import { buildKpiInsights, decomposeNetDelta } from "@/lib/ai/insightEngine";
import { reconcileCauses, isKpiCause, isCalculationSource } from "@/lib/ai/types";
import { DEFAULT_THRESHOLDS } from "@/lib/ai/killSwitch";
import type { PeriodAggregates } from "@/lib/ai/dataReader";

const agg = (over: Partial<PeriodAggregates>): PeriodAggregates => {
  const merged = {
    from: "2026-07-21", to: "2026-07-27",
    recettes: 500_000, soldeConsomme: 80_000, carburantConsomme: 90_000,
    depensesOpe: 30_000, netOperationnel: 300_000, km: 700,
    coutCarburantParKm: 128.5, reportsApproved: 12, reportsAttendus: 14,
    reposDeclares: 0, tauxSoumission: 85.7, joursOuvres: 7,
    ...over,
  };
  return {
    netParJourOuvre: Math.round(merged.netOperationnel / Math.max(1, merged.joursOuvres)),
    ...merged,
  } as PeriodAggregates;
};

describe("decomposeNetDelta — réconciliation exacte (règle d'or)", () => {
  it("Σ contributions == Δ net, à ±1 FCFA", () => {
    const prev = agg({});
    const cur = agg({
      from: "2026-07-28", to: "2026-08-03",
      recettes: 460_000, soldeConsomme: 95_000, carburantConsomme: 110_000,
      depensesOpe: 42_000, netOperationnel: 460_000 - 95_000 - 110_000 - 42_000, // 213 000
    });
    const causes = decomposeNetDelta(cur, prev);
    const delta = cur.netOperationnel - prev.netOperationnel; // -87 000
    expect(reconcileCauses(causes, delta)).toBe(true);
    expect(causes.every(isKpiCause)).toBe(true);
    // La cause dominante est triée en premier
    expect(Math.abs(causes[0].delta_fcfa)).toBeGreaterThanOrEqual(Math.abs(causes.at(-1)!.delta_fcfa));
  });

  it("aucune cause fantôme quand rien ne bouge", () => {
    expect(decomposeNetDelta(agg({}), agg({}))).toHaveLength(0);
  });
});

describe("buildKpiInsights — seuils", () => {
  const tenantId = "00000000-0000-0000-0000-000000000001";

  it("déclenche net_operationnel sous le seuil de -5% avec source de calcul valide", () => {
    const prev = agg({});
    const cur = agg({ recettes: 420_000, netOperationnel: 420_000 - 80_000 - 90_000 - 30_000 }); // -26.7%
    const out = buildKpiInsights({ tenantId, cur, prev, thresholds: DEFAULT_THRESHOLDS });
    const net = out.find((i) => i.kpi_name === "net_operationnel");
    expect(net).toBeDefined();
    expect(net!.delta_pct).toBeLessThanOrEqual(-5);
    expect(isCalculationSource(net!.calculation_source)).toBe(true);
    expect(reconcileCauses(net!.causes, net!.delta_value)).toBe(true);
  });

  it("ne déclenche RIEN quand tout est dans les seuils", () => {
    const out = buildKpiInsights({
      tenantId, cur: agg({}), prev: agg({}), thresholds: DEFAULT_THRESHOLDS,
    });
    expect(out).toHaveLength(0);
  });

  it("PAS de fausse alerte net quand la baisse vient de jours ouvrés en moins (repos flotte)", () => {
    const prev = agg({}); // 300 000 sur 7 j ouvrés → 42 857 / j
    // 6 j ouvrés au même rythme/jour : total en baisse de −14,3% mais net/j stable
    const cur = agg({ netOperationnel: 257_143, recettes: 457_143, joursOuvres: 6 });
    const out = buildKpiInsights({ tenantId, cur, prev, thresholds: DEFAULT_THRESHOLDS });
    expect(out.find((i) => i.kpi_name === "net_operationnel")).toBeUndefined();
  });

  it("déclenche net quand la baisse PAR JOUR OUVRÉ franchit le seuil, même à jours inégaux", () => {
    const prev = agg({}); // 42 857 / j ouvré
    // 6 j ouvrés mais rythme/jour en chute de ~30% → alerte légitime
    const cur = agg({ netOperationnel: 180_000, recettes: 380_000, joursOuvres: 6 });
    const out = buildKpiInsights({ tenantId, cur, prev, thresholds: DEFAULT_THRESHOLDS });
    expect(out.find((i) => i.kpi_name === "net_operationnel")).toBeDefined();
  });

  it("déclenche carburant_km au-dessus de +15%", () => {
    const out = buildKpiInsights({
      tenantId,
      cur: agg({ coutCarburantParKm: 160 }),
      prev: agg({ coutCarburantParKm: 128.5 }),
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(out.some((i) => i.kpi_name === "carburant_km")).toBe(true);
  });

  it("déclenche taux_soumission sous 80%", () => {
    const out = buildKpiInsights({
      tenantId,
      cur: agg({ tauxSoumission: 64.3, reportsApproved: 9 }),
      prev: agg({}),
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(out.some((i) => i.kpi_name === "taux_soumission")).toBe(true);
  });
});

describe("describeCauses — le sens hausse/baisse est pré-calculé pour le LLM", () => {
  const { describeCauses } = require("@/lib/ai/insightEngine");
  it("coût avec contribution négative = coût en HAUSSE qui pèse sur le net", () => {
    const [d] = describeCauses([{ component: "depenses_ope", delta_fcfa: -92_100, contribution_pct: 36.8, badge: "calculated" }]);
    expect(d.evolution).toContain("hausse");
    expect(d.evolution).toContain("pèse sur le net");
  });
  it("recettes avec contribution positive = recettes en hausse qui améliorent le net", () => {
    const [d] = describeCauses([{ component: "recettes", delta_fcfa: 56_448, contribution_pct: 22.5, badge: "calculated" }]);
    expect(d.evolution).toContain("hausse");
    expect(d.evolution).toContain("améliore le net");
  });
  it("coût avec contribution positive = coût en BAISSE qui améliore le net", () => {
    const [d] = describeCauses([{ component: "solde_consomme", delta_fcfa: 30_000, contribution_pct: 10, badge: "calculated" }]);
    expect(d.evolution).toContain("baisse");
    expect(d.evolution).toContain("améliore le net");
  });
});
