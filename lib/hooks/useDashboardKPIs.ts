import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTenantId } from "@/lib/supabase/tenanted";
import {
  soldeConsomme as calcSoldeConsomme, coutCarburantParKm, carburantConsomme,
  computeOperationnel, computeTresorerie, joursOuvresProjetes,
} from "@/lib/calc";

// Catégories de dépenses au traitement spécial (front-load)
const CAT_SOLDE = "Solde Yango";
const CAT_CARBU = "Carburant";

export interface DailyRow {
  date: string;
  brutYango: number;
  horsYango: number;
  netRecettes: number;
  depenses: number;
  netFinal: number;
  km: number;
  solde: number;
  nbCourses: number;
}

export interface DashboardKPIs {
  brutYango: number;
  netYango: number;
  horsYango: number;
  totalBrut: number;
  totalDepenses: number;
  netFinal: number;

  // ── Reporting OPÉRATIONNEL réel ──
  soldeConsomme: number;       // solde Yango réellement consommé (mesuré)
  carburantConsomme: number;   // carburant consommé (km × coût/km)
  coutCarburantKm: number;     // coût carburant par km (dérivé)
  provisionsSolde: number;     // achats de solde (front-load)
  achatsCarburant: number;     // achats de carburant (front-load)
  autresDepensesOpe: number;   // dépenses hors solde & carburant
  netOperationnel: number;     // résultat opérationnel réel
  // ── Vue TRÉSORERIE ──
  decaissements: number;
  tresorerie: number;
  avanceSolde: number;         // cash immobilisé en solde
  avanceCarburant: number;     // cash immobilisé en carburant
  avgBrutPerDay: number;
  avgNetPerDay: number;
  avgDepensesPerDay: number;
  avgKmPerDay: number;
  avgSoldePerDay: number;

  todayRevenue: number;
  todayExpenses: number;
  todayNetMargin: number;
  activeDriversToday: number;

  weekRevenue: number;
  weekExpenses: number;
  weekNetMargin: number;
  weekAvgDailyRevenue: number;

  monthRevenue: number;
  monthExpenses: number;
  monthNetMargin: number;
  monthMarginPercent: number;
  avgFuelConsumption: number;
  totalFuelCost: number;
  totalDrivers: number;
  avgRevenuePerDriver: number;

  // Per-day rows for table & charts
  dailyRows: DailyRow[];

  // Expense breakdown by category
  expenseBreakdown: Array<{ type: string; amount: number; percent: number }>;

  // Per-day expenses by category (for stacked chart)
  dailyExpByCategory: Array<{ date: string; [cat: string]: number | string }>;

  // Legacy
  dailyTrendData: Array<{ date: string; revenue: number; expenses: number; margin: number }>;
  topDrivers: Array<{ driver_id: string; earnings: number; expenses: number; margin: number }>;

  // Per-driver allocation (approved + submitted, non-rejected)
  driverAllocations: Array<{
    driver_id: string;
    name: string;
    netDeclared: number;   // sum of net_after_expenses (approved + submitted)
    netApproved: number;   // approved only
    netPending: number;    // submitted only
    nbReports: number;
    nbApproved: number;
    nbPending: number;
    hire_date: string | null;
    prorataFactor: number;   // 1 = plein mois ; < 1 si entré en cours de période
    salary_model: string | null;  // modèle de rému du chauffeur (null → tenant)
    base_amount: number | null;   // salaire de base du chauffeur (null → tenant)
  }>;

  loading: boolean;
  error: string | null;
}

