import {
  matureDriverIds, rulePanierMoyen, ruleEfficienceCarburant, ruleJourOptimalRepos,
  ruleReconciliationSolde, ruleUtilisationVehicule, ruleFraisEvitables, AdvancedCtx,
} from "@/lib/ai/advancedRules";
import type { RawDriver, RawExpense, RawReport, TenantWindow } from "@/lib/ai/dataReader";

const TENANT = "00000000-0000-0000-0000-0000000000bb";
const TODAY = "2026-07-29";
const D1 = "11111111-1111-1111-1111-111111111111"; // Emile — mature
const D2 = "22222222-2222-2222-2222-222222222222"; // Ahmadou — mature
const D3 = "33333333-3333-3333-3333-333333333333"; // Daouda — NOUVEAU (promo)

const driver = (id: string, name: string): RawDriver =>
  ({ id, full_name: name, account_type: null, active: true, salary_model: null, hire_date: null, contract_end_date: null });

const rep = (driver_id: string, date: string, over: Partial<RawReport> = {}): RawReport => ({
  driver_id, date, status: "approved",
  yango_gross: 50_000, yango_bonus: 0, off_yango_revenue: 0,
  solde_yango: null, end_odometer: null,
  yango_trip_count: 20, off_yango_trip_count: 0, commission_amount: null,
  ...over,
});

const exp = (driver_id: string | null, category: string, amount: number, date: string): RawExpense =>
  ({ driver_id, category, amount, expense_date: date, status: null });

const day = (i: number) => new Date(Date.parse(TODAY) - i * 86_400_000).toISOString().slice(0, 10);

function ctx(win: TenantWindow, activeVehicles = 2): AdvancedCtx {
  return { tenantId: TENANT, today: TODAY, win, activeVehicles };
}

describe("Garde maturité (correctif Abdou : promo Yango ~1 semaine)", () => {
  it("exclut un chauffeur avec moins de 14 j d'historique", () => {
    const win: TenantWindow = {
      drivers: [driver(D1, "Emile"), driver(D3, "Daouda")],
      reports: [
        ...Array.from({ length: 30 }, (_, i) => rep(D1, day(i + 1))),
        ...Array.from({ length: 8 }, (_, i) => rep(D3, day(i + 1))), // démarré il y a 8 j
      ],
      expenses: [],
    };
    const mature = matureDriverIds(win, TODAY);
    expect(mature.has(D1)).toBe(true);
    expect(mature.has(D3)).toBe(false);
  });

  it("un nouveau chauffeur au panier gonflé ne sert JAMAIS de référence", () => {
    const win: TenantWindow = {
      drivers: [driver(D1, "Emile"), driver(D3, "Daouda")],
      reports: [
        // Emile mature : panier 2 500 (20 courses × 2 500 = 50 000)
        ...Array.from({ length: 30 }, (_, i) => rep(D1, day(i + 1), { yango_gross: 50_000, yango_trip_count: 20 })),
        // Daouda promo : panier 3 200, mais seulement 8 j
        ...Array.from({ length: 8 }, (_, i) => rep(D3, day(i + 1), { yango_gross: 64_000, yango_trip_count: 20 })),
      ],
      expenses: [],
    };
    const mature = matureDriverIds(win, TODAY);
    // Un seul mature → pas de benchmark → aucune reco panier
    expect(rulePanierMoyen(ctx(win), mature)).toHaveLength(0);
  });
});

describe("rulePanierMoyen — la qualité de course bat le volume", () => {
  it("détecte un écart de panier > 10% entre chauffeurs matures", () => {
    const win: TenantWindow = {
      drivers: [driver(D1, "Emile"), driver(D2, "Ahmadou")],
      reports: [
        ...Array.from({ length: 25 }, (_, i) => rep(D1, day(i + 1), { yango_gross: 50_000, yango_trip_count: 20 })), // 2 500
        ...Array.from({ length: 25 }, (_, i) => rep(D2, day(i + 1), { yango_gross: 60_000, yango_trip_count: 20 })), // 3 000
      ],
      expenses: [],
    };
    const out = rulePanierMoyen(ctx(win), matureDriverIds(win, TODAY));
    expect(out).toHaveLength(1);
    expect(out[0].driver_id).toBe(D1); // Emile sous le référent Ahmadou
    expect(out[0].impact_fcfa).toBeGreaterThan(0);
    expect(out[0].title_fr).toContain("Emile");
  });
});

describe("ruleEfficienceCarburant — FCFA/km comparé", () => {
  it("détecte un surcoût > 12% et le quantifie", () => {
    const mkReports = (id: string, kmParJour: number) =>
      Array.from({ length: 25 }, (_, i) => rep(id, day(25 - i), { end_odometer: 10_000 + i * kmParJour }));
    const win: TenantWindow = {
      drivers: [driver(D1, "Emile"), driver(D2, "Ahmadou")],
      reports: [...mkReports(D1, 40), ...mkReports(D2, 40)],
      expenses: [
        // Emile : 2 880 FCFA/j sur ~960 km → 72 FCFA/km ; Ahmadou : 2 400 → 60 FCFA/km
        ...Array.from({ length: 24 }, (_, i) => exp(D1, "Carburant", 2_880, day(i + 1))),
        ...Array.from({ length: 24 }, (_, i) => exp(D2, "Carburant", 2_400, day(i + 1))),
      ],
    };
    const out = ruleEfficienceCarburant(ctx(win), matureDriverIds(win, TODAY));
    expect(out).toHaveLength(1);
    expect(out[0].driver_id).toBe(D1);
    expect(out[0].impact_fcfa).toBeGreaterThan(5_000);
  });
});

