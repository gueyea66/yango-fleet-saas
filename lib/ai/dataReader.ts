/**
 * Lecture SEULE des données métier + agrégats déterministes pour la couche IA.
 * Les fonctions d'agrégation sont pures (tableaux → chiffres) et testées ;
 * seul fetchTenantWindow touche la DB (service_role, filtré par tenant_id).
 * Mêmes conventions que /api/admin/kpis : source saas/null, statut approved,
 * comptes techniques exclus.
 */
import { aiAdmin } from "./adminClient";
import { soldeConsomme, coutCarburantParKm, carburantConsomme, computeOperationnel } from "@/lib/calc";
import { CAT_AVANCE } from "@/lib/expenseCategories";

export interface RawReport {
  driver_id: string;
  date: string;               // YYYY-MM-DD
  status: string;             // approved | submitted | rejected
  yango_gross: number | null;
  yango_bonus: number | null;
  off_yango_revenue: number | null;
  solde_yango: number | null;
  end_odometer: number | null;
  yango_trip_count?: number | null;
  off_yango_trip_count?: number | null;
  commission_amount?: number | null; // commissions déclarées (réconciliation solde)
  comment?: string | null;    // "[REPOS]…" = jour de repos déclaré
}

/**
 * Jour de repos déclaré (convention "[REPOS]" en tête de commentaire, comme
 * usePilotage/reportHtml). Ces rapports comptent comme SOUMIS (le chauffeur a
 * bien déclaré sa journée) mais sont exclus des moyennes et des jours attendus
 * pour ne pas biaiser les calculs. Leur odomètre reste utilisé (km physiques).
 */
export const isReposReport = (r: Pick<RawReport, "comment">): boolean =>
  String(r.comment ?? "").startsWith("[REPOS]");

export interface RawExpense {
  driver_id: string | null;
  category: string | null;    // "Carburant" | "Solde Yango" | autres
  amount: number | null;
  expense_date: string | null;
  status: string | null;      // null | submitted | approved
  /** Commentaire saisi (Abdou documente ses dépenses) — matière première des explications du brief. */
  description?: string | null;
}

export interface RawDriver {
  id: string;
  full_name: string | null;
  account_type: string | null; // "technical" à exclure des stats
  active: boolean | null;
  salary_model: string | null;
  hire_date: string | null;
  contract_end_date: string | null;
}

/**
 * Chauffeur actif à une date donnée : flag actif ET contrat non terminé.
 * Le flag `active` seul ne suffit pas (retour Abdou 02/09 : le briefing parlait
 * d'un chauffeur dont le contrat était fini depuis 2 jours) — les paramétrages
 * hire_date / contract_end_date font foi.
 */
export function isDriverActiveOn(d: RawDriver, date: string): boolean {
  return d.active !== false && (!d.contract_end_date || d.contract_end_date >= date);
}