const ZERO: DashboardKPIs = {
  brutYango: 0, netYango: 0, horsYango: 0, totalBrut: 0, totalDepenses: 0, netFinal: 0,
  soldeConsomme: 0, carburantConsomme: 0, coutCarburantKm: 0, provisionsSolde: 0,
  achatsCarburant: 0, autresDepensesOpe: 0, netOperationnel: 0,
  decaissements: 0, tresorerie: 0, avanceSolde: 0, avanceCarburant: 0,
  avgBrutPerDay: 0, avgNetPerDay: 0, avgDepensesPerDay: 0, avgKmPerDay: 0, avgSoldePerDay: 0,
  todayRevenue: 0, todayExpenses: 0, todayNetMargin: 0, activeDriversToday: 0,
  weekRevenue: 0, weekExpenses: 0, weekNetMargin: 0, weekAvgDailyRevenue: 0,
  monthRevenue: 0, monthExpenses: 0, monthNetMargin: 0, monthMarginPercent: 0,
  avgFuelConsumption: 0, totalFuelCost: 0, totalDrivers: 0, avgRevenuePerDriver: 0,
  dailyRows: [], expenseBreakdown: [], dailyExpByCategory: [],
  dailyTrendData: [], topDrivers: [], driverAllocations: [],
  loading: true, error: null,
};

