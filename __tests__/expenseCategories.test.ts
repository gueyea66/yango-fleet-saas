import { CAT_AVANCE, CAT_SOLDE, EXPENSE_CATEGORIES, estChargeDeResultat } from "@/lib/expenseCategories";

describe("catégories et résultat", () => {
  it("l'achat de solde et l'avance propriétaire ne pèsent pas sur le résultat", () => {
    expect(estChargeDeResultat(CAT_SOLDE)).toBe(false);
    expect(estChargeDeResultat(CAT_AVANCE)).toBe(false);
  });
  it("toutes les autres catégories, et une charge sans catégorie, sont des charges", () => {
    for (const c of EXPENSE_CATEGORIES.filter((x) => x !== CAT_SOLDE && x !== CAT_AVANCE)) expect(estChargeDeResultat(c)).toBe(true);
    expect(estChargeDeResultat(null)).toBe(true);
  });
  it("CAT_SOLDE est bien une catégorie de la liste", () => {
    expect(EXPENSE_CATEGORIES).toContain(CAT_SOLDE);
  });
});
