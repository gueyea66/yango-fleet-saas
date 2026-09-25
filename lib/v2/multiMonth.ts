/**
 * Sélection de plusieurs mois (même non contigus) : useDashboardKPIs n'accepte
 * qu'une plage continue, la page l'appelle donc une fois par mois et on
 * additionne ici, sans toucher au hook.
 *
 * - Montants : sommés.
 * - Ratios (marge %, moyennes / jour, coût / km, CA / chauffeur) : recalculés
 *   sur les totaux, pas moyennés.
 * - Comparaisons à la période précédente : masquées (null).
 * - Aujourd'hui / semaine : ne dépendent pas de la période → premier mois.
 * - La masse salariale se calcule mois par mois (paliers, prorata) : utiliser
 *   la liste par mois, pas driverAllocations fusionné.
 */
import type { DashboardKPIs } from "@/lib/hooks/useDashboardKPIs";

const SUM_KEYS = [
  "brutYango", "netYango", "horsYango", "totalBrut", "totalDepenses", "netFinal", "joursOuvres",
  "soldeConsomme", "carburantConsomme", "provisionsSolde", "achatsCarburant", "autresDepensesOpe",
  "netOperationnel", "decaissements", "tresorerie", "avanceSolde", "avanceCarburant", "avancesProprietaire",
  "monthRevenue", "monthExpenses", "monthNetMargin", "totalFuelCost",
] as const;

/** Jours actifs d'un mois, retrouvés depuis une moyenne arrondie (total / moyenne). */
function activeDaysOf(k: DashboardKPIs): number {
  const pairs: [number, number][] = [[k.totalBrut, k.avgBrutPerDay], [k.netFinal, k.avgNetPerDay], [k.totalDepenses, k.avgDepensesPerDay]];
  for (const [total, avg] of pairs) if (avg) return Math.max(1, Math.round(total / avg));
  return 1; // le hook divise par 1 quand il n'y a aucun jour actif
}

function mergeBy<T, K>(rows: T[], key: (r: T) => K, add: (a: T, b: T) => T): T[] {
  const m = new Map<K, T>();
  for (const r of rows) { const k = key(r); const cur = m.get(k); m.set(k, cur ? add(cur, r) : { ...r }); }
  return [...m.values()];
}

