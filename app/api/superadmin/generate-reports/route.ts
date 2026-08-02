import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";
import { generateAndStoreReport, getReportAddonTenants, previousMonthRange } from "@/lib/reportHtml";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

async function getStoredKey(): Promise<string> {
  const { data } = await adminClient.from("superadmin_settings").select("value").eq("key", "access_key").single();
  return data?.value ?? process.env.SUPERADMIN_KEY ?? "";
}

/**
 * Génération en lot des rapports d'activité (console super admin).
 * body : { superadminKey, tenantIds?: string[], dateFrom?, dateTo? }
 *  - tenantIds absent → TOUS les tenants dont l'add-on est activé ;
 *  - tenantIds fourni → intersection avec les tenants activés (éligibilité stricte) ;
 *  - période absente → mois précédent complet.
 * Chaque rapport est stocké (bucket privé) et l'admin du client est notifié.
 */
export async function POST(req: NextRequest) {
  const { superadminKey, tenantIds, dateFrom, dateTo } = await req.json();

  const storedKey = await getStoredKey();
  if (!checkSuperadminKey(superadminKey, storedKey, getClientIp(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const addon = await getReportAddonTenants();
  const targets: string[] = Array.isArray(tenantIds) && tenantIds.length > 0
    ? tenantIds.filter((id: string) => addon.includes(id))
    : addon;
  if (targets.length === 0) {
    return NextResponse.json({ error: "Aucun client éligible (add-on rapport non activé)." }, { status: 400 });
  }

  const range = dateFrom && dateTo ? { dateFrom, dateTo } : previousMonthRange();

  const generated: { tenantId: string; file: string; period: string }[] = [];
  const errors: { tenantId: string; error: string }[] = [];
  for (const tid of targets) {
    try {
      const r = await generateAndStoreReport(tid, range.dateFrom, range.dateTo);
      generated.push({ tenantId: tid, ...r });
    } catch (e) {
      errors.push({ tenantId: tid, error: e instanceof Error ? e.message : "?" });
    }
  }
  return NextResponse.json({ generated, errors, period: range });
}
