/**
 * Orchestrateur du batch quotidien (06h00 UTC = 06h00 Dakar).
 * Par tenant en rollout : agrégats → insights → briefing (narration LLM
 * pseudonymisée) → recommandations → notification push admin.
 * Écritures UNIQUEMENT dans les tables ai_* (le trigger 033 protège la
 * réécriture ; les upserts sont idempotents → relance sans doublon).
 */
import { aiAdmin } from "./adminClient";
import { isAiEnabled } from "./killSwitch";
import { DEFAULT_THRESHOLDS } from "./killSwitch";
import {
  computePeriodAggregates, confidenceFromCoverage, fetchTenantWindow, freshnessSnapshot,
} from "./dataReader";
import { buildKpiInsights, paramsHash } from "./insightEngine";
import { runRules } from "./recommendationEngine";
import { narrate, narrativeCitesOnlyKnownNumbers } from "./llmGateway";
import { AI_CALC_VERSION, BriefingContent, BriefingDriver, BriefingKpi } from "./types";
import { projeterResultat, joursOuvresProjetes, joursOuvresRealises } from "@/lib/calc";
import { sendNotification, getTenantAdminId } from "@/lib/notifications";
import type { SalaryTier } from "@/lib/tenant/types";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface BatchResult {
  tenantId: string;
  insights: number;
  recommendations: number;
  briefing: "complete" | "degraded" | "skipped";
  error?: string;
}

/** Lance le batch pour tous les tenants en rollout (ou un tenant précis). */
export async function runDailyBatch(onlyTenantId?: string): Promise<BatchResult[]> {
  if (!(await isAiEnabled())) return [];

  const admin = aiAdmin();
  let q = admin.from("ai_config")
    .select("tenant_id, rollout_stage, thresholds, llm_model_override")
    .neq("rollout_stage", "disabled");
  if (onlyTenantId) q = q.eq("tenant_id", onlyTenantId);
  const { data: configs } = await q;

  const results: BatchResult[] = [];
  for (const cfg of configs ?? []) {
    try {
      results.push(await runTenantBatch(cfg.tenant_id, {
        thresholds: { ...DEFAULT_THRESHOLDS, ...(cfg.thresholds ?? {}) },
        llmModel: cfg.llm_model_override ?? null,
      }));
    } catch (err) {
      console.error(`[ai/batch] tenant ${cfg.tenant_id}:`, err);
      results.push({
        tenantId: cfg.tenant_id, insights: 0, recommendations: 0,
        briefing: "skipped", error: String(err).slice(0, 200),
      });
    }
  }
  return results;
}

