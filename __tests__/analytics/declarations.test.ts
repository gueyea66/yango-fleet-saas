import {
  suiviDeclarations, cleCourses, type ChauffeurLigne, type RapportLigne, type DepenseLigne,
} from "@/lib/analytics/declarations";

const AWA: ChauffeurLigne = { id: "a", full_name: "Awa Ndiaye", yango_driver_id: "ya", active: true, plate: " AA101SJ " };
const rapport = (date: string, extra: Partial<RapportLigne> = {}): RapportLigne =>
  ({ driver_id: "a", date, status: "approved", yango_gross: 30000, yango_trip_count: 18, ...extra });
const plein = (date: string, extra: Partial<DepenseLigne> = {}): DepenseLigne =>
  ({ driver_id: "a", category: "Carburant", amount: 8000, status: "approved", expense_date: date, ...extra });
const suivi = (o: { rapports?: RapportLigne[]; depenses?: DepenseLigne[]; chauffeurs?: ChauffeurLigne[]; courses?: Map<string, number> }) =>
  suiviDeclarations({ chauffeurs: o.chauffeurs ?? [AWA], rapports: o.rapports ?? [], depenses: o.depenses ?? [], courses: o.courses, du: "2026-10-05", au: "2026-10-11", aujourdhui: "2026-10-11" });
const cas = (s: ReturnType<typeof suivi>, jour: string) => s.chauffeurs[0].cases.find((c) => c.jour === jour)!;

