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

/**
 * « Décaissement propriétaire » = AVANCE de fonds remise à un chauffeur
 * (retour Abdou 03/09) : cash sorti (trésorerie) mais NEUTRE pour le résultat —
 * la charge réelle est celle que le chauffeur déclare ensuite avec preuve et la
 * vraie catégorie. Compter les deux serait un double comptage. Tout agrégat de
 * charges (net final, opérationnel, pilotage, brief IA, rapports) DOIT exclure
 * cette catégorie ; seule la trésorerie la compte (décaissements).
 * Réservée aux comptes techniques (ex. « Founder ») dans le formulaire chauffeur.
 */
export const CAT_AVANCE = "Décaissement propriétaire";