export function useDashboardKPIs(dateFrom?: string, dateTo?: string, explicitTenantId?: string | null, filterDriverId?: string) {
  const [kpis, setKPIs] = useState<DashboardKPIs>(ZERO);

  const loadKPIs = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const periodStart = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const periodEnd = dateTo || today;

      let allReps: any[], allExps: any[], allPayments: any[], todayRep: any[], weekRep: any[], driverProfiles: any[];

      if (explicitTenantId) {
        // Admin context — bypass RLS via service-role API
        const params = new URLSearchParams({ tenantId: explicitTenantId, dateFrom: periodStart, dateTo: periodEnd });
        if (filterDriverId) params.set("driverId", filterDriverId);
        const json = await fetch(`/api/admin/kpis?${params}`).then((r) => r.json());
        allReps = json.allReps || [];
        allExps = json.allExps || [];
        allPayments = json.allPayments || [];
        todayRep = json.todayRep || [];
        weekRep = json.weekRep || [];
        driverProfiles = json.driverProfiles || [];
      } else {
        // Driver context — use anon client (driver reads their own data, RLS allows it)
        const supabase = createClient() as any;
        let tid: string | null = null;
        try { tid = await getTenantId(); } catch { /* no tenant context */ }
        const repQ = (q: any) => tid ? q.eq("tenant_id", tid) : q;
        const drvQ = (q: any) => filterDriverId ? q.eq("driver_id", filterDriverId) : q;
        const saasQ = (q: any) => q.or("source.eq.saas,source.is.null");
        const [r1, r2, r3, r4, r5, r6] = await Promise.all([
          saasQ(drvQ(repQ(supabase.from("daily_reports").select("*")))).gte("date", periodStart).lte("date", periodEnd).order("date"),
          saasQ(drvQ(repQ(supabase.from("expenses").select("*")))),
          drvQ(repQ(supabase.from("payments").select("*"))),
          saasQ(drvQ(repQ(supabase.from("daily_reports").select("*")))).eq("date", today),
          saasQ(drvQ(repQ(supabase.from("daily_reports").select("*")))).gte("date", weekAgo).lte("date", today),
          tid
            ? supabase.from("profiles").select("*").eq("tenant_id", tid).eq("role", "driver")
            : supabase.from("profiles").select("*").eq("role", "driver"),
        ]);
        allReps = r1.data || []; allExps = r2.data || []; allPayments = r3.data || [];
        todayRep = r4.data || []; weekRep = r5.data || []; driverProfiles = r6.data || [];
      }

      // Only approved reports count in real figures
      const reps: any[] = (allReps || []).filter((r: any) => r.status === "approved");
      const repsAll: any[] = allReps || []; // all (including pending) for pending display
      const todayReps: any[] = (todayRep || []).filter((r: any) => r.status === "approved");
      const weekReps: any[] = (weekRep || []).filter((r: any) => r.status === "approved");
      const drivers: any[] = driverProfiles || [];
      // Chauffeurs ACTIFS aujourd'hui (masse salariale, effectif) — l'historique garde tout le monde
      const activeDrivers: any[] = drivers.filter((d: any) =>
        d.active !== false && (!d.contract_end_date || d.contract_end_date >= today));

      // Filter expenses by user-entered date (expense_date) or created_at fallback
      // Only approved expenses count in real figures
      const getED = (e: any) => e.expense_date || e.created_at?.slice(0, 10) || "";
      const exps: any[] = (allExps || []).filter((e: any) => {
        const d = getED(e);
        const isApproved = !e.status || e.status === "approved"; // legacy rows without status count as approved
        return isApproved && d >= periodStart && d <= periodEnd;
      });
      const expsPending: any[] = (allExps || []).filter((e: any) => e.status === "submitted");

      // Filter salary payments by salary_month (imputation month) or payment_date fallback
      const getSalaryDate = (p: any) => p.salary_month?.slice(0, 10) || p.payment_date || p.created_at?.slice(0, 10) || "";
      const periodPayments: any[] = (allPayments || []).filter((p: any) => {
        const d = getSalaryDate(p);
        return d >= periodStart && d <= periodEnd;
      });
      const totalSalaries = periodPayments.reduce((s, p) => s + (p.amount || 0), 0);

      // ── PERIOD TOTALS ──
      const brutYango = reps.reduce((s, r) => s + (r.yango_gross || 0) + (r.yango_bonus || 0), 0);
      const commission = reps.reduce((s, r) => s + (r.commission_amount || 0), 0);
      const netYango = brutYango - commission;
      const horsYango = reps.reduce((s, r) => s + (r.off_yango_revenue || 0), 0);
      const totalBrut = reps.reduce((s, r) => s + (r.net_after_expenses || 0), 0);
      const totalExpenses = exps.reduce((s, e) => s + (e.amount || 0), 0);
      const totalDepenses = totalExpenses + totalSalaries; // charges = dépenses + salaires
      const netFinal = totalBrut - totalDepenses;

      // ── KM PER DAY from odometer ──
      // Le km/jour = différence de compteur d'un MÊME véhicule d'un relevé au suivant.
      // On regroupe donc par chauffeur avant de faire les écarts : sinon on soustrait
      // le compteur d'un véhicule (~142 000) de celui d'un autre (~100 000) et on
      // fabrique des dizaines de milliers de km fantômes (bug historique).
      const MAX_KM_JOUR = 1500; // garde-fou anti-saisie aberrante (chiffre en trop au compteur)
      const kmByDate: Record<string, number> = {};
      const repsByDriverKm: Record<string, any[]> = {};
      reps.forEach((r: any) => { (repsByDriverKm[r.driver_id] ||= []).push(r); });
      for (const driverReps of Object.values(repsByDriverKm)) {
        const sorted = driverReps.sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 1; i < sorted.length; i++) {
          const cur = sorted[i], prev = sorted[i - 1];
          if (cur.end_odometer && prev?.end_odometer && cur.end_odometer > prev.end_odometer) {
            const delta = cur.end_odometer - prev.end_odometer;
            if (delta <= MAX_KM_JOUR) kmByDate[cur.date] = (kmByDate[cur.date] || 0) + delta;
          }
        }
      }
      const totalKm = Object.values(kmByDate).reduce((s, k) => s + k, 0);

      // ── SOLDE MOYEN ──
      const repWithSolde = reps.filter((r) => r.solde_yango > 0);
      const avgSoldePerDay = repWithSolde.length > 0
        ? repWithSolde.reduce((s, r) => s + (r.solde_yango || 0), 0) / repWithSolde.length
        : 0;

      // ══ REPORTING OPÉRATIONNEL RÉEL (solde & carburant consommés) ══
      const provisionsSolde = exps.filter((e: any) => e.category === CAT_SOLDE).reduce((s: number, e: any) => s + (e.amount || 0), 0);
      const achatsCarburant = exps.filter((e: any) => e.category === CAT_CARBU).reduce((s: number, e: any) => s + (e.amount || 0), 0);
      const autresDepensesOpe = exps.filter((e: any) => e.category !== CAT_SOLDE && e.category !== CAT_CARBU).reduce((s: number, e: any) => s + (e.amount || 0), 0);

      // Solde consommé : jour par jour, par chauffeur (solde_veille dérivé du rapport précédent)
      const provByDriverDate: Record<string, number> = {};
      exps.filter((e: any) => e.category === CAT_SOLDE).forEach((e: any) => {
        const k = `${e.driver_id}|${getED(e)}`;
        provByDriverDate[k] = (provByDriverDate[k] || 0) + (e.amount || 0);
      });
      const soldeInitByDriver: Record<string, number | null> = {};
      const salaryModelByDriver: Record<string, string | null> = {};
      const baseAmountByDriver: Record<string, number | null> = {};
      drivers.forEach((d: any) => {
        soldeInitByDriver[d.id] = d.solde_initial ?? null;
        salaryModelByDriver[d.id] = d.salary_model ?? null;
        baseAmountByDriver[d.id] = d.base_amount ?? null;
      });
      const repsByDriver: Record<string, any[]> = {};
      reps.forEach((r: any) => { (repsByDriver[r.driver_id] ||= []).push(r); });
      let totalSoldeConsomme = 0;
      Object.entries(repsByDriver).forEach(([drvId, list]) => {
        const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
        let prevSolde: number | null = soldeInitByDriver[drvId] ?? null;
        sorted.forEach((r) => {
          const soldeFin = r.solde_yango ?? null;
          const prov = provByDriverDate[`${drvId}|${r.date}`] || 0;
          if (soldeFin != null && prevSolde != null) {
            totalSoldeConsomme += calcSoldeConsomme({ soldeVeille: prevSolde, soldeFin, provisionsDuJour: prov });
          }
          if (soldeFin != null) prevSolde = soldeFin;
        });
      });

      // Carburant consommé = km × coût/km (dérivé de l'historique de la période)
      const coutCarburantKm = coutCarburantParKm(achatsCarburant, totalKm);
      const carbuConsomme = carburantConsomme(totalKm, coutCarburantKm);

      const recettesReelles = brutYango + horsYango;
      const netOperationnel = computeOperationnel({
        recettes: recettesReelles, soldeConsomme: totalSoldeConsomme, carburantConsomme: carbuConsomme,
        depensesOperationnelles: autresDepensesOpe, salaires: totalSalaries,
      });
      const treso = computeTresorerie({
        encaissements: recettesReelles, provisionsSolde, achatsCarburant,
        autresDepenses: autresDepensesOpe, salaires: totalSalaries,
        soldeConsomme: totalSoldeConsomme, carburantConsomme: carbuConsomme,
      });

      // ── DAILY ROWS for table ──
      const dateSet = new Set<string>([
        ...reps.map((r) => r.date),
        ...exps.map(getED).filter(Boolean),
      ]);
      const dailyRows: DailyRow[] = Array.from(dateSet).sort().map((date) => {
        const dayReps = reps.filter((r) => r.date === date);
        const dayExps = exps.filter((e) => getED(e) === date);
        const brutY = dayReps.reduce((s, r) => s + (r.yango_gross || 0) + (r.yango_bonus || 0), 0);
        const horsY = dayReps.reduce((s, r) => s + (r.off_yango_revenue || 0), 0);
        const netR = dayReps.reduce((s, r) => s + (r.net_after_expenses || 0), 0);
        const dep = dayExps.reduce((s, e) => s + (e.amount || 0), 0);
        const solde = dayReps.reduce((s, r) => s + (r.solde_yango || 0), 0);
        const courses = dayReps.reduce((s, r) => s + (r.yango_trip_count || 0) + (r.off_yango_trip_count || 0), 0);
        return {
          date, brutYango: brutY, horsYango: horsY, netRecettes: netR,
          depenses: dep, netFinal: netR - dep,
          km: kmByDate[date] || 0, solde, nbCourses: courses,
        };
      });

      // ── EXPENSE BREAKDOWN BY CATEGORY ──
      const catMap = new Map<string, number>();
      exps.forEach((e: any) => catMap.set(e.category || "Autre", (catMap.get(e.category || "Autre") || 0) + (e.amount || 0)));
      if (totalSalaries > 0) catMap.set("💵 Salaires", totalSalaries);
      const expenseBreakdown = Array.from(catMap.entries())
        .map(([type, amount]) => ({ type, amount, percent: totalDepenses > 0 ? (amount / totalDepenses) * 100 : 0 }))
        .sort((a, b) => b.amount - a.amount);

      // ── DAILY EXP BY CATEGORY (stacked chart) ──
      const allCats = Array.from(catMap.keys());
      const dailyExpByCategory = Array.from(dateSet).sort().map((date) => {
        const row: any = { date };
        allCats.forEach((cat) => {
          row[cat] = exps.filter((e: any) => getED(e) === date && (e.category || "Autre") === cat)
            .reduce((s: number, e: any) => s + (e.amount || 0), 0);
        });
        return row;
      });

      // ── DAILY TREND (legacy) ──
      const dailyTrendData = dailyRows.map((r) => ({
        date: r.date, revenue: r.netRecettes, expenses: r.depenses, margin: r.netFinal,
      }));

      // ── TOP DRIVERS ──
      const driverMap = new Map<string, { earnings: number; expenses: number; name: string }>();
      reps.forEach((r) => {
        if (!driverMap.has(r.driver_id)) {
          const p = drivers.find((d) => d.id === r.driver_id);
          driverMap.set(r.driver_id, { earnings: 0, expenses: 0, name: p?.full_name || p?.driver_id || r.driver_id?.slice(0, 8) });
        }
        driverMap.get(r.driver_id)!.earnings += r.net_after_expenses || 0;
      });
      exps.forEach((e: any) => {
        if (driverMap.has(e.driver_id)) driverMap.get(e.driver_id)!.expenses += e.amount || 0;
      });
      const topDrivers = Array.from(driverMap.entries())
        .map(([driver_id, d]) => ({ driver_id: d.name, earnings: d.earnings, expenses: d.expenses, margin: d.earnings - d.expenses }))
        .sort((a, b) => b.earnings - a.earnings).slice(0, 5);

      const activeDays = new Set(reps.map((r) => r.date)).size || 1;

      // ── PER-DRIVER ALLOCATIONS (approved + submitted, non-rejected) ──
      const allActive: any[] = (allReps || []).filter((r: any) => r.status === "approved" || r.status === "submitted");
      const driverAllocationMap = new Map<string, { name: string; netApproved: number; netPending: number; nbApproved: number; nbPending: number }>();
      // Seed with all driver profiles so zero-report drivers still appear
      drivers.forEach((d) => {
        driverAllocationMap.set(d.id, { name: d.full_name || d.driver_id || d.id.slice(0, 8), netApproved: 0, netPending: 0, nbApproved: 0, nbPending: 0 });
      });
      allActive.forEach((r: any) => {
        if (!driverAllocationMap.has(r.driver_id)) {
          const p = drivers.find((d) => d.id === r.driver_id);
          driverAllocationMap.set(r.driver_id, { name: p?.full_name || p?.driver_id || r.driver_id?.slice(0, 8), netApproved: 0, netPending: 0, nbApproved: 0, nbPending: 0 });
        }
        const entry = driverAllocationMap.get(r.driver_id)!;
        if (r.status === "approved") { entry.netApproved += r.net_after_expenses || 0; entry.nbApproved++; }
        else { entry.netPending += r.net_after_expenses || 0; entry.nbPending++; }
      });
      // Prorata salaire : jours ouvrés du mois (6j/7 sur le calendrier réel de la période)
      const joursOuvresPeriode = joursOuvresProjetes(periodStart, periodEnd);
      const hireByDriver: Record<string, string | null> = {};
      drivers.forEach((d: any) => { hireByDriver[d.id] = d.hire_date ?? null; });
      const prorataOf = (hire: string | null): number => {
        if (!hire || hire <= periodStart || joursOuvresPeriode <= 0) return 1;
        if (hire > periodEnd) return 0;
        const travailles = joursOuvresProjetes(hire, periodEnd);
        return Math.min(1, travailles / joursOuvresPeriode);
      };

      const driverAllocations = Array.from(driverAllocationMap.entries()).map(([driver_id, d]) => ({
        driver_id,
        name: d.name,
        netApproved: d.netApproved,
        netPending: d.netPending,
        netDeclared: d.netApproved + d.netPending,
        nbReports: d.nbApproved + d.nbPending,
        nbApproved: d.nbApproved,
        nbPending: d.nbPending,
        hire_date: hireByDriver[driver_id] ?? null,
        prorataFactor: prorataOf(hireByDriver[driver_id] ?? null),
        salary_model: salaryModelByDriver[driver_id] ?? null,
        base_amount: baseAmountByDriver[driver_id] ?? null,
      })).sort((a, b) => b.netDeclared - a.netDeclared);

      // ── TODAY / WEEK (approved only) ──
      const todayExpenses = (allExps || []).filter((e: any) => getED(e) === today && (!e.status || e.status === "approved")).reduce((s: number, e: any) => s + e.amount, 0);
      const weekExpAmt = (allExps || []).filter((e: any) => getED(e) >= weekAgo && getED(e) <= today && (!e.status || e.status === "approved")).reduce((s: number, e: any) => s + e.amount, 0);
      const weekActiveDays = new Set(weekReps.map((r: any) => r.date)).size || 1;

      setKPIs({
        brutYango, netYango, horsYango, totalBrut, totalDepenses, netFinal,
        soldeConsomme: totalSoldeConsomme, carburantConsomme: carbuConsomme, coutCarburantKm,
        provisionsSolde, achatsCarburant, autresDepensesOpe, netOperationnel,
        decaissements: treso.decaissements, tresorerie: treso.tresorerie,
        avanceSolde: treso.avanceSolde, avanceCarburant: treso.avanceCarburant,
        avgBrutPerDay: Math.round(totalBrut / activeDays),
        avgNetPerDay: Math.round(netFinal / activeDays),
        avgDepensesPerDay: Math.round(totalDepenses / activeDays),
        avgKmPerDay: Math.round(totalKm / activeDays),
        avgSoldePerDay: Math.round(avgSoldePerDay),
        todayRevenue: todayReps.reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0),
        todayExpenses,
        todayNetMargin: todayReps.reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0) - todayExpenses,
        activeDriversToday: new Set(todayReps.map((r: any) => r.driver_id)).size,
        weekRevenue: weekReps.reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0),
        weekExpenses: weekExpAmt,
        weekNetMargin: weekReps.reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0) - weekExpAmt,
        weekAvgDailyRevenue: weekReps.reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0) / weekActiveDays,
        monthRevenue: totalBrut, monthExpenses: totalDepenses, monthNetMargin: netFinal,
        monthMarginPercent: totalBrut > 0 ? (netFinal / totalBrut) * 100 : 0,
        avgFuelConsumption: 0,
        totalFuelCost: totalExpenses > 0 ? exps.filter((e: any) => e.category === "Carburant").reduce((s: number, e: any) => s + e.amount, 0) : 0,
        totalDrivers: activeDrivers.length,
        // Moyenne par chauffeur AYANT PRODUIT sur la période (pas l'effectif actuel)
        avgRevenuePerDriver: (() => { const n = new Set(reps.map((r: any) => r.driver_id)).size; return n ? Math.round(totalBrut / n) : 0; })(),
        dailyRows, expenseBreakdown, dailyExpByCategory, dailyTrendData, topDrivers, driverAllocations,
        loading: false, error: null,
      });
    } catch (err) {
      console.error("KPI error:", err);
      setKPIs((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "Erreur" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, explicitTenantId, filterDriverId]);

  useEffect(() => {
    setKPIs((prev) => ({ ...prev, loading: true }));
    const timeout = setTimeout(() => setKPIs((prev) => ({ ...prev, loading: false })), 6000);
    loadKPIs().finally(() => clearTimeout(timeout));
  }, [loadKPIs]);

  return kpis;
}
