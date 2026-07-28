/**
 * Lecture SEULE des données métier + agrégats déterministes pour la couche IA.
 * Les fonctions d'agrégation sont pures (tableaux → chiffres) et testées ;
 * seul fetchTenantWindow touche la DB (service_role, filtré par tenant_id).
 * Mêmes conventions que /api/admin/kpis : source saas/null, statut approved,
 * comptes techniques exclus.
 */
import { aiAdmin } from "./adminClient";
import { soldeConsomme, coutCarburantParKm, carburantConsomme, computeOperationnel } from "@/lib/calc";

export interface RawReport {
  driver_id: string;
  date: string;               // YYYY-MM-DD
  status: string;             // approved | submitted | rejected
  yango_gross: number | null;
  yango_bonus: number | null;
  off_yango_revenue: number | null;
  solde_yango: number | null;
  end_odometer: number | null;
}

export interface RawExpense {
  driver_id: string | null;
  category: string | null;    // "Carburant" | "Solde Yango" | autres
  amount: number | null;
  expense_date: string | null;
  status: string | null;      // null | submitted | approved
}

export interface RawDriver {
  id: string;
  full_name: string | null;
  account_type: string | null; // "technical" à exclure des stats
  active: boolean | null;
  salary_model: string | null;
}

export interface TenantWindow {
  drivers: RawDriver[];
  reports: RawReport[];   // triés par date croissante
  expenses: RawExpense[];
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
};

export async function fetchTenantWindow(tenantId: string, days = 70): Promise<TenantWindow> {
  const admin = aiAdmin();
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const [drv, rep, exp] = await Promise.all([
    admin.from("profiles")
      .select("id, full_name, account_type, active, salary_model")
      .eq("tenant_id", tenantId).eq("role", "driver"),
    admin.from("daily_reports")
      .select("driver_id, date, status, yango_gross, yango_bonus, off_yango_revenue, solde_yango, end_odometer")
      .eq("tenant_id", tenantId)
      .or("source.eq.saas,source.is.null")
      .gte("date", from)
      .order("date", { ascending: true }),
    admin.from("expenses")
      .select("driver_id, category, amount, expense_date, status")
      .eq("tenant_id", tenantId)
      .or("source.eq.saas,source.is.null")
      .gte("expense_date", from),
  ]);

  const technical = new Set(
    (drv.data ?? []).filter((d) => d.account_type === "technical").map((d) => d.id)
  );

  return {
    drivers: (drv.data ?? []).filter((d) => !technical.has(d.id)) as RawDriver[],
    reports: ((rep.data ?? []) as RawReport[]).filter((r) => !technical.has(r.driver_id)),
    expenses: ((exp.data ?? []) as RawExpense[]).filter(
      (e) => !e.driver_id || !technical.has(e.driver_id)
    ),
  };
}

/* ── Agrégats déterministes (purs) ──────────────────────────────────── */

const inPeriod = (d: string | null, from: string, to: string) => !!d && d >= from && d <= to;
const approved = (r: RawReport) => r.status === "approved";
const expenseOk = (e: RawExpense) => !e.status || e.status === "approved" || e.status === "submitted";

/** Recettes = brut + bonus + hors Yango (rapports approuvés). */
export function recettesPeriode(reports: RawReport[], from: string, to: string): number {
  return reports.filter((r) => approved(r) && inPeriod(r.date, from, to))
    .reduce((s, r) => s + n(r.yango_gross) + n(r.yango_bonus) + n(r.off_yango_revenue), 0);
}

/** Provisions de solde (dépenses "Solde Yango") sur une période. */
export function provisionsSoldePeriode(expenses: RawExpense[], from: string, to: string): number {
  return expenses.filter((e) => e.category === "Solde Yango" && expenseOk(e) && inPeriod(e.expense_date, from, to))
    .reduce((s, e) => s + n(e.amount), 0);
}

/** Achats de carburant (dépenses "Carburant") sur une période. */
export function achatsCarburantPeriode(expenses: RawExpense[], from: string, to: string): number {
  return expenses.filter((e) => e.category === "Carburant" && expenseOk(e) && inPeriod(e.expense_date, from, to))
    .reduce((s, e) => s + n(e.amount), 0);
}

/** Dépenses opérationnelles hors Solde/Carburant sur une période. */
export function depensesOpePeriode(expenses: RawExpense[], from: string, to: string): number {
  return expenses.filter((e) =>
    e.category !== "Solde Yango" && e.category !== "Carburant" &&
    expenseOk(e) && inPeriod(e.expense_date, from, to)
  ).reduce((s, e) => s + n(e.amount), 0);
}

/**
 * Solde Yango consommé sur une période (Modèle A, SPEC-CALCULS §2.1) :
 * par chauffeur, jour par jour : consommé = solde_veille − solde_fin + provisions.
 * `reports` doit couvrir AUSSI l'historique avant `from` (pour le solde de veille).
 */
