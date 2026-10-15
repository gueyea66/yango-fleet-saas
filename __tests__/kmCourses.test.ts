import { kmParMoisDepuisCourses, kmParMoisVehicule, amortissementPeriode } from "@/lib/calc";
import { plaqueCle, kmMoisCoursesParVehicule, kmCoursesParJour } from "@/lib/fleetroom/kmCourses";

/** Client Supabase factice : renvoie `rows` à la première page, rien ensuite. */
function fauxClient(rows: object[]) {
  const appels: Record<string, unknown[]> = {};
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lte", "order"]) {
    q[m] = (...a: unknown[]) => { (appels[m] ??= []).push(a); return q; };
  }
  q.range = (a: number) => Promise.resolve({ data: a === 0 ? rows : [], error: null });
  return { client: { from: () => q }, appels };
}

describe("km des courses Yango", () => {
  it("km/mois : somme des km ÷ jours entre première et dernière course × 30,4", () => {
    // 30 jours inclusifs, 3 000 km → 3 040 km/mois
    expect(kmParMoisDepuisCourses([
      { jour: "2026-09-01", distance_m: 1_000_000 },
      { jour: "2026-09-15", distance_m: 1_000_000 },
      { jour: "2026-09-30", distance_m: 1_000_000 },
    ])).toBe(3040);
  });

  it("moins de 14 jours ou aucun km : pas de mesure", () => {
    expect(kmParMoisDepuisCourses([{ jour: "2026-09-01", distance_m: 5000 }, { jour: "2026-09-10", distance_m: 5000 }])).toBeNull();
    expect(kmParMoisDepuisCourses([{ jour: "2026-09-01", distance_m: 0 }, { jour: "2026-09-30", distance_m: null }])).toBeNull();
    expect(kmParMoisDepuisCourses([])).toBeNull();
  });

  it("le compteur l'emporte ; les courses ne servent qu'à défaut", () => {
    const releves = [{ date: "2026-09-01", end_odometer: 100_000 }, { date: "2026-09-30", end_odometer: 104_000 }];
    expect(kmParMoisVehicule(releves, 1500)).toBe(Math.round((4000 / 30) * 30.4));
    expect(kmParMoisVehicule([], 1500)).toBe(1500);
    expect(kmParMoisVehicule([], null)).toBeNull();
  });

  it("NMK : sans compteur, un véhicule roulant porte son amortissement sur 36 mois", () => {
    const vehicule = { prixAcquisition: 8_900_000, valeurResiduelle: 2_000_000, dateAcquisition: "2024-05-01", compteurActuel: 0, porteePar: "exploitant" };
    const sans = amortissementPeriode({ vehicule, fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: kmParMoisVehicule([], null) });
    expect(sans).toMatchObject({ montant: 0, raison: "non_renseigne" });
    const avec = amortissementPeriode({ vehicule, fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: kmParMoisVehicule([], 2400) });
    expect(avec).toMatchObject({ dureeMois: 36, mensualite: Math.round(6_900_000 / 36), raison: null });
  });

  it("plaques : tirets, espaces, minuscules et cyrillique ramenés à la même clé", () => {
    expect(plaqueCle("AB-872-JG ")).toBe("AB872JG");
    expect(plaqueCle("ab 872 jg")).toBe("AB872JG");
    expect(plaqueCle("АА195SJ")).toBe("AA195SJ");
    expect(plaqueCle("  ")).toBeNull();
  });

  it("rattache les courses au véhicule par la plaque et ignore les véhicules sans course", async () => {
    const { client, appels } = fauxClient([
      { plate: "AB872JG", jour: "2026-09-01", distance_m: 1_000_000 },
      { plate: "AB872JG", jour: "2026-09-30", distance_m: 2_000_000 },
    ]);
    const km = await kmMoisCoursesParVehicule(client, "t1", [{ id: "v1", plate: "AB-872-JG" }, { id: "v2", plate: "AA195SJ" }], "2026-10-01");
    expect(km.get("v1")).toBe(3040);
    expect(km.has("v2")).toBe(false);
    expect(appels.in[0]).toEqual(["plate", ["AB872JG", "AA195SJ"]]);
    expect(appels.eq).toEqual(expect.arrayContaining([["tenant_id", "t1"], ["status", "Terminé"]]));
  });

  it("km Yango par jour pour le suivi GPS", async () => {
    const { client } = fauxClient([
      { jour: "2026-10-10", distance_m: 4200 }, { jour: "2026-10-10", distance_m: 1800 }, { jour: "2026-10-11", distance_m: 3000 },
    ]);
    const parJour = await kmCoursesParJour(client, "t1", "AB-872-JG", "2026-10-01", "2026-10-14");
    expect(parJour.get("2026-10-10")).toEqual({ km: 6, courses: 2 });
    expect(parJour.get("2026-10-11")).toEqual({ km: 3, courses: 1 });
    expect((await kmCoursesParJour(client, "t1", null, "2026-10-01", "2026-10-14")).size).toBe(0);
  });
});
