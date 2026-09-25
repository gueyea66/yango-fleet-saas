/**
 * État de la FilterBar v2 (période + chauffeur), sérialisé dans l'URL
 * (`?p=mois&d=<id>`) pour garder les liens partageables. Pur : aucune lecture
 * de données, la page appelante branche le résultat sur ses états existants.
 */
export type FilterPeriod = "jour" | "7j" | "mois" | "annee";

export const FILTER_PERIODS: { key: FilterPeriod; label: string }[] = [
  { key: "jour", label: "Jour" },
  { key: "7j", label: "7 j" },
  { key: "mois", label: "Mois" },
  { key: "annee", label: "Année" },
];

export const DEFAULT_PERIOD: FilterPeriod = "mois";

export interface FilterState {
  period: FilterPeriod;
  driverId: string; // "" = tous les chauffeurs
}

function isPeriod(v: string | null): v is FilterPeriod {
  return v === "jour" || v === "7j" || v === "mois" || v === "annee";
}

export function parseFilterParams(search: string | URLSearchParams, fallback: FilterPeriod = DEFAULT_PERIOD): FilterState {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const p = sp.get("p");
  const d = (sp.get("d") || "").trim();
  return { period: isPeriod(p) ? p : fallback, driverId: d };
}

/** Réécrit p/d dans une query existante sans toucher aux autres paramètres. */
export function serializeFilterParams(state: FilterState, base: string | URLSearchParams = ""): string {
  const sp = new URLSearchParams(typeof base === "string" ? base : base.toString());
  sp.set("p", state.period);
  if (state.driverId) sp.set("d", state.driverId);
  else sp.delete("d");
  return sp.toString();
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Bornes (incluses, AAAA-MM-JJ, heure locale) d'une période qui se termine aujourd'hui. */
export function periodRange(period: FilterPeriod, today: Date): { from: string; to: string } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (period) {
    case "jour":
      return { from: iso(t), to: iso(t) };
    case "7j": {
      const f = new Date(t);
      f.setDate(f.getDate() - 6);
      return { from: iso(f), to: iso(t) };
    }
    case "mois":
      return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
    case "annee":
      return { from: iso(new Date(t.getFullYear(), 0, 1)), to: iso(t) };
  }
}

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/**
 * Libellé humain d'une plage :
 * même jour → « 23 septembre 2026 » · début de mois → « Septembre 2026 » ·
 * début d'année → « 2026 » · même mois → « 17 → 23 sept. ».
 */
export function rangeLabel(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return "—";
  if (from === to) return `${td} ${MONTHS_FR[tm - 1]} ${ty}`;
  if (fy === ty && fm === tm && fd === 1) {
    const m = MONTHS_FR[fm - 1];
    return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${fy}`;
  }
  if (fy === ty && fm === 1 && fd === 1) return String(fy);
  if (fy === ty && fm === tm) return `${fd} → ${td} ${MONTHS_SHORT[tm - 1]}`;
  if (fy === ty) return `${fd} ${MONTHS_SHORT[fm - 1]} → ${td} ${MONTHS_SHORT[tm - 1]}`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(fd)}/${pad(fm)}/${fy} → ${pad(td)}/${pad(tm)}/${ty}`;
}
