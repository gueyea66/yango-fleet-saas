/**
 * Recalcul du net d'un rapport DÉJÀ saisi quand on corrige ses montants
 * (fiche rapport admin, resoumission chauffeur après rejet).
 *
 * Le recalcul respecte le mode de la saisie d'origine :
 * - « éléments réels » dès qu'une commission lue dans l'app est stockée
 *   (lib/calcReel — aucune commission recalculée, les éléments sont repris) ;
 * - sinon « théorique » aux taux FIGÉS du rapport (lib/calc).
 *
 * Sans ça, corriger un rapport en mode réel réappliquait les taux théoriques
 * et écrasait le net déclaré. Pur, sans dépendance DB/UI.
 */
import { computeCommissions } from "@/lib/calc";
import { computeElementsReels, hasElementsReels } from "@/lib/calcReel";

export const DEFAULT_COMMISSION_RATE = 0.15;  // fraction, repli si le rapport n'a pas de taux
export const DEFAULT_PARTNER_RATE = 0.0075;

export interface ReportNetInput {
  yangoGross: number;
  yangoBonus: number;
  horsYango: number;
  serviceSupplementaire: number;
  commissionYangoReelle: number | null;       // null = non déclarée
  commissionPartenaireReelle: number | null;
  commissionRate: number | null;              // fraction stockée sur le rapport (0.15)
  partnerRate: number | null;                 // fraction (0.0075)
}

export interface ReportNetResult {
  mode: "elements_reels" | "theorique";
  grossEarnings: number;
  commissionAmount: number;
  netAfterExpenses: number;
}

export function recomputeReportNet(i: ReportNetInput): ReportNetResult {
  if (hasElementsReels({
    commissionYango: i.commissionYangoReelle,
    commissionPartenaire: i.commissionPartenaireReelle,
  })) {
    const commY = i.commissionYangoReelle ?? 0;
    const commP = i.commissionPartenaireReelle ?? 0;
    // Le brut corrigé fait foi (espèces + carte d'origine ne sont pas ré-éditées).
    const r = computeElementsReels({
      yangoCash: i.yangoGross, yangoCard: 0, bonus: i.yangoBonus,
      commissionYango: commY, commissionPartenaire: commP,
      servicesSupplementaires: i.serviceSupplementaire, horsYango: i.horsYango,
    });
    return {
      mode: "elements_reels",
      grossEarnings: r.brutYango + i.yangoBonus + i.horsYango,
      commissionAmount: commY + commP,
      netAfterExpenses: r.netTotal,
    };
  }
  const calc = computeCommissions({
    brutYango: i.yangoGross, bonusYango: i.yangoBonus, horsYango: i.horsYango,
    rates: {
      yangoPct: (i.commissionRate ?? DEFAULT_COMMISSION_RATE) * 100,
      partnerPct: (i.partnerRate ?? DEFAULT_PARTNER_RATE) * 100,
    },
    serviceSupplementaire: i.serviceSupplementaire,
  });
  return {
    mode: "theorique",
    grossEarnings: calc.base + i.horsYango,
    commissionAmount: calc.commYango + calc.commPartner,
    netAfterExpenses: calc.netTotal,
  };
}
