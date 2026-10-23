/**
 * Catégories d'absence d'un chauffeur : repos, panne, congé, malade.
 *
 * Une absence reste un daily_reports à zéro dont le commentaire commence par
 * « [REPOS] » : toutes les règles qui sortent les absences des moyennes, des
 * jours travaillés et de la paie continuent de les reconnaître sans changement.
 * La catégorie s'ajoute juste derrière : « [REPOS][PANNE] motif ».
 * Un « [REPOS] » seul (toutes les saisies d'avant) reste un repos, sauf si son
 * motif libre dit clairement autre chose (« maladie », « congé », « garage »…).
 */
export type CategorieAbsence = "repos" | "panne" | "conge" | "malade";

export interface InfoAbsence {
  key: CategorieAbsence;
  label: string;
  /** Lettre affichée dans les cases du planning et des déclarations. */
  lettre: string;
  couleur: string;
}

export const ABSENCES: InfoAbsence[] = [
  { key: "repos", label: "Repos", lettre: "R", couleur: "#6366f1" },
  { key: "panne", label: "Panne", lettre: "P", couleur: "#f97316" },
  { key: "conge", label: "Congé", lettre: "C", couleur: "#0ea5e9" },
  { key: "malade", label: "Malade", lettre: "M", couleur: "#ec4899" },
];

export const infoAbsence = (k: CategorieAbsence): InfoAbsence => ABSENCES.find((a) => a.key === k) ?? ABSENCES[0];

const MARQUE = "[REPOS]";
const ETIQUETTE: Record<Exclude<CategorieAbsence, "repos">, string> = { panne: "PANNE", conge: "CONGE", malade: "MALADE" };

export const estCategorieAbsence = (v: unknown): v is CategorieAbsence =>
  v === "repos" || v === "panne" || v === "conge" || v === "malade";

/** Commentaire à enregistrer pour une absence. */
export function commentaireAbsence(categorie: CategorieAbsence, motif?: string | null): string {
  const m = (motif ?? "").trim();
  const tag = categorie === "repos" ? "" : `[${ETIQUETTE[categorie]}]`;
  return `${MARQUE}${tag}${m ? " " + m : ""}`;
}

// Saisies d'avant les catégories : seul le motif libre dit de quoi il s'agissait.
const DEVINE: [RegExp, CategorieAbsence][] = [
  [/malad|hopital|hôpital|médec|medec|soin|fièvre|fievre|palu/i, "malade"],
  [/cong[eé]|vacance|voyage|famil|deuil|mariage|bapt[eê]me|f[eê]te|tabaski|korit/i, "conge"],
  [/panne|garage|m[eé]cani|r[eé]paration|entretien|vidange|pneu|accident|batterie|moteur/i, "panne"],
];

/** Catégorie et motif d'un commentaire d'absence ; null si ce n'est pas une absence. */
export function lireAbsence(comment: string | null | undefined): { categorie: CategorieAbsence; motif: string } | null {
  const c = (comment ?? "").trimStart();
  if (!c.startsWith(MARQUE)) return null;
  let reste = c.slice(MARQUE.length);
  const tag = /^\[(PANNE|CONGE|MALADE)\]/.exec(reste);
  if (tag) {
    reste = reste.slice(tag[0].length);
    const categorie = (Object.keys(ETIQUETTE) as (keyof typeof ETIQUETTE)[]).find((k) => ETIQUETTE[k] === tag[1])!;
    return { categorie, motif: reste.trim() };
  }
  const motif = reste.trim();
  const devine = DEVINE.find(([re]) => re.test(motif));
  return { categorie: devine ? devine[1] : "repos", motif };
}

/** Motif libre seul, sans les marques (pour l'affichage). */
export const motifAbsence = (comment: string | null | undefined): string => lireAbsence(comment)?.motif ?? "";
