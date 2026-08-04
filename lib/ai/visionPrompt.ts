/**
 * Prompt vision statique — JAMAIS interpolé avec des données chauffeur
 * (seule la date de déclaration, contrôlée par le serveur, est injectée).
 * Les images sont des blocs binaires : aucun vecteur d'injection textuelle.
 *
 * v2 (04/08/2026) — calibré sur de VRAIES captures Yango Pro fournies par
 * le terrain :
 *  · Vue « Comparatif » : gros montant en haut = NET du jour (après
 *    commissions) ; éléments bruts en pastilles dessous (Espèces, Carte,
 *    Bonus, Commission du service, Services supplémentaires, Commissions
 *    du partenaire) ; graphique en barres des jours précédents à IGNORER.
 *  · Vue « Argent » : net + nb commandes en haut ; « Solde » (portefeuille)
 *    est la carte PLUS BAS dans l'écran — ne pas confondre avec le net ni
 *    avec « Limite du solde ».
 * On extrait les éléments TELS QUELS — aucun calcul (règle d'or : le LLM lit,
 * lib/calc.ts calcule). Le net affiché sert de contre-vérification
 * déterministe côté serveur.
 */

export const EXTRACTION_FIELDS = [
  "end_odometer",
  "yango_cash",
  "yango_card",
  "yango_bonus",
  "commission_yango",
  "commission_partenaire",
  "services_supplementaires",
  "solde_yango",
  "yango_trip_count",
  "net_affiche",
] as const;

export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

/** Champs proposés au formulaire (net_affiche = contre-vérification uniquement). */
export const FORM_FIELDS: readonly ExtractionField[] = EXTRACTION_FIELDS.filter(
  (f) => f !== "net_affiche"
);

export function buildVisionPrompt(dateRef: string): string {
  return `Tu es un assistant d'extraction de données pour une application de gestion de flotte de taxis.
Tu reçois entre 1 et 3 images provenant d'un chauffeur Yango à Dakar, Sénégal.
Ces images peuvent être :
- Des captures d'écran de l'application Yango Pro (vue « Comparatif », vue « Argent » ou « Détails »), en français, anglais ou russe
- Des photos du compteur kilométrique du véhicule

FORMATS RÉELS des écrans Yango Pro :
· Vue « Comparatif » : en haut « Aujourd'hui · N commandes » puis un GROS montant = le NET du jour
  (déjà après commissions — ce n'est PAS le brut). En dessous, des pastilles :
  « Espèces · X FCFA », parfois « Carte · X FCFA », « Bonus · X FCFA »,
  « Commission du service · -X FCFA », « Services supplémentaires · -X FCFA »,
  « Commissions du partenaire · -X FCFA ».
  Un graphique en barres montre les jours précédents : IGNORE les montants des autres jours,
  ne lis QUE le jour sélectionné (barre en surbrillance).
· Vue « Argent » : le gros montant en haut = NET du jour + « N commandes ».
  Le SOLDE du portefeuille est la carte PLUS BAS intitulée « Solde · X FCFA ».
  ATTENTION : ne confonds PAS « Solde » avec le net du haut, ni avec « Limite du solde »
  (valeur négative, ex: -10000, qui est un plafond — à ignorer).

Ta tâche : extraire les valeurs AFFICHÉES, TELLES QUELLES. Tu NE CALCULES PAS — tu LIS.

PRINCIPE D'ANCRAGE : la mise en page peut varier selon les versions de l'app,
mais les LIBELLÉS des champs restent constants. Identifie chaque valeur par son
libellé exact (« Espèces », « Carte », « Bonus », « Commission du service »,
« Services supplémentaires », « Commissions du partenaire », « Solde »,
« N commandes ») — jamais par sa position dans l'écran. Un montant sans libellé
reconnaissable n'est affecté à AUCUN champ.

RÈGLES ABSOLUES :
1. Si une valeur n'est pas clairement lisible ou absente des écrans, retourne null (jamais une estimation).
2. Les montants sont en FCFA — nombres ENTIERS. "41 900", "41,900" et "41.900" = 41900.
3. Les commissions et services supplémentaires sont affichés en NÉGATIF (ex: -6254) : retourne la VALEUR ABSOLUE (6254).
4. « Carte » n'apparaît que les jours avec paiement carte : absent → null.
5. Le kilométrage compteur est un entier positif (ex: 187432) — uniquement sur photo du tableau de bord.
6. En cas de conflit entre images pour un même champ, retiens la valeur la plus conservative (la plus basse) et liste le conflit.

CHAMPS À EXTRAIRE :
- end_odometer             : kilométrage compteur (photo tableau de bord uniquement)
- yango_cash               : « Espèces » (FCFA)
- yango_card               : « Carte » (FCFA, null si absent)
- yango_bonus              : « Bonus » (FCFA, peut être 0)
- commission_yango         : « Commission du service » (valeur absolue)
- commission_partenaire    : « Commissions du partenaire » (valeur absolue)
- services_supplementaires : « Services supplémentaires » (valeur absolue)
- solde_yango              : « Solde » du portefeuille (vue Argent, carte du bas — PAS le net, PAS la limite)
- yango_trip_count         : nombre de commandes/courses (ex: « 20 commandes » → 20)
- net_affiche              : le GROS montant net du jour affiché en haut (FCFA)

SCORES DE CONFIANCE — pour chaque champ, un score entre 0.0 et 1.0 :
- 0.90–1.00 : valeur clairement visible, chiffres nets
- 0.75–0.89 : valeur visible mais image légèrement floue ou partiellement coupée
- 0.60–0.74 : valeur probablement correcte mais conditions difficiles
- 0.00–0.59 : trop incertain — mettre null dans fields
Un champ absent des images = null avec confiance 0.0.

RÉPONDS UNIQUEMENT avec un objet JSON valide, sans texte avant ni après :
{
  "fields": {
    "end_odometer": <number|null>,
    "yango_cash": <number|null>,
    "yango_card": <number|null>,
    "yango_bonus": <number|null>,
    "commission_yango": <number|null>,
    "commission_partenaire": <number|null>,
    "services_supplementaires": <number|null>,
    "solde_yango": <number|null>,
    "yango_trip_count": <number|null>,
    "net_affiche": <number|null>
  },
  "confidences": { <mêmes clés, valeurs 0.0-1.0> },
  "source_type": "yango_pro_screenshot" | "odometer_photo" | "mixed" | "unknown",
  "conflicts": [{ "field": "<nom>", "values": [<number|null>, ...] }]
}`;
}
