import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTenantId } from "@/lib/supabase/tenanted";

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

  loading: boolean;
  error: string | null;
}

const ZERO: DashboardKPIs = {
  brutYango: 0, netYango: 0, horsYango: 0, totalBrut: 0, totalDepenses: 0, netFinal: 0,
  avgBrutPerDay: 0, avgNetPerDay: 0, avgDepensesPerDay: 0, avgKmPerDay: 0, avgSoldePerDay: 0,
  todayRevenue: 0, todayExpenses: 0, todayNetMargin: 0, activeDriversToday: 0,
  weekRevenue: 0, weekExpenses: 0, weekNetMargin: 0, weekAvgDailyRevenue: 0,
  monthRevenue: 0, monthExpenses: 0, monthNetMargin: 0, monthMarginPercent: 0,
  avgFuelConsumption: 0, totalFuelCost: 0, totalDrivers: 0, avgRevenuePerDriver: 0,
  dailyRows: [], expenseBreakdown: [], dailyExpByCategory: [],
  dailyTrendData: [], topDrivers: [],
  loading: true, error: null,
};

export function useDashboardKPIs(dateFrom?: string, dateTo?: string, explicitTenantId?: string | null) {
  const [kpis, setKPIs] = useState<DashboardKPIs>(ZERO);

  const loadKPIs = useCallback(async () => {
    try {
      const supabase = createClient() as any;
      // Use explicit tenantId if provided (admin page), otherwise fall back to slug-based detection
      let tid: string | null = explicitTenantId || null;
      if (!tid) {
        try { tid = await getTenantId(); } catch { /* no tenant context, query all */ }
      }
      const today = new Date().toISOString().split("T")[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const periodStart = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const periodEnd = dateTo || today;

      // Build base queries — conditionally filter by tenant_id if available
      const repQ = (q: any) => tid ? q.eq("tenant_id", tid) : q;
      const saasQ = (q: any) => q.eq("source", "saas"); // exclude legacy yango-app records

      const [
        { data: allReps },
        { data: allExps },
        { data: allPayments },
        { data: todayRep },
        { data: weekRep },
        { data: driverProfiles },
      ] = await Promise.all([
        saasQ(repQ(supabase.from("daily_reports").select("*"))).gte("date", periodStart).lte("date", periodEnd).order("date"),
        saasQ(repQ(supabase.from("expenses").select("*"))),
        repQ(supabase.from("payments").select("*")),
        saasQ(repQ(supabase.from("daily_reports").select("*"))).eq("date", today),
        saasQ(repQ(supabase.from("daily_reports").select("*"))).gte("date", weekAgo).lte("date", today),
        tid
          ? supabase.from("profiles").select("id, full_name, driver_id").eq("tenant_id", tid).eq("role", "driver")
          : supabase.from("profiles").select("id, full_name, driver_id").eq("role", "driver"),
      ]);

      // Only approved reports count in real figures
      const reps: any[] = (allReps || []).filter((r: any) => r.status === "approved");
      const repsAll: any[] = allReps || []; // all (including pending) for pending display
      const todayReps: any[] = (todayRep || []).filter((r: any) => r.status === "approved");
      const weekReps: any[] = (weekRep || []).filter((r: any) => r.status === "approved");
      const drivers: any[] = driverProfiles || [];

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
      const sortedReps = [...reps].sort((a, b) => a.date.localeCompare(b.date));
      const kmByDate: Record<string, number> = {};
      for (let i = 0; i < sortedReps.length; i++) {
        const cur = sortedReps[i];
        const prev = sortedReps[i - 1];
        if (cur.end_odometer && prev?.end_odometer && cur.end_odometer > prev.end_odometer) {
          kmByDate[cur.date] = cur.end_odometer - prev.end_odometer;
        } else {
          kmByDate[cur.date] = 0;
        }
      }
      const totalKm = Object.values(kmByDate).reduce((s, k) => s + k, 0);

      // ── SOLDE MOYEN ──
      const repWithSolde = reps.filter((r) => r.solde_yango > 0);
      const avgSoldePerDay = repWithSolde.length > 0
        ? repWithSolde.reduce((s, r) => s + (r.solde_yango || 0), 0) / repWithSolde.length
        : 0;

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

      // ── TODAY / WEEK (approved only) ──
      const todayExpenses = (allExps || []).filter((e: any) => getED(e) === today && (!e.status || e.status === "approved")).reduce((s: number, e: any) => s + e.amount, 0);
      const weekExpAmt = (allExps || []).filter((e: any) => getED(e) >= weekAgo && getED(e) <= today && (!e.status || e.status === "approved")).reduce((s: number, e: any) => s + e.amount, 0);
      const weekActiveDays = new Set(weekReps.map((r: any) => r.date)).size || 1;

      setKPIs({
        brutYango, netYango, horsYango, totalBrut, totalDepenses, netFinal,
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
        totalDrivers: drivers.length,
        avgRevenuePerDriver: drivers.length ? Math.round(totalBrut / drivers.length) : 0,
        dailyRows, expenseBreakdown, dailyExpByCategory, dailyTrendData, topDrivers,
        loading: false, error: null,
      });
    } catch (err) {
      console.error("KPI error:", err);
      setKPIs((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "Erreur" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, explicitTenantId]);

  useEffect(() => {
    setKPIs((prev) => ({ ...prev, loading: true }));
    const timeout = setTimeout(() => setKPIs((prev) => ({ ...prev, loading: false })), 6000);
    loadKPIs().finally(() => clearTimeout(timeout));
  }, [loadKPIs]);

  return kpis;
}
