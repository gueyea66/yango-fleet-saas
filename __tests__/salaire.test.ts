import { configEffective, partSurCA } from "@/lib/salaire";

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

describe("paramétrage appliqué à un chauffeur", () => {
  const compte = { model: "percent", base_amount: 0, commission_rate: 0.2, bonus_objectif_rate: 0.5, comm_yango: 15 };
  it("fiche vide : le paramétrage par défaut du compte s'applique tel quel", () => {
    expect(configEffective(compte, {})).toEqual(compte);
    expect(configEffective(compte, { salary_model: null, base_amount: null, salary_rate: null, salary_bonus_objectif_rate: null })).toEqual(compte);
  });
  it("seuls les champs réglés sur la fiche remplacent le défaut", () => {
    expect(configEffective(compte, { salary_rate: 0.25 })).toEqual({ ...compte, commission_rate: 0.25 });
    expect(configEffective(compte, { salary_model: "fixed", base_amount: 200_000 })).toEqual({ ...compte, model: "fixed", base_amount: 200_000 });
    expect(configEffective(compte, { salary_bonus_objectif_rate: 0.4 }).bonus_objectif_rate).toBe(0.4);
  });
  it("un taux de 0 sur la fiche est un vrai choix, pas un champ vide", () => {
    expect(configEffective(compte, { salary_rate: 0, salary_bonus_objectif_rate: 0 })).toMatchObject({ commission_rate: 0, bonus_objectif_rate: 0 });
  });
  it("part calculée avec le paramétrage du chauffeur", () => {
    const c = configEffective(compte, { salary_rate: 0.25, salary_bonus_objectif_rate: 0.6 });
    expect(partSurCA({ brut: 1_000_000, bonusObjectif: 100_000, taux: c.commission_rate, tauxBonusObjectif: c.bonus_objectif_rate })).toBe(900_000 * 0.25 + 100_000 * 0.6);
  });
});
