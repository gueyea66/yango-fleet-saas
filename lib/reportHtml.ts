import { createClient } from "@supabase/supabase-js";
import { narrate } from "@/lib/ai/llmGateway";
import { runAgentPanel } from "@/lib/report-agent/agents";
import { renderReport } from "@/lib/report-agent/render";
import type { BrandTheme, NarrativeResult } from "@/lib/report-agent/types";
import { buildFleetDataset, type FleetReportKind } from "@/lib/reportAdapters/fleet";

/**
 * Génération du rapport d'activité (HTML brandé, imprimable).
 * Brique partagée entre :
 *  - GET /api/admin/report-monthly (génération à la demande par l'admin client)
 *  - POST /api/superadmin/generate-reports (génération en lot + push storage)
 *  - GET /api/internal/monthly-reports (cron Vercel du 1er du mois)
 *
 * Architecture : lib/reportAdapters/fleet.ts calcule le dataset (formules
 * IDENTIQUES au recap — aucun montant recalculé ailleurs), lib/report-agent/
 * (noyau NEUTRE et copiable, voir son README) orchestre le panel IA et rend
 * le HTML. Trois types de rapports : monthly (standard), ytd et deepdive
 * (premium). Le panel IA (narration multi-agent) est réservé au premium.
 *
 * Kill-switch global : REPORT_AGENT=off → narration désactivée partout,
 * les rapports sortent en mode déterministe (jamais bloquant).
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export const REPORTS_BUCKET = "activity-reports";
export type { FleetReportKind };

async function settingsList(key: string): Promise<string[]> {
  const { data } = await admin.from("superadmin_settings")
    .select("value").eq("key", key).maybeSingle();
  try {
    const v = JSON.parse(data?.value || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Tenants pour lesquels l'add-on « Rapport d'activité » est activé (console super admin). */
export async function getReportAddonTenants(): Promise<string[]> {
  return settingsList("report_addon_tenants");
}

/** Tenants premium : narration multi-agent + rapports YTD et deep dive. */
export async function getReportPremiumTenants(): Promise<string[]> {
  return settingsList("report_premium_tenants");
}

/** Mois précédent complet [du 1er, au dernier jour] — période par défaut des générations automatiques. */
export function previousMonthRange(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { dateFrom: first.toISOString().slice(0, 10), dateTo: last.toISOString().slice(0, 10) };
}

function fleetTheme(tenantName: string): BrandTheme {
  return {
    brandName: tenantName || "M3A FLEET",
    tagline: "Gestion de flotte Yango · Dakar",
    footerBrand: "M3A GROUP",
  };
}

export interface BuildReportOptions {
  kind?: FleetReportKind;   // défaut : monthly
  premium?: boolean;        // narration multi-agent (l'appelant a déjà vérifié l'éligibilité)
}

export async function buildReportHtml(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  opts: BuildReportOptions = {}
): Promise<{ html: string; period: string; tenantName: string; narrated: boolean }> {
  const kind = opts.kind ?? "monthly";
  const { dataset, tenantName } = await buildFleetDataset(tenantId, dateFrom, dateTo, kind);

  let narrative: NarrativeResult | null = null;
  const agentOn = (process.env.REPORT_AGENT ?? "on") !== "off";
  if (opts.premium && agentOn) {
    try {
      narrative = await runAgentPanel(dataset, {
        narrate,
        editorModel: process.env.REPORT_AGENT_MODEL || "claude-sonnet-5",
        decisionsTitle: "Décisions proposées pour la période suivante",
        timeoutMs: 90_000,
      });
    } catch (e) {
      console.error("[report] panel IA indisponible (repli déterministe):", e instanceof Error ? e.message : e);
    }
  }

  const html = renderReport(dataset, fleetTheme(tenantName), narrative, {
    decisionsTitle: "Décisions proposées pour la période suivante",
  });
  const period = `${dateFrom.slice(8, 10)}/${dateFrom.slice(5, 7)}/${dateFrom.slice(0, 4)} → ${dateTo.slice(8, 10)}/${dateTo.slice(5, 7)}/${dateTo.slice(0, 4)}`;
  return { html, period, tenantName, narrated: narrative !== null };
}

/**
 * Génère + stocke le rapport d'un tenant dans le bucket privé, puis notifie
 * l'admin du tenant (in-app + web push). Retourne le nom du fichier stocké.
 */
export async function generateAndStoreReport(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  opts: BuildReportOptions = {}
): Promise<{ file: string; period: string; narrated: boolean }> {
  const kind = opts.kind ?? "monthly";
  const { html, period, narrated } = await buildReportHtml(tenantId, dateFrom, dateTo, opts);

  // Bucket privé, créé au premier passage (idempotent).
  await admin.storage.createBucket(REPORTS_BUCKET, { public: false }).catch(() => { /* existe déjà */ });

  const prefix = kind === "monthly" ? "rapport" : kind === "ytd" ? "bilan-ytd" : "deepdive";
  const file = `${prefix}_${dateFrom}_${dateTo}.html`;
  const { error } = await admin.storage.from(REPORTS_BUCKET)
    .upload(`${tenantId}/${file}`, Buffer.from(html, "utf-8"), {
      contentType: "text/html; charset=utf-8",
      upsert: true,
    });
  if (error) throw new Error(`stockage du rapport impossible: ${error.message}`);

  // Notification best-effort : l'échec de la notif ne doit pas annuler la génération.
  try {
    const { sendNotification, getTenantAdminId } = await import("./notifications");
    const adminId = await getTenantAdminId(tenantId);
    if (adminId) {
      const label = kind === "monthly" ? "rapport d'activité" : kind === "ytd" ? "bilan année-à-date" : "deep dive opérations";
      await sendNotification(
        tenantId, adminId, "report_available",
        `📊 Votre ${label} est disponible`,
        `Document de la période ${period} — consultez-le depuis Exporter → Rapports reçus.`,
        { url: "/admin" }
      );
    }
  } catch (e) {
    console.error("[report] notification failed:", e instanceof Error ? e.message : e);
  }

  return { file, period, narrated };
}