describe("ruleJourOptimalRepos — saisonnalité hebdo", () => {
  it("détecte le jour creux (< 85% de la moyenne) et chiffre le placement des repos", () => {
    const reports: RawReport[] = [];
    for (let i = 1; i <= 60; i++) {
      const d = day(i);
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      reports.push(rep(D1, d, { yango_gross: wd === 1 ? 30_000 : 55_000 })); // lundis faibles
    }
    const win: TenantWindow = { drivers: [driver(D1, "Emile")], reports, expenses: [] };
    const out = ruleJourOptimalRepos(ctx(win), matureDriverIds(win, TODAY));
    expect(out).toHaveLength(1);
    expect(out[0].title_fr).toContain("lundi");
    expect(out[0].impact_fcfa).toBeGreaterThan(0);
  });

  it("les [REPOS] (CA 0) ne fabriquent PAS un faux jour creux (retour Abdou 19/08)", () => {
    // CA constant tous les jours travaillés, mais repos déclaré chaque jeudi :
    // sans exclusion, le jeudi paraîtrait « creux » à cause du CA 0 du repos.
    const reports: RawReport[] = [];
    for (let i = 1; i <= 60; i++) {
      const d = day(i);
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      reports.push(wd === 4
        ? rep(D1, d, { yango_gross: 0, comment: "[REPOS] jeudi" })
        : rep(D1, d, { yango_gross: 55_000 }));
    }
    const win: TenantWindow = { drivers: [driver(D1, "Emile")], reports, expenses: [] };
    expect(ruleJourOptimalRepos(ctx(win), matureDriverIds(win, TODAY))).toHaveLength(0);
  });

  it("ignore les rapports d'un chauffeur inactif (parti)", () => {
    const reports: RawReport[] = [];
    for (let i = 1; i <= 60; i++) {
      const d = day(i);
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      // Seul l'ex-chauffeur D2 avait des lundis faibles
      reports.push(rep(D1, d, { yango_gross: 55_000 }));
      reports.push(rep(D2, d, { yango_gross: wd === 1 ? 5_000 : 55_000 }));
    }
    const win: TenantWindow = {
      drivers: [driver(D1, "Emile"), { ...driver(D2, "Ahmadou"), active: false }],
      reports, expenses: [],
    };
    expect(ruleJourOptimalRepos(ctx(win), matureDriverIds(win, TODAY))).toHaveLength(0);
  });
});

describe("ruleReconciliationSolde — consommé vs déclaré", () => {
  it("alerte quand le wallet consomme bien plus que les commissions déclarées", () => {
    const reports: RawReport[] = [];
    for (let i = 20; i >= 1; i--) {
      // solde qui fond de 5 000/j sans provision → consommé 5 000/j ; déclaré 3 000/j
      reports.push(rep(D1, day(i), { solde_yango: 200_000 - (20 - i) * 5_000, commission_amount: 3_000 }));
    }
    const win: TenantWindow = { drivers: [driver(D1, "Emile")], reports, expenses: [] };
    const out = ruleReconciliationSolde(ctx(win), matureDriverIds(win, TODAY));
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe("HIGH");
    expect(out[0].title_fr).toContain("PLUS");
  });

  it("silencieux quand l'écart est ≤ 10 000 FCFA", () => {
    const reports: RawReport[] = [];
    for (let i = 20; i >= 1; i--) {
      reports.push(rep(D1, day(i), { solde_yango: 200_000 - (20 - i) * 5_000, commission_amount: 5_000 }));
    }
    const win: TenantWindow = { drivers: [driver(D1, "Emile")], reports, expenses: [] };
    expect(ruleReconciliationSolde(ctx(win), matureDriverIds(win, TODAY))).toHaveLength(0);
  });
});

describe("ruleUtilisationVehicule — jours-véhicule immobiles", () => {
  it("chiffre le CA envolé quand un véhicule ne tourne pas", () => {
    // 2 véhicules, 1 seul chauffeur qui roule sur 14 j → ~14 jours-véhicule immobiles
    const win: TenantWindow = {
      drivers: [driver(D1, "Emile")],
      reports: Array.from({ length: 14 }, (_, i) => rep(D1, day(i + 1), { yango_gross: 55_000 })),
      expenses: [],
    };
    const out = ruleUtilisationVehicule(ctx(win, 2));
    expect(out).toHaveLength(1);
    expect(out[0].impact_fcfa).toBeGreaterThan(500_000);
  });

  it("silencieux quand la flotte tourne (repos normaux ≤ 2 j)", () => {
    const reports = [];
    for (let i = 1; i <= 14; i++) {
      reports.push(rep(D1, day(i)));
      if (i > 1) reports.push(rep(D2, day(i))); // 1 seul jour-véhicule manquant
    }
    const win: TenantWindow = { drivers: [driver(D1, "Emile"), driver(D2, "Ahmadou")], reports, expenses: [] };
    expect(ruleUtilisationVehicule(ctx(win, 2))).toHaveLength(0);
  });
});

describe("ruleFraisEvitables", () => {
  it("cumule amendes + contrôles > 10 000 et signale la dérive entretien", () => {
    const win: TenantWindow = {
      drivers: [driver(D1, "Emile")],
      reports: [],
      expenses: [
        exp(D1, "Amende", 9_000, day(5)),
        exp(D1, "Contrôle routier", 6_000, day(10)),
        exp(null, "Entretien", 110_000, day(8)), // vs 0 le mois précédent
      ],
    };
    const out = ruleFraisEvitables(ctx(win));
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.title_fr.includes("amendes"))!.impact_fcfa).toBe(15_000);
    expect(out.find((r) => r.title_fr.includes("Entretien"))).toBeDefined();
  });
});