export function soldeConsommePeriode(
  reports: RawReport[], expenses: RawExpense[], from: string, to: string
): number {
  const byDriver = new Map<string, RawReport[]>();
  for (const r of reports) {
    if (!approved(r) || r.solde_yango == null) continue;
    const arr = byDriver.get(r.driver_id) ?? [];
    arr.push(r);
    byDriver.set(r.driver_id, arr);
  }

  let total = 0;
  for (const [driverId, arr] of byDriver) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      if (!inPeriod(cur.date, from, to)) continue;
      const prev = i > 0 ? arr[i - 1] : null;
      // Premier rapport connu : consommation 0 (SPEC : solde_veille = solde_fin)
      const soldeVeille = prev ? n(prev.solde_yango) : n(cur.solde_yango);
      const provisionsDuJour = expenses
        .filter((e) => e.driver_id === driverId && e.category === "Solde Yango"
          && expenseOk(e) && e.expense_date === cur.date)
        .reduce((s, e) => s + n(e.amount), 0);
      total += soldeConsomme({ soldeVeille, soldeFin: n(cur.solde_yango), provisionsDuJour });
    }
  }
  return total;
}

/** Km parcourus (diff d'odomètre entre rapports consécutifs, par chauffeur). */
export function kmPeriode(reports: RawReport[], from: string, to: string): number {
  const byDriver = new Map<string, RawReport[]>();
  for (const r of reports) {
    if (!approved(r) || !n(r.end_odometer)) continue;
    const arr = byDriver.get(r.driver_id) ?? [];
    arr.push(r);
    byDriver.set(r.driver_id, arr);
  }
  let km = 0;
  for (const arr of byDriver.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < arr.length; i++) {
      if (!inPeriod(arr[i].date, from, to)) continue;
      const d = n(arr[i].end_odometer) - n(arr[i - 1].end_odometer);
      if (d > 0 && d < 2000) km += d; // garde-fou saisie aberrante
    }
  }
  return km;
}

export interface PeriodAggregates {
  from: string;
  to: string;
  recettes: number;
  soldeConsomme: number;
  carburantConsomme: number;
  depensesOpe: number;
  /** Net opérationnel AVANT salaires (comparaison hebdo — les salaires sont mensuels). */
  netOperationnel: number;
  km: number;
  coutCarburantParKm: number; // ratio historique appliqué (FCFA/km)
  reportsApproved: number;
  reportsAttendus: number;    // chauffeurs actifs × jours de la période
  tauxSoumission: number;     // %
}

/**
 * Agrégats d'une période. `histFrom` borne l'historique du ratio carburant/km
 * (SPEC §2.2 : ratio = Σ carburant / Σ km sur l'historique, lissage front-load).
 */
export function computePeriodAggregates(
  win: TenantWindow, from: string, to: string, histFrom: string
): PeriodAggregates {
  const recettes = recettesPeriode(win.reports, from, to);
  const solde = soldeConsommePeriode(win.reports, win.expenses, from, to);
  const km = kmPeriode(win.reports, from, to);
  const histKm = kmPeriode(win.reports, histFrom, to);
  const histFuel = achatsCarburantPeriode(win.expenses, histFrom, to);
  const ratio = coutCarburantParKm(histFuel, histKm);
  const carburant = Math.round(carburantConsomme(km, ratio));
  const depensesOpe = depensesOpePeriode(win.expenses, from, to);

  const netOperationnel = computeOperationnel({
    recettes, soldeConsomme: solde, carburantConsomme: carburant,
    depensesOperationnelles: depensesOpe, salaires: 0,
  });

  const activeDrivers = win.drivers.filter((d) => d.active !== false).length;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const attendus = activeDrivers * days;
  const approvedCount = win.reports.filter((r) =>
    (r.status === "approved" || r.status === "submitted") && inPeriod(r.date, from, to)).length;

  return {
    from, to,
    recettes: Math.round(recettes),
    soldeConsomme: Math.round(solde),
    carburantConsomme: carburant,
    depensesOpe: Math.round(depensesOpe),
    netOperationnel: Math.round(netOperationnel),
    km,
    coutCarburantParKm: Math.round(ratio * 100) / 100,
    reportsApproved: approvedCount,
    reportsAttendus: attendus,
    tauxSoumission: attendus > 0 ? Math.round((approvedCount / attendus) * 1000) / 10 : 0,
  };
}

/** Snapshot de fraîcheur : driver_id → date du dernier rapport connu. */
export function freshnessSnapshot(win: TenantWindow): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const r of win.reports) {
    if (!snap[r.driver_id] || r.date > snap[r.driver_id]) snap[r.driver_id] = r.date;
  }
  return snap;
}

/**
 * Score de confiance déterministe : part des données attendues réellement
 * présentes sur la période (taux de soumission borné 0–1) — jamais inventé.
 */
export function confidenceFromCoverage(agg: PeriodAggregates): number {
  if (agg.reportsAttendus <= 0) return 0;
  return Math.max(0, Math.min(1, Math.round((agg.reportsApproved / agg.reportsAttendus) * 1000) / 1000));
}
