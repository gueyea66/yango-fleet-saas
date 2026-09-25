import { costBreakdown, variationPct, cleanCategory, parseDashView } from "@/lib/v2/dashboard";
import { CAT_AVANCE } from "@/lib/expenseCategories";

describe("coûts par poste", () => {
  const breakdown = [
    { type: "Carburant", amount: 300000 },
    { type: "💵 Salaires", amount: 600000 },
    { type: "Péage", amount: 100000 },
    { type: CAT_AVANCE, amount: 50000 },
    { type: "Lavage", amount: 0 },
  ];

  it("% du CA = montant ÷ recettes, % des coûts = montant ÷ total", () => {
    const { rows, total } = costBreakdown(breakdown, 2000000);
    expect(rows.map((r) => r.type)).toEqual(["💵 Salaires", "Carburant", "Péage"]);
    expect(rows[1]).toEqual({ type: "Carburant", amount: 300000, pctCA: 15, pctCosts: 30 });
    expect(rows[0].pctCosts).toBe(60);
    expect(total).toEqual({ type: "Total", amount: 1000000, pctCA: 50, pctCosts: 100 });
  });

  it("l'avance propriétaire est exclue, les postes à zéro aussi", () => {
    const { rows } = costBreakdown(breakdown, 2000000);
    expect(rows.find((r) => r.type === CAT_AVANCE)).toBeUndefined();
    expect(rows.find((r) => r.type === "Lavage")).toBeUndefined();
  });

  it("les % des coûts somment à 100", () => {
    const { rows } = costBreakdown(breakdown, 2000000);
    expect(rows.reduce((s, r) => s + (r.pctCosts ?? 0), 0)).toBeCloseTo(100, 6);
  });

  it("sans recettes : % du CA indisponible", () => {
    const { rows, total } = costBreakdown([{ type: "Carburant", amount: 10 }], 0);
    expect(rows[0].pctCA).toBeNull();
    expect(total.pctCA).toBeNull();
  });

  it("sans coûts", () => {
    expect(costBreakdown([], 1000).total).toEqual({ type: "Total", amount: 0, pctCA: 0, pctCosts: null });
  });
});

describe("variation vs période précédente", () => {
  it("par jour ouvré quand les deux fenêtres sont connues", () => {
    // 20 j à 1 000 000 vs 30 j à 1 200 000 → 50 000/j vs 40 000/j = +25 %
    expect(variationPct(1000000, 1200000, 20, 30)).toBeCloseTo(25, 6);
  });
  it("sinon sur les totaux", () => {
    expect(variationPct(110, 100)).toBeCloseTo(10, 6);
    expect(variationPct(-50, -100)).toBeCloseTo(50, 6);
  });
  it("indisponible sans référence", () => {
    expect(variationPct(100, null)).toBeNull();
    expect(variationPct(100, 0)).toBeNull();
  });
});

describe("divers", () => {
  it("libellés sans émoji", () => {
    expect(cleanCategory("💵 Salaires")).toBe("Salaires");
    expect(cleanCategory("Carburant")).toBe("Carburant");
  });
  it("vue par défaut : simple", () => {
    expect(parseDashView(null)).toBe("simple");
    expect(parseDashView("avance")).toBe("avance");
    expect(parseDashView("x")).toBe("simple");
  });
});
