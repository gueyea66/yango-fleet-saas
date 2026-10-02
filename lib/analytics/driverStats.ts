/**
 * Classement et KPI par chauffeur — calcul pur, commun à tous les tenants.
 *
 * Deux sources :
 * - les déclarations (`daily_reports`), présentes partout : jours, courses,
 *   CA, net, km au compteur ;
 * - les commandes Fleetroom (`yango_orders`), seulement pour les tenants qui
 *   importent leurs exports Yango : acceptation, refus, heures en course,
 *   amplitude, km réels, XOF/km. Sans commande sur la période, ces colonnes
 *   sont absentes (`hasFleetroom = false`) et l'écran les masque.
 *
 * Mêmes définitions que le tableau de bord (useDashboardKPIs) :
 * - CA = yango_gross + yango_bonus + off_yango_revenue ;
 * - km compteur = écarts d'odomètre par chauffeur, amorcés par la dernière
 *   déclaration avant la période, plafonnés à MAX_KM_JOUR ;
 * - comptes techniques exclus (le total du classement peut donc différer
 *   légèrement du CA du tableau de bord si un compte technique déclare) ;
 * - jours [REPOS] exclus des jours travaillés.
 */

export const MAX_KM_JOUR = 1500;

/** Raisons d'annulation Fleetroom imputables au chauffeur (règles de fleetroom_rebuild). */
export const REFUS_REASONS = [
  "Le conducteur n'a pas accepté la demande de course",
  "Le conducteur a refusé la demande de course",
];
export const ECHEC_REASONS = [
  "La transmission de la notification a pris trop de temps en raison d'une mauvaise connexion",
  "Échec de l'attribution de la demande de course au conducteur",
];
export const ANNUL_CLIENT_REASON = "Course annulée par le client";
const TERMINE = "Terminé";

export interface ReportLike {
  driver_id: string;
  date: string;
  status?: string | null;
  comment?: string | null;
  yango_gross?: number | null;
  yango_bonus?: number | null;
  off_yango_revenue?: number | null;
  yango_trip_count?: number | null;
  off_yango_trip_count?: number | null;
  net_after_expenses?: number | null;
  end_odometer?: number | null;
}

export interface OrderLike {
  yango_driver_id: string | null;
  jour: string | null;
  status: string | null;
  cancel_reason: string | null;
  started_at: string | null;
  ended_at: string | null;
  distance_m: number | null;
  cash: number | null;
  cashless: number | null;
}

export interface ExpenseLike {
  driver_id: string | null;
  amount: number | null;
  category?: string | null;
  status?: string | null;
}

export interface DriverLike {
  id: string;
  full_name?: string | null;
  driver_id?: string | null;
  yango_driver_id?: string | null;
  active?: boolean | null;
  account_type?: string | null;
}

export interface FleetroomStats {
  courses: number;
  offres: number;          // terminées + refus + annulées par le client
  refus: number;
  echecs: number;          // connexion / attribution ratée
  annulClient: number;
  tauxAcceptation: number | null; // (offres − refus) / offres
  heuresCourse: number;    // Σ (fin − début) des courses terminées
  amplitudeMoy: number | null; // heures entre 1re prise en charge et dernière fin, moyenne par jour actif
  occupation: number | null;   // heures en course / amplitude
  joursActifs: number;
  km: number;
  caCourses: number;       // espèces + carte des courses terminées
  xofParKm: number | null;
}

export interface DriverStat {
  driverId: string;
  name: string;
  active: boolean;
  jours: number;           // jours déclarés hors repos
  courses: number;
  ca: number;
  net: number;
  depenses: number;
  km: number;              // compteur, sinon km Fleetroom des jours sans compteur
  caParJour: number | null;
  caParCourse: number | null;
  coursesParJour: number | null;
  caParKm: number | null;
  rang?: number;
  fleetroom: FleetroomStats | null;
}

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const isRepos = (r: Pick<ReportLike, "comment">) => String(r.comment || "").startsWith("[REPOS]");
export const caOf = (r: ReportLike) => n(r.yango_gross) + n(r.yango_bonus) + n(r.off_yango_revenue);
export const coursesOf = (r: ReportLike) => n(r.yango_trip_count) + n(r.off_yango_trip_count);

