import {
  baseAmortissable, dureeAmortissementMois, amortissementPeriode, amortissementParc,
  pointMortParJour, financementPeriode,
  AMORT_PLAFOND_KM_DEFAUT, AMORT_DUREE_MAX_DEFAUT,
  type VehiculeAmortissable,
} from "@/lib/calc";

/**
 * Les deux véhicules du parc M3A réel, avec les valeurs directionnelles
 * données par Abdou le 25/09. Les km/mois sont MESURÉS en prod sur les
 * relevés de compteur de juin à septembre — pas des hypothèses.
 */
const ORLANDO: VehiculeAmortissable = {
  prixAcquisition: 6_500_000, valeurResiduelle: 4_000_000,
  dateAcquisition: "2026-01-01", compteurActuel: 96_998,
  plafondKm: 400_000, dureeMaxMois: 36, porteePar: "exploitant",
};
const ORLANDO_KM_MOIS = 5_890;

const KIA_K3: VehiculeAmortissable = {
  prixAcquisition: 5_500_000, valeurResiduelle: 3_500_000,
  dateAcquisition: "2026-01-01", compteurActuel: 149_037,
  plafondKm: 400_000, dureeMaxMois: 36, porteePar: "exploitant",
};
const KIA_KM_MOIS = 4_597;

describe("base amortissable", () => {
  it("retire la valeur résiduelle du prix d'acquisition", () => {
    expect(baseAmortissable(ORLANDO)).toBe(2_500_000);
    expect(baseAmortissable(KIA_K3)).toBe(2_000_000);
  });

  it("amortit la totalité quand la résiduelle est absente", () => {
    expect(baseAmortissable({ prixAcquisition: 6_000_000 })).toBe(6_000_000);
  });

  it("rend null tant que le prix n'est pas saisi — jamais 0", () => {
    // 0 serait lu comme « véhicule gratuit » par l'appelant ; null force
    // l'affichage « à renseigner ».
    expect(baseAmortissable({})).toBeNull();
    expect(baseAmortissable({ prixAcquisition: null })).toBeNull();
    expect(baseAmortissable({ prixAcquisition: 0 })).toBeNull();
  });

  it("ne descend jamais sous zéro", () => {
    expect(baseAmortissable({ prixAcquisition: 1_000_000, valeurResiduelle: 3_000_000 })).toBe(0);
  });
});

describe("durée d'amortissement", () => {
  it("retient la plus courte des deux contraintes, jamais la plus longue", () => {
    // Orlando : (400 000 − 96 998) / 5 890 = 51 mois, plafonné à 36.
    expect(dureeAmortissementMois(ORLANDO, ORLANDO_KM_MOIS)).toBe(36);
    // Kia : (400 000 − 149 037) / 4 597 = 55 mois, plafonné à 36.
    expect(dureeAmortissementMois(KIA_K3, KIA_KM_MOIS)).toBe(36);
  });

  it("raccourcit la durée quand le kilométrage restant est faible", () => {
    // C'est tout l'intérêt de la mesure : un véhicule racheté à 320 000 km
    // s'amortit en 14 mois, pas en 36. Un défaut global l'aurait manqué.
    const usee = { ...KIA_K3, compteurActuel: 320_000 };
    expect(dureeAmortissementMois(usee, 5_890)).toBe(14);
  });

  it("laisse au moins un mois à un véhicule au-delà de son plafond km", () => {
    // Pas 0 : l'appelant divise par cette durée.
    expect(dureeAmortissementMois({ ...KIA_K3, compteurActuel: 450_000 }, 5_000)).toBe(1);
  });

  it("rend null sans km/mois mesuré plutôt qu'une fausse précision", () => {
    expect(dureeAmortissementMois(ORLANDO, null)).toBeNull();
    expect(dureeAmortissementMois(ORLANDO, 0)).toBeNull();
  });

  it("applique les défauts 400 000 km / 36 mois quand ils sont absents", () => {
    const sansDefauts = { prixAcquisition: 6_000_000, compteurActuel: 0 };
    // 400 000 / 20 000 = 20 mois, sous le plafond de 36.
    expect(dureeAmortissementMois(sansDefauts, 20_000)).toBe(20);
    expect(AMORT_PLAFOND_KM_DEFAUT).toBe(400_000);
    expect(AMORT_DUREE_MAX_DEFAUT).toBe(36);
  });
});

