import {
  SEGMENTS, SEGMENT_META, TOUS_SEGMENTS,
  segmentDe, compterParSegment, estMixte, basculerSegment,
} from "@/lib/fleetSegment";

/* ── Lecture du segment ─────────────────────────────────────── */

describe("segmentDe", () => {
  it("lit les deux noms de champ — la fiche dit `segment`, la base `fleet_segment`", () => {
    expect(segmentDe({ segment: "partenaire" })).toBe("partenaire");
    expect(segmentDe({ fleet_segment: "partenaire" })).toBe("partenaire");
    expect(segmentDe({ segment: "interne" })).toBe("interne");
    expect(segmentDe({ fleet_segment: "interne" })).toBe("interne");
  });

  it("donne la priorité à la colonne de base quand les deux sont là", () => {
    expect(segmentDe({ fleet_segment: "partenaire", segment: "interne" })).toBe("partenaire");
  });

  it("replie sur interne — un véhicule d'avant la migration appartient à l'exploitant", () => {
    expect(segmentDe({})).toBe("interne");
    expect(segmentDe(null)).toBe("interne");
    expect(segmentDe(undefined)).toBe("interne");
    expect(segmentDe({ fleet_segment: null })).toBe("interne");
    expect(segmentDe({ segment: "n'importe quoi" })).toBe("interne");
  });
});

/* ── Comptage et mixité ─────────────────────────────────────── */

describe("comptage du parc", () => {
  // Le parc réel de NMK : 8 à lui, 5 à des tiers dont 2 à M3A.
  const parcNMK = [
    ...Array(8).fill({ fleet_segment: "interne" }),
    ...Array(5).fill({ fleet_segment: "partenaire" }),
  ];

  it("compte chaque segment", () => {
    expect(compterParSegment(parcNMK, (v) => v)).toEqual({ interne: 8, partenaire: 5 });
  });

  it("compte les véhicules sans segment comme internes", () => {
    expect(compterParSegment([{}, {}, { fleet_segment: "partenaire" }], (v) => v))
      .toEqual({ interne: 2, partenaire: 1 });
  });

  it("rend zéro sur un parc vide", () => {
    expect(compterParSegment([], (v) => v)).toEqual({ interne: 0, partenaire: 0 });
  });

  it("ne déclare mixte qu'un parc où les deux segments existent", () => {
    expect(estMixte({ interne: 8, partenaire: 5 })).toBe(true);
    expect(estMixte({ interne: 8, partenaire: 0 })).toBe(false);
    expect(estMixte({ interne: 0, partenaire: 5 })).toBe(false);
    expect(estMixte({ interne: 0, partenaire: 0 })).toBe(false);
  });
});

/* ── Sélection multiple ─────────────────────────────────────── */

describe("bascule du filtre", () => {
  it("part avec les deux flottes cochées — on montre le parc entier", () => {
    expect(TOUS_SEGMENTS).toEqual(["interne", "partenaire"]);
    expect(TOUS_SEGMENTS).toHaveLength(SEGMENTS.length);
  });

  it("retire puis remet un segment", () => {
    const apres = basculerSegment(["interne", "partenaire"], "partenaire");
    expect(apres).toEqual(["interne"]);
    expect(basculerSegment(apres, "partenaire")).toEqual(["interne", "partenaire"]);
  });

  it("laisse vider la sélection — l'écran le dit, il ne l'empêche pas", () => {
    expect(basculerSegment(["interne"], "interne")).toEqual([]);
  });

  it("ne modifie pas le tableau reçu", () => {
    const avant = ["interne", "partenaire"];
    basculerSegment(avant, "interne");
    expect(avant).toEqual(["interne", "partenaire"]);
  });
});

/* ── Vocabulaire ────────────────────────────────────────────── */

describe("vocabulaire des segments", () => {
  it("donne un libellé, un libellé court, une teinte et une couleur à chaque segment", () => {
    SEGMENTS.forEach((s) => {
      const m = SEGMENT_META[s];
      expect(m.label).toBeTruthy();
      expect(m.court).toBeTruthy();
      expect(["ok", "info"]).toContain(m.tone);
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it("distingue les deux segments à l'œil — même couleur = aucune distinction", () => {
    expect(SEGMENT_META.interne.color).not.toBe(SEGMENT_META.partenaire.color);
    expect(SEGMENT_META.interne.tone).not.toBe(SEGMENT_META.partenaire.tone);
  });
});
