/**
 * Filtre « type de véhicule » (interne / externe) des écrans gestionnaire.
 *
 * Hors Performance (qui classe chaque déclaration selon son propre véhicule),
 * le filtre se traduit en liste de chauffeurs : ceux dont le véhicule affecté
 * est du segment choisi. Cette liste passe ensuite par le circuit existant du
 * filtre chauffeurs (KPI, À valider, Finance, Historique), sans autre code.
 */
import type { Segment } from "@/lib/fleetSegment";
import type { SegmentFilter } from "@/lib/analytics/segment";

/** Identifiant qui ne correspond à aucun chauffeur : segment vide → aucune ligne (et non « tous »). */
export const NO_DRIVER = "00000000-0000-0000-0000-000000000000";

export const FLEET_SEG_OPTS: { key: SegmentFilter; label: string }[] = [
  { key: "all", label: "Tous véhicules" },
  { key: "interne", label: "Interne" },
  { key: "partenaire", label: "Externe" },
];

/**
 * Chauffeurs effectivement filtrés. [] = tous (convention du filtre chauffeurs).
 * Sélection explicite ∩ segment ; intersection vide → [NO_DRIVER].
 */
export function driverScope(selected: string[], segment: SegmentFilter, drivers: { id: string; segment?: Segment | null }[]): string[] {
  if (segment === "all") return selected;
  const inSeg = new Set(drivers.filter((d) => (d.segment ?? "interne") === segment).map((d) => d.id));
  const out = selected.length ? selected.filter((id) => inSeg.has(id)) : [...inSeg];
  return out.length ? out : [NO_DRIVER];
}

/** Nombre de chauffeurs par segment (le filtre ne s'affiche que si le parc est mixte). */
export function segCountsOf(drivers: { segment?: Segment | null }[]): Record<Segment, number> {
  const c: Record<Segment, number> = { interne: 0, partenaire: 0 };
  for (const d of drivers) c[d.segment ?? "interne"]++;
  return c;
}
