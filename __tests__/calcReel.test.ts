/**
 * Mode « éléments réels » — arithmétique pure des éléments Yango pris tels
 * quels (aucune commission calculée). Validé sur la capture réelle du
 * 03/08/2026 : Espèces 41 900 + Bonus 200 − Comm 6 254 − Services 605 −
 * Comm partenaire 1 251 = Net 33 990 (affiché par l'app).
 */
import { computeElementsReels, hasElementsReels } from "@/lib/calcReel";

const captureReelle = {
  yangoCash: 41900, yangoCard: 0, bonus: 200,
  commissionYango: 6254, commissionPartenaire: 1251,
  servicesSupplementaires: 605, horsYango: 0,
};

describe("computeElementsReels — capture réelle 03/08", () => {
  it("reconstitue exactement le net affiché par l'app", () => {
    const r = computeElementsReels(captureReelle);
    expect(r.brutYango).toBe(41900);
    expect(r.totalDeductions).toBe(6254 + 1251 + 605);
    expect(r.netYango).toBe(33990);
    expect(r.netTotal).toBe(33990);
  });

  it("carte présente : brut = espèces + carte", () => {
    const r = computeElementsReels({ ...captureReelle, yangoCard: 5000 });
    expect(r.brutYango).toBe(46900);
    expect(r.netYango).toBe(38990);
  });

  it("hors Yango s'ajoute au net total, jamais au net Yango", () => {
    const r = computeElementsReels({ ...captureReelle, horsYango: 5000 });
    expect(r.netYango).toBe(33990);
    expect(r.netTotal).toBe(38990);
  });

  it("journée sans bonus ni services : simple brut − commissions", () => {
    const r = computeElementsReels({
      yangoCash: 20000, yangoCard: 0, bonus: 0,
      commissionYango: 3000, commissionPartenaire: 150,
      servicesSupplementaires: 0, horsYango: 0,
    });
    expect(r.netTotal).toBe(16850);
  });
});

describe("hasElementsReels — bascule mode réel / mode théorique", () => {
  it("une commission réelle renseignée suffit", () => {
    expect(hasElementsReels({ commissionYango: 6254, commissionPartenaire: null })).toBe(true);
    expect(hasElementsReels({ commissionYango: null, commissionPartenaire: 1251 })).toBe(true);
  });
  it("aucune commission réelle → mode théorique historique (calc.ts)", () => {
    expect(hasElementsReels({ commissionYango: null, commissionPartenaire: null })).toBe(false);
  });
  it("commission à 0 explicite = mode réel (jour sans commission)", () => {
    expect(hasElementsReels({ commissionYango: 0, commissionPartenaire: null })).toBe(true);
  });
});
