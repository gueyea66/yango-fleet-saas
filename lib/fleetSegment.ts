/**
 * Segmentation d'un parc : ce qui appartient à l'exploitant, et ce qu'il
 * héberge pour un tiers.
 *
 * Source unique du vocabulaire. Le segment apparaît dans la fiche
 * d'onboarding, dans `fleet.vehicles.fleet_segment`, dans l'onglet Flotte et
 * dans la carte des signaux v2 : quatre endroits qui doivent dire le même mot
 * et lui donner la même couleur, sinon « partenaire » finit par désigner deux
 * choses différentes selon l'écran.
 *
 * Présentation pure, aucun accès aux données — importable côté navigateur
 * comme côté serveur.
 */

export const SEGMENTS = ["interne", "partenaire"] as const;
export type Segment = (typeof SEGMENTS)[number];

export interface SegmentMeta {
  /** Libellé complet, pour un filtre ou un formulaire. */
  label: string;
  /** Libellé court, pour une pastille posée à côté d'une plaque. */
  court: string;
  /** Teinte v2. `info` pour le partenaire : il est signalé, pas dévalué. */
  tone: "ok" | "info";
  /** Couleur directe, pour l'UI actuelle qui n'a pas les jetons v2. */
  color: string;
}

export const SEGMENT_META: Record<Segment, SegmentMeta> = {
  interne:    { label: "Flotte interne",   court: "Interne",    tone: "ok",   color: "#22c55e" },
  partenaire: { label: "Flotte partenaire", court: "Partenaire", tone: "info", color: "#3b82f6" },
};

/** Conservé pour les appels existants ; `SEGMENT_META[s].label` fait pareil. */
export const SEGMENT_LABELS: Record<string, string> = {
  interne: SEGMENT_META.interne.label,
  partenaire: SEGMENT_META.partenaire.label,
};

/**
 * Segment d'un véhicule, quelle que soit la forme reçue — fiche d'onboarding
 * (`segment`) ou ligne de base (`fleet_segment`).
 *
 * Repli sur 'interne' et non sur une valeur « inconnue » : les véhicules
 * enregistrés avant la migration 063 n'ont pas de segment, et ils appartiennent
 * tous à leur exploitant. Une troisième catégorie fantôme ferait apparaître un
 * parc incomplet dans chaque total.
 */
export function segmentDe(
  v: { segment?: string | null; fleet_segment?: string | null } | null | undefined,
): Segment {
  const brut = v?.fleet_segment ?? v?.segment;
  return brut === "partenaire" ? "partenaire" : "interne";
}

/** Compte les véhicules de chaque segment. */
export function compterParSegment<T>(
  vehicules: T[],
  lire: (v: T) => { segment?: string | null; fleet_segment?: string | null },
): Record<Segment, number> {
  const n: Record<Segment, number> = { interne: 0, partenaire: 0 };
  vehicules.forEach((v) => { n[segmentDe(lire(v))] += 1; });
  return n;
}

/**
 * Un parc est mixte quand les deux segments y sont représentés. Le filtre et
 * les pastilles ne s'affichent que dans ce cas : sur un parc homogène, ils
 * n'apprendraient rien et laisseraient croire qu'une partie du parc est cachée.
 */
export function estMixte(n: Record<Segment, number>): boolean {
  return n.interne > 0 && n.partenaire > 0;
}

/** Bascule d'un segment dans une sélection multiple. */
export function basculerSegment(selection: string[], s: string): string[] {
  return selection.includes(s) ? selection.filter((x) => x !== s) : [...selection, s];
}

/** Sélection de départ : tout est coché, on montre le parc entier. */
export const TOUS_SEGMENTS: string[] = [...SEGMENTS];
