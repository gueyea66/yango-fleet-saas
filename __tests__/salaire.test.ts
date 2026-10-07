import { partSurCA } from "@/lib/salaire";

describe("part du chauffeur sur le CA", () => {
  it("20 % du reste et 50 % du bonus d'objectif", () => {
    // 1 000 000 de brut dont 100 000 de bonus d'objectif
    expect(partSurCA({ brut: 1_000_000, bonusObjectif: 100_000, taux: 0.2, tauxBonusObjectif: 0.5 })).toBe(900_000 * 0.2 + 100_000 * 0.5);
  });
  it("sans bonus d'objectif : brut × taux", () => {
    expect(partSurCA({ brut: 500_000, bonusObjectif: 0, taux: 0.2, tauxBonusObjectif: 0.5 })).toBe(100_000);
    expect(partSurCA({ brut: 500_000, taux: 0.2, tauxBonusObjectif: 0.5 })).toBe(100_000);
  });
  it("sans taux propre au bonus : il est partagé au taux général, comme avant", () => {
    expect(partSurCA({ brut: 1_000_000, bonusObjectif: 100_000, taux: 0.2 })).toBe(200_000);
    expect(partSurCA({ brut: 1_000_000, bonusObjectif: 100_000, taux: 0.2, tauxBonusObjectif: null })).toBe(200_000);
  });
  it("le bonus est borné par le brut et n'est jamais négatif", () => {
    expect(partSurCA({ brut: 50_000, bonusObjectif: 80_000, taux: 0.2, tauxBonusObjectif: 0.5 })).toBe(25_000);
    expect(partSurCA({ brut: 50_000, bonusObjectif: -10_000, taux: 0.2, tauxBonusObjectif: 0.5 })).toBe(10_000);
  });
});
