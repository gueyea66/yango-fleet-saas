/**
 * Moteur d'insights — 100% déterministe. Compare deux périodes agrégées et
 * décompose le delta du net opérationnel par composant de formule
 * (linéarité de computeOperationnel → la réconciliation est EXACTE).
 * Le LLM ne voit que la sortie structurée de ce moteur.
 */
import { createHash } from "crypto";
import { AI_CALC_VERSION, CalculationSource, KpiCause, KpiName, reconcileCauses } from "./types";
import type { PeriodAggregates } from "./dataReader";
import type { TenantAiAccess } from "./killSwitch";

export interface InsightDraft {
  kpi_name: KpiName;
  period_start: string;
  period_end: string;
  current_value: number;
  previous_value: number;
  delta_value: number;
  delta_pct: number | null;
  causes: KpiCause[];
  calculation_source: CalculationSource;
}

export function paramsHash(tenantId: string, from: string, to: string): string {
  return createHash("sha256").update(`${tenantId}|${from}|${to}`).digest("hex").slice(0, 12);
}

function source(fn: string, tenantId: string, from: string, to: string): CalculationSource {
  return { function: fn, version: AI_CALC_VERSION, params_hash: paramsHash(tenantId, from, to) };
}

const pct = (delta: number, prev: number): number | null =>
  prev !== 0 ? Math.round((delta / Math.abs(prev)) * 1000) / 10 : null;

/**
 * Décomposition du delta net opérationnel entre deux périodes.
 * net = recettes − solde − carburant − depenses_ope  (salaires exclus, mensuels)
 * → Δnet = Δrecettes − Δsolde − Δcarburant − Δdepenses (réconciliation exacte).
 */
export function decomposeNetDelta(cur: PeriodAggregates, prev: PeriodAggregates): KpiCause[] {
  const contributions: Array<[KpiCause["component"], number]> = [
    ["recettes", cur.recettes - prev.recettes],
    ["solde_consomme", -(cur.soldeConsomme - prev.soldeConsomme)],
    ["carburant_consomme", -(cur.carburantConsomme - prev.carburantConsomme)],
    ["depenses_ope", -(cur.depensesOpe - prev.depensesOpe)],
  ];
  const totalAbs = contributions.reduce((s, [, v]) => s + Math.abs(v), 0);
  return contributions
    .filter(([, v]) => v !== 0)
    .map(([component, v]) => ({
      component,
      delta_fcfa: v,
      contribution_pct: totalAbs > 0 ? Math.round((Math.abs(v) / totalAbs) * 1000) / 10 : 0,
      badge: "calculated" as const,
    }))
    .sort((a, b) => Math.abs(b.delta_fcfa) - Math.abs(a.delta_fcfa));
}

/**
 * Produit les insights dont le seuil est franchi. Ne renvoie JAMAIS un chiffre
 * non issu des agrégats. Un insight net_operationnel embarque sa décomposition.
 */
export function buildKpiInsights(params: {
  tenantId: string;
  cur: PeriodAggregates;
  prev: PeriodAggregates;
  thresholds: TenantAiAccess["thresholds"];
}): InsightDraft[] {
  const { tenantId, cur, prev, thresholds } = params;
  const out: InsightDraft[] = [];

  // 1. Net opérationnel — seuil : baisse ≥ |net_operationnel_delta_pct| %
  {
    const delta = cur.netOperationnel - prev.netOperationnel;
    const p = pct(delta, prev.netOperationnel);
    if (p !== null && p <= thresholds.net_operationnel_delta_pct) {
      const causes = decomposeNetDelta(cur, prev);
      if (reconcileCauses(causes, delta)) {
        out.push({
          kpi_name: "net_operationnel",
          period_start: cur.from, period_end: cur.to,
          current_value: cur.netOperationnel, previous_value: prev.netOperationnel,
          delta_value: delta, delta_pct: p, causes,
          calculation_source: source("computeOperationnel+decomposeNetDelta", tenantId, cur.from, cur.to),
        });
      }
    }
  }

  // 2. Coût carburant / km — seuil : hausse ≥ carburant_km_delta_pct %
  {
    const delta = cur.coutCarburantParKm - prev.coutCarburantParKm;
    const p = pct(delta, prev.coutCarburantParKm);
    if (p !== null && p >= thresholds.carburant_km_delta_pct) {
      out.push({
        kpi_name: "carburant_km",
        period_start: cur.from, period_end: cur.to,
        current_value: cur.coutCarburantParKm, previous_value: prev.coutCarburantParKm,
        delta_value: Math.round(delta * 100) / 100, delta_pct: p, causes: [],
        calculation_source: source("coutCarburantParKm", tenantId, cur.from, cur.to),
      });
    }
  }

  // 3. Taux de soumission — seuil : sous taux_soumission_min_pct %
  {
    if (cur.reportsAttendus > 0 && cur.tauxSoumission < thresholds.taux_soumission_min_pct) {
      out.push({
        kpi_name: "taux_soumission",
        period_start: cur.from, period_end: cur.to,
        current_value: cur.tauxSoumission, previous_value: prev.tauxSoumission,
        delta_value: Math.round((cur.tauxSoumission - prev.tauxSoumission) * 10) / 10,
        delta_pct: pct(cur.tauxSoumission - prev.tauxSoumission, prev.tauxSoumission),
        causes: [],
        calculation_source: source("tauxSoumission", tenantId, cur.from, cur.to),
      });
    }
  }

  return out;
}
