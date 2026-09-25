import { financeKpis, kycState, teamCounts, driverDayGrid } from "@/lib/v2/team";

describe("KPI Finance", () => {
  it("encaissements = trésorerie + décaissements, masse salariale depuis la ligne Salaires", () => {
    const f = financeKpis({
      tresorerie: 962150, decaissements: 320000, netFinal: 1214380,
      expenseBreakdown: [{ type: "Carburant", amount: 142300 }, { type: "💵 Salaires", amount: 690000 }],
    });
    expect(f).toEqual({ encaissements: 1282150, decaissements: 320000, masseSalariale: 690000, margeApresSalaires: 1214380 });
  });
  it("sans salaires : indisponible", () => {
    expect(financeKpis({ tresorerie: 0, decaissements: 0, netFinal: 0, expenseBreakdown: [] }).masseSalariale).toBeNull();
  });
});

describe("équipe", () => {
  it("état KYC", () => {
    expect(kycState("approved")).toBe("approved");
    expect(kycState("in_review")).toBe("in_review");
    expect(kycState("pending")).toBe("incomplete");
    expect(kycState(null)).toBe("incomplete");
  });
  it("compteurs", () => {
    expect(teamCounts([
      { active: true, onboarding_status: "approved" },
      { active: false, onboarding_status: "in_review" },
      { onboarding_status: null },
    ])).toEqual({ total: 3, actifs: 2, kycValides: 1, kycAVerifier: 1 });
  });
});

describe("grille historique", () => {
  const reports = [
    { driver_id: "a", date: "2026-09-01", status: "approved" },
    { driver_id: "a", date: "2026-09-02", status: "rejected" },
    { driver_id: "a", date: "2026-09-02", status: "submitted" },
    { driver_id: "b", date: "2026-09-02", status: "approved", comment: "[REPOS]" },
    { driver_id: "a", date: "2026-08-31", status: "approved" },
  ];
  it("jours du mois et état par chauffeur", () => {
    const g = driverDayGrid(reports, 2026, 8);
    expect(g.days).toHaveLength(30);
    expect(g.cell("a", "2026-09-01")).toBe("approved");
    expect(g.cell("a", "2026-09-02")).toBe("submitted");
    expect(g.cell("b", "2026-09-02")).toBe("repos");
    expect(g.cell("b", "2026-09-03")).toBeNull();
  });
  it("ignore les autres mois", () => {
    expect(driverDayGrid(reports, 2026, 8).cell("a", "2026-08-31")).toBeNull();
  });
});