describe("amortissement sur une période", () => {
  it("charge un mois plein sur un mois entier", () => {
    const r = amortissementPeriode({
      vehicule: ORLANDO, fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: ORLANDO_KM_MOIS,
    });
    // 2 500 000 / 36 = 69 444/mois ; 30 jours / 30,4 = 0,9868.
    expect(r.mensualite).toBe(69_444);
    expect(r.montant).toBe(68_530);
    expect(r.dureeMois).toBe(36);
    expect(r.raison).toBeNull();
  });

  it("proratise un véhicule acquis en cours de mois", () => {
    const r = amortissementPeriode({
      vehicule: { ...ORLANDO, dateAcquisition: "2026-09-16" },
      fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: ORLANDO_KM_MOIS,
    });
    // Du 16 au 30 = 15 jours, soit la moitié d'un mois.
    expect(r.montant).toBe(Math.round(69_444 * (15 / 30.4)));
    expect(r.montant).toBeLessThan(r.mensualite);
  });

  it("ne charge rien avant la date d'acquisition", () => {
    const r = amortissementPeriode({
      vehicule: { ...ORLANDO, dateAcquisition: "2026-10-01" },
      fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: ORLANDO_KM_MOIS,
    });
    expect(r.montant).toBe(0);
    expect(r.raison).toBe("hors_periode");
  });

  it("s'arrête net à la fin de l'amortissement — le résultat doit bondir", () => {
    // Acquis en janvier 2026, 36 mois ⇒ fin le 01/01/2029.
    const apres = amortissementPeriode({
      vehicule: ORLANDO, fromISO: "2029-02-01", toISO: "2029-02-28", kmParMois: ORLANDO_KM_MOIS,
    });
    expect(apres.montant).toBe(0);
    expect(apres.raison).toBe("totalement_amorti");
    expect(apres.moisRestants).toBe(0);
  });

  it("ne charge que les jours antérieurs sur le mois de fin", () => {
    // Décembre 2028 est le dernier mois plein ; janvier 2029 ne porte que le
    // 31 décembre exclu — donc rien au-delà du 01/01.
    const dernier = amortissementPeriode({
      vehicule: ORLANDO, fromISO: "2028-12-01", toISO: "2029-01-31", kmParMois: ORLANDO_KM_MOIS,
    });
    expect(dernier.montant).toBeGreaterThan(0);
    // 31 jours de décembre seulement, pas les 62 de la période demandée.
    expect(dernier.montant).toBe(Math.round(69_444 * (31 / 30.4)));
  });

  it("n'impute rien pour un véhicule porté par un tiers", () => {
    // Le cas NMK : un véhicule hébergé ne coûte pas son capital à l'exploitant.
    const r = amortissementPeriode({
      vehicule: { ...ORLANDO, porteePar: "proprietaire_tiers" },
      fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: ORLANDO_KM_MOIS,
    });
    expect(r.montant).toBe(0);
    expect(r.raison).toBe("porte_par_tiers");
  });

  it("distingue « non renseigné » de « rien à charger »", () => {
    const sansPrix = amortissementPeriode({
      vehicule: { dateAcquisition: "2026-01-01", compteurActuel: 50_000 },
      fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: 5_000,
    });
    expect(sansPrix.raison).toBe("non_renseigne");

    const sansDate = amortissementPeriode({
      vehicule: { ...ORLANDO, dateAcquisition: null },
      fromISO: "2026-09-01", toISO: "2026-09-30", kmParMois: ORLANDO_KM_MOIS,
    });
    expect(sansDate.raison).toBe("non_renseigne");
  });
});

describe("amortissement du parc M3A", () => {
  it("somme les deux véhicules et signale les trous de saisie", () => {
    const r = amortissementParc([
      { id: "orlando", vehicule: ORLANDO, kmParMois: ORLANDO_KM_MOIS },
      { id: "kia", vehicule: KIA_K3, kmParMois: KIA_KM_MOIS },
      { id: "inconnu", vehicule: {}, kmParMois: 5_000 },
    ], "2026-09-01", "2026-09-30");

    // Orlando 69 444 + Kia 55 556 = 125 000/mois pleins, proratisés sur 30 j.
    expect(r.montant).toBe(68_530 + 54_825);
    expect(r.nonRenseignes).toEqual(["inconnu"]);
  });

  it("rend 0 sur un parc vide sans planter", () => {
    const r = amortissementParc([], "2026-09-01", "2026-09-30");
    expect(r.montant).toBe(0);
    expect(r.nonRenseignes).toEqual([]);
  });
});

describe("point mort", () => {
  it("donne la recette nette minimale par jour ouvré", () => {
    expect(pointMortParJour({
      amortissementMensuel: 69_444, salaireMensuel: 200_000,
      chargesFixesMensuelles: 50_000, joursOuvresMois: 26,
    })).toBe(12_286);
  });

  it("rend 0 sans jours ouvrés plutôt que l'infini", () => {
    expect(pointMortParJour({
      amortissementMensuel: 69_444, salaireMensuel: 0,
      chargesFixesMensuelles: 0, joursOuvresMois: 0,
    })).toBe(0);
  });
});

describe("financement (bloc trésorerie, séparé du résultat)", () => {
  const credit = { mensualite: 180_000, dateDebut: "2026-01-01", dureeMois: 24, actif: true };

  it("décaisse la mensualité sur un mois entier", () => {
    expect(financementPeriode(credit, "2026-09-01", "2026-09-30"))
      .toBe(Math.round(180_000 * (30 / 30.4)));
  });

  it("s'arrête à l'échéance du crédit", () => {
    // Janvier 2026 + 24 mois ⇒ fin le 01/01/2028.
    expect(financementPeriode(credit, "2028-02-01", "2028-02-29")).toBe(0);
  });

  it("respecte un remboursement anticipé", () => {
    const solde = { ...credit, dateFin: "2026-09-01" };
    expect(financementPeriode(solde, "2026-09-01", "2026-09-30")).toBe(0);
  });

  it("ne compte rien pour un achat comptant ni pour un échéancier inactif", () => {
    expect(financementPeriode({ mensualite: 0, dateDebut: "2026-01-01", dureeMois: 0 }, "2026-09-01", "2026-09-30")).toBe(0);
    expect(financementPeriode({ ...credit, actif: false }, "2026-09-01", "2026-09-30")).toBe(0);
  });

  it("ne compte rien avant le premier prélèvement", () => {
    expect(financementPeriode(credit, "2025-11-01", "2025-11-30")).toBe(0);
  });
});
