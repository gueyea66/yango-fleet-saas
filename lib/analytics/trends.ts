/**
 * Tendances de performance par semaine, mois, trimestre ou année — calcul pur.
 *
 * Unité de base : la journée-chauffeur (une déclaration hors repos). L'objectif
 * se lit en CA par jour et par chauffeur (40 000 XOF par défaut) :
 * - par période : CA / journées-chauffeur comparé à l'objectif ;
 * - par journée : atteint (≥ 100 %), proche (80–100 %) ou sous (< 80 %).
 * Statuts réservés (vert / ambre / rouge), toujours doublés d'un libellé.
 */
import { caOf, coursesOf, isRepos, type ReportLike } from "./driverStats";

export type Granularite = "semaine" | "mois" | "trimestre" | "annee";
export const GRANULARITES: Granularite[] = ["semaine", "mois", "trimestre", "annee"];
/** Nombre de périodes affichées par défaut */
export const PERIODES_PAR_DEFAUT: Record<Granularite, number> = { semaine: 12, mois: 12, trimestre: 8, annee: 3 };
export const OBJECTIF_DEFAUT = 40_000;

export type Statut = "atteint" | "proche" | "sous";
/** Seuil « proche » : 80 % de l'objectif */
export const SEUIL_PROCHE = 0.8;
export function statutDe(valeur: number | null, objectif: number): Statut | null {
  if (valeur == null || !(objectif > 0)) return null;
  const r = valeur / objectif;
  return r >= 1 ? "atteint" : r >= SEUIL_PROCHE ? "proche" : "sous";
}

export interface Bucket {
  key: string;      // 2026-W40, 2026-09, 2026-T3, 2026
  label: string;    // « S40 », « sept. 26 », « T3 26 », « 2026 »
  from: string;     // AAAA-MM-JJ inclus
  to: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Semaine ISO (lundi → dimanche) */
function isoWeek(d: Date): { year: number; week: number; monday: Date } {
  const day = (d.getUTCDay() + 6) % 7; // lundi = 0
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - day);
  const thursday = new Date(monday); thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4); week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return { year, week, monday };
}

