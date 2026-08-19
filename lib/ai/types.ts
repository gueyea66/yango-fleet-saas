/**
 * Couche IA V3 — types partagés API ↔ UI ↔ tests (contrat).
 * Règle d'or : un LLM ne calcule JAMAIS un chiffre. Tout montant provient
 * de lib/calc.ts ou d'une agrégation déterministe (voir dataReader).
 */

/** Version du contrat de calcul embarquée dans calculation_source. */
export const AI_CALC_VERSION = "v3.0-spec-calculs-2026-07-02";

export type KpiName = "net_operationnel" | "carburant_km" | "taux_soumission";

export interface KpiCause {
  component: "recettes" | "solde_consomme" | "carburant_consomme" | "depenses_ope";
  delta_fcfa: number;        // contribution signée au delta du net (± FCFA)
  contribution_pct: number;  // part de |delta| total (0–100)
  badge: "calculated";
}

export interface CalculationSource {
  function: string;          // ex "computeOperationnel+decomposition"
  version: string;           // AI_CALC_VERSION
  params_hash: string;       // hash court des bornes de période + tenant
}

export interface ReliabilityMeta {
  computed_at: string;                      // ISO
  data_freshness_snapshot: Record<string, string>; // driver_id → dernière date de rapport
  confidence_score: number;                 // 0–1
  calculation_source: CalculationSource;
}

export interface AiInsight extends ReliabilityMeta {
  id: string;
  tenant_id: string;
  kpi_name: KpiName;
  period_start: string;
  period_end: string;
  current_value: number;
  previous_value: number;
  delta_value: number;
  delta_pct: number | null;
  causes: KpiCause[];
  narrative_fr: string | null; // null = dégradé (LLM indisponible)
  status: "unread" | "read" | "degraded";
  expires_at: string;
  created_at: string;
}

export type RuleId =
  | "palier_a_risque"
  | "carburant_derive"
  | "rapport_manquant"
  | "avance_solde_gonflee"
  // Phase 1.1 — règles d'optimisation (analyse croisée 29/07)
  | "panier_moyen"
  | "efficience_carburant"
  | "jour_optimal_repos"
  | "reconciliation_solde"
  | "utilisation_vehicule"
  | "frais_evitables";

export interface AiRecommendation {
  id: string;
  tenant_id: string;
  driver_id: string | null;
  rule_id: RuleId;
  priority: "HIGH" | "MEDIUM" | "LOW";
  impact_fcfa: number;
  title_fr: string;
  detail_fr: string | null;
  action_context: Record<string, unknown>;
  status: "active" | "expired" | "acted_on" | "ignored";
  acted_at: string | null;
  computed_at: string;
  calculation_source: CalculationSource;
  expires_at: string;
  created_at: string;
}

export interface BriefingKpi {
  kpi_name: KpiName;
  value: number;
  unit: string;              // "FCFA" | "FCFA/km" | "%"
  delta_pct_wow: number | null;
  badge: "calculated";
}

export interface BriefingDriver {
  driver_id: string;
  driver_ref: string;        // pseudonyme envoyé au LLM (drv_xxxx)
  driver_name: string;       // JAMAIS envoyé au LLM — résolution serveur
  ca_mtd_fcfa: number;
  ca_projete_fcfa: number;
  /** Jours réellement travaillés MTD (repos [REPOS] exclus) — base des rythmes. */
  jours_travailles_mtd?: number;
  palier_cible_fcfa: number | null;
  a_risque: boolean;
}

export interface BriefingContent {
  narrative_fr: string | null;
  /** Briefing structuré : 2-3 points courts, chacun une info NON visible sur les cartes. */
  narrative_points?: string[] | null;
  /** L'action du jour, concrète et chiffrée. */
  action_fr?: string | null;
  /** Origine des points : "llm" (badge IA) ou "deterministic" (badge Calculé). */
  narrative_source?: "llm" | "deterministic" | null;
  degraded_message_fr: string | null;
  kpis: BriefingKpi[];
  chauffeurs: Array<Omit<BriefingDriver, "driver_ref">>;
  projections: {
    net_projete_fcfa: number;
    jours_restants_mois: number;
    hypotheses: string[];
  };
}

export interface AiBriefing extends ReliabilityMeta {
  id: string;
  tenant_id: string;
  briefing_date: string;
  content_json: BriefingContent;
  status: "complete" | "degraded";
  has_newer_data: boolean;
  push_summary: string | null;
}

/** Réponses API — le contrat couvre flag ON et flag OFF (204 sans corps). */
export interface AiBriefingResponse { ai_layer_enabled: true; briefing: AiBriefing | null; }
export interface AiInsightsResponse { ai_layer_enabled: true; insights: AiInsight[]; }
export interface AiRecommendationsResponse {
  ai_layer_enabled: true;
  recommendations: AiRecommendation[];
  total_active: number;
}

/* ── Gardes runtime (contrat testé sans dépendance externe) ─────────── */

export function isKpiCause(v: unknown): v is KpiCause {
  const o = v as KpiCause;
  return !!o && typeof o === "object"
    && ["recettes", "solde_consomme", "carburant_consomme", "depenses_ope"].includes(o.component)
    && typeof o.delta_fcfa === "number" && Number.isFinite(o.delta_fcfa)
    && typeof o.contribution_pct === "number"
    && o.badge === "calculated";
}

export function isCalculationSource(v: unknown): v is CalculationSource {
  const o = v as CalculationSource;
  return !!o && typeof o === "object"
    && typeof o.function === "string" && o.function.length > 0
    && typeof o.version === "string" && o.version.length > 0
    && typeof o.params_hash === "string" && o.params_hash.length > 0;
}

/** Réconciliation obligatoire : Σ contributions == delta total (±1 FCFA). */
export function reconcileCauses(causes: KpiCause[], deltaTotal: number): boolean {
  const sum = causes.reduce((s, c) => s + c.delta_fcfa, 0);
  return Math.abs(sum - deltaTotal) <= 1;
}
