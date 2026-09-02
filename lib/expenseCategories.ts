/**
 * Liste CANONIQUE des motifs de charge/décaissement — une seule source pour
 * les formulaires admin et chauffeur (retour Abdou 02/09 : « Décaissement
 * propriétaire » évite de noyer les sorties du compte Founder dans « Autre » ;
 * le commentaire saisi alimente ensuite le deep dive des rapports mensuels).
 * « Autre » reste en dernier — le commentaire y est fortement recommandé.
 */
export const EXPENSE_CATEGORIES = [
  "Carburant",
  "Péage",
  "Contrôle routier",
  "Entretien",
  "Lavage",
  "Amende",
  "Solde Yango",
  "Décaissement propriétaire",
  "Autre",
] as const;