/** Période qui contient la date `day`. */
export function bucketOf(day: string, g: Granularite): Bucket {
  const d = utc(day);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  switch (g) {
    case "semaine": {
      const { year, week, monday } = isoWeek(d);
      const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
      return { key: `${year}-S${String(week).padStart(2, "0")}`, label: `S${week}`, from: iso(monday), to: iso(sunday) };
    }
    case "mois":
      return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MOIS[m]} ${String(y).slice(2)}`, from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
    case "trimestre": {
      const q = Math.floor(m / 3);
      return { key: `${y}-T${q + 1}`, label: `T${q + 1} ${String(y).slice(2)}`, from: iso(new Date(Date.UTC(y, q * 3, 1))), to: iso(new Date(Date.UTC(y, q * 3 + 3, 0))) };
    }
    case "annee":
      return { key: String(y), label: String(y), from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

/** Les `n` dernières périodes jusqu'à celle qui contient `anchor` (incluse), dans l'ordre. */
export function lastBuckets(anchor: string, g: Granularite, n: number): Bucket[] {
  const out: Bucket[] = [];
  let cur = bucketOf(anchor, g);
  for (let i = 0; i < n; i++) {
    out.unshift(cur);
    const prevDay = utc(cur.from); prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    cur = bucketOf(iso(prevDay), g);
  }
  return out;
}

export interface BucketStats extends Bucket {
  ca: number;
  courses: number;
  net: number;
  journees: number;          // journées-chauffeur déclarées (hors repos)
  chauffeurs: number;        // chauffeurs distincts actifs
  caParJour: number | null;  // CA / journée-chauffeur
  atteinte: number | null;   // caParJour / objectif
  statut: Statut | null;
  jours: Record<Statut, number>; // répartition des journées-chauffeur
  enCours: boolean;          // période pas encore terminée (comparaison à prendre avec recul)
}

export interface DriverTrend {
  driverId: string;
  name: string;
  cells: { key: string; caParJour: number | null; journees: number; ca: number; statut: Statut | null }[];
  caParJour: number | null;   // sur toute la fenêtre
  statut: Statut | null;
  tauxJoursAtteints: number | null;
}

export interface TrendsResult {
  granularite: Granularite;
  objectif: number;
  buckets: BucketStats[];
  drivers: DriverTrend[];
  total: { ca: number; courses: number; journees: number; caParJour: number | null; statut: Statut | null; tauxJoursAtteints: number | null };
  /** dernière période terminée vs la précédente (évite de comparer un mois entamé) */
  comparaison: { courante: string; precedente: string; ca: number | null; caParJour: number | null; tauxJoursAtteints: number | null } | null;
  insights: string[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const pctDelta = (a: number | null, b: number | null) => (a != null && b != null && b !== 0 ? (a - b) / Math.abs(b) : null);

export function computeTrends({ reports, drivers, objectif, granularite, buckets, today }: {
  reports: (ReportLike & { status?: string | null })[];
  drivers: { id: string; full_name?: string | null; driver_id?: string | null }[];
  objectif: number;
  granularite: Granularite;
  buckets: Bucket[];
  today: string;
}): TrendsResult {
  const worked = reports.filter((r) => !isRepos(r));
  const keyOf = (date: string) => bucketOf(date, granularite).key;
  // journées-chauffeur (un chauffeur peut avoir deux lignes le même jour : on additionne)
  const day = new Map<string, { driver: string; date: string; ca: number; courses: number; net: number }>();
  for (const r of worked) {
    const k = `${r.driver_id}|${r.date}`;
    const cur = day.get(k) ?? { driver: r.driver_id, date: r.date, ca: 0, courses: 0, net: 0 };
    cur.ca += caOf(r); cur.courses += coursesOf(r); cur.net += Number(r.net_after_expenses) || 0;
    day.set(k, cur);
  }
  const days = [...day.values()];
  const byBucket = new Map<string, typeof days>();
  for (const d of days) { const k = keyOf(d.date); (byBucket.get(k) ?? byBucket.set(k, []).get(k)!).push(d); }

  const repartition = (ds: typeof days) => {
    const j: Record<Statut, number> = { atteint: 0, proche: 0, sous: 0 };
    for (const d of ds) { const s = statutDe(d.ca, objectif); if (s) j[s]++; }
    return j;
  };

  const bucketStats: BucketStats[] = buckets.map((b) => {
    const ds = byBucket.get(b.key) ?? [];
    const ca = ds.reduce((s, d) => s + d.ca, 0);
    const caParJour = ratio(ca, ds.length);
    return {
      ...b, ca, courses: ds.reduce((s, d) => s + d.courses, 0), net: ds.reduce((s, d) => s + d.net, 0),
      journees: ds.length, chauffeurs: new Set(ds.map((d) => d.driver)).size,
      caParJour, atteinte: caParJour != null && objectif > 0 ? caParJour / objectif : null,
      statut: statutDe(caParJour, objectif), jours: repartition(ds), enCours: b.to >= today,
    };
  });

  const nameOf = (id: string) => { const p = drivers.find((x) => x.id === id); return p?.full_name || p?.driver_id || "Chauffeur"; };
  const driverIds = [...new Set(days.map((d) => d.driver))];
  const driverTrends: DriverTrend[] = driverIds.map((id) => {
    const mine = days.filter((d) => d.driver === id);
    const cells = buckets.map((b) => {
      const ds = mine.filter((d) => keyOf(d.date) === b.key);
      const ca = ds.reduce((s, d) => s + d.ca, 0);
      const v = ratio(ca, ds.length);
      return { key: b.key, caParJour: v, journees: ds.length, ca, statut: statutDe(v, objectif) };
    });
    const ca = mine.reduce((s, d) => s + d.ca, 0);
    const v = ratio(ca, mine.length);
    return {
      driverId: id, name: nameOf(id), cells, caParJour: v, statut: statutDe(v, objectif),
      tauxJoursAtteints: ratio(mine.filter((d) => d.ca >= objectif).length, mine.length),
    };
  }).sort((a, b) => (b.caParJour ?? -1) - (a.caParJour ?? -1));

  const totCa = days.reduce((s, d) => s + d.ca, 0);
  const totCpj = ratio(totCa, days.length);
  const total = {
    ca: totCa, courses: days.reduce((s, d) => s + d.courses, 0), journees: days.length,
    caParJour: totCpj, statut: statutDe(totCpj, objectif),
    tauxJoursAtteints: ratio(days.filter((d) => d.ca >= objectif).length, days.length),
  };

  // comparaison : deux dernières périodes terminées et non vides
  const done = bucketStats.filter((b) => !b.enCours && b.journees > 0);
  const cur = done[done.length - 1], prev = done[done.length - 2];
  const taux = (b: BucketStats) => ratio(b.jours.atteint, b.journees);
  const comparaison = cur && prev ? {
    courante: cur.label, precedente: prev.label,
    ca: pctDelta(cur.ca, prev.ca), caParJour: pctDelta(cur.caParJour, prev.caParJour),
    tauxJoursAtteints: taux(cur) != null && taux(prev) != null ? taux(cur)! - taux(prev)! : null,
  } : null;

  return { granularite, objectif, buckets: bucketStats, drivers: driverTrends, total, comparaison, insights: insightsOf(bucketStats, driverTrends, objectif) };
}

// espaces normales : l'espace fine insécable de fr-FR ne s'affiche pas dans toutes les polices
const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n)).replace(/[\u202f\u00a0]/g, " ");

/** 3 à 4 constats lisibles, sans jargon, calculés sur la fenêtre affichée. */
export function insightsOf(buckets: BucketStats[], drivers: DriverTrend[], objectif: number): string[] {
  const out: string[] = [];
  const filled = buckets.filter((b) => b.journees > 0);
  if (!filled.length) return out;
  const best = filled.reduce((a, b) => ((b.caParJour ?? 0) > (a.caParJour ?? 0) ? b : a));
  out.push(`Meilleure période : ${best.label}, ${fmt(best.caParJour ?? 0)} XOF par jour et par chauffeur.`);
  const enTete = drivers.filter((d) => d.statut === "atteint");
  if (enTete.length) out.push(`${enTete.length} chauffeur${enTete.length > 1 ? "s" : ""} au-dessus de l'objectif de ${fmt(objectif)} XOF/jour sur la fenêtre (${enTete.slice(0, 3).map((d) => d.name).join(", ")}${enTete.length > 3 ? "…" : ""}).`);
  const sous = drivers.filter((d) => d.statut === "sous");
  if (sous.length) out.push(`${sous.length} chauffeur${sous.length > 1 ? "s" : ""} sous 80 % de l'objectif : ${sous.slice(0, 3).map((d) => d.name).join(", ")}${sous.length > 3 ? "…" : ""}.`);
  // tendance : moyenne des 3 dernières périodes terminées vs les 3 précédentes
  const done = filled.filter((b) => !b.enCours);
  if (done.length >= 4) {
    const k = Math.min(3, Math.floor(done.length / 2));
    const avg = (bs: BucketStats[]) => bs.reduce((s, b) => s + (b.caParJour ?? 0), 0) / bs.length;
    const recent = avg(done.slice(-k)), before = avg(done.slice(-2 * k, -k));
    if (before > 0) {
      const d = (recent - before) / before;
      if (Math.abs(d) >= 0.03) out.push(`CA par jour ${d > 0 ? "en hausse" : "en baisse"} de ${Math.round(Math.abs(d) * 100)} % sur les ${k} dernières périodes terminées.`);
      else out.push(`CA par jour stable sur les ${k} dernières périodes terminées.`);
    }
  }
  return out;
}
