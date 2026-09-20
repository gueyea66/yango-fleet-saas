import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { tenantAccessState } from "@/lib/tenant/access";

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
    // select("*") : tolère l'absence de colonnes récentes (ex: active avant migration 029)
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Chauffeur désactivé → déconnexion + retour login (son historique reste en base)
    if (profile?.role === "driver" && (profile as any).active === false) {
      await supabase.auth.signOut();
      const redirect = NextResponse.redirect(new URL("/auth/login?disabled=1", request.url));
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }

    if (profile?.tenant_id) {
      // select("*") : `never_expires` arrive avec la migration 061 — tolérer
      // son absence évite de verrouiller tout le monde si le code part avant.
      const { data: tenant } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", profile.tenant_id)
        .single();

      // Règle d'accès unique (lib/tenant/access) — même verdict qu'en API.
      const access = tenant ? tenantAccessState(tenant) : null;
      if (access?.locked && path !== "/locked") {
        return NextResponse.redirect(new URL(`/locked?reason=${access.reason}`, request.url));
      }
    }
  }

  return response;
};
