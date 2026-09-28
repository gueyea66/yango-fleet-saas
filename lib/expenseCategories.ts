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
  "Réparation",
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

/**
 * Entretien COURANT (vidange, filtres, AdBlue, climatisation) contre
 * RÉPARATION (panne, casse, pièce détachée, main d'œuvre).
 *
 * Ajouté le 26/09 sur constat d'Abdou : faute de catégorie, les réparations
 * étaient saisies en « Entretien ». Sur le parc M3A, cela représentait environ
 * les deux tiers du poste — 553 500 F de réparations dans 816 200 F d'« Entretien ».
 * Les mélanger a deux conséquences concrètes :
 *
 *   • les projections extrapolaient une réparation ponctuelle comme si elle se
 *     répétait chaque jour ouvré du mois (cf. PONCTUELLES dans usePilotage) ;
 *   • l'entretien courant est prévisible et se budgète, la réparation est
 *     aléatoire et se provisionne. Un seul poste ne peut pas se piloter des
 *     deux façons.
 */
export const CAT_ENTRETIEN = "Entretien";
export const CAT_REPARATION = "Réparation";

/**
 * Tout ce qui touche la mécanique du véhicule. Sert aux analyses et aux règles
 * qui suivent le coût global d'un véhicule, et à sortir ces postes des
 * « autres dépenses récurrentes » où ils seraient comptés deux fois.
 */
export const CATS_MAINTENANCE: readonly string[] = [CAT_ENTRETIEN, CAT_REPARATION];

/**
 * Ce que la dotation de provision couvre — l'entretien programmé SEULEMENT.
 *
 * Précision d'Abdou le 26/09 : « réparation = panne exceptionnelle ; huile,
 * vidange, ça c'est justement la provision ». On provisionne ce qui est
 * prévisible et revient au kilométrage (vidange, filtres, AdBlue) ; une panne
 * est un accident de parcours et passe en charge au moment où elle tombe.
 * L'inverse — provisionner l'aléa — reviendrait à lisser un sinistre et à
 * masquer le mois où il se produit.
 */
export const CATS_PROVISIONNEES: readonly string[] = [CAT_ENTRETIEN];
