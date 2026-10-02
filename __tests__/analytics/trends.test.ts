import { bucketOf, computeTrends, lastBuckets, statutDe } from "@/lib/analytics/trends";
import { segmentResolver } from "@/lib/analytics/segment";
import { sansHorsYango } from "@/lib/analytics/driverStats";

describe("périodes", () => {
  it("semaine ISO, mois, trimestre, année", () => {
    expect(bucketOf("2026-10-01", "semaine")).toEqual({ key: "2026-S40", label: "S40", from: "2026-09-28", to: "2026-10-04" });
    expect(bucketOf("2027-01-01", "semaine").key).toBe("2026-S53");
    expect(bucketOf("2026-09-15", "mois")).toMatchObject({ key: "2026-09", from: "2026-09-01", to: "2026-09-30" });
    expect(bucketOf("2026-08-15", "trimestre")).toMatchObject({ key: "2026-T3", from: "2026-07-01", to: "2026-09-30" });
    expect(bucketOf("2026-08-15", "annee")).toMatchObject({ key: "2026", from: "2026-01-01", to: "2026-12-31" });
  });
  it("n dernières périodes, contiguës et ordonnées", () => {
    const b = lastBuckets("2026-10-02", "mois", 3);
    expect(b.map((x) => x.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const t = lastBuckets("2026-02-10", "trimestre", 2);
    expect(t.map((x) => x.key)).toEqual(["2025-T4", "2026-T1"]);
  });
});

describe("statut vs objectif", () => {
  it("atteint ≥ 100 %, proche ≥ 80 %, sous < 80 %", () => {
    expect(statutDe(40_000, 40_000)).toBe("atteint");
    expect(statutDe(32_000, 40_000)).toBe("proche");
    expect(statutDe(31_999, 40_000)).toBe("sous");
    expect(statutDe(null, 40_000)).toBeNull();
    expect(statutDe(10, 0)).toBeNull();
  });
});

describe("tendances", () => {
  const rep = (driver_id: string, date: string, ca: number, o: Record<string, unknown> = {}) =>
    ({ driver_id, date, yango_gross: ca, yango_bonus: 0, off_yango_revenue: 0, yango_trip_count: 10, net_after_expenses: ca / 2, ...o });
  const drivers = [{ id: "a", full_name: "Moussa" }, { id: "b", full_name: "Awa" }];
  const buckets = lastBuckets("2026-09-30", "mois", 2);
  const res = computeTrends({
    drivers, objectif: 40_000, granularite: "mois", buckets, today: "2026-10-02",
    reports: [
      rep("a", "2026-08-10", 50_000), rep("a", "2026-08-11", 30_000), rep("b", "2026-08-10", 20_000),
      rep("a", "2026-09-10", 45_000), rep("a", "2026-09-10", 5_000), // deux lignes le même jour = une journée
      rep("b", "2026-09-11", 36_000), rep("b", "2026-09-12", 0, { comment: "[REPOS]" }),
    ],
  });
  it("CA par journée-chauffeur et répartition des journées", () => {
    const [aout, sept] = res.buckets;
    expect(aout.journees).toBe(3);
    expect(aout.caParJour).toBeCloseTo(100_000 / 3);
    expect(aout.statut).toBe("proche");
    expect(aout.jours).toEqual({ atteint: 1, proche: 0, sous: 2 });
    expect(sept.journees).toBe(2); // repos exclu, doublon fusionné
    expect(sept.caParJour).toBe(43_000);
    expect(sept.statut).toBe("atteint");
    expect(sept.jours).toEqual({ atteint: 1, proche: 1, sous: 0 });
  });
  it("comparaison entre deux périodes terminées, chauffeurs triés", () => {
    expect(res.comparaison?.courante).toBe("sept. 26");
    expect(res.comparaison?.caParJour).toBeCloseTo(43_000 / (100_000 / 3) - 1);
    expect(res.drivers[0].name).toBe("Moussa");
    // août : (50 000 + 30 000) / 2 = 40 000 → atteint
    expect(res.drivers[0].cells.map((c) => c.statut)).toEqual(["atteint", "atteint"]);
    expect(res.insights.length).toBeGreaterThan(0);
  });
});

describe("segment d'une ligne", () => {
  const seg = segmentResolver([
    { id: "v1", driver_id: "a", plate: "AA-195-SJ", fleet_segment: "partenaire" },
    { id: "v2", driver_id: "b", plate: "DK1234", fleet_segment: null },
  ]);
  it("véhicule de la ligne, sinon véhicule du chauffeur, sinon interne", () => {
    expect(seg.ofReport({ vehicle_id: "v2", driver_id: "a" })).toBe("interne");
    expect(seg.ofReport({ vehicle_id: null, driver_id: "a" })).toBe("partenaire");
    expect(seg.ofReport({ driver_id: "z" })).toBe("interne");
    expect(seg.ofPlate("AA195SJ", "b")).toBe("partenaire");
    expect(seg.counts()).toEqual({ interne: 1, partenaire: 1 });
  });
});

describe("filtre hors Yango", () => {
  it("Yango seul : recettes et courses hors Yango exclues, déclaration d'origine intacte", () => {
    const r = { driver_id: "a", date: "2026-08-19", yango_gross: 10_360, yango_bonus: 0, off_yango_revenue: 43_000, yango_trip_count: 6, off_yango_trip_count: 3 };
    const avec = computeTrends({ reports: [r], drivers: [{ id: "a" }], objectif: 40_000, granularite: "mois", buckets: lastBuckets("2026-08-31", "mois", 1), today: "2026-10-02" });
    const sans = computeTrends({ reports: [sansHorsYango(r)], drivers: [{ id: "a" }], objectif: 40_000, granularite: "mois", buckets: lastBuckets("2026-08-31", "mois", 1), today: "2026-10-02" });
    expect(avec.buckets[0].statut).toBe("atteint");
    expect(sans.buckets[0].caParJour).toBe(10_360);
    expect(sans.buckets[0].statut).toBe("sous");
    expect(sans.total.courses).toBe(6);
    expect(r.off_yango_revenue).toBe(43_000);
  });
});

describe("granularité jour", () => {
  it("une période par jour, libellé court, 14 jours glissants", () => {
    expect(bucketOf("2026-10-02", "jour")).toEqual({ key: "2026-10-02", label: "ven. 02/10", from: "2026-10-02", to: "2026-10-02" });
    const b = lastBuckets("2026-10-02", "jour", 14);
    expect(b).toHaveLength(14);
    expect(b[0].key).toBe("2026-09-19");
  });
});
