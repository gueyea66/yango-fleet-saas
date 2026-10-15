/**
 * Vue par défaut du gestionnaire : la sélection qu'il retrouve à chaque
 * ouverture du tableau de bord et de Performance (demande d'Abdou, 15/10/2026).
 *
 * Mémorisée sur l'appareil, par compte. Une période « courante » reste
 * courante : enregistrer « Mois » en octobre rouvre sur novembre en novembre.
 * Une période choisie à la main (dates, plusieurs mois, une autre année)
 * est rouverte telle quelle.
 */
import type { AdminPeriod, PeriodKind } from "./periodFilter";
import type { SegmentFilter } from "@/lib/analytics/segment";

export interface PeriodeFigee {
  kind: PeriodKind;
  /** true : se recale sur aujourd'hui à chaque ouverture (mois en cours, année en cours, 7 j, jour). */
  relative: boolean;
  months?: string[];
  year?: number;
  from?: string;
  to?: string;
}

export interface VueDefaut {
  periode: PeriodeFigee;
  chauffeurs: string[];
  segment: SegmentFilter;
  horsYango: boolean;
  /** Performance › Tendances */
  tendances?: { granularite: string; statut: string };
  /** Performance › Rendement : préréglage en jours, ou dates libres */
  rendement?: { jours: number; du: string | null; au: string | null };
}

const pad = (n: number) => String(n).padStart(2, "0");
const moisDe = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export function figerPeriode(p: AdminPeriod, today: Date): PeriodeFigee {
  if (p.kind === "jour" || p.kind === "7j") return { kind: p.kind, relative: true };
  if (p.kind === "annee") return p.year === today.getFullYear() ? { kind: "annee", relative: true } : { kind: "annee", relative: false, year: p.year };
  if (p.kind === "dates") return { kind: "dates", relative: false, from: p.from, to: p.to };
  const months = p.months?.length ? p.months : [p.month];
  return months.length === 1 && months[0] === moisDe(today)
    ? { kind: "mois", relative: true }
    : { kind: "mois", relative: false, months };
}

export function restaurerPeriode(f: PeriodeFigee, base: AdminPeriod): AdminPeriod {
  if (f.relative) return { ...base, kind: f.kind };
  if (f.kind === "annee" && f.year) return { ...base, kind: "annee", year: f.year };
  if (f.kind === "dates" && f.from && f.to) return { ...base, kind: "dates", from: f.from, to: f.to };
  if (f.kind === "mois" && f.months?.length) {
    const tri = [...f.months].sort();
    return { ...base, kind: "mois", month: tri[tri.length - 1], months: tri.length > 1 ? tri : undefined };
  }
  return base;
}

const cle = (compte: string) => `m3a-vue-defaut:${compte}`;

export function lireVueDefaut(compte: string | null | undefined): VueDefaut | null {
  if (!compte) return null;
  try {
    const v = JSON.parse(localStorage.getItem(cle(compte)) || "null");
    return v && typeof v === "object" && v.periode ? (v as VueDefaut) : null;
  } catch { return null; }
}

export function ecrireVueDefaut(compte: string, v: VueDefaut) {
  try { localStorage.setItem(cle(compte), JSON.stringify(v)); } catch { /* stockage indisponible */ }
}

export function oublierVueDefaut(compte: string) {
  try { localStorage.removeItem(cle(compte)); } catch { /* idem */ }
}

/**
 * Réglages d'écran qui vivent dans leur composant (Tendances, Rendement) :
 * ils déposent ici leur valeur courante, que « Enregistrer comme vue par
 * défaut » relit au moment du clic.
 */
export const vueCourante: { tendances?: VueDefaut["tendances"]; rendement?: VueDefaut["rendement"] } = {};
