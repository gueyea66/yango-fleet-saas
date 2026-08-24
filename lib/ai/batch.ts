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
  isReposReport, topExpenseMovements,
} from "./dataReader";
import { buildKpiInsights, describeCauses, paramsHash } from "./insightEngine";
import { runRules } from "./recommendationEngine";
import { runAdvancedRules } from "./advancedRules";
import { extractJsonObject, foreignNumbers, narrate, narrativeCitesOnlyKnownNumbers } from "./llmGateway";
import { buildDeterministicBriefing } from "./briefingFallback";
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
export async function runDailyBatch(
  onlyTenantId?: string,
  batchOpts: { forceWeekly?: boolean } = {}
): Promise<BatchResult[]> {
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
        forceWeekly: batchOpts.forceWeekly,
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
  opts: { thresholds: typeof DEFAULT_THRESHOLDS; llmModel: string | null; forceWeekly?: boolean }
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
      // Causes décrites en clair (hausse/baisse pré-calculées) : le LLM ne doit
      // jamais interpréter le signe d'une contribution — observé en prod le 29/07.
      const payload = JSON.stringify({
        kpi: d.kpi_name, delta_fcfa: d.delta_value, delta_pct: d.delta_pct,
        periode: { de: d.period_start, a: d.period_end, jours_ouvres: cur.joursOuvres },
        periode_precedente: { de: prevFrom, a: prevTo, jours_ouvres: prev.joursOuvres },
        net_par_jour_ouvre: { actuel_fcfa: cur.netParJourOuvre, precedent_fcfa: prev.netParJourOuvre },
        causes: describeCauses(d.causes),
        consigne: "Recopier le champ 'evolution' de chaque cause tel quel (sens déjà calculé). " +
          "Si jours_ouvres diffère entre les deux périodes, le dire et t'appuyer sur net_par_jour_ouvre (déjà calculé).",
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

  // Phase 1.1 — règles avancées (analyse croisée 29/07). Les croisements lourds
  // (panier, carburant comparé, jour de repos, utilisation véhicule) tournent
  // en cadence HEBDO (dimanche) ; réconciliation & frais évitables au quotidien.
  const weekly = opts.forceWeekly === true || new Date(now).getUTCDay() === 0;
  const { count: vehiclesCount } = await admin.from("vehicles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("status", "active");
  recos.push(...runAdvancedRules(
    { tenantId, today, win, activeVehicles: vehiclesCount ?? 0 },
    { weekly }
  ));

  // Anti-répétition inter-jours : une même règle (même chauffeur) déjà active
  // depuis moins de 6 jours n'est pas reproposée.
  const { data: recentRecos } = await admin.from("ai_recommendations")
    .select("rule_id, driver_id")
    .eq("tenant_id", tenantId).eq("status", "active")
    .gte("created_at", new Date(now - 6 * DAY).toISOString());
  const recentKeys = new Set((recentRecos ?? []).map((r) => `${r.rule_id}|${r.driver_id ?? ""}`));

  let recoCount = 0;
  for (const r of recos) {
    if (recentKeys.has(`${r.rule_id}|${r.driver_id ?? ""}`)) continue;
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
        // Dédup : une seule notif « Briefing du jour » par tenant et par jour,
        // même si le batch est relancé (vu en prod : 5 notifs identiques le 29/07)
        const { count: alreadyNotified } = await admin.from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId).eq("title", "Briefing du jour")
          .gte("created_at", today + "T00:00:00Z");
        if (!alreadyNotified) {
          await sendNotification(
            tenantId, adminId, "report_reminder",
            "Briefing du jour",
            buildPushSummary(content) ?? "Votre briefing quotidien est prêt.",
            { url: "/admin" }
          ).catch(() => {}); // best-effort — le briefing reste consultable dans l'app
        }
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

  // Rapports du mois (chauffeurs actifs) : les [REPOS] déclarés sortent des
  // jours ouvrés écoulés — sinon le rythme/jour est sous-estimé et la
  // projection fin de mois avec (retour Abdou 19/08).
  const activeIds = new Set(win.drivers.filter((d) => d.active !== false).map((d) => d.id));
  const monthReps = win.reports.filter((r) =>
    (r.status === "approved" || r.status === "submitted") && activeIds.has(r.driver_id)
    && r.date >= monthStart && r.date <= today);
  const workedDates = new Set(monthReps.filter((r) => !isReposReport(r)).map((r) => r.date));
  // Repos « flotte entière » : au moins un repos déclaré ce jour-là et aucun
  // chauffeur actif n'a travaillé — seule configuration où le jour ne compte pas.
  const reposFleetDates = [...new Set(monthReps.filter(isReposReport).map((r) => r.date))]
    .filter((d) => !workedDates.has(d));
  const reposByDriver = new Map<string, string[]>();
  for (const r of monthReps.filter(isReposReport)) {
    reposByDriver.set(r.driver_id, [...(reposByDriver.get(r.driver_id) ?? []), r.date]);
  }

  // Projection fin de mois : net opérationnel MTD projeté sur les jours ouvrés
  const mtd = computePeriodAggregates(win, monthStart, today, iso(Date.parse(today) - 30 * DAY));
  const netProjete = projeterResultat({
    resultatRealise: mtd.netOperationnel,
    joursOuvresEcoules: Math.max(1, joursOuvresRealises(monthStart, today, reposFleetDates)),
    joursOuvresCible: joursOuvresProjetes(monthStart, monthEnd),
  });

  const deltaPct = (c: number, p: number) => (p !== 0 ? Math.round(((c - p) / Math.abs(p)) * 1000) / 10 : null);
  const kpis: BriefingKpi[] = [
    { kpi_name: "net_operationnel", value: cur.netOperationnel, unit: "FCFA", delta_pct_wow: deltaPct(cur.netOperationnel, prev.netOperationnel), badge: "calculated" },
    { kpi_name: "carburant_km", value: cur.coutCarburantParKm, unit: "FCFA/km", delta_pct_wow: deltaPct(cur.coutCarburantParKm, prev.coutCarburantParKm), badge: "calculated" },
    { kpi_name: "taux_soumission", value: cur.tauxSoumission, unit: "%", delta_pct_wow: deltaPct(cur.tauxSoumission, prev.tauxSoumission), badge: "calculated" },
  ];

  // Chauffeurs : CA MTD + projection + palier (pseudonymisés pour le LLM).
  // Rythme = CA / jours OUVRÉS écoulés du chauffeur (démarrage réel dans le
  // mois, repos déclarés déduits) — pas / jours calendaires, qui écrasait le
  // rythme des chauffeurs au repos ou arrivés en cours de mois.
  const sortedTiers = [...tiers].sort((a, b) => a.min_net - b.min_net);
  const joursOuvresRestants = joursRestants > 0
    ? joursOuvresProjetes(iso(Date.parse(today) + DAY), monthEnd) : 0;
  const chauffeurs: BriefingDriver[] = win.drivers
    .filter((d) => d.active !== false)
    .map((d) => {
      const rr = monthReps.filter((r) => r.driver_id === d.id);
      const ca = rr.reduce((s, r) => s + (r.yango_gross ?? 0) + (r.yango_bonus ?? 0) + (r.off_yango_revenue ?? 0), 0);
      const debut = rr.length ? rr.reduce((min, r) => (r.date < min ? r.date : min), today) : monthStart;
      const joursTravailles = Math.max(
        1, joursOuvresRealises(debut, today, reposByDriver.get(d.id) ?? []));
      const projete = Math.round(ca + (ca / joursTravailles) * joursOuvresRestants);
      const cible = sortedTiers.find((t) => t.min_net > projete && t.min_net > 0);
      return {
        driver_id: d.id,
        driver_ref: "drv_" + d.id.replace(/-/g, "").slice(0, 4),
        driver_name: d.full_name ?? "Chauffeur",
        ca_mtd_fcfa: Math.round(ca),
        ca_projete_fcfa: projete,
        jours_travailles_mtd: joursTravailles,
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

  // ── Faits calculés « palpables » : ce que les cartes KPI ne montrent PAS ──
  // (retour terrain 29/07 : la narration répétait les chiffres déjà affichés)
  const paliers = chauffeurs
    .filter((c) => c.palier_cible_fcfa && joursRestants > 0 && joursOuvresRestants > 0)
    .map((c) => {
      const manque = Math.max(0, (c.palier_cible_fcfa ?? 0) - c.ca_mtd_fcfa);
      // Rythme et besoin par jour OUVRÉ (repos exclus des deux côtés) :
      // comparer un rythme hors repos à un besoin calendaire gonflait l'écart.
      const rythme = Math.round(c.ca_mtd_fcfa / Math.max(1, c.jours_travailles_mtd ?? 1));
      const besoin = Math.ceil(manque / joursOuvresRestants);
      // Tous les écarts sont PRÉ-CALCULÉS : le LLM n'a jamais à faire une
      // soustraction (cause du rejet anti-hallucination du 29/07).
      return {
        chauffeur: c.driver_ref,
        palier_fcfa: c.palier_cible_fcfa,
        manque_total_fcfa: manque,
        rythme_actuel_fcfa_par_jour: rythme,
        besoin_fcfa_par_jour_pour_palier: besoin,
        effort_supplementaire_fcfa_par_jour: Math.max(0, besoin - rythme),
        jours_ouvres_restants: joursOuvresRestants,
        atteignable: besoin <= rythme * 2,
      };
    })
    .filter((p) => p.besoin_fcfa_par_jour_pour_palier > 0);

  const depensesMouvements = topExpenseMovements(
    win.expenses, cur.from, cur.to, prev.from, prev.to
  ).map((m) => ({
    poste: m.poste,
    mouvement: `${m.sens} de ${Math.abs(m.delta_fcfa)} FCFA vs semaine précédente`,
    delta_fcfa: m.delta_fcfa,
  }));

  // Payload LLM : pseudonymes uniquement, agrégats + faits uniquement
  const llmPayload = JSON.stringify({
    date: today,
    kpis_deja_affiches_a_l_ecran: kpis,
    faits_calcules: { paliers, depenses_mouvements: depensesMouvements },
    projections,
  });
  // Jusqu'à 2 tentatives : un rejet anti-hallucination ne condamne pas le briefing
  let points: string[] | null = null;
  let action: string | null = null;
  let narrativeSource: "llm" | "deterministic" = "llm";
  for (let attempt = 0; attempt < 2 && !points; attempt++) {
    const raw = await narrate(llmPayload, { model: llmModel, system: BRIEFING_JSON_SYSTEM });
    if (!raw) break; // LLM indisponible → fallback déterministe direct
    const foreign = foreignNumbers(raw, llmPayload);
    if (foreign.length) {
      console.warn(`[ai/batch] narration briefing rejetée (tentative ${attempt + 1}) — chiffres étrangers: ${foreign.join(",")}`);
      continue;
    }
    const parsed = extractJsonObject(raw);
    const p = parsed?.points;
    const a = parsed?.action;
    if (Array.isArray(p) && p.length && p.every((x) => typeof x === "string")) {
      points = (p as string[]).slice(0, 3).map(stripMarkdown);
      if (typeof a === "string" && a.trim()) action = stripMarkdown(a);
    }
  }

  // Résolution pseudonyme → prénom APRÈS le LLM (jamais de nom dans le prompt)
  const resolve = (s: string) => {
    let out = s;
    for (const c of chauffeurs) out = out.split(c.driver_ref).join(c.driver_name.split(" ")[0]);
    return out;
  };
  points = points?.map(resolve) ?? null;
  action = action ? resolve(action) : null;

  // Fallback déterministe : le briefing n'est JAMAIS vide — les mêmes faits,
  // pré-rédigés par le moteur (badge « Calculé » via narrative_source).
  if (!points) {
    narrativeSource = "deterministic";
    const refToPrenom = new Map(chauffeurs.map((c) => [c.driver_ref, c.driver_name.split(" ")[0]]));
    const det = buildDeterministicBriefing({
      paliers: paliers.map((p) => ({
        prenom: refToPrenom.get(p.chauffeur) ?? "Chauffeur",
        palier_fcfa: p.palier_fcfa,
        manque_total_fcfa: p.manque_total_fcfa,
        rythme_actuel_fcfa_par_jour: p.rythme_actuel_fcfa_par_jour,
        besoin_fcfa_par_jour_pour_palier: p.besoin_fcfa_par_jour_pour_palier,
        effort_supplementaire_fcfa_par_jour: p.effort_supplementaire_fcfa_par_jour,
        jours_ouvres_restants: p.jours_ouvres_restants,
        atteignable: p.atteignable,
      })),
      mouvements: topExpenseMovements(win.expenses, cur.from, cur.to, prev.from, prev.to),
      netProjete: projections.net_projete_fcfa,
      joursRestantsMois: joursRestants,
    });
    if (det.points.length) {
      points = det.points;
      action = det.action;
    }
  }

  const narrative = points ? [...points, action].filter(Boolean).join(" ") : null;

  return {
    narrative_fr: narrative,
    narrative_points: points,
    action_fr: action,
    narrative_source: points ? narrativeSource : null,
    degraded_message_fr: narrative ? null
      : "Analyse narrative indisponible — les chiffres calculés restent affichés.",
    kpis,
    chauffeurs: chauffeurs.map(({ driver_ref: _r, ...rest }) => rest),
    projections,
  };
}

/** Le briefing est structuré et ne répète pas ce que l'écran montre déjà. */
const BRIEFING_JSON_SYSTEM = `Tu rédiges le briefing matinal d'un opérateur de flotte VTC à Dakar.
Réponds UNIQUEMENT par un objet JSON valide, sans texte autour :
{"points":["…","…"],"action":"…"}
Règles ABSOLUES :
- 2 ou 3 points maximum, UNE phrase courte par point, français direct, AUCUN markdown ni astérisque.
- Chaque point doit apprendre quelque chose de NON visible sur les cartes KPI : utilise faits_calcules
  (rythme vs besoin par jour pour un palier, poste de dépense qui bouge) et projections.
- INTERDIT de recopier les valeurs de kpis_deja_affiches_a_l_ecran, sauf pour les mettre en rapport avec un fait.
- Tu n'inventes JAMAIS un chiffre et tu ne fais JAMAIS de calcul (ni somme, ni différence, ni arrondi) :
  uniquement les nombres du JSON fourni, recopiés tels quels. Tous les écarts utiles sont déjà fournis
  (manque_total_fcfa, effort_supplementaire_fcfa_par_jour…).
- Les chauffeurs sont désignés par leur référence drv_xxxx : recopie-les telles quelles.
- "action" : UNE action concrète et CHIFFRÉE pour aujourd'hui (qui, combien, sur combien de jours).`;

function stripMarkdown(s: string): string {
  return s.replace(/\*\*/g, "").replace(/^[#\-•*]\s*/gm, "").trim();
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
