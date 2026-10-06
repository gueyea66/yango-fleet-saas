import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import {
  buildReportHtml, getReportAddonTenants, getReportPremiumTenants, type FleetReportKind,
} from "@/lib/reportHtml";
import { isSegmentFilter } from "@/lib/analytics/segment";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // panel IA premium : plusieurs appels LLM

// Rapport d'activité à la demande (admin client). Service complémentaire :
// activé PAR TENANT depuis la console super admin — indépendant du plan.
//  - ?type=monthly (défaut) : inclus dans l'add-on rapport ;
//  - ?type=hebdo : point hebdomadaire d'exploitation, mois en cours à date
//    (du 1er du mois de dateTo à dateTo) — inclus dans l'add-on rapport ;
//  - ?type=ytd | deepdive : réservés au niveau premium (comme la narration
//    multi-agent, appliquée automatiquement aux tenants premium).
// La génération elle-même vit dans lib/reportHtml.ts (partagée avec la
// génération en lot super admin et le cron mensuel).
export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    const addonTenants = await getReportAddonTenants();
    if (!addonTenants.includes(tenantId)) {
      return NextResponse.json(
        { error: "Le rapport d'activité est un service complémentaire non activé sur ce compte. Contactez M3A Group pour l'activer." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const rawType = searchParams.get("type") || "monthly";
    if (!["monthly", "ytd", "deepdive", "hebdo"].includes(rawType)) {
      return NextResponse.json({ error: "type invalide (monthly | hebdo | ytd | deepdive)" }, { status: 400 });
    }
    const kind = rawType as FleetReportKind;

    const premium = (await getReportPremiumTenants()).includes(tenantId);
    if (kind !== "monthly" && kind !== "hebdo" && !premium) {
      return NextResponse.json(
        { error: "Les bilans année-à-date et deep dives font partie du niveau premium du service Rapports. Contactez M3A Group pour l'activer." },
        { status: 403 }
      );
    }

    const now = new Date();
    const defFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const dateFrom = searchParams.get("dateFrom") || defFrom;
    const today = now.toISOString().slice(0, 10);
    let dateTo = searchParams.get("dateTo") || today;
    // point hebdomadaire : « à date » ne dépasse jamais aujourd'hui (le filtre peut finir en fin de mois)
    if (kind === "hebdo" && dateTo > today) dateTo = today;

    // ?segment=interne | partenaire : rapport limité à un périmètre (défaut : toute la flotte)
    const segParam = searchParams.get("segment");
    const segment = isSegmentFilter(segParam) ? segParam : "all";
    const { html } = await buildReportHtml(tenantId, dateFrom, dateTo, { kind, premium, segment });
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: e.status ?? 500 });
  }
}
