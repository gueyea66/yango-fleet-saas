/**
 * Recalcul du net d'un rapport corrigé : le mode d'origine est conservé.
 * Cas réel de référence : capture Yango Pro du 03/08/2026 (net app 33 990).
 */
import { recomputeReportNet } from "@/lib/reportNet";

const reel = {
  yangoGross: 41900, yangoBonus: 200, horsYango: 0, serviceSupplementaire: 605,
  commissionYangoReelle: 6254, commissionPartenaireReelle: 1251,
  commissionRate: 0.15, partnerRate: 0.0075,
};

describe("recomputeReportNet — mode éléments réels", () => {
  it("reprend le net déclaré par l'app, sans taux théorique", () => {
    const r = recomputeReportNet(reel);
    expect(r.mode).toBe("elements_reels");
    expect(r.netAfterExpenses).toBe(33990);
    expect(r.commissionAmount).toBe(7505);
    expect(r.grossEarnings).toBe(42100);
  });

  it("une correction du brut garde les commissions lues", () => {
    const r = recomputeReportNet({ ...reel, yangoGross: 42900 });
    expect(r.mode).toBe("elements_reels");
    expect(r.netAfterExpenses).toBe(34990);
  });

  it("hors Yango s'ajoute au net", () => {
    expect(recomputeReportNet({ ...reel, horsYango: 5000 }).netAfterExpenses).toBe(38990);
  });

  it("une commission réelle à 0 reste le mode réel", () => {
    const r = recomputeReportNet({ ...reel, commissionYangoReelle: 0, commissionPartenaireReelle: null, serviceSupplementaire: 0, yangoBonus: 0 });
    expect(r.mode).toBe("elements_reels");
    expect(r.netAfterExpenses).toBe(41900);
  });
});

describe("recomputeReportNet — mode théorique", () => {
  const theo = {
    yangoGross: 100000, yangoBonus: 0, horsYango: 5000, serviceSupplementaire: 0,
    commissionYangoReelle: null, commissionPartenaireReelle: null,
    commissionRate: 0.15, partnerRate: 0.0075,
  };

  it("applique les taux figés du rapport", () => {
    const r = recomputeReportNet(theo);
    expect(r.mode).toBe("theorique");
    expect(r.commissionAmount).toBeCloseTo(15750, 6);
    expect(r.netAfterExpenses).toBeCloseTo(89250, 6);
    expect(r.grossEarnings).toBe(105000);
  });

  it("respecte un taux propre au rapport", () => {
    const r = recomputeReportNet({ ...theo, commissionRate: 0.1, partnerRate: 0 });
    expect(r.netAfterExpenses).toBeCloseTo(95000, 6);
  });

  it("taux absents : repli 15 % + 0,75 %", () => {
    const r = recomputeReportNet({ ...theo, commissionRate: null, partnerRate: null });
    expect(r.netAfterExpenses).toBeCloseTo(89250, 6);
  });

  it("déduit le service supplémentaire", () => {
    expect(recomputeReportNet({ ...theo, serviceSupplementaire: 1000 }).netAfterExpenses).toBeCloseTo(88250, 6);
  });
});
