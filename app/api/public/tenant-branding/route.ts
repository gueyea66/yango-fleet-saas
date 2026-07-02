import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

/**
 * GET /api/public/tenant-branding?slug=xxx
 * Branding public d'un tenant — nécessaire AVANT connexion (page de login).
 * Whitelist stricte de champs : aucune donnée métier ni de configuration privée.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug")?.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  if (!slug) return NextResponse.json({ error: "slug requis" }, { status: 400 });

  const { data: tenant } = await adminClient
    .from("tenants")
    .select("id, slug, name, plan, active")
    .eq("slug", slug)
    .single();

  if (!tenant) return NextResponse.json({ error: "Tenant introuvable" }, { status: 404 });

  const { data: settings } = await adminClient
    .from("tenant_settings")
    .select("app_name, logo_url, primary_color, currency, timezone, operator_name")
    .eq("tenant_id", tenant.id)
    .single();

  return NextResponse.json(
    { tenant, settings: settings ?? null },
    // Cache CDN 5 min — le branding change rarement
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