describe("suiviDeclarations", () => {
  it("distingue recette validée, en attente, repos, sans chiffre et manquante", () => {
    const s = suivi({
      rapports: [
        rapport("2026-10-05"),
        rapport("2026-10-06", { status: "submitted" }),
        rapport("2026-10-07", { comment: "[REPOS] dimanche", yango_gross: 0, yango_trip_count: 0 }),
        rapport("2026-10-08", { yango_gross: 0, yango_trip_count: 0 }),
      ],
      depenses: [plein("2026-10-05"), plein("2026-10-06")],
    });
    expect(s.jours).toHaveLength(7);
    expect(cas(s, "2026-10-05").recette).toBe("declaree");
    expect(cas(s, "2026-10-05").ca).toBe(30000);
    expect(cas(s, "2026-10-06").recette).toBe("attente");
    expect(cas(s, "2026-10-07").recette).toBe("repos");
    expect(cas(s, "2026-10-07").alertes).toEqual([]);
    expect(cas(s, "2026-10-08").alertes).toEqual(["sans_chiffre"]);
    expect(cas(s, "2026-10-09").alertes).toEqual(["declaration_manquante"]);
    expect(s.chauffeurs[0].plaque).toBe("AA101SJ");
  });

  it("ne réclame pas le jour en cours : il n'est pas encore dû", () => {
    const s = suivi({ rapports: [] });
    expect(cas(s, "2026-10-11").recette).toBe("en_cours");
    expect(cas(s, "2026-10-11").alertes).toEqual([]);
    expect(s.chauffeurs[0].dus).toBe(6);
    expect(s.total.alertes.declaration_manquante).toBe(6);
    expect(s.total.taux).toBe(0);
  });

  it("tolère une journée travaillée sans carburant, signale la deuxième de suite", () => {
    const s = suivi({
      rapports: ["05", "06", "07", "08", "09", "10"].map((j) => rapport(`2026-10-${j}`)),
      depenses: [plein("2026-10-05"), plein("2026-10-09", { status: "submitted" })],
    });
    expect(cas(s, "2026-10-05").carburant).toBe("ok");
    expect(cas(s, "2026-10-06").carburant).toBe("absent");
    expect(cas(s, "2026-10-06").alertes).toEqual([]);            // première journée sans : tolérée
    expect(cas(s, "2026-10-07").alertes).toEqual(["carburant_manquant"]);
    expect(cas(s, "2026-10-08").alertes).toEqual(["carburant_manquant"]);
    expect(cas(s, "2026-10-09").carburant).toBe("attente");      // un plein en attente de validation compte
    expect(cas(s, "2026-10-09").alertes).toEqual([]);
    expect(s.chauffeurs[0].dernierCarburant).toBe("2026-10-09");
    expect(s.total.alertes.carburant_manquant).toBe(2);
  });

  it("ne réclame pas de carburant un jour de repos, et ne compte pas une dépense rejetée", () => {
    const s = suivi({
      rapports: [rapport("2026-10-05"), rapport("2026-10-06"), rapport("2026-10-07", { comment: "[REPOS]", yango_gross: 0, yango_trip_count: 0 })],
      depenses: [plein("2026-10-05", { status: "rejected" }), plein("2026-10-06", { status: "rejected" })],
    });
    expect(cas(s, "2026-10-05").carburant).toBe("absent");
    expect(cas(s, "2026-10-06").alertes).toEqual(["carburant_manquant"]);
    expect(cas(s, "2026-10-07").carburant).toBe("sans_objet");
  });

  it("un rapport rejeté ne vaut pas déclaration", () => {
    const s = suivi({ rapports: [rapport("2026-10-05", { status: "rejected" })] });
    expect(cas(s, "2026-10-05").recette).toBe("manquante");
    expect(cas(s, "2026-10-05").rejetee).toBe(true);
    expect(s.aTraiter.find((a) => a.jour === "2026-10-05")!.detail).toMatch(/rejeté/);
  });

  it("se sert des courses Yango comme témoin", () => {
    const courses = new Map([[cleCourses("ya", "2026-10-06"), 14], [cleCourses("ya", "2026-10-07"), 9]]);
    const s = suivi({
      rapports: [rapport("2026-10-07", { comment: "[REPOS]", yango_gross: 0, yango_trip_count: 0 })],
      courses,
    });
    expect(s.temoinYango).toBe(true);
    expect(cas(s, "2026-10-06").alertes).toEqual(["roule_sans_declarer"]);
    expect(cas(s, "2026-10-07").alertes).toEqual(["repos_mais_roule"]);
    expect(cas(s, "2026-10-08").alertes).toEqual(["declaration_manquante"]);
    expect(cas(s, "2026-10-08").coursesYango).toBe(0);
  });

  it("ne demande rien hors contrat et ignore les comptes techniques", () => {
    const s = suivi({
      chauffeurs: [
        { ...AWA, hire_date: "2026-10-08" },
        { id: "t", full_name: "Founder", account_type: "technical" },
        { id: "p", full_name: "Parti", contract_end_date: "2026-09-30" },
      ],
    });
    expect(s.chauffeurs.map((c) => c.nom)).toEqual(["Awa Ndiaye"]);
    expect(cas(s, "2026-10-06").recette).toBe("hors_contrat");
    expect(s.chauffeurs[0].dus).toBe(3); // 8, 9, 10 — le 11 est en cours
  });

  it("masque sur demande les chauffeurs partis depuis, et dit combien", () => {
    const base = { rapports: [], depenses: [], du: "2026-10-05", au: "2026-10-11", aujourdhui: "2026-10-11" };
    const chauffeurs = [AWA, { id: "p", full_name: "Parti Mardi", contract_end_date: "2026-10-07" }];
    const tous = suiviDeclarations({ ...base, chauffeurs });
    expect(tous.chauffeurs.map((c) => c.nom).sort()).toEqual(["Awa Ndiaye", "Parti Mardi"]);
    expect(tous.anciens).toBe(1);
    const actifs = suiviDeclarations({ ...base, chauffeurs, actifsSeulement: true });
    expect(actifs.chauffeurs.map((c) => c.nom)).toEqual(["Awa Ndiaye"]);
    expect(actifs.anciens).toBe(1);
    expect(actifs.total.dus).toBe(6); // les journées du chauffeur parti ne pèsent plus dans le taux
  });

  it("suit une seule journée quand les deux dates sont identiques", () => {
    const s = suiviDeclarations({ chauffeurs: [AWA], rapports: [rapport("2026-10-08")], depenses: [], du: "2026-10-08", au: "2026-10-08", aujourdhui: "2026-10-11" });
    expect(s.jours).toEqual(["2026-10-08"]);
    expect(s.total.taux).toBe(1);
  });

  it("classe d'abord les chauffeurs qui ont le plus à régulariser", () => {
    const s = suivi({
      chauffeurs: [AWA, { id: "b", full_name: "Zed Ba" }],
      rapports: ["05", "06", "07", "08", "09", "10"].map((j) => rapport(`2026-10-${j}`, { driver_id: "b" })),
      depenses: ["05", "06", "07", "08", "09", "10"].map((j) => plein(`2026-10-${j}`, { driver_id: "b" })),
    });
    expect(s.chauffeurs.map((c) => c.nom)).toEqual(["Awa Ndiaye", "Zed Ba"]);
    expect(s.total.chauffeursConcernes).toBe(1);
    expect(s.total.taux).toBeCloseTo(0.5, 5);
  });
});
