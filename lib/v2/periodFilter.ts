/**
 * Filtres gestionnaire v2 (maquettes 6a / 6b) : période → plage de dates
 * passée telle quelle à useDashboardKPIs (dateFrom / dateTo), plage
 * personnalisée, raccourcis, chauffeurs multiples, état dans l'URL.
 * Pur : aucune donnée lue ici.
 */
export type PeriodKind = "jour" | "7j" | "mois" | "annee" | "dates";

export interface AdminPeriod {
  kind: PeriodKind;
  month: string;   // AAAA-MM (kind = mois)
  year: number;    // kind = annee
  from: string;    // AAAA-MM-JJ (kind = dates)
  to: string;
}

export const PERIOD_OPTIONS: { key: PeriodKind; label: string }[] = [
  { key: "jour", label: "Jour" },
  { key: "7j", label: "7 j" },
  { key: "mois", label: "Mois" },
  { key: "annee", label: "Année" },
  { key: "dates", label: "Dates" },
];

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const parseIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseIso(s).getTime());
const isMonth = (s: string | null | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function defaultPeriod(today: Date): AdminPeriod {
  const t = isoDate(today);
  return { kind: "mois", month: t.slice(0, 7), year: today.getFullYear(), from: t, to: t };
}

/** Bornes incluses (AAAA-MM-JJ) de la période choisie. Le mois et l'année sont complets. */
export function periodRange(p: AdminPeriod, today: Date): { from: string; to: string } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (p.kind) {
    case "jour":
      return { from: isoDate(t), to: isoDate(t) };
    case "7j":
      return { from: isoDate(addDays(t, -6)), to: isoDate(t) };
    case "mois": {
      const [y, m] = p.month.split("-").map(Number);
      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` };
    }
    case "annee":
      return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
    case "dates":
      return p.from <= p.to ? { from: p.from, to: p.to } : { from: p.to, to: p.from };
  }
}

/** Nombre de jours d'une plage incluse (« Appliquer · 14 j »). */
export function daysInclusive(from: string, to: string): number {
  if (!isIso(from) || !isIso(to)) return 0;
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000) + 1;
}

export function inRange(date: string | null | undefined, r: { from: string; to: string }): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= r.from && d <= r.to;
}

/** Mois précédent / suivant (AAAA-MM). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Raccourcis du sélecteur de dates (maquette 6a). La semaine commence le lundi. */
export function dateShortcuts(today: Date): { key: string; label: string; from: string; to: string }[] {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = addDays(t, -((t.getDay() + 6) % 7));
  const firstThis = new Date(t.getFullYear(), t.getMonth(), 1);
  const lastPrev = addDays(firstThis, -1);
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  return [
    { key: "today", label: "Aujourd'hui", from: isoDate(t), to: isoDate(t) },
    { key: "yesterday", label: "Hier", from: isoDate(addDays(t, -1)), to: isoDate(addDays(t, -1)) },
    { key: "week", label: "Cette semaine", from: isoDate(monday), to: isoDate(t) },
    { key: "2weeks", label: "2 dernières sem.", from: isoDate(addDays(t, -13)), to: isoDate(t) },
    { key: "lastMonth", label: "Mois dernier", from: isoDate(firstPrev), to: isoDate(lastPrev) },
    { key: "30days", label: "30 derniers jours", from: isoDate(addDays(t, -29)), to: isoDate(t) },
  ];
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const monthLabel = (month: string) => { const [y, m] = month.split("-").map(Number); return `${cap(MOIS[m - 1])} ${y}`; };
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Libellé de la pastille de dates. */
export function periodLabel(p: AdminPeriod, today: Date): string {
  const r = periodRange(p, today);
  switch (p.kind) {
    case "mois": return monthLabel(p.month);
    case "annee": return String(p.year);
    case "jour": return `Aujourd'hui · ${ddmm(r.from)}`;
    default: return r.from === r.to ? ddmm(r.from) : `${ddmm(r.from)} → ${ddmm(r.to)}`;
  }
}

/** Libellé du filtre chauffeurs (maquette 6b). */
export function driversLabel(ids: string[], drivers: { id: string; label: string }[]): string {
  if (ids.length === 0) return "Tous les chauffeurs";
  if (ids.length === 1) return drivers.find((d) => d.id === ids[0])?.label ?? "1 chauffeur";
  return `${ids.length} chauffeurs`;
}

/**
 * État dans l'URL : ?p=mois&m=2026-09 · ?p=dates&du=2026-09-08&au=2026-09-21 ·
 * ?p=annee&y=2026 · &d=id1,id2. Valeurs invalides → période par défaut.
 */
export function parseAdminFilter(search: string | URLSearchParams, today: Date): { period: AdminPeriod; drivers: string[] } {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const base = defaultPeriod(today);
  const p = sp.get("p");
  let period = base;
  if (p === "jour" || p === "7j") period = { ...base, kind: p };
  else if (p === "mois") period = { ...base, kind: "mois", month: isMonth(sp.get("m")) ? (sp.get("m") as string) : base.month };
  else if (p === "annee") {
    const y = Number(sp.get("y"));
    period = { ...base, kind: "annee", year: Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : base.year };
  } else if (p === "dates") {
    const du = sp.get("du"), au = sp.get("au");
    if (isIso(du) && isIso(au)) period = { ...base, kind: "dates", from: du <= au ? du : au, to: du <= au ? au : du };
  }
  const drivers = (sp.get("d") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return { period, drivers: [...new Set(drivers)] };
}

export function serializeAdminFilter(period: AdminPeriod, drivers: string[], base: string | URLSearchParams = ""): string {
  const sp = new URLSearchParams(typeof base === "string" ? base : base.toString());
  for (const k of ["p", "m", "y", "du", "au", "d"]) sp.delete(k);
  sp.set("p", period.kind);
  if (period.kind === "mois") sp.set("m", period.month);
  if (period.kind === "annee") sp.set("y", String(period.year));
  if (period.kind === "dates") { sp.set("du", period.from); sp.set("au", period.to); }
  if (drivers.length) sp.set("d", drivers.join(","));
  return sp.toString();
}