async function runTenantBatch(
  tenantId: string,
  opts: { thresholds: typeof DEFAULT_THRESHOLDS; llmModel: string | null }
): Promise<BatchResult> {
  const admin = aiAdmin();
  const now = Date.now();
  const today = iso(now);
  const computedAt = new Date(now).toISOString();

  const win = await fetchTenantWindow(tenantId, 70);
  const snapshot = freshnessSnapshot(win);

  // Périodes : 7 derniers jours clos (J-7 → J-1) vs 7 précédents ; ratio carburant sur 30 j.
  const curFrom = iso(now - 7 * DAY), curTo = iso(now - DAY);
  const prevFrom = iso(now - 14 * DAY), prevTo = iso(now - 8 * DAY);
  const histFrom = iso(now - 30 * DAY);

  const cur = computePeriodAggregates(win, curFrom, curTo, histFrom);
  const prev = computePeriodAggregates(win, prevFrom, prevTo, histFrom);
  const confidence = confidenceFromCoverage(cur);

  // ── 1. Insights (upsert idempotent par tenant/kpi/période) ───────────
  const drafts = buildKpiInsights({ tenantId, cur, prev, thresholds: opts.thresholds });
  let insightCount = 0;
  for (const d of drafts) {
    // Narration du seul insight net_operationnel (décomposition riche)
    let narrative: string | null = null;
    if (d.kpi_name === "net_operationnel" && d.causes.length) {
      const payload = JSON.stringify({
        kpi: d.kpi_name, delta_fcfa: d.delta_value, delta_pct: d.delta_pct,
        periode: { de: d.period_start, a: d.period_end }, causes: d.causes,
      });
      narrative = await narrate(payload, { model: opts.llmModel });
      if (narrative && !narrativeCitesOnlyKnownNumbers(narrative, payload)) {
        console.warn("[ai/batch] narration rejetée (chiffre étranger au payload)");
        narrative = null;
      }
    }
    const { error } = await admin.from("ai_insights").upsert({
      tenant_id: tenantId,
      kpi_name: d.kpi_name,
      period_start: d.period_start, period_end: d.period_end,
      current_value: d.current_value, previous_value: d.previous_value,
      delta_value: d.delta_value, delta_pct: d.delta_pct,
      causes: d.causes,
      narrative_fr: narrative,
      computed_at: computedAt,
      data_freshness_snapshot: snapshot,
      confidence_score: confidence,
      calculation_source: d.calculation_source,
      status: narrative ? "unread" : "degraded",
      expires_at: new Date(now + DAY).toISOString(),
    }, { onConflict: "tenant_id,kpi_name,period_start,period_end", ignoreDuplicates: true });
    if (!error) insightCount++;
  }

  // ── 2. Recommandations (l'index unique partiel déduplique par jour) ──
  const tiers = await loadSalaryTiers(tenantId);
  const recos = runRules({
    tenantId, today, win, salaryTiers: tiers,
    thresholds: { carburant_km_delta_pct: opts.thresholds.carburant_km_delta_pct },
  });
  let recoCount = 0;
  for (const r of recos) {
    const { error } = await admin.from("ai_recommendations").insert({
      tenant_id: tenantId, driver_id: r.driver_id, rule_id: r.rule_id,
      priority: r.priority, impact_fcfa: r.impact_fcfa,
      title_fr: r.title_fr.slice(0, 200), detail_fr: r.detail_fr,
      action_context: r.action_context, computed_at: computedAt,
      calculation_source: r.calculation_source,
      expires_at: new Date(now + 2 * DAY).toISOString(),
    });
    if (!error) recoCount++; // erreur 23505 = doublon du jour → silencieux, voulu
  }

  // ── 3. Briefing du jour (1/jour, jamais réécrit) ─────────────────────
  const { data: existing } = await admin.from("ai_briefings")
    .select("id").eq("tenant_id", tenantId).eq("briefing_date", today).maybeSingle();
  let briefingStatus: BatchResult["briefing"] = "skipped";

  if (!existing) {
    const content = await buildBriefingContent(tenantId, today, win, cur, prev, tiers, opts.llmModel);
    briefingStatus = content.narrative_fr ? "complete" : "degraded";
    const { error } = await admin.from("ai_briefings").insert({
      tenant_id: tenantId, briefing_date: today,
      content_json: content, status: briefingStatus,
      computed_at: computedAt, data_freshness_snapshot: snapshot,
      confidence_score: confidence,
      calculation_source: {
        function: "computePeriodAggregates+projeterResultat",
        version: AI_CALC_VERSION,
        params_hash: paramsHash(tenantId, curFrom, curTo),
      },
      push_summary: buildPushSummary(content),
    });
    if (error) {
      briefingStatus = "skipped";
      console.error("[ai/batch] briefing insert:", error.message);
    } else {
      const adminId = await getTenantAdminId(tenantId);
      if (adminId) {
        await sendNotification(
          tenantId, adminId, "report_reminder",
          "Briefing du jour",
          buildPushSummary(content) ?? "Votre briefing quotidien est prêt.",
          { url: "/admin" }
        ).catch(() => {}); // best-effort — le briefing reste consultable dans l'app
      }
    }
  }

  return { tenantId, insights: insightCount, recommendations: recoCount, briefing: briefingStatus };
}

async function loadSalaryTiers(tenantId: string): Promise<SalaryTier[]> {
  const { data } = await aiAdmin().from("remuneration_config")
    .select("model, salary_tiers").eq("tenant_id", tenantId).maybeSingle();
  if (!data || data.model !== "tiered" || !Array.isArray(data.salary_tiers)) return [];
  return data.salary_tiers as SalaryTier[];
}

