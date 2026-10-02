import { driverStats, fleetroomStats, kmCompteurParJour, sortStats, REFUS_REASONS, ECHEC_REASONS, ANNUL_CLIENT_REASON } from "@/lib/analytics/driverStats";

const drivers = [
  { id: "a", full_name: "Moussa", yango_driver_id: "ya", active: true },
  { id: "b", full_name: "Awa", active: true },
  { id: "c", full_name: "Parti", active: false },
  { id: "t", full_name: "Compte technique", account_type: "technical" },
];
const rep = (driver_id: string, date: string, o: Record<string, unknown> = {}) => ({
  driver_id, date, yango_gross: 20_000, yango_bonus: 1_000, off_yango_revenue: 0,
  yango_trip_count: 10, off_yango_trip_count: 0, net_after_expenses: 15_000, end_odometer: 0, ...o,
});
const order = (o: Record<string, unknown>) => ({
  yango_driver_id: "ya", jour: "2026-09-10", status: "Terminé", cancel_reason: null,
  started_at: "2026-09-10T08:00:00Z", ended_at: "2026-09-10T08:30:00Z", distance_m: 5000, cash: 2000, cashless: 0, ...o,
});

describe("km au compteur", () => {
  it("écarts par chauffeur, amorce avant période, plafond anti-aberration", () => {
    const km = kmCompteurParJour(
      [rep("a", "2026-09-02", { end_odometer: 1200 }), rep("a", "2026-09-01", { end_odometer: 1000 }),
       rep("a", "2026-09-03", { end_odometer: 99_999 }), rep("b", "2026-09-01", { end_odometer: 50_000 })],
      [rep("a", "2026-08-31", { end_odometer: 900 })],
    );
    expect(Object.fromEntries(km.get("a")!)).toEqual({ "2026-09-01": 100, "2026-09-02": 200 });
    expect(km.get("b")!.size).toBe(0); // jamais d'écart entre deux chauffeurs
  });
});

describe("KPI Fleetroom", () => {
  it("acceptation, refus, heures, amplitude, XOF/km", () => {
    const s = fleetroomStats([
      order({}),
      order({ started_at: "2026-09-10T17:00:00Z", ended_at: "2026-09-10T18:00:00Z", distance_m: 15_000, cash: 6_000 }),
      order({ status: "Annulé", cancel_reason: REFUS_REASONS[0] }),
      order({ status: "Annulé", cancel_reason: REFUS_REASONS[1] }),
      order({ status: "Annulé", cancel_reason: ECHEC_REASONS[0] }),
      order({ status: "Annulé", cancel_reason: ANNUL_CLIENT_REASON }),
      order({ status: "Annulé", cancel_reason: "autoreorder" }),
    ]);
    expect(s.courses).toBe(2);
    expect(s.offres).toBe(5);
    expect(s.refus).toBe(2);
    expect(s.echecs).toBe(1);
    expect(s.tauxAcceptation).toBeCloseTo(0.6);
    expect(s.heuresCourse).toBe(1.5);
    expect(s.amplitudeMoy).toBe(10);
    expect(s.occupation).toBeCloseTo(0.15);
    expect(s.km).toBe(20);
    expect(s.xofParKm).toBe(400);
  });
  it("aucune commande : ratios nuls, pas de division par zéro", () => {
    const s = fleetroomStats([]);
    expect(s.tauxAcceptation).toBeNull();
    expect(s.xofParKm).toBeNull();
    expect(s.amplitudeMoy).toBeNull();
  });
});

describe("classement", () => {
  const reports = [
    rep("a", "2026-09-10"), rep("a", "2026-09-11", { yango_trip_count: 20, yango_gross: 40_000 }),
    rep("a", "2026-09-12", { comment: "[REPOS]" }),
    rep("b", "2026-09-10", { yango_trip_count: 5, yango_gross: 9_000, off_yango_revenue: 5_000, off_yango_trip_count: 2 }),
  ];
  it("sans Fleetroom : colonnes Fleetroom absentes, technique et partis inactifs exclus", () => {
    const { rows, hasFleetroom } = driverStats({ drivers, reports });
    expect(hasFleetroom).toBe(false);
    expect(rows.map((r) => r.driverId).sort()).toEqual(["a", "b"]);
    const a = rows.find((r) => r.driverId === "a")!;
    expect(a.jours).toBe(2);           // repos exclu
    expect(a.courses).toBe(30);
    expect(a.ca).toBe(62_000);         // brut + bonus + hors Yango
    expect(a.caParCourse).toBeCloseTo(62_000 / 30);
    expect(a.fleetroom).toBeNull();
  });
  it("avec Fleetroom : km des courses quand le compteur manque", () => {
    const { rows, hasFleetroom } = driverStats({ drivers, reports, orders: [order({}), order({ yango_driver_id: "inconnu" })] });
    expect(hasFleetroom).toBe(true);
    const a = rows.find((r) => r.driverId === "a")!;
    expect(a.km).toBe(5);
    expect(a.fleetroom?.courses).toBe(1);
    expect(rows.find((r) => r.driverId === "b")!.fleetroom).toBeNull();
  });
  it("tri décroissant, valeurs absentes en bas, rang posé", () => {
    const { rows } = driverStats({ drivers, reports, orders: [order({})] });
    const byCa = sortStats(rows, "ca");
    expect(byCa.map((r) => [r.driverId, r.rang])).toEqual([["a", 1], ["b", 2]]);
    const byAcc = sortStats(rows, "fr.tauxAcceptation", false);
    expect(byAcc[byAcc.length - 1].driverId).toBe("b");
    expect(sortStats(rows, "name", false)[0].name).toBe("Awa");
  });
});