export function activeDriverIds(win: TenantWindow, date: string): Set<string> {
  return new Set(win.drivers.filter((d) => isDriverActiveOn(d, date)).map((d) => d.id));
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
      .select("id, full_name, account_type, active, salary_model, hire_date, contract_end_date")
      .eq("tenant_id", tenantId).eq("role", "driver"),
    admin.from("daily_reports")
      .select("driver_id, date, status, yango_gross, yango_bonus, off_yango_revenue, solde_yango, end_odometer, yango_trip_count, off_yango_trip_count, commission_amount, comment")
      .eq("tenant_id", tenantId)
      
      .gte("date", from)
      .order("date", { ascending: true }),
    admin.from("expenses")
      .select("driver_id, category, amount, expense_date, status, description")
      .eq("tenant_id", tenantId)

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

/**
 * Dépenses opérationnelles hors Solde/Carburant sur une période.
 * Les « Décaissement propriétaire » (CAT_AVANCE) sont exclus : ce sont des
 * avances remises aux chauffeurs, neutres pour le résultat — la charge réelle
 * est celle que le chauffeur déclare ensuite (anti double comptage, 03/09).
 */
export function depensesOpePeriode(expenses: RawExpense[], from: string, to: string): number {
  return expenses.filter((e) =>
    e.category !== "Solde Yango" && e.category !== "Carburant" && e.category !== CAT_AVANCE &&
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

/**
 * Km parcourus (diff d'odomètre entre rapports consécutifs, par chauffeur).
 * Les rapports [REPOS] restent DANS la chaîne : un odomètre est une mesure
 * physique — l'exclure casserait le delta du lendemain de repos.
 */
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

/**
 * Mouvements des postes de dépenses opé (hors Carburant/Solde) entre deux
 * périodes — nourrit le briefing avec du "palpable" : QUEL poste a bougé,
 * pas seulement le total déjà affiché sur les cartes KPI.
 */
export function topExpenseMovements(
  expenses: RawExpense[],
  curFrom: string, curTo: string,
  prevFrom: string, prevTo: string,
  minDelta = 5_000, top = 3
): Array<{
  poste: string; delta_fcfa: number; sens: "hausse" | "baisse";
  /** Lignes de la semaine courante qui composent le poste (montant + commentaire
   *  saisi) — le brief EXPLIQUE le mouvement au lieu de le constater (retour
   *  Abdou 02/09 : « chercher les réponses au constat »). */
  lignes: Array<{ montant_fcfa: number; libelle: string }>;
}> {
  const sum = (from: string, to: string) => {
    const acc = new Map<string, number>();
    for (const e of expenses) {
      if (e.category === "Carburant" || e.category === "Solde Yango" || e.category === CAT_AVANCE) continue;
      if (!expenseOk(e) || !inPeriod(e.expense_date, from, to)) continue;
      const cat = e.category ?? "Autre";
      acc.set(cat, (acc.get(cat) ?? 0) + n(e.amount));
    }
    return acc;
  };
  const cur = sum(curFrom, curTo);
  const prev = sum(prevFrom, prevTo);
  const cats = new Set([...cur.keys(), ...prev.keys()]);
  return [...cats]
    .map((poste) => {
      const delta = Math.round((cur.get(poste) ?? 0) - (prev.get(poste) ?? 0));
      const lignes = expenses
        .filter((e) => (e.category ?? "Autre") === poste && expenseOk(e) && inPeriod(e.expense_date, curFrom, curTo))
        .sort((a, b) => n(b.amount) - n(a.amount))
        .slice(0, 3)
        .map((e) => ({
          montant_fcfa: Math.round(n(e.amount)),
          libelle: (e.description ?? "").trim().slice(0, 80) || "(sans commentaire)",
        }));
      return { poste, delta_fcfa: delta, sens: (delta >= 0 ? "hausse" : "baisse") as "hausse" | "baisse", lignes };
    })
    .filter((m) => Math.abs(m.delta_fcfa) >= minDelta)
    .sort((a, b) => Math.abs(b.delta_fcfa) - Math.abs(a.delta_fcfa))
    .slice(0, top);
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
  reportsApproved: number;    // rapports travaillés (hors [REPOS])
  reportsAttendus: number;    // Σ jours attendus par chauffeur (depuis sa date de début, repos déduits)
  reposDeclares: number;      // jours de repos déclarés ([REPOS]) sur la période
  tauxSoumission: number;     // %
  joursOuvres: number;        // jours ouvrés flotte : calendaires − repos « flotte entière »
  netParJourOuvre: number;    // net opérationnel ramené au jour ouvré (base de comparaison)
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

  // Actif = flag + contrat couvrant au moins une partie de la période.
  const activeIds = activeDriverIds(win, from);
  const endOf = new Map(win.drivers.map((d) => [d.id, d.contract_end_date]));
  const hireOf = new Map(win.drivers.map((d) => [d.id, d.hire_date]));
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const periodReps = win.reports.filter((r) =>
    (r.status === "approved" || r.status === "submitted") && inPeriod(r.date, from, to));
  // Jours de repos déclarés (chauffeurs actifs) : retirés des jours attendus —
  // un repos posé n'est pas un rapport manquant et ne doit pas biaiser le taux.
  const reposDeclares = periodReps.filter((r) => isReposReport(r) && activeIds.has(r.driver_id)).length;

  // Jours attendus PAR chauffeur depuis sa date de début (1er rapport connu de
  // la fenêtre) : un chauffeur arrivé en cours de période n'est pas attendu
  // avant son premier jour. Sans rapport du tout, il reste attendu sur toute
  // la période (chauffeur silencieux = signal, pas une absence de début).
  const firstReportByDriver = new Map<string, string>();
  for (const r of win.reports) {
    if (!activeIds.has(r.driver_id)) continue;
    const f = firstReportByDriver.get(r.driver_id);
    if (!f || r.date < f) firstReportByDriver.set(r.driver_id, r.date);
  }
  let attendus = 0;
  for (const id of activeIds) {
    // Attendu de max(période, embauche, 1er rapport) jusqu'à min(période, fin
    // de contrat) : un contrat terminé en cours de période n'est plus attendu après.
    const hire = hireOf.get(id);
    const first = firstReportByDriver.get(id);
    let start = hire && hire > from ? hire : from;
    if (first && first > start) start = first;
    const contractEnd = endOf.get(id);
    const end = contractEnd && contractEnd < to ? contractEnd : to;
    if (start > end) continue;
    const driverDays = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
    const driverRepos = periodReps
      .filter((r) => r.driver_id === id && isReposReport(r) && r.date >= start && r.date <= end).length;
    attendus += Math.max(0, driverDays - driverRepos);
  }
  const approvedCount = periodReps.filter((r) => !isReposReport(r)).length;

  // Jours ouvrés FLOTTE : un jour ne compte pas quand au moins un repos est
  // déclaré et qu'aucun chauffeur actif n'a travaillé (même convention que le
  // briefing). Base des comparaisons hebdo « par jour ouvré ».
  const workedDates = new Set(periodReps
    .filter((r) => !isReposReport(r) && activeIds.has(r.driver_id)).map((r) => r.date));
  const reposFleetDays = [...new Set(periodReps
    .filter((r) => isReposReport(r) && activeIds.has(r.driver_id)).map((r) => r.date))]
    .filter((d) => !workedDates.has(d)).length;
  const joursOuvres = Math.max(0, days - reposFleetDays);

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
    reposDeclares,
    tauxSoumission: attendus > 0 ? Math.round((approvedCount / attendus) * 1000) / 10 : 0,
    joursOuvres,
    netParJourOuvre: Math.round(netOperationnel / Math.max(1, joursOuvres)),
  };
}

/**
 * Snapshot de fraîcheur : driver_id → date du dernier rapport connu.
 * Chauffeurs ACTIFS uniquement — un chauffeur parti a mécaniquement de vieilles
 * dates et polluerait le briefing (fausse alerte « chauffeur silencieux »).
 */
export function freshnessSnapshot(win: TenantWindow): Record<string, string> {
  // Actif AUJOURD'HUI : un contrat terminé ne doit plus déclencher d'alerte
  // « chauffeur silencieux » (cas Ahmadou, retour Abdou 02/09).
  const today = new Date().toISOString().slice(0, 10);
  const activeIds = activeDriverIds(win, today);
  const snap: Record<string, string> = {};
  for (const r of win.reports) {
    if (!activeIds.has(r.driver_id)) continue;
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
