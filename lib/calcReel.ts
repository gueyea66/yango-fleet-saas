/**
 * Mode « éléments réels » de la déclaration journalière.
 *
 * Quand les éléments affichés par l'app Yango Pro sont disponibles (saisis ou
 * extraits par vision), il n'y a PLUS RIEN à calculer côté commissions : on
 * additionne/soustrait les éléments TELS QUELS. Ce module est l'arithmétique
 * pure de ce mode — testé, zéro dépendance, zéro LLM.
 *
 * lib/calc.ts (commissions THÉORIQUES par taux) reste intact : il sert de
 * secours quand les éléments réels ne sont pas fournis (saisie ancienne
 * école), et de référence de réconciliation côté admin.
 */

export interface ElementsReelsInput {
  yangoCash: number;        // « Espèces »
  yangoCard: number;        // « Carte » (0 si absent)
  bonus: number;            // « Bonus »
  commissionYango: number;  // « Commission du service » (valeur absolue)
  commissionPartenaire: number; // « Commissions du partenaire » (valeur absolue)
  servicesSupplementaires: number; // « Services supplémentaires » (valeur absolue)
  horsYango: number;        // revenus hors plateforme (saisie chauffeur)
}

export interface ElementsReelsResult {
  brutYango: number;        // espèces + carte
  totalDeductions: number;  // commissions + services
  netYango: number;         // brut + bonus − déductions (= net affiché par l'app)
  netTotal: number;         // netYango + hors Yango
}

/** Le mode réel s'applique dès qu'une commission réelle est renseignée. */
export function hasElementsReels(input: {
  commissionYango: number | null;
  commissionPartenaire: number | null;
}): boolean {
  return input.commissionYango !== null || input.commissionPartenaire !== null;
}

export function computeElementsReels(input: ElementsReelsInput): ElementsReelsResult {
  const brutYango = input.yangoCash + input.yangoCard;
  const totalDeductions =
    input.commissionYango + input.commissionPartenaire + input.servicesSupplementaires;
  const netYango = brutYango + input.bonus - totalDeductions;
  return {
    brutYango,
    totalDeductions,
    netYango,
    netTotal: netYango + input.horsYango,
  };
}