/**
 * Filtre « hors Yango » : exclu = recettes ET courses hors Yango mises à zéro,
 * pour comparer à périmètre égal avec un tenant qui ne connaît que Yango
 * (exports Fleetroom). La déclaration d'origine n'est pas modifiée.
 */
export function sansHorsYango<T extends ReportLike>(r: T): T {
  return { ...r, off_yango_revenue: 0, off_yango_trip_count: 0 };
}

/** km au compteur par chauffeur et par jour (même règle que le tableau de bord). */
export function kmCompteurParJour(reports: ReportLike[], seeds: ReportLike[] = []): Map<string, Map<string, number>> {
  const seedBy = new Map<string, ReportLike>();
  for (const r of seeds) {
    if (!r.end_odometer) continue;
    const cur = seedBy.get(r.driver_id);
    if (!cur || r.date > cur.date) seedBy.set(r.driver_id, r);
  }
  // Toutes les déclarations (repos compris) : un jour sans compteur coupe la
  // paire, comme au tableau de bord — pas d'écart cumulé sur plusieurs jours.
  const byDriver = new Map<string, ReportLike[]>();
  for (const r of reports) (byDriver.get(r.driver_id) ?? byDriver.set(r.driver_id, []).get(r.driver_id)!).push(r);
  const out = new Map<string, Map<string, number>>();
  for (const [id, reps] of byDriver) {
    const chain = [...reps].sort((a, b) => a.date.localeCompare(b.date));
    const seed = seedBy.get(id);
    if (seed) chain.unshift(seed);
    const days = new Map<string, number>();
    for (let i = 1; i < chain.length; i++) {
      if (!chain[i].end_odometer || !chain[i - 1].end_odometer) continue;
      const d = n(chain[i].end_odometer) - n(chain[i - 1].end_odometer);
      if (d > 0 && d <= MAX_KM_JOUR) days.set(chain[i].date, (days.get(chain[i].date) ?? 0) + d);
    }
    out.set(id, days);
  }
  return out;
}

const hoursBetween = (a: string | null, b: string | null) => {
  if (!a || !b) return 0;
  const h = (Date.parse(b) - Date.parse(a)) / 3_600_000;
  return h > 0 && h < 24 ? h : 0;
};

/** KPI Fleetroom d'un ensemble de commandes (un chauffeur, une période ou un jour). */
export function fleetroomStats(orders: OrderLike[]): FleetroomStats {
  let courses = 0, refus = 0, echecs = 0, annulClient = 0, heures = 0, m = 0, ca = 0;
  const span = new Map<string, { min: number; max: number }>();
  for (const o of orders) {
    const why = o.cancel_reason || "";
    if (o.status === TERMINE) {
      courses++;
      heures += hoursBetween(o.started_at, o.ended_at);
      m += n(o.distance_m);
      ca += n(o.cash) + n(o.cashless);
      if (o.jour && o.started_at && o.ended_at) {
        const a = Date.parse(o.started_at), b = Date.parse(o.ended_at);
        const s = span.get(o.jour);
        if (!s) span.set(o.jour, { min: a, max: b });
        else { s.min = Math.min(s.min, a); s.max = Math.max(s.max, b); }
      }
    } else if (REFUS_REASONS.includes(why)) refus++;
    else if (ECHEC_REASONS.includes(why)) echecs++;
    else if (why === ANNUL_CLIENT_REASON) annulClient++;
  }
  const offres = courses + refus + annulClient;
  const amplitudes = [...span.values()].map((s) => (s.max - s.min) / 3_600_000).filter((h) => h > 0 && h < 24);
  const amplitudeTot = amplitudes.reduce((s, h) => s + h, 0);
  const km = Math.round(m / 100) / 10;
  return {
    courses, offres, refus, echecs, annulClient,
    tauxAcceptation: ratio(offres - refus, offres),
    heuresCourse: Math.round(heures * 10) / 10,
    amplitudeMoy: amplitudes.length ? Math.round((amplitudeTot / amplitudes.length) * 10) / 10 : null,
    occupation: ratio(heures, amplitudeTot),
    joursActifs: span.size,
    km,
    caCourses: ca,
    xofParKm: ratio(ca, km),
  };
}

