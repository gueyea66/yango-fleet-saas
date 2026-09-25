import { kmDeclared, gpsGap, daysBetween, extractionConfidence, nextSelection, isNew, GPS_GAP_ALERT_PCT } from "@/lib/v2/validation";

describe("km déclarés", () => {
  it("delta de compteur", () => {
    expect(kmDeclared(151461, 151299)).toBe(162);
    expect(kmDeclared(100, 100)).toBe(0);
  });
  it("indisponible si compteur manquant ou qui recule", () => {
    expect(kmDeclared(null, 100)).toBeNull();
    expect(kmDeclared(100, undefined)).toBeNull();
    expect(kmDeclared(90, 100)).toBeNull();
  });
});

describe("écart km GPS", () => {
  const ok = { coverage: 0.95, points: 400, daysCovered: 1 };
  it("écart en % et alerte au-delà de 15 %", () => {
    const g = gpsGap({ kmDecl: 162, kmGps: 196, ...ok });
    expect(g.exploitable).toBe(true);
    expect(g.pct).toBeCloseTo(20.99, 1);
    expect(g.alert).toBe(true);
    expect(GPS_GAP_ALERT_PCT).toBe(15);
    expect(gpsGap({ kmDecl: 162, kmGps: 170, ...ok }).alert).toBe(false);
  });
  it("jamais de différence si la journée n'est pas exploitable", () => {
    expect(gpsGap({ kmDecl: 162, kmGps: 196, coverage: 0.5, points: 400, daysCovered: 1 })).toEqual({ pct: null, exploitable: false, alert: false });
    expect(gpsGap({ kmDecl: 162, kmGps: 196, coverage: 0.9, points: 50, daysCovered: 1 }).exploitable).toBe(false);
    expect(gpsGap({ kmDecl: 324, kmGps: 196, ...ok, daysCovered: 2 }).exploitable).toBe(false);
    expect(gpsGap({ kmDecl: null, kmGps: 196, ...ok }).exploitable).toBe(false);
  });
  it("jours entre deux dates", () => {
    expect(daysBetween("2026-09-22", "2026-09-23")).toBe(1);
    expect(daysBetween("2026-08-31", "2026-09-02")).toBe(2);
  });
});

describe("confiance de l'extraction", () => {
  it("plus faible score et champs à vérifier", () => {
    expect(extractionConfidence({ yango_cash: 0.95, yango_card: 0.6, end_odometer: null })).toEqual({ min: 0.6, low: ["yango_card"] });
    expect(extractionConfidence(null)).toEqual({ min: null, low: [] });
    expect(extractionConfidence({})).toEqual({ min: null, low: [] });
  });
});

describe("Valider et suivant", () => {
  it("garde la sélection tant qu'elle est dans la liste", () => {
    expect(nextSelection(["a", "b", "c"], "b", 1)).toBe("b");
  });
  it("prend l'élément suivant quand la sélection disparaît", () => {
    expect(nextSelection(["a", "c"], "b", 1)).toBe("c");
    expect(nextSelection(["a", "b"], "c", 2)).toBe("b");
    expect(nextSelection([], "a", 0)).toBeNull();
    expect(nextSelection(["a"], null, 0)).toBe("a");
  });
});

describe("tag NOUVEAU", () => {
  const now = new Date("2026-09-23T21:30:00Z");
  it("moins d'une heure", () => {
    expect(isNew("2026-09-23T21:00:00Z", now)).toBe(true);
    expect(isNew("2026-09-23T20:00:00Z", now)).toBe(false);
    expect(isNew(null, now)).toBe(false);
    expect(isNew("2026-09-23T22:00:00Z", now)).toBe(false);
  });
});
