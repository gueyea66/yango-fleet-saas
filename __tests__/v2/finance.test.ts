/* eslint-disable @typescript-eslint/no-explicit-any -- lignes non typées (convention du projet) */
import { masseSalariale, palierLabel, paymentSalaryDate, recentMovements, salaryMonthOf, salaryRows } from "@/lib/v2/finance";

// Moteur de test : même forme que calcDriverSalary (paliers + prorata).
const salaryOf = (net: number, cfg: any, pf = 1) => {
  const sorted = [...cfg.salary_tiers].sort((a: any, b: any) => b.min_net - a.min_net);
  const tier = sorted.find((t: any) => net >= t.min_net) ?? sorted[sorted.length - 1];
  return (cfg.model === "fixed" ? cfg.base_amount : tier.total_salary) * pf;
};
const cfg = {
  model: "tiered", base_amount: 100_000,
  salary_tiers: [{ label: "P1", min_net: 0, total_salary: 100_000 }, { label: "P2", min_net: 500_000, total_salary: 150_000 }],
};
const sep = { from: "2026-09-01", to: "2026-09-30" };
const allocs = [
  { driver_id: "a", name: "Moussa", netDeclared: 600_000 },
  { driver_id: "b", name: "Awa", netDeclared: 200_000, prorataFactor: 0.5 },
  { driver_id: "c", name: "Omar", netDeclared: 0, salary_model: "fixed", base_amount: 80_000 },
];

describe("masse salariale projetée", () => {
  it("Σ salaires dus, prorata et modèle perso inclus", () => {
    expect(masseSalariale(allocs, cfg, salaryOf)).toBe(150_000 + 50_000 + 80_000);
  });
  it("palier atteint / libellé du modèle", () => {
    expect(palierLabel(600_000, cfg)).toBe("P2");
    expect(palierLabel(10, cfg)).toBe("P1");
    expect(palierLabel(0, { ...cfg, model: "fixed" })).toBe("Salaire fixe");
  });
});

describe("tableau des salaires", () => {
  const payments = [
    { id: "1", driver_id: "a", amount: 30_000, type: "acompte", payment_date: "2026-09-10", salary_month: "2026-09-01" },
    { id: "2", driver_id: "a", amount: 120_000, type: "salaire", payment_date: "2026-10-02", salary_month: "2026-09-01" },
    { id: "3", driver_id: "b", amount: 20_000, type: "acompte", payment_date: "2026-09-05", salary_month: null },
    { id: "4", driver_id: "b", amount: 99_000, type: "salaire", payment_date: "2026-08-30", salary_month: "2026-08-01" },
  ];
  const rows = Object.fromEntries(salaryRows(allocs, cfg, payments, sep, salaryOf).map((r) => [r.driverId, r]));
  it("dû, avances, reste", () => {
    expect(rows.a).toMatchObject({ palier: "P2", du: 150_000, avances: 30_000, verse: 120_000, reste: 0, paidOn: "2026-10-02" });
    expect(rows.b).toMatchObject({ du: 50_000, avances: 20_000, verse: 0, reste: 30_000, paidOn: null });
    expect(rows.c).toMatchObject({ palier: "Salaire fixe", du: 80_000, reste: 80_000 });
  });
  it("un paiement est imputé sur son mois de salaire, sinon sa date", () => {
    expect(paymentSalaryDate(payments[1])).toBe("2026-09-01");
    expect(paymentSalaryDate(payments[2])).toBe("2026-09-05");
  });
  it("mois pré-rempli dans Nouveau paiement", () => {
    expect(salaryMonthOf(sep)).toBe("2026-09-01");
  });
});

describe("derniers mouvements", () => {
  const m = recentMovements({
    payments: [{ id: "p", driver_id: "a", amount: 30_000, type: "acompte", payment_date: "2026-09-10" }],
    reports: [
      { id: "r1", driver_id: "a", status: "approved", date: "2026-09-12", yango_gross: 40_000, yango_bonus: 2_000, off_yango_revenue: 3_000 },
      { id: "r2", driver_id: "a", status: "submitted", date: "2026-09-13", yango_gross: 99 },
    ],
    expenses: [
      { id: "e1", driver_id: "b", status: "approved", expense_date: "2026-09-11", category: "Carburant", amount: 15_000 },
      { id: "e2", driver_id: "b", status: "approved", expense_date: "2026-08-11", category: "Carburant", amount: 1 },
    ],
    range: sep,
    nameOf: (id) => (id === "a" ? "Moussa" : "Awa"),
  });
  it("validés seulement, sur la période, du plus récent au plus ancien, signés", () => {
    expect(m.map((x) => [x.date, x.label, x.amount])).toEqual([
      ["2026-09-12", "Recette · Moussa", 45_000],
      ["2026-09-11", "Carburant · Awa", -15_000],
      ["2026-09-10", "Avance · Moussa", -30_000],
    ]);
  });
  it("10 lignes au plus", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: String(i), driver_id: "a", amount: 1, type: "salaire", payment_date: `2026-09-${String(i + 1).padStart(2, "0")}` }));
    expect(recentMovements({ payments: many, reports: [], expenses: [], range: sep, nameOf: () => "x" })).toHaveLength(10);
  });
});