export function mergeMonthlyKpis(list: DashboardKPIs[]): DashboardKPIs {
  if (list.length === 0) throw new Error("mergeMonthlyKpis: liste vide");
  if (list.length === 1) return list[0];
  const first = list[0];
  const out: DashboardKPIs = { ...first };
  for (const key of SUM_KEYS) out[key] = list.reduce((s, k) => s + (k[key] || 0), 0);

  const days = list.map(activeDaysOf);
  const nDays = days.reduce((s, d) => s + d, 0);
  const weighted = (f: (k: DashboardKPIs) => number) => Math.round(list.reduce((s, k, i) => s + f(k) * days[i], 0) / nDays);
  out.avgBrutPerDay = Math.round(out.totalBrut / nDays);
  out.avgNetPerDay = Math.round(out.netFinal / nDays);
  out.avgDepensesPerDay = Math.round(out.totalDepenses / nDays);
  out.avgKmPerDay = weighted((k) => k.avgKmPerDay);
  out.avgSoldePerDay = weighted((k) => k.avgSoldePerDay);
  const km = list.reduce((s, k) => s + (k.coutCarburantKm > 0 ? k.achatsCarburant / k.coutCarburantKm : 0), 0);
  out.coutCarburantKm = km > 0 ? out.achatsCarburant / km : 0;
  out.monthMarginPercent = out.totalBrut > 0 ? (out.netFinal / out.totalBrut) * 100 : 0;

  // Comparaisons masquées : « mois précédent » n'a pas de sens pour une sélection non contiguë.
  out.prevNetFinal = null; out.prevTotalBrut = null; out.prevRecettes = null; out.prevJoursOuvres = null;

  const byDate = <T extends { date: string }>(rows: T[]) => [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  out.dailyRows = byDate(list.flatMap((k) => k.dailyRows));
  out.dailyExpByCategory = byDate(list.flatMap((k) => k.dailyExpByCategory));
  out.dailyTrendData = byDate(list.flatMap((k) => k.dailyTrendData));

  const totalDep = out.totalDepenses;
  out.expenseBreakdown = mergeBy(list.flatMap((k) => k.expenseBreakdown), (r) => r.type, (a, b) => ({ ...a, amount: a.amount + b.amount }))
    .map((r) => ({ ...r, percent: totalDep > 0 ? (r.amount / totalDep) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
  out.topDrivers = mergeBy(list.flatMap((k) => k.topDrivers), (r) => r.driver_id,
    (a, b) => ({ ...a, earnings: a.earnings + b.earnings, expenses: a.expenses + b.expenses, margin: a.margin + b.margin }))
    .sort((a, b) => b.earnings - a.earnings).slice(0, 5);
  out.avancesParChauffeur = mergeBy(list.flatMap((k) => k.avancesParChauffeur), (r) => r.driver_id,
    (a, b) => ({ ...a, remis: a.remis + b.remis, justifie: a.justifie + b.justifie }))
    .map((r) => ({ ...r, restant: Math.max(0, r.remis - r.justifie) }))
    .sort((a, b) => b.restant - a.restant);
  out.driverAllocations = mergeBy(list.flatMap((k) => k.driverAllocations), (r) => r.driver_id,
    (a, b) => ({
      ...a, netDeclared: a.netDeclared + b.netDeclared, netApproved: a.netApproved + b.netApproved, netPending: a.netPending + b.netPending,
      nbReports: a.nbReports + b.nbReports, nbApproved: a.nbApproved + b.nbApproved, nbPending: a.nbPending + b.nbPending,
    }))
    .sort((a, b) => b.netDeclared - a.netDeclared);
  const producing = out.driverAllocations.filter((d) => d.nbReports > 0).length;
  out.avgRevenuePerDriver = producing ? Math.round(out.totalBrut / producing) : 0;

  out.loading = list.some((k) => k.loading);
  out.error = list.find((k) => k.error)?.error ?? null;
  return out;
}

export interface SalaryRowLike {
  driverId: string; name: string; palier: string;
  du: number; avances: number; verse: number; reste: number; paidOn: string | null;
}

/**
 * Tableau des salaires sur plusieurs mois : une ligne par chauffeur, montants
 * additionnés (chaque mois calculé avec ses propres paliers / prorata).
 * `restByMonth` sert à « Marquer payé » (mois le plus récent restant dû).
 */
export function mergeSalaryRows<R extends SalaryRowLike>(perMonth: { month: string; rows: R[] }[]): (R & { restByMonth: { month: string; reste: number }[] })[] {
  const m = new Map<string, R & { restByMonth: { month: string; reste: number }[] }>();
  for (const { month, rows } of perMonth) {
    for (const r of rows) {
      const cur = m.get(r.driverId);
      if (!cur) { m.set(r.driverId, { ...r, restByMonth: [{ month, reste: r.reste }] }); continue; }
      const paliers = new Set([...cur.palier.split(" / "), r.palier]);
      m.set(r.driverId, {
        ...cur,
        palier: [...paliers].join(" / "),
        du: cur.du + r.du, avances: cur.avances + r.avances, verse: cur.verse + r.verse, reste: cur.reste + r.reste,
        paidOn: [cur.paidOn, r.paidOn].filter(Boolean).sort().pop() ?? null,
        restByMonth: [...cur.restByMonth, { month, reste: r.reste }],
      });
    }
  }
  return [...m.values()]
    .map((r) => ({ ...r, paidOn: r.reste === 0 && r.verse > 0 ? r.paidOn : null }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