async function buildBriefingContent(
  tenantId: string, today: string,
  win: Awaited<ReturnType<typeof fetchTenantWindow>>,
  cur: ReturnType<typeof computePeriodAggregates>,
  prev: ReturnType<typeof computePeriodAggregates>,
  tiers: SalaryTier[],
  llmModel: string | null
): Promise<BriefingContent> {
  const [y, m] = today.split("-").map(Number);
  const monthStart = today.slice(0, 8) + "01";
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${today.slice(0, 8)}${String(daysInMonth).padStart(2, "0")}`;
  const joursRestants = daysInMonth - Number(today.slice(8, 10));

  // Projection fin de mois : net opérationnel MTD projeté sur les jours ouvrés
  const mtd = computePeriodAggregates(win, monthStart, today, iso(Date.parse(today) - 30 * DAY));
  const netProjete = projeterResultat({
    resultatRealise: mtd.netOperationnel,
    joursOuvresEcoules: Math.max(1, joursOuvresRealises(monthStart, today, [])),
    joursOuvresCible: joursOuvresProjetes(monthStart, monthEnd),
  });

  const deltaPct = (c: number, p: number) => (p !== 0 ? Math.round(((c - p) / Math.abs(p)) * 1000) / 10 : null);
  const kpis: BriefingKpi[] = [
    { kpi_name: "net_operationnel", value: cur.netOperationnel, unit: "FCFA", delta_pct_wow: deltaPct(cur.netOperationnel, prev.netOperationnel), badge: "calculated" },
    { kpi_name: "carburant_km", value: cur.coutCarburantParKm, unit: "FCFA/km", delta_pct_wow: deltaPct(cur.coutCarburantParKm, prev.coutCarburantParKm), badge: "calculated" },
    { kpi_name: "taux_soumission", value: cur.tauxSoumission, unit: "%", delta_pct_wow: deltaPct(cur.tauxSoumission, prev.tauxSoumission), badge: "calculated" },
  ];

  // Chauffeurs : CA MTD + projection + palier (pseudonymisés pour le LLM)
  const sortedTiers = [...tiers].sort((a, b) => a.min_net - b.min_net);
  const dayOfMonth = Math.max(1, Number(today.slice(8, 10)));
  const chauffeurs: BriefingDriver[] = win.drivers
    .filter((d) => d.active !== false)
    .map((d) => {
      const ca = win.reports
        .filter((r) => r.driver_id === d.id && (r.status === "approved" || r.status === "submitted")
          && r.date >= monthStart && r.date <= today)
        .reduce((s, r) => s + (r.yango_gross ?? 0) + (r.yango_bonus ?? 0) + (r.off_yango_revenue ?? 0), 0);
      const projete = Math.round(ca + (ca / dayOfMonth) * joursRestants);
      const cible = sortedTiers.find((t) => t.min_net > projete && t.min_net > 0);
      return {
        driver_id: d.id,
        driver_ref: "drv_" + d.id.replace(/-/g, "").slice(0, 4),
        driver_name: d.full_name ?? "Chauffeur",
        ca_mtd_fcfa: Math.round(ca),
        ca_projete_fcfa: projete,
        palier_cible_fcfa: cible?.min_net ?? null,
        a_risque: !!cible && cible.min_net - projete <= cible.min_net * 0.15,
      };
    })
    .filter((c) => c.ca_mtd_fcfa > 0);

  const projections = {
    net_projete_fcfa: netProjete,
    jours_restants_mois: joursRestants,
    hypotheses: ["6 jours travaillés sur 7", "rythme du mois en cours maintenu", "salaires mensuels non déduits"],
  };

  // Payload LLM : pseudonymes uniquement, agrégats uniquement
  const llmPayload = JSON.stringify({
    date: today, kpis,
    chauffeurs: chauffeurs.map(({ driver_id: _id, driver_name: _n, ...safe }) => safe),
    projections,
  });
  let narrative = await narrate(llmPayload, { model: llmModel });
  if (narrative && !narrativeCitesOnlyKnownNumbers(narrative, llmPayload)) {
    console.warn("[ai/batch] narration briefing rejetée (chiffre étranger)");
    narrative = null;
  }
  // Résolution pseudonyme → prénom APRÈS le LLM (jamais de nom dans le prompt)
  if (narrative) {
    for (const c of chauffeurs) {
      narrative = narrative.split(c.driver_ref).join(c.driver_name.split(" ")[0]);
    }
  }

  return {
    narrative_fr: narrative,
    degraded_message_fr: narrative ? null
      : "Analyse narrative indisponible — les chiffres calculés restent affichés.",
    kpis,
    chauffeurs: chauffeurs.map(({ driver_ref: _r, ...rest }) => rest),
    projections,
  };
}

function buildPushSummary(content: BriefingContent): string | null {
  const net = content.kpis.find((k) => k.kpi_name === "net_operationnel");
  if (!net) return null;
  const fmt = new Intl.NumberFormat("fr-FR").format(Math.round(net.value));
  const risque = content.chauffeurs.filter((c) => c.a_risque).length;
  const parts = [`Net 7j : ${fmt} FCFA`];
  if (risque > 0) parts.push(`${risque} chauffeur(s) à surveiller`);
  return parts.join(" · ").slice(0, 140);
}
