import type { DashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import { mergeMonthlyKpis, mergeSalaryRows } from "@/lib/v2/multiMonth";
import {
  defaultPeriod, inRange, monthRanges, monthsLabel, nextMonthSelection, parseAdminFilter, periodLabel, periodRange,
  serializeAdminFilter, withMonths,
} from "@/lib/v2/periodFilter";

const today = new Date(2026, 8, 24);
const base = defaultPeriod(today);

function kpi(o: Partial<DashboardKPIs>): DashboardKPIs {
  return {
    brutYango: 0, netYango: 0, horsYango: 0, totalBrut: 0, totalDepenses: 0, netFinal: 0,
    prevNetFinal: 1, prevTotalBrut: 1, prevRecettes: 1, joursOuvres: 0, prevJoursOuvres: 1,
    soldeConsomme: 0, carburantConsomme: 0, coutCarburantKm: 0, provisionsSolde: 0, achatsCarburant: 0,
    autresDepensesOpe: 0, netOperationnel: 0, decaissements: 0, tresorerie: 0, avanceSolde: 0, avanceCarburant: 0,
    avancesProprietaire: 0, avancesParChauffeur: [],
    avgBrutPerDay: 0, avgNetPerDay: 0, avgDepensesPerDay: 0, avgKmPerDay: 0, avgSoldePerDay: 0,
    todayRevenue: 7, todayExpenses: 0, todayNetMargin: 0, activeDriversToday: 0,
    weekRevenue: 0, weekExpenses: 0, weekNetMargin: 0, weekAvgDailyRevenue: 0,
    monthRevenue: 0, monthExpenses: 0, monthNetMargin: 0, monthMarginPercent: 0, avgFuelConsumption: 0, totalFuelCost: 0,
    totalDrivers: 3, avgRevenuePerDriver: 0,
    dailyRows: [], expenseBreakdown: [], dailyExpByCategory: [], dailyTrendData: [], topDrivers: [], driverAllocations: [],
    loading: false, error: null,
    ...o,
  };
}

const alloc = (driver_id: string, net: number) => ({
  driver_id, name: driver_id, netDeclared: net, netApproved: net, netPending: 0, nbReports: 10, nbApproved: 10, nbPending: 0,
  hire_date: null, prorataFactor: 1, salary_model: null, base_amount: null,
});

const juil = kpi({
  totalBrut: 1_000_000, netFinal: 400_000, totalDepenses: 600_000, decaissements: 900_000, tresorerie: 300_000, joursOuvres: 26,
  avgBrutPerDay: 40_000, avgNetPerDay: 16_000, avgDepensesPerDay: 24_000, achatsCarburant: 200_000, coutCarburantKm: 50,
  expenseBreakdown: [{ type: "Carburant", amount: 200_000, percent: 0 }, { type: "💵 Salaires", amount: 400_000, percent: 0 }],
  dailyRows: [{ date: "2026-07-02", brutYango: 0, horsYango: 0, netRecettes: 0, depenses: 0, netFinal: 0, km: 0, solde: 0, nbCourses: 0 }],
  driverAllocations: [alloc("a", 600_000), alloc("b", 400_000)],
});
const sep = kpi({
  totalBrut: 500_000, netFinal: 100_000, totalDepenses: 400_000, decaissements: 450_000, tresorerie: 50_000, joursOuvres: 24,
  avgBrutPerDay: 25_000, avgNetPerDay: 5_000, avgDepensesPerDay: 20_000, achatsCarburant: 100_000, coutCarburantKm: 40,
  expenseBreakdown: [{ type: "Carburant", amount: 100_000, percent: 0 }],
  dailyRows: [{ date: "2026-09-01", brutYango: 0, horsYango: 0, netRecettes: 0, depenses: 0, netFinal: 0, km: 0, solde: 0, nbCourses: 0 }],
  driverAllocations: [alloc("a", 500_000)],
});

describe("Juil + Sep = somme des deux mois pris séparément", () => {
  const m = mergeMonthlyKpis([juil, sep]);
  it("montants additionnés", () => {
    for (const k of ["totalBrut", "netFinal", "totalDepenses", "decaissements", "tresorerie", "joursOuvres", "achatsCarburant"] as const) {
      expect(m[k]).toBe(juil[k] + sep[k]);
    }
  });
  it("ratios recalculés sur les totaux (pas moyennés)", () => {
    expect(m.monthMarginPercent).toBeCloseTo((500_000 / 1_500_000) * 100);
    expect(m.avgBrutPerDay).toBe(Math.round(1_500_000 / (25 + 20)));
    expect(m.coutCarburantKm).toBeCloseTo(300_000 / (4_000 + 2_500));
  });
  it("comparaisons masquées, aujourd'hui inchangé", () => {
    expect(m.prevNetFinal).toBeNull();
    expect(m.prevJoursOuvres).toBeNull();
    expect(m.todayRevenue).toBe(7);
  });
  it("listes fusionnées", () => {
    expect(m.dailyRows.map((r) => r.date)).toEqual(["2026-07-02", "2026-09-01"]);
    expect(m.expenseBreakdown[0]).toMatchObject({ type: "💵 Salaires", amount: 400_000 });
    expect(m.expenseBreakdown.find((r) => r.type === "Carburant")?.amount).toBe(300_000);
    expect(m.driverAllocations.find((d) => d.driver_id === "a")?.netDeclared).toBe(1_100_000);
  });
  it("un mois encore en chargement → chargement", () => {
    expect(mergeMonthlyKpis([juil, { ...sep, loading: true }]).loading).toBe(true);
  });
});

describe("salaires sur plusieurs mois", () => {
  const row = (driverId: string, palier: string, du: number, reste: number, paidOn: string | null = null) =>
    ({ driverId, name: driverId, palier, du, avances: 0, verse: du - reste, reste, paidOn });
  const r = mergeSalaryRows([
    { month: "2026-07", rows: [row("a", "P2", 150_000, 0, "2026-08-02"), row("b", "P1", 100_000, 100_000)] },
    { month: "2026-09", rows: [row("a", "P1", 100_000, 100_000)] },
  ]);
  it("dû et reste additionnés, paliers listés", () => {
    expect(r.find((x) => x.driverId === "a")).toMatchObject({ du: 250_000, reste: 100_000, palier: "P2 / P1", paidOn: null });
    expect(r.find((x) => x.driverId === "a")?.restByMonth).toEqual([{ month: "2026-07", reste: 0 }, { month: "2026-09", reste: 100_000 }]);
  });
});

describe("sélection des mois", () => {
  it("clic simple = ce mois seul", () => {
    expect(nextMonthSelection(["2026-07", "2026-09"], "2026-08", {})).toEqual(["2026-08"]);
  });
  it("Ctrl+clic ajoute / retire, jamais vide", () => {
    expect(nextMonthSelection(["2026-07"], "2026-09", { toggle: true })).toEqual(["2026-07", "2026-09"]);
    expect(nextMonthSelection(["2026-07", "2026-09"], "2026-07", { toggle: true })).toEqual(["2026-09"]);
    expect(nextMonthSelection(["2026-07"], "2026-07", { toggle: true })).toEqual(["2026-07"]);
  });
  it("Maj+clic = plage depuis l'ancre, à travers l'année", () => {
    expect(nextMonthSelection(["2025-11"], "2026-02", { range: true, anchor: "2025-11" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("libellés", () => {
    expect(monthsLabel(["2026-07", "2026-09"])).toBe("Juil + Sep 2026");
    expect(monthsLabel(["2025-12", "2026-01"])).toBe("Déc 2025 + Janv 2026");
    expect(monthsLabel(["2026-01", "2026-03", "2026-05"])).toBe("3 mois");
    expect(periodLabel(withMonths(base, ["2026-09"]), today)).toBe("Septembre 2026");
  });
});

describe("plusieurs mois : plages et URL", () => {
  const p = withMonths(base, ["2026-09", "2026-07"]);
  it("une plage continue par mois (un appel useDashboardKPIs chacune)", () => {
    expect(monthRanges(p, today)).toEqual([{ from: "2026-07-01", to: "2026-07-31" }, { from: "2026-09-01", to: "2026-09-30" }]);
    expect(monthRanges(base, today)).toEqual([{ from: "2026-09-01", to: "2026-09-30" }]);
  });
  it("août exclu des listes filtrées", () => {
    const r = periodRange(p, today);
    expect(inRange("2026-07-15", r)).toBe(true);
    expect(inRange("2026-08-15", r)).toBe(false);
    expect(inRange("2026-09-30", r)).toBe(true);
  });
  it("?m=2026-07,2026-09 survit au rechargement", () => {
    const q = serializeAdminFilter(p, [], "tab=payments");
    expect(new URLSearchParams(q).get("m")).toBe("2026-07,2026-09");
    const back = parseAdminFilter(q, today).period;
    expect(monthRanges(back, today)).toHaveLength(2);
    expect(periodLabel(back, today)).toBe("Juil + Sep 2026");
    expect(parseAdminFilter("p=mois&m=2026-07,nope", today).period.months).toBeUndefined();
  });
});
