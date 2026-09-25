/**
 * Fiche de mise en service — modèle partagé page/serveur.
 *
 * Aucune dépendance Node ici, à dessein : la console d'onboarding importe ce
 * fichier côté navigateur. La mise en service elle-même vit dans
 * `lib/onboarding.ts`, qui reste serveur.
 */

export interface OnbEtat { s: number; n: string }

export interface OnbVehicule {
  id: string;
  plaque: string;
  modele: string;
  annee: string;
  proprio: string;
  service: string;
  /**
   * 'interne' (le véhicule appartient au client) ou 'partenaire' (il appartient
   * à un tiers qui le confie au parc). Optionnel pour les fiches antérieures
   * à la 062 ; `segmentDe()` les traite comme internes.
   */
  segment?: string;
}

export interface OnbChauffeur {
  id: string;
  nom: string;
  tel: string;
  permis: string;
  vehicule: string;   // plaque attribuée
  entree: string;
  kyc: string;
  /** Identifiant attribué à la mise en service — rend le rejeu stable. */
  driverId?: string;
}

export interface OnbRegle {
  mode: string;
  /** Montant brut attendu par vehicule et par jour, quel que soit le mode. */
  versement: string;
  /** Taux de commission, en % du brut. Ne sert qu'au mode « Commission sur le brut ». */
  commission?: string;
  repos: string;
  immobilise: string;
  carburant: string;
  seuilCarb: string;
  objectif: string;
}

export interface OnbDoc {
  nom: string;
  contact: string;
  sousDomaine: string;
  gestionnaire: string;
  gestionnaireEmail?: string;
  /** Second compte admin : la direction du client, à côté du gestionnaire. */
  direction?: string;
  directionEmail?: string;
  plan?: string;
  vehiculesPrevus: number | string;
  j0: string;
  a: Record<string, OnbEtat>;
  b: Record<string, OnbEtat>;
  c: Record<string, OnbEtat>;
  vehicules: OnbVehicule[];
  chauffeurs: OnbChauffeur[];
  regle: OnbRegle;
  formation: { date: string; lieu: string; participants: string };
  notes: string;
  maj: string;
}

export interface OnbFileRow {
  id: string;
  nom: string;
  tenant_id: string | null;
  provisioned_at: string | null;
  updated_at: string;
}

/* ── Les listes de contrôle ─────────────────────────────────── */

export interface OnbPoint { id: string; t: string; w: string; blk: boolean }

/** A — ce que le client doit fournir. */
export const LISTE_CLIENT: OnbPoint[] = [
  { id: "A1", t: "Devis signé et premier versement de 700 000 XOF", w: "Déclenche le J0", blk: true },
  { id: "A2", t: "Accès au compte partenaire Yango", w: "Le numéro de connexion remplacé par celui de la direction — sans ça, ni historique ni contrôle", blk: true },
  { id: "A3", t: "Liste des véhicules", w: "Plaque, marque et modèle, année, propriétaire, mise en service", blk: true },
  { id: "A4", t: "Liste des chauffeurs", w: "Nom, téléphone, permis, véhicule attribué, date d'entrée", blk: true },
  { id: "A5", t: "Règle de versement", w: "Montant par jour, jours de repos, cas du véhicule immobilisé", blk: true },
  { id: "A6", t: "Historique des versements réels", w: "Trois à six mois — point de départ des indicateurs (J+5)", blk: false },
  { id: "A7", t: "Charges récurrentes", w: "Carburant et mode de paiement, entretien, assurance, parking, dépannages", blk: false },
  { id: "A8", t: "Gestionnaire qui valide au quotidien", w: "Premier niveau de contrôle, formé en priorité", blk: true },
  { id: "A9", t: "Pièces des chauffeurs", w: "CNI, permis, photo — peut se compléter en cours de route", blk: false },
  { id: "A10", t: "Logo et couleur validés", w: "Espace aux couleurs du client", blk: false },
  { id: "A11", t: "Date et lieu de la formation", w: "À fixer avant le J3 — déclenche le second versement", blk: false },
];

/** B — ce que M3A prépare de son côté. */
export const LISTE_M3A: OnbPoint[] = [
  { id: "B1", t: "Vercel Pro activé", w: "L'offre gratuite interdit l'usage commercial", blk: true },
  { id: "B2", t: "Clé Anthropic dédiée, recharge automatique", w: "L'API a déjà été coupée faute de crédit", blk: true },
  { id: "B3", t: "Quota de scans relevé", w: "200 par défaut ; 8 à 10 véhicules en font 300 à 400 par mois", blk: true },
  { id: "B4", t: "Espace réel du client créé", w: "Séparé de toute démonstration ; sous-domaine déclaré", blk: true },
  { id: "B5", t: "Cloisonnement des données entre chauffeurs", w: "Un chauffeur ne doit pas lire les données de ses collègues — avant d'ouvrir l'application", blk: true },
  { id: "B6", t: "Supports de formation", w: "Une page gestionnaire, une page chauffeur", blk: false },
  { id: "B7", t: "Conditions d'abonnement à jour", w: "Propriété, engagements de service, périmètre", blk: false },
  { id: "B8", t: "Facture du premier versement émise", w: "700 000 XOF à l'acceptation", blk: false },
];

