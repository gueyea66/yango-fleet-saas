import {
  resolveRates, computeCommissions, soldeConsomme, coutCarburantParKm,
  carburantConsomme, computeOperationnel, computeTresorerie,
  joursCalendaires, joursOuvresRealises, joursOuvresProjetes, bornesMois,
  salaireProrata, estProratable, projeterResultat,
} from "@/lib/calc";

describe("commissions (théorique)", () => {
  const tenant = { yangoPct: 15, partnerPct: 0.75 };

  it("résout chauffeur > véhicule > tenant", () => {
    expect(resolveRates({ yangoPct: 10 }, { partnerPct: 2 }, tenant))
      .toEqual({ yangoPct: 10, partnerPct: 2 });
    expect(resolveRates(null, null, tenant)).toEqual(tenant);
    expect(resolveRates({ yangoPct: undefined }, { yangoPct: 12, partnerPct: 3 }, tenant))
      .toEqual({ yangoPct: 12, partnerPct: 3 });
  });

  it("calcule le net commissions avec service supplémentaire", () => {
    const r = computeCommissions({
      brutYango: 45000, bonusYango: 2500, horsYango: 6000,
      rates: tenant, serviceSupplementaire: 1000,
    });
    // base = 47500 ; commY = 7125 ; commP = 356.25 ; service = 1000
    expect(r.base).toBe(47500);
    expect(r.commYango).toBeCloseTo(7125);
    expect(r.commPartner).toBeCloseTo(356.25);
    expect(r.netYango).toBeCloseTo(47500 - 7125 - 356.25 - 1000);
    expect(r.netTotal).toBeCloseTo(47500 - 7125 - 356.25 - 1000 + 6000);
  });

  it("service supp par défaut = 0", () => {
    const r = computeCommissions({ brutYango: 10000, bonusYango: 0, horsYango: 0, rates: { yangoPct: 10, partnerPct: 0 } });
    expect(r.serviceSupp).toBe(0);
    expect(r.netTotal).toBeCloseTo(9000);
  });
});

describe("solde consommé (opérationnel)", () => {
  it("neutralise les recharges du jour", () => {
    // veille 20000, fin 15000, provision 10000 → consommé = 20000-15000+10000 = 15000
    expect(soldeConsomme({ soldeVeille: 20000, soldeFin: 15000, provisionsDuJour: 10000 })).toBe(15000);
  });
  it("jamais négatif", () => {
    expect(soldeConsomme({ soldeVeille: 5000, soldeFin: 20000, provisionsDuJour: 0 })).toBe(0);
  });
});

describe("carburant (opérationnel)", () => {
  it("coût par km dérivé du réel", () => {
    expect(coutCarburantParKm(120000, 2000)).toBe(60); // 60 XOF/km
  });
  it("0 si aucun km (pas de division par zéro)", () => {
    expect(coutCarburantParKm(50000, 0)).toBe(0);
  });
  it("consommation = km × coût/km", () => {
    expect(carburantConsomme(300, 60)).toBe(18000);
  });
});

describe("résultat opérationnel & trésorerie", () => {
  it("opérationnel = recettes − consommations − dépenses opé − salaires", () => {
    expect(computeOperationnel({
      recettes: 53500, soldeConsomme: 8000, carburantConsomme: 12000,
      depensesOperationnelles: 3000, salaires: 5000,
    })).toBe(53500 - 8000 - 12000 - 3000 - 5000);
  });

  it("trésorerie sépare cash et avance de solde/carburant", () => {
    const t = computeTresorerie({
      encaissements: 53500, provisionsSolde: 20000, achatsCarburant: 30000,
      autresDepenses: 3000, salaires: 5000, soldeConsomme: 8000, carburantConsomme: 12000,
    });
    expect(t.decaissements).toBe(20000 + 30000 + 3000 + 5000);
    expect(t.tresorerie).toBe(53500 - 58000);
    expect(t.avanceSolde).toBe(20000 - 8000);       // 12000 immobilisés
    expect(t.avanceCarburant).toBe(30000 - 12000);  // 18000 immobilisés
  });

  it("réconciliation : opérationnel − trésorerie = avances", () => {
    const common = { soldeConsomme: 8000, carburantConsomme: 12000, salaires: 5000 };
    const op = computeOperationnel({ recettes: 53500, depensesOperationnelles: 3000, ...common });
    const tr = computeTresorerie({
      encaissements: 53500, provisionsSolde: 20000, achatsCarburant: 30000,
      autresDepenses: 3000, ...common,
    });
    expect(op - tr.tresorerie).toBe(tr.avanceSolde + tr.avanceCarburant);
  });
});

describe("jours ouvrés", () => {
  it("compte les jours calendaires inclus", () => {
    expect(joursCalendaires("2026-07-01", "2026-07-31")).toBe(31);
    expect(joursCalendaires("2026-07-15", "2026-07-15")).toBe(1);
  });
  it("réalisés = calendaires − repos déclarés", () => {
    expect(joursOuvresRealises("2026-07-01", "2026-07-07", ["2026-07-05"])).toBe(6);
    // repos hors période ignoré
    expect(joursOuvresRealises("2026-07-01", "2026-07-07", ["2026-06-30", "2026-07-05"])).toBe(6);
  });
  it("projetés = 6/7 sur le calendrier réel du mois", () => {
    // juillet 2026 = 31 jours → round(31*6/7) = round(26.57) = 27
    const { from, to } = bornesMois(2026, 7);
    expect(joursOuvresProjetes(from, to)).toBe(27);
    // février 2026 = 28 jours → round(24) = 24
    const feb = bornesMois(2026, 2);
    expect(joursOuvresProjetes(feb.from, feb.to)).toBe(24);
  });
  it("bornesMois gère la longueur variable", () => {
    expect(bornesMois(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(bornesMois(2024, 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" }); // bissextile
    expect(bornesMois(2026, 7)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
});

describe("salaire prorata", () => {
  it("proratise la base fixe selon jours ouvrés travaillés", () => {
    // entré à mi-parcours : 13 jours ouvrés sur 26 → moitié
    expect(salaireProrata({ salaireMensuel: 200000, joursOuvresTravailles: 13, joursOuvresMois: 26, proratable: true })).toBe(100000);
  });
  it("plein salaire si non proratable (percent/location)", () => {
    expect(salaireProrata({ salaireMensuel: 200000, joursOuvresTravailles: 5, joursOuvresMois: 26, proratable: false })).toBe(200000);
  });
  it("plafonne à 100%", () => {
    expect(salaireProrata({ salaireMensuel: 200000, joursOuvresTravailles: 30, joursOuvresMois: 26, proratable: true })).toBe(200000);
  });
  it("modèles proratables", () => {
    expect(estProratable("fixed")).toBe(true);
    expect(estProratable("tiered")).toBe(true);
    expect(estProratable("percent")).toBe(false);
    expect(estProratable("location")).toBe(false);
  });
});

describe("projection PnL", () => {
  it("extrapole la moyenne par jour ouvré", () => {
    // réalisé 130000 sur 10 jours ouvrés → 13000/j ; cible 27 jours → 351000
    expect(projeterResultat({ resultatRealise: 130000, joursOuvresEcoules: 10, joursOuvresCible: 27 })).toBe(351000);
  });
  it("0 si aucun jour écoulé", () => {
    expect(projeterResultat({ resultatRealise: 100000, joursOuvresEcoules: 0, joursOuvresCible: 27 })).toBe(0);
  });
});
