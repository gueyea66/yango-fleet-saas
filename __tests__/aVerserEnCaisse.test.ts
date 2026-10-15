import { aVerserEnCaisse } from "@/lib/calc";

describe("argent à verser en caisse", () => {
  it("espèces + hors plateforme − dépenses ; la carte n'entre pas", () => {
    const c = aVerserEnCaisse([
      { yango_cash: 30_000, yango_card: 5_000, yango_gross: 35_000, off_yango_revenue: 2_000 },
      { yango_cash: 20_000, yango_card: 0, yango_gross: 20_000, off_yango_revenue: null },
    ], 8_000);
    expect(c).toEqual({ especes: 50_000, horsPlateforme: 2_000, avances: 0, charges: 8_000, montant: 44_000 });
  });

  it("une avance du propriétaire qui finance une dépense ne réduit pas le dû", () => {
    // 100 000 d'espèces ; réparation de 60 000 payée avec une avance de 60 000
    expect(aVerserEnCaisse([{ yango_cash: 100_000 }], 60_000, 60_000).montant).toBe(100_000);
  });

  it("déclaration sans espèces renseignées : brut − carte", () => {
    expect(aVerserEnCaisse([{ yango_cash: null, yango_card: 1_500, yango_gross: 10_000 }], 0).especes).toBe(8_500);
    expect(aVerserEnCaisse([{ yango_gross: 10_000 }], 0).especes).toBe(10_000);
  });

  it("dépenses supérieures aux encaissements : montant négatif, à signaler", () => {
    expect(aVerserEnCaisse([{ yango_cash: 5_000 }], 9_000).montant).toBe(-4_000);
  });

  it("aucune déclaration : zéro", () => {
    expect(aVerserEnCaisse([], 0)).toEqual({ especes: 0, horsPlateforme: 0, avances: 0, charges: 0, montant: 0 });
  });
});
