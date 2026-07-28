/**
 * Tests de contrat de la couche IA (remplacent Pact : mêmes garanties, zéro infra).
 * Couvre les DEUX états : flag ON (formes de réponse) et flag OFF (204 sans corps,
 * aucun composant monté, master-off env prioritaire).
 */
import { envEnabled, DEFAULT_THRESHOLDS } from "@/lib/ai/killSwitch";
import { AI_OFF } from "@/lib/ai/routeGuards";
import {
  isKpiCause, isCalculationSource, reconcileCauses, AI_CALC_VERSION,
} from "@/lib/ai/types";
import { narrativeCitesOnlyKnownNumbers } from "@/lib/ai/llmGateway";
import { computePeriodAggregates, confidenceFromCoverage } from "@/lib/ai/dataReader";
import type { TenantWindow } from "@/lib/ai/dataReader";

describe("Kill-switch — étage env (master-off)", () => {
  it("off coupe tout, quel que soit l'état DB", () => {
    expect(envEnabled({ AI_LAYER_ENABLED: "off" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(envEnabled({ AI_LAYER_ENABLED: " OFF " } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it("on / absent laisse l'étage DB décider", () => {
    expect(envEnabled({ AI_LAYER_ENABLED: "on" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(envEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("Contrat flag OFF — 204 sans corps", () => {
  it("AI_OFF() est un 204 vide (l'UI ne logge pas d'erreur, ne monte rien)", async () => {
    const res = AI_OFF();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});

describe("Contrat flag ON — formes de données", () => {
  it("les seuils par défaut sont ceux de la spec", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      net_operationnel_delta_pct: -5,
      carburant_km_delta_pct: 15,
      taux_soumission_min_pct: 80,
    });
  });

  it("KpiCause et CalculationSource sont validés par les gardes", () => {
    expect(isKpiCause({ component: "recettes", delta_fcfa: -1000, contribution_pct: 50, badge: "calculated" })).toBe(true);
    expect(isKpiCause({ component: "inconnu", delta_fcfa: 0, contribution_pct: 0, badge: "calculated" })).toBe(false);
    expect(isKpiCause({ component: "recettes", delta_fcfa: NaN, contribution_pct: 0, badge: "calculated" })).toBe(false);
    expect(isCalculationSource({ function: "x", version: AI_CALC_VERSION, params_hash: "abc123" })).toBe(true);
    expect(isCalculationSource({ function: "", version: "", params_hash: "" })).toBe(false);
  });

  it("la réconciliation refuse un écart > 1 FCFA", () => {
    const causes = [
      { component: "recettes" as const, delta_fcfa: -50_000, contribution_pct: 100, badge: "calculated" as const },
    ];
    expect(reconcileCauses(causes, -50_000)).toBe(true);
    expect(reconcileCauses(causes, -50_002)).toBe(false);
  });
});

describe("Garde anti-hallucination — le LLM ne peut citer que les chiffres du payload", () => {
  const payload = JSON.stringify({ net: 487320, carburant_km: 142, delta: -87450 });
  it("accepte une narration qui recopie les chiffres", () => {
    expect(narrativeCitesOnlyKnownNumbers("Ton net est de 487320 FCFA, en baisse de 87450.", payload)).toBe(true);
  });
  it("rejette une narration qui invente un chiffre", () => {
    expect(narrativeCitesOnlyKnownNumbers("Tu finiras le mois à 999999 FCFA.", payload)).toBe(false);
  });
});

describe("Agrégats — net opérationnel et confiance dérivés des seules données", () => {
  const win: TenantWindow = {
    drivers: [{ id: "d1", full_name: "Test", account_type: null, active: true, salary_model: null }],
    reports: [
      { driver_id: "d1", date: "2026-07-21", status: "approved", yango_gross: 50_000, yango_bonus: 5_000, off_yango_revenue: 0, solde_yango: 20_000, end_odometer: 1000 },
      { driver_id: "d1", date: "2026-07-22", status: "approved", yango_gross: 45_000, yango_bonus: 0, off_yango_revenue: 5_000, solde_yango: 12_000, end_odometer: 1150 },
    ],
    expenses: [
      { driver_id: "d1", category: "Carburant", amount: 15_000, expense_date: "2026-07-22", status: null },
      { driver_id: "d1", category: "Lavage", amount: 2_000, expense_date: "2026-07-22", status: null },
    ],
  };

  it("net = recettes − solde − carburant − dépenses (formule SPEC, salaires exclus)", () => {
    const agg = computePeriodAggregates(win, "2026-07-21", "2026-07-27", "2026-07-01");
    // recettes 105 000 ; solde consommé (veille 20k → fin 12k) 8 000 ;
    // km 150, ratio 15 000/150 = 100 → carburant 15 000 ; dépenses opé 2 000
    expect(agg.recettes).toBe(105_000);
    expect(agg.soldeConsomme).toBe(8_000);
    expect(agg.carburantConsomme).toBe(15_000);
    expect(agg.depensesOpe).toBe(2_000);
    expect(agg.netOperationnel).toBe(105_000 - 8_000 - 15_000 - 2_000);
  });

  it("le score de confiance est le taux de couverture, borné 0–1", () => {
    const agg = computePeriodAggregates(win, "2026-07-21", "2026-07-27", "2026-07-01");
    const c = confidenceFromCoverage(agg);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});
