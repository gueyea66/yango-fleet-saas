import {
  rulePalierARisque, ruleCarburantDerive, ruleRapportManquant, ruleAvanceSoldeGonflee,
  RecoContext,
} from "@/lib/ai/recommendationEngine";
import type { TenantWindow, RawReport, RawExpense } from "@/lib/ai/dataReader";

const TENANT = "00000000-0000-0000-0000-0000000000aa";
const DRV = "11111111-1111-1111-1111-111111111111";

const report = (over: Partial<RawReport>): RawReport => ({
  driver_id: DRV, date: "2026-07-01", status: "approved",
  yango_gross: 40_000, yango_bonus: 0, off_yango_revenue: 0,
  solde_yango: null, end_odometer: null,
  ...over,
});
const expense = (over: Partial<RawExpense>): RawExpense => ({
  driver_id: DRV, category: "Carburant", amount: 10_000,
  expense_date: "2026-07-01", status: null,
  ...over,
});

const win = (reports: RawReport[], expenses: RawExpense[] = []): TenantWindow => ({
  drivers: [{ id: DRV, full_name: "Emile Ndiaye", account_type: null, active: true, salary_model: null, hire_date: null, contract_end_date: null }],
  reports, expenses,
});

const ctx = (over: Partial<RecoContext>): RecoContext => ({
  tenantId: TENANT, today: "2026-07-20",
  win: win([]), salaryTiers: [],
  thresholds: { carburant_km_delta_pct: 15 },
  ...over,
});

describe("rulePalierARisque", () => {
  const tiers = [
    { min_net: 0, total_salary: 200_000, label: "Base" },
    { min_net: 1_000_000, total_salary: 230_000, label: "Palier 1" },
  ];

  it("déclenche quand la projection frôle le palier (manque ≤ 15%)", () => {
    // 19 jours à 48 000 → MTD 912 000, projection ≈ 1 439 000 > 1 000 000 : pas de manque.
    // 19 jours à 31 000 → MTD 589 000, projection ≈ 930 000 → manque 70 000 (7% du palier) → déclenche.
    const reports = Array.from({ length: 19 }, (_, i) =>
      report({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, yango_gross: 31_000 }));
    const out = rulePalierARisque(ctx({ win: win(reports), salaryTiers: tiers }));
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe("HIGH");
    expect(out[0].impact_fcfa).toBe(30_000); // 230 000 − 200 000 (salaire en jeu)
    expect(out[0].action_context.montant_manquant_fcfa).toBeGreaterThan(0);
  });

  it("silencieux quand le palier est hors de portée (> 15%)", () => {
    const reports = Array.from({ length: 19 }, (_, i) =>
      report({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, yango_gross: 15_000 }));
    expect(rulePalierARisque(ctx({ win: win(reports), salaryTiers: tiers }))).toHaveLength(0);
  });

  it("silencieux sans grille de paliers (modèle non tiered)", () => {
    expect(rulePalierARisque(ctx({ salaryTiers: [] }))).toHaveLength(0);
  });
});

describe("ruleCarburantDerive", () => {
  it("déclenche quand le coût/km 7j dépasse la moyenne 30j de +15%", () => {
    // 30 jours : odomètre +30 km/j, carburant 3 000 FCFA/j → 100 FCFA/km
    // 7 derniers jours : carburant 4 500 FCFA/j → ~150 FCFA/km (+50%)
    const reports: RawReport[] = [];
    const expenses: RawExpense[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 5, 21 + i)).toISOString().slice(0, 10);
      reports.push(report({ date: d, end_odometer: 10_000 + i * 30 }));
      const last7 = i >= 23;
      expenses.push(expense({ expense_date: d, amount: last7 ? 4_500 : 3_000 }));
    }
    const out = ruleCarburantDerive(ctx({ today: "2026-07-20", win: win(reports, expenses) }));
    expect(out).toHaveLength(1);
    expect(out[0].impact_fcfa).toBeGreaterThan(0);
    expect(out[0].rule_id).toBe("carburant_derive");
  });

  it("silencieux sans assez de km", () => {
    expect(ruleCarburantDerive(ctx({}))).toHaveLength(0);
  });
});

describe("ruleRapportManquant", () => {
  it("déclenche à J-1 manquant avec CA estimé = moyenne 7 derniers rapports", () => {
    const reports = Array.from({ length: 7 }, (_, i) =>
      report({ date: `2026-07-${String(10 + i).padStart(2, "0")}`, yango_gross: 35_000 }));
    // aucun rapport le 19/07 (J-1 de today=20/07)
    const out = ruleRapportManquant(ctx({ win: win(reports) }));
    expect(out).toHaveLength(1);
    expect(out[0].impact_fcfa).toBe(35_000);
    expect(out[0].action_context.estimation).toBe(true);
  });

  it("silencieux si le rapport J-1 existe", () => {
    const reports = [report({ date: "2026-07-19" })];
    expect(ruleRapportManquant(ctx({ win: win(reports) }))).toHaveLength(0);
  });

  it("un [REPOS] déclaré à J-1 n'est PAS un rapport manquant", () => {
    const reports = [
      ...Array.from({ length: 5 }, (_, i) =>
        report({ date: `2026-07-${String(13 + i).padStart(2, "0")}`, yango_gross: 35_000 })),
      report({ date: "2026-07-19", yango_gross: 0, comment: "[REPOS] jour de repos" }),
    ];
    expect(ruleRapportManquant(ctx({ win: win(reports) }))).toHaveLength(0);
  });

  it("l'estimation du CA perdu ignore les [REPOS] (CA 0) de la fenêtre (retour Abdou 19/08)", () => {
    const reports = [
      ...Array.from({ length: 6 }, (_, i) =>
        report({ date: `2026-07-${String(12 + i).padStart(2, "0")}`, yango_gross: 35_000 })),
      report({ date: "2026-07-18", yango_gross: 0, comment: "[REPOS] repos" }),
      // aucun rapport le 19/07 (J-1)
    ];
    const out = ruleRapportManquant(ctx({ win: win(reports) }));
    expect(out).toHaveLength(1);
    expect(out[0].impact_fcfa).toBe(35_000); // moyenne des jours TRAVAILLÉS, pas diluée par le repos
  });

  it("silencieux pour un chauffeur sans historique (onboarding)", () => {
    expect(ruleRapportManquant(ctx({ win: win([]) }))).toHaveLength(0);
  });
});

describe("ruleAvanceSoldeGonflee", () => {
  it("déclenche quand le cash immobilisé dépasse 25% des provisions et 30 000 FCFA", () => {
    // Provisions 100 000, consommé mesuré 20 000 → avance 80 000
    const reports = [
      report({ date: "2026-07-01", solde_yango: 10_000 }),
      report({ date: "2026-07-10", solde_yango: 90_000 }), // veille 10k, fin 90k, provisions 100k → consommé 20k
    ];
    const expenses = [expense({ category: "Solde Yango", amount: 100_000, expense_date: "2026-07-10" })];
    const out = ruleAvanceSoldeGonflee(ctx({ win: win(reports, expenses) }));
    expect(out).toHaveLength(1);
    expect(out[0].impact_fcfa).toBe(80_000);
  });

  it("silencieux sans provisions", () => {
    expect(ruleAvanceSoldeGonflee(ctx({}))).toHaveLength(0);
  });
});
