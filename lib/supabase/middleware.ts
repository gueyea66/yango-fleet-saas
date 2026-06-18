import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PREFIXES = ["/admin", "/driver"];

export const updateSession = async (request: NextRequest) => {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = (createServerClient as Function)(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "fleet" },
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(p => path.startsWith(p));

  // Not logged in → login
  if (isProtected && !user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // Logged in on protected route → check tenant expiry
  if (isProtected && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profile?.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("active, trial_ends_at, plan_expires_at")
        .eq("id", profile.tenant_id)
        .single();

      if (tenant) {
        // Suspended by superadmin
        if (!tenant.active) {
          return NextResponse.redirect(new URL("/locked", request.url));
        }

        // Check expiry: plan_expires_at takes priority over trial_ends_at
        const expiresAt = tenant.plan_expires_at ?? tenant.trial_ends_at;
        if (expiresAt) {
          const expired = new Date(expiresAt).getTime() < Date.now();
          if (expired && path !== "/locked") {
            return NextResponse.redirect(new URL("/locked", request.url));
          }
        }
      }
    }
  }

  return response;
};
