import { decaissementsDetail, margeApresSalaires } from "@/lib/v2/finance";

describe("décaissements et marge", () => {
  it("le détail retombe exactement sur le total de la carte", () => {
    const k = { decaissements: 1_491_400, provisionsSolde: 400_000, achatsCarburant: 300_000, autresDepensesOpe: 91_400, avancesProprietaire: 200_000 };
    const d = decaissementsDetail(k);
    expect(d.reduce((s, x) => s + x.amount, 0)).toBe(1_491_400);
    expect(d[4].amount).toBe(500_000);
  });
  it("marge = CA net − salaires dus (pas de double déduction)", () => {
    expect(margeApresSalaires(1_000_000, 280_000)).toBe(720_000);
  });
});