/**
 * Une ligne par chauffeur ayant une activité sur la période (déclaration ou
 * commande), plus les chauffeurs actifs sans activité (à 0, en bas du tri).
 * `reports` = déclarations déjà filtrées sur la période et les statuts voulus.
 */
export function driverStats({ drivers, reports, seeds = [], expenses = [], orders = [] }: {
  drivers: DriverLike[];
  reports: ReportLike[];
  seeds?: ReportLike[];
  expenses?: ExpenseLike[];
  orders?: OrderLike[];
}): { rows: DriverStat[]; hasFleetroom: boolean } {
  const hasFleetroom = orders.length > 0;
  const real = drivers.filter((d) => d.account_type !== "technical");
  const byYango = new Map(real.filter((d) => d.yango_driver_id).map((d) => [d.yango_driver_id!, d.id]));
  const ordersBy = new Map<string, OrderLike[]>();
  for (const o of orders) {
    const id = o.yango_driver_id ? byYango.get(o.yango_driver_id) : undefined;
    if (id) (ordersBy.get(id) ?? ordersBy.set(id, []).get(id)!).push(o);
  }
  const worked = reports.filter((r) => !isRepos(r));
  const kmCompteur = kmCompteurParJour(reports, seeds);
  const rows: DriverStat[] = [];
  for (const d of real) {
    const reps = worked.filter((r) => r.driver_id === d.id);
    const ords = ordersBy.get(d.id) ?? [];
    if (!reps.length && !ords.length && d.active === false) continue;
    const fr = ords.length ? fleetroomStats(ords) : null;
    const jours = new Set(reps.map((r) => r.date)).size;
    const courses = reps.reduce((s, r) => s + coursesOf(r), 0);
    const ca = reps.reduce((s, r) => s + caOf(r), 0);
    const net = reps.reduce((s, r) => s + n(r.net_after_expenses), 0);
    const depenses = expenses.filter((e) => e.driver_id === d.id).reduce((s, e) => s + n(e.amount), 0);
    // km : compteur ; à défaut (jours importés de Fleetroom, compteur à 0), km des courses
    const kmDays = kmCompteur.get(d.id) ?? new Map<string, number>();
    let km = [...kmDays.values()].reduce((s, k) => s + k, 0);
    if (ords.length) {
      const frByDay = new Map<string, number>();
      for (const o of ords) if (o.status === TERMINE && o.jour) frByDay.set(o.jour, (frByDay.get(o.jour) ?? 0) + n(o.distance_m) / 1000);
      for (const [day, k] of frByDay) if (!kmDays.has(day)) km += k;
    }
    km = Math.round(km);
    rows.push({
      driverId: d.id, name: d.full_name || d.driver_id || "Chauffeur", active: d.active !== false,
      jours, courses, ca, net, depenses, km,
      caParJour: ratio(ca, jours), caParCourse: ratio(ca, courses),
      coursesParJour: ratio(courses, jours), caParKm: ratio(ca, km),
      fleetroom: fr,
    });
  }
  return { rows, hasFleetroom };
}

export type SortKey =
  | "name" | "jours" | "courses" | "ca" | "net" | "depenses" | "km"
  | "caParJour" | "caParCourse" | "coursesParJour" | "caParKm"
  | "fr.tauxAcceptation" | "fr.refus" | "fr.heuresCourse" | "fr.amplitudeMoy" | "fr.occupation" | "fr.xofParKm";

export function sortValue(r: DriverStat, k: SortKey): number | string | null {
  if (k === "name") return r.name;
  if (k.startsWith("fr.")) {
    const v = r.fleetroom?.[k.slice(3) as keyof FleetroomStats];
    return typeof v === "number" ? v : null;
  }
  return r[k as Exclude<SortKey, "name" | `fr.${string}`>] as number | null;
}

/** Tri stable ; les valeurs absentes (null) vont toujours en bas. Pose `rang`. */
export function sortStats(rows: DriverStat[], key: SortKey, desc = true): DriverStat[] {
  const sorted = [...rows].sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key);
    if (va == null && vb == null) return a.name.localeCompare(b.name, "fr");
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = typeof va === "string" ? va.localeCompare(String(vb), "fr") : va - (vb as number);
    return (desc ? -c : c) || a.name.localeCompare(b.name, "fr");
  });
  return sorted.map((r, i) => ({ ...r, rang: i + 1 }));
}
