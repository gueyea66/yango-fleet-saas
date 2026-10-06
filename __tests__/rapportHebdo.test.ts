/**
 * Point hebdomadaire d'exploitation : règles pures (avancement du mois,
 * semaine contre semaine précédente, période « mois en cours à date »).
 */
jest.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

import { debutDuMois, rythmeDuMois, semaineContrePrecedente } from "@/lib/reportAdapters/fleet";
import { monthToDateRange } from "@/lib/reportHtml";

describe("période du point hebdomadaire", () => {
  it("du 1er du mois à la veille", () => {
    expect(monthToDateRange(new Date("2026-10-12T07:00:00Z"))).toEqual({ dateFrom: "2026-10-01", dateTo: "2026-10-11" });
  });
  it("un lundi 1er : le mois qui vient de se terminer, en entier", () => {
    expect(monthToDateRange(new Date("2026-06-01T07:00:00Z"))).toEqual({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
  });
  it("début du mois", () => {
    expect(debutDuMois("2026-10-06")).toBe("2026-10-01");
  });
});

describe("avancement du mois", () => {
  // 10 jours écoulés sur 31, 30 journées-chauffeur, objectif 40 000
  const base = { dateTo: "2026-10-10", journees: 30, objectif: 40_000 };
  it("en retard : écart négatif, atterrissage sous la cible, CA à tenir au-dessus de l'objectif", () => {
    const r = rythmeDuMois({ ...base, recette: 1_050_000 }); // 35 000 F par jour
    expect(r.joursEcoules).toBe(10);
    expect(r.joursRestants).toBe(21);
    expect(r.journeesRestantes).toBeCloseTo(63);
    expect(r.ecartADate).toBe(-150_000);
    expect(r.atterrissage).toBeCloseTo(1_050_000 + 105_000 * 21);
    expect(r.cibleMois).toBeCloseTo(40_000 * 93);
    expect(r.atterrissage).toBeLessThan(r.cibleMois);
    expect(r.caJourRequis).toBeCloseTo((40_000 * 93 - 1_050_000) / 63);
    expect(r.caJourRequis!).toBeGreaterThan(40_000);
  });
  it("à l'objectif exactement : écart nul, CA à tenir égal à l'objectif", () => {
    const r = rythmeDuMois({ ...base, recette: 1_200_000 });
    expect(r.ecartADate).toBe(0);
    expect(r.caJourRequis).toBeCloseTo(40_000);
    expect(r.atterrissage).toBeCloseTo(r.cibleMois);
  });
  it("mois terminé ou sans activité : pas de CA à tenir", () => {
    expect(rythmeDuMois({ dateTo: "2026-10-31", recette: 3_000_000, journees: 90, objectif: 40_000 }).caJourRequis).toBeNull();
    expect(rythmeDuMois({ dateTo: "2026-10-31", recette: 3_000_000, journees: 90, objectif: 40_000 }).atterrissage).toBe(3_000_000);
    expect(rythmeDuMois({ ...base, recette: 0, journees: 0 }).caJourRequis).toBeNull();
  });
});

describe("semaine contre semaine précédente", () => {
  const row = (date: string, driver_id: string, brut: number) => ({ date, driver_id, brut, bonus: 0, hors: 0 });
  const rows = [
    row("2026-10-11", "a", 50_000), row("2026-10-05", "a", 30_000),  // semaine du 05 au 11
    row("2026-10-04", "a", 20_000), row("2026-09-28", "a", 60_000),  // semaine précédente, à cheval sur septembre
    row("2026-09-27", "a", 99_000),                                   // trop ancien
    row("2026-10-01", "b", 45_000),                                   // b : seulement la semaine précédente
    row("2026-10-12", "a", 99_000),                                   // après la date du rapport
  ];
  it("range chaque journée dans sa semaine et ignore le reste", () => {
    const l = semaineContrePrecedente(rows, "2026-10-11", (id) => id.toUpperCase());
    expect(l).toEqual([
      { id: "a", nom: "A", jours: 2, ca: 80_000, joursAvant: 2, caAvant: 80_000 },
      { id: "b", nom: "B", jours: 0, ca: 0, joursAvant: 1, caAvant: 45_000 },
    ]);
  });
});
