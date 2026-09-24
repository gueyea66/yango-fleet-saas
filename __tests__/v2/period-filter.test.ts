import {
  defaultPeriod, periodRange, daysInclusive, inRange, shiftMonth, dateShortcuts, periodLabel, driversLabel,
  parseAdminFilter, serializeAdminFilter, type AdminPeriod,
} from "@/lib/v2/periodFilter";

const today = new Date(2026, 8, 24, 21, 0); // jeudi 24 septembre 2026
const base = defaultPeriod(today);

describe("période → plage passée à useDashboardKPIs", () => {
  it("par défaut : le mois courant entier", () => {
    expect(base.kind).toBe("mois");
    expect(periodRange(base, today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("changer de mois change la plage (donc les chiffres)", () => {
    const aout: AdminPeriod = { ...base, month: "2026-08" };
    expect(periodRange(aout, today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(periodRange(aout, today)).not.toEqual(periodRange(base, today));
    expect(periodRange({ ...base, month: "2028-02" }, today)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("jour, 7 j, année", () => {
    expect(periodRange({ ...base, kind: "jour" }, today)).toEqual({ from: "2026-09-24", to: "2026-09-24" });
    expect(periodRange({ ...base, kind: "7j" }, today)).toEqual({ from: "2026-09-18", to: "2026-09-24" });
    expect(periodRange({ ...base, kind: "annee", year: 2025 }, today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("plage personnalisée, remise dans l'ordre si inversée", () => {
    expect(periodRange({ ...base, kind: "dates", from: "2026-09-08", to: "2026-09-21" }, today)).toEqual({ from: "2026-09-08", to: "2026-09-21" });
    expect(periodRange({ ...base, kind: "dates", from: "2026-09-21", to: "2026-09-08" }, today)).toEqual({ from: "2026-09-08", to: "2026-09-21" });
  });
  it("nombre de jours (« Appliquer · 14 j »)", () => {
    expect(daysInclusive("2026-09-08", "2026-09-21")).toBe(14);
    expect(daysInclusive("2026-09-24", "2026-09-24")).toBe(1);
    expect(daysInclusive("x", "2026-09-24")).toBe(0);
  });
  it("filtre d'appartenance à la plage (file À valider, historique)", () => {
    const r = { from: "2026-09-08", to: "2026-09-21" };
    expect(inRange("2026-09-08", r)).toBe(true);
    expect(inRange("2026-09-21T22:10:00Z", r)).toBe(true);
    expect(inRange("2026-09-22", r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
  });
  it("mois précédent / suivant", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("raccourcis de dates (6a)", () => {
  const s = Object.fromEntries(dateShortcuts(today).map((x) => [x.key, [x.from, x.to]]));
  it("valeurs", () => {
    expect(s.today).toEqual(["2026-09-24", "2026-09-24"]);
    expect(s.yesterday).toEqual(["2026-09-23", "2026-09-23"]);
    expect(s.week).toEqual(["2026-09-21", "2026-09-24"]); // lundi 21
    expect(s["2weeks"]).toEqual(["2026-09-11", "2026-09-24"]);
    expect(s.lastMonth).toEqual(["2026-08-01", "2026-08-31"]);
    expect(s["30days"]).toEqual(["2026-08-26", "2026-09-24"]);
  });
  it("mois dernier en janvier = décembre de l'année précédente", () => {
    const jan = Object.fromEntries(dateShortcuts(new Date(2027, 0, 10)).map((x) => [x.key, [x.from, x.to]]));
    expect(jan.lastMonth).toEqual(["2026-12-01", "2026-12-31"]);
  });
});

describe("libellés", () => {
  it("pastille de dates", () => {
    expect(periodLabel(base, today)).toBe("Septembre 2026");
    expect(periodLabel({ ...base, kind: "dates", from: "2026-09-08", to: "2026-09-21" }, today)).toBe("08/09 → 21/09");
    expect(periodLabel({ ...base, kind: "annee", year: 2026 }, today)).toBe("2026");
  });
  it("chauffeurs (6b)", () => {
    const d = [{ id: "a", label: "Alioune Diagne" }, { id: "b", label: "Moussa Diop" }];
    expect(driversLabel([], d)).toBe("Tous les chauffeurs");
    expect(driversLabel(["b"], d)).toBe("Moussa Diop");
    expect(driversLabel(["a", "b"], d)).toBe("2 chauffeurs");
  });
});

describe("état dans l'URL", () => {
  it("mois + chauffeurs", () => {
    const f = parseAdminFilter("?p=mois&m=2026-08&d=id1,id2", today);
    expect(f.period.kind).toBe("mois");
    expect(f.period.month).toBe("2026-08");
    expect(f.drivers).toEqual(["id1", "id2"]);
  });
  it("plage", () => {
    const f = parseAdminFilter("p=dates&du=2026-09-08&au=2026-09-21", today);
    expect(periodRange(f.period, today)).toEqual({ from: "2026-09-08", to: "2026-09-21" });
  });
  it("valeurs invalides → mois courant", () => {
    expect(parseAdminFilter("p=mois&m=2026-13", today).period.month).toBe("2026-09");
    expect(parseAdminFilter("p=dates&du=hier", today).period.kind).toBe("mois");
    expect(parseAdminFilter("", today).drivers).toEqual([]);
  });
  it("aller-retour, sans toucher aux autres paramètres (?tab=)", () => {
    const period: AdminPeriod = { ...base, kind: "dates", from: "2026-09-08", to: "2026-09-21" };
    const q = serializeAdminFilter(period, ["x", "y"], "tab=pending&m=2020-01");
    const sp = new URLSearchParams(q);
    expect(sp.get("tab")).toBe("pending");
    expect(sp.get("m")).toBeNull();
    const back = parseAdminFilter(q, today);
    expect(back.period.from).toBe("2026-09-08");
    expect(back.drivers).toEqual(["x", "y"]);
    expect(serializeAdminFilter(base, [], "")).toBe("p=mois&m=2026-09");
  });
});