/** C — cadrage du module bennes, facturé à part. */
export const LISTE_BENNES: OnbPoint[] = [
  { id: "C1", t: "Export GPS détaillé du dernier mois", w: "Et un export mis en place chaque mois — l'historique ne dure que 31 jours", blk: false },
  { id: "C2", t: "Un bon de pesée et un bon de livraison signé", w: "", blk: false },
  { id: "C3", t: "Une facture Gécamines avec le barème par destination", w: "", blk: false },
  { id: "C4", t: "Un mois complet du tracker", w: "", blk: false },
  { id: "C5", t: "L'historique des immobilisations", w: "S'il existe", blk: false },
];

export const ETATS_CLIENT = ["À demander", "Demandé", "Reçu"] as const;
export const ETATS_M3A = ["À faire", "En cours", "Fait"] as const;
export const ETATS_KYC = ["À collecter", "Partiel", "Complet"] as const;

/* ── Segmentation du parc ─────────────────────────── */

/**
 * Un parc Yango n'appartient pas forcément à un seul propriétaire : un
 * exploitant héberge souvent des véhicules de tiers contre une commission.
 * Les deux segments doivent être distingués partout où on additionne des
 * recettes, sinon le compte de résultat du client compte des voitures qui ne
 * sont pas les siennes.
 */
export const SEGMENTS = ["interne", "partenaire"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<string, string> = {
  interne: "Flotte interne",
  partenaire: "Flotte partenaire",
};

/** Segment d'un véhicule, avec repli sur 'interne' — le cas des fiches anciennes. */
export function segmentDe(v: { segment?: string } | null | undefined): Segment {
  return v?.segment === "partenaire" ? "partenaire" : "interne";
}

export const MODES = [
  "Loyer journalier",
  "Commission sur le brut",
  "Fixe et prime",
  "Paliers de chiffre d'affaires",
] as const;

/* ── Helpers purs ───────────────────────────────────────────── */

/**
 * Règle de versement de la fiche → modèle de rémunération de l'application.
 * Les libellés de la fiche sont ceux qu'on emploie avec le client ; les clés
 * sont celles que lit `lib/calc.ts`.
 */
export function mapRemunerationModel(mode: string): string {
  switch (mode) {
    case "Commission sur le brut": return "percent";
    case "Fixe et prime": return "hybrid";
    case "Paliers de chiffre d'affaires": return "tiered";
    case "Loyer journalier":
    default: return "location";
  }
}

/** Nombre lu d'un champ de fiche (saisi librement : « 15 000 F », « 15000 »). */
export function numFromField(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Clé de comparaison d'une plaque. « DK-1234-AA », « dk 1234 aa » et
 * « DK1234AA » désignent le même véhicule : sans cette normalisation, un rejeu
 * de la mise en service créerait un doublon à la moindre variante de frappe.
 */
export function plateKey(p: string): string {
  return String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function slugify(s: string): string {
  return String(s ?? "")
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function ficheVide(nom: string): OnbDoc {
  return {
    nom, contact: "", sousDomaine: "", gestionnaire: "", gestionnaireEmail: "",
    direction: "", directionEmail: "",
    vehiculesPrevus: 0, j0: "",
    a: {}, b: {}, c: {},
    vehicules: [], chauffeurs: [],
    regle: { mode: MODES[0], versement: "", commission: "", repos: "", immobilise: "", carburant: "", seuilCarb: "", objectif: "" },
    formation: { date: "", lieu: "", participants: "" },
    notes: "", maj: "",
  };
}

/** État d'un point de contrôle, avec repli sur « rien fait ». */
export function etat(doc: OnbDoc | null, groupe: "a" | "b" | "c", id: string): OnbEtat {
  const g = (doc?.[groupe] ?? {}) as Record<string, OnbEtat>;
  return g[id] ?? { s: 0, n: "" };
}

/** Message de relance, construit sur ce qui manque encore. */
export function texteRelance(doc: OnbDoc): string {
  const attendus = LISTE_CLIENT.filter((x) => etat(doc, "a", x.id).s !== 2);
  if (!attendus.length) return "Tous les éléments sont reçus.";
  const prenom = (doc.contact || "").trim();
  return "Bonjour" + (prenom ? " " + prenom : "") + ",\n\n" +
    "Pour lancer l'installation, il me manque encore :\n" +
    attendus.map((x) => "- " + x.t + (x.blk ? "" : " (peut suivre)")).join("\n") +
    "\n\nDès réception des éléments marqués sans mention, nous démarrons.\n\nAbdoulaye";
}
