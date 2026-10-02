/**
 * GET / PUT /api/admin/objectifs — objectif de CA par jour et par chauffeur.
 * Tenant toujours issu de la session admin (requireAdminAuth) ; le client
 * service-role ignore la RLS, d'où le filtre tenant_id explicite.
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { OBJECTIF_DEFAUT } from "@/lib/analytics/trends";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const MIN = 1_000, MAX = 10_000_000;
const MIGRATION_MSG = "Réglage indisponible : la migration 074 (objectif_ca_jour) n'est pas encore appliquée.";

export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const { data, error } = await admin.from("remuneration_config").select("objectif_ca_jour").eq("tenant_id", tenantId).limit(1);
    if (error) return NextResponse.json({ objectif: OBJECTIF_DEFAUT, modifiable: false, message: MIGRATION_MSG });
    const v = Number(data?.[0]?.objectif_ca_jour);
    return NextResponse.json({ objectif: v > 0 ? v : OBJECTIF_DEFAUT, modifiable: true });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return NextResponse.json({ error: e.status ? e.message : "Erreur" }, { status: e.status ?? 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const body = await req.json().catch(() => ({}));
    const v = Math.round(Number(body?.objectif));
    if (!Number.isFinite(v) || v < MIN || v > MAX) {
      return NextResponse.json({ error: `Objectif invalide (entre ${MIN} et ${MAX})` }, { status: 400 });
    }
    const { data: rows, error: readErr } = await admin.from("remuneration_config").select("id").eq("tenant_id", tenantId).limit(1);
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    const { error } = rows?.length
      ? await admin.from("remuneration_config").update({ objectif_ca_jour: v }).eq("tenant_id", tenantId)
      : await admin.from("remuneration_config").insert({ tenant_id: tenantId, objectif_ca_jour: v });
    if (error) {
      // 42703 = colonne inconnue : migration non appliquée
      const status = error.code === "42703" || /objectif_ca_jour/.test(error.message) ? 409 : 500;
      return NextResponse.json({ error: status === 409 ? MIGRATION_MSG : "Enregistrement impossible" }, { status });
    }
    return NextResponse.json({ objectif: v, modifiable: true });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return NextResponse.json({ error: e.status ? e.message : "Erreur" }, { status: e.status ?? 500 });
  }
}
