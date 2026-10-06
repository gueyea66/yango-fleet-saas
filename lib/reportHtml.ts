import { createClient } from "@supabase/supabase-js";
import { narrate } from "@/lib/ai/llmGateway";
import { runAgentPanel } from "@/lib/report-agent/agents";
import { renderReport } from "@/lib/report-agent/render";
import type { BrandTheme, NarrativeResult } from "@/lib/report-agent/types";
import { buildFleetDataset, debutDuMois, type FleetReportKind } from "@/lib/reportAdapters/fleet";
import type { SegmentFilter } from "@/lib/analytics/segment";

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
 * le HTML. Quatre types de rapports : monthly et hebdo (standard), ytd et
 * deepdive (premium). Le panel IA (narration multi-agent) est réservé au premium.
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

/**
 * Comptes pour lesquels un rapport automatique a un sens (demande d'Abdou, 04/10/2026 :
 * « inutile de générer pour les inactifs »). Un compte est écarté s'il est désactivé,
 * si son essai ou son abonnement est échu, ou s'il n'a aucune journée validée sur la
 * période. La génération à la demande par l'admin du client n'est pas concernée.
 */
export async function activeReportTenants(
  tenantIds: string[], dateFrom: string, dateTo: string,
): Promise<{ active: string[]; skipped: { tenantId: string; name: string; reason: string }[] }> {
  if (tenantIds.length === 0) return { active: [], skipped: [] };
  const { data: tenants } = await admin.from("tenants")
    .select("id, name, active, trial_ends_at, plan_expires_at").in("id", tenantIds);
  const byId = new Map((tenants || []).map((t) => [t.id as string, t]));
  const active: string[] = [];
  const skipped: { tenantId: string; name: string; reason: string }[] = [];
  for (const id of tenantIds) {
    const t = byId.get(id);
    const skip = (reason: string) => skipped.push({ tenantId: id, name: t?.name || id, reason });
    if (!t) { skip("compte introuvable"); continue; }
    if (t.active === false) { skip("compte désactivé"); continue; }
    const echeance = t.plan_expires_at ?? t.trial_ends_at;
    if (!echeance || new Date(echeance).getTime() <= Date.now()) { skip("essai ou abonnement échu"); continue; }
    const { count } = await admin.from("daily_reports").select("id", { count: "exact", head: true })
      .eq("tenant_id", id).eq("status", "approved").gte("date", dateFrom).lte("date", dateTo)
      .not("comment", "like", "[REPOS]%");
    if (!count) { skip("aucune journée validée sur la période"); continue; }
    active.push(id);
  }
  return { active, skipped };
}

/** Mois précédent complet [du 1er, au dernier jour] — période par défaut des générations automatiques. */
export function previousMonthRange(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { dateFrom: first.toISOString().slice(0, 10), dateTo: last.toISOString().slice(0, 10) };
}

/**
 * Période du point hebdomadaire : du 1er du mois à la veille (mois en cours à
 * date). Lancé un lundi 1er, il couvre donc le mois qui vient de se terminer.
 */
export function monthToDateRange(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const dateTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString().slice(0, 10);
  return { dateFrom: debutDuMois(dateTo), dateTo };
}

const PREFIXE: Record<FleetReportKind, string> = { monthly: "rapport", ytd: "bilan-ytd", deepdive: "deepdive", hebdo: "point-hebdo" };
const LIBELLE: Record<FleetReportKind, string> = { monthly: "rapport d'activité", ytd: "bilan année-à-date", deepdive: "deep dive opérations", hebdo: "point hebdomadaire d'exploitation" };

function fleetTheme(tenantName: string, platformLabel: string): BrandTheme {
  return {
    brandName: tenantName || "M3A FLEET",
    tagline: platformLabel === "Yango" ? "Gestion de flotte Yango · Dakar" : "Gestion de flotte · Dakar",
    footerBrand: tenantName || "M3A GROUP",
  };
}

export interface BuildReportOptions {
  kind?: FleetReportKind;   // défaut : monthly
  premium?: boolean;        // narration multi-agent (l'appelant a déjà vérifié l'éligibilité)
  /** Périmètre : toute la flotte (défaut), flotte interne seule ou véhicules partenaires seuls. */
  segment?: SegmentFilter;
}

export async function buildReportHtml(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  opts: BuildReportOptions = {}
): Promise<{ html: string; period: string; tenantName: string; narrated: boolean }> {
  const kind = opts.kind ?? "monthly";
  // point hebdomadaire : toujours le mois en cours à date, quelle que soit la période demandée
  if (kind === "hebdo") dateFrom = debutDuMois(dateTo);
  const { dataset, tenantName, platformLabel } = await buildFleetDataset(tenantId, dateFrom, dateTo, kind, opts.segment ?? "all");

  let narrative: NarrativeResult | null = null;
  const agentOn = (process.env.REPORT_AGENT ?? "on") !== "off";
  if (opts.premium && agentOn) {
    try {
      // Rôles ET rédacteur sur Sonnet : Haiku calcule/arrondit malgré la consigne
      // et se fait rejeter par le garde (observé en prod 02-03/09, brief compris).
      narrative = await runAgentPanel(dataset, {
        narrate,
        editorModel: process.env.REPORT_AGENT_MODEL || "claude-sonnet-5",
        roleModel: process.env.REPORT_AGENT_MODEL || "claude-sonnet-5",
        decisionsTitle: "Décisions proposées pour la période suivante",
        timeoutMs: 120_000,
      });
    } catch (e) {
      console.error("[report] panel IA indisponible (repli déterministe):", e instanceof Error ? e.message : e);
    }
  }

  const html = renderReport(dataset, fleetTheme(tenantName, platformLabel), narrative, {
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

  const file = `${PREFIXE[kind]}_${kind === "hebdo" ? debutDuMois(dateTo) : dateFrom}_${dateTo}.html`;
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
      const label = LIBELLE[kind];
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
