import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";
import {
  generateAndStoreReport, getReportAddonTenants, getReportPremiumTenants,
  previousMonthRange, type FleetReportKind,
} from "@/lib/reportHtml";

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
 * body : { superadminKey, tenantIds?: string[], dateFrom?, dateTo?, types?: FleetReportKind[] }
 *  - tenantIds absent → TOUS les tenants dont l'add-on est activé ;
 *  - tenantIds fourni → intersection avec les tenants activés (éligibilité stricte) ;
 *  - période absente → mois précédent complet ;
 *  - types absent → ["monthly"] ; ytd/deepdive ne sont générés que pour les
 *    tenants premium (qui reçoivent aussi la narration multi-agent).
 * Chaque rapport est stocké (bucket privé) et l'admin du client est notifié.
 */
export async function POST(req: NextRequest) {
  const { superadminKey, tenantIds, dateFrom, dateTo, types } = await req.json();

  const storedKey = await getStoredKey();
  if (!checkSuperadminKey(superadminKey, storedKey, getClientIp(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [addon, premiumList] = await Promise.all([getReportAddonTenants(), getReportPremiumTenants()]);
  const targets: string[] = Array.isArray(tenantIds) && tenantIds.length > 0
    ? tenantIds.filter((id: string) => addon.includes(id))
    : addon;
  if (targets.length === 0) {
    return NextResponse.json({ error: "Aucun client éligible (add-on rapport non activé)." }, { status: 400 });
  }

  const askedTypes: FleetReportKind[] = (Array.isArray(types) && types.length > 0 ? types : ["monthly"])
    .filter((t: string): t is FleetReportKind => ["monthly", "ytd", "deepdive"].includes(t));
  const range = dateFrom && dateTo ? { dateFrom, dateTo } : previousMonthRange();

  const generated: { tenantId: string; kind: FleetReportKind; file: string; period: string; narrated: boolean }[] = [];
  const errors: { tenantId: string; kind: FleetReportKind; error: string }[] = [];
  for (const tid of targets) {
    const premium = premiumList.includes(tid);
    const kinds = askedTypes.filter((k) => k === "monthly" || premium);
    for (const kind of kinds) {
      try {
        const r = await generateAndStoreReport(tid, range.dateFrom, range.dateTo, { kind, premium });
        generated.push({ tenantId: tid, kind, ...r });
      } catch (e) {
        errors.push({ tenantId: tid, kind, error: e instanceof Error ? e.message : "?" });
      }
    }
  }
  return NextResponse.json({ generated, errors, period: range });
}
