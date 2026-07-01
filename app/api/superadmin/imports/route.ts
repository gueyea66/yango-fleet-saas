import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp, resolveSuperadminKey } from "@/lib/auth/server";

const serviceClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifySuperadmin(req: NextRequest): Promise<boolean> {
  const key = req.headers.get("x-superadmin-key") ?? "";
  const ip = getClientIp(req);
  const storedKey = await resolveSuperadminKey(async () => {
    const { data } = await serviceClient
      .schema("fleet")
      .from("superadmin_settings")
      .select("value")
      .eq("key", "superadmin_key")
      .single();
    return data?.value ?? null;
  });
  return checkSuperadminKey(key, storedKey, ip);
}

/* ── GET — liste tous les imports (toutes flottes) avec infos tenant ── */
export async function GET(req: NextRequest) {
  if (!(await verifySuperadmin(req))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "admin_confirmed";

  const { data, error } = await serviceClient
    .schema("fleet")
    .from("import_batches")
    .select(`
      id, status, row_count, valid_count, error_count, duplicate_count,
      date_from, date_to, drivers_found, admin_notes,
      created_at, admin_confirmed_at, injected_at, injected_count,
      tenant_id,
      tenants:tenant_id ( slug, name, plan )
    `)
    .eq("status", status)
    .order("admin_confirmed_at", { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imports: data });
}
