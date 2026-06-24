import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── PARAMETERS ────────────────────────────────────────
export const DEFAULT_PARAMS = {
  commYango: 15,
  commPartner: 0.75,
  workingDaysPerMonth: 26,
  targetMonthlyNet: 1300000,
  fuelPctOfRevenue: 18,
  soldePctOfRevenue: 8,
  fuelDailyOverride: 0,
  soldeDailyOverride: 0,
  maintenanceCostPerMonth: 50000,
  salaryRules: [
    { min_net: 0,       total_salary: 200000, label: "Base" },
    { min_net: 1000000, total_salary: 230000, label: "Palier 1" },
    { min_net: 1150000, total_salary: 260000, label: "Palier 2" },
    { min_net: 1300000, total_salary: 300000, label: "Palier 3 (Max)" },
  ],
};
export type PilotageParams = typeof DEFAULT_PARAMS;

// ── TYPES ─────────────────────────────────────────────
export interface ExpenseBreakdown { category: string; amount: number; pct: number; }

export interface MonthlyPnL {
  month: string; label: string; revenue: number;
  expensesByCategory: ExpenseBreakdown[]; totalExpenses: number;
  salaries: number; maintenance: number; ebitda: number; margin: number;
  workingDays: number; dailyAvg: number; isProjection?: boolean;
}

export interface DriverPilotage {
  driverId: string; name: string; mtdNet: number; mtdDays: number;
  dailyAvg: number; neededDailyAvg: number; projectedMonthNet: number;
  projectedSalary: number; projectedTier: string; currentTier: string;
  paceAlert: boolean; daysElapsed: number; daysRemaining: number; daysInMonth: number;
  progressToCurrentTierMax: number;
  distanceToTiers: Array<{ label: string; needed: number; salary: number; reachable: boolean }>;
  prevMonthNet: number; prevDailyAvg: number;
}

export interface CashFlowMonth {
  month: string; label: string; revenue: number; fuel: number; solde: number;
  other: number; maintenance: number; salaries: number; net: number; isProjection: boolean;
}

export interface SimulationResult {
  nVehicles: number; revenue: number; expenses: number; maintenance: number;
  salaries: number; ebitda: number; marginPct: number; deltaEbitda: number;
}

export interface DailyOperational {
  date: string;
  label: string;
  weekday: string;
  weekdayNum: number; // 0=Sun…6=Sat
  net: number;
  yangoGross: number;
  courses: number;
  km: number;
  solde: number;
  fuel: number;
  avgFare: number;
}

export interface WeekdayStats {
  day: string; shortDay: string; avgNet: number; avgCourses: number;
  avgKm: number; avgFare: number; count: number;
}

export interface PilotageData {
  historicalPnL: MonthlyPnL[];
  currentProjection: MonthlyPnL | null;
  quarterProjection: { revenue: number; ebitda: number; marginPct: number };
  yearProjection: { revenue: number; ebitda: number; marginPct: number };
  drivers: DriverPilotage[];
  cashFlow: CashFlowMonth[];
  vehicleSimulations: SimulationResult[];
  globalExpBreakdown: ExpenseBreakdown[];
  avgDailyMetrics: {
    revenue: number; fuel: number; solde: number; net: number;
    fuelPricePerLiter: number; totalLiters: number; fuelRawDailyAvg: number;
    fuelNbDeclarations: number; fuelTotalDeclared: number; fuelActiveDays: number;
    avgCourses: number; avgKm: number; avgFare: number;
  };
  dailyOps: DailyOperational[];
  weekdayStats: WeekdayStats[];
  insights: Array<{ type: "warning" | "opportunity" | "tip"; title: string; body: string; value?: string }>;
  params: PilotageParams;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  refresh: () => void;
}

interface RawData {
  reports: any[]; expenses: any[]; payments: any[]; profiles: any[];
}

const WEEKDAYS = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const WEEKDAYS_FULL = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

// ── HELPERS ───────────────────────────────────────────
const ml = (m: string) => {
  const [y, mo] = m.split("-");
  return ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"][parseInt(mo)-1] + " " + y;
};
const dim = (y: number, m: number) => new Date(y, m, 0).getDate();
const tier = (net: number, rules: PilotageParams["salaryRules"]) =>
  [...rules].sort((a, b) => b.min_net - a.min_net).find((r) => net >= r.min_net) ?? rules[0];
export const xofFmt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

// ── COMPUTE (pure, no DB) ─────────────────────────────
function computeFromRaw(raw: RawData, params: PilotageParams): Omit<PilotageData, "loading" | "fetching" | "error" | "refresh"> {
  // Exclure les jours de repos des calculs financiers
  const { expenses, payments, profiles } = raw;
  const reports = raw.reports.filter((r: any) => !String(r.comment || "").startsWith("[REPOS]"));
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const sixAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().split("T")[0];
  const nVehicles = Math.max(profiles.length, 1);

  const getED = (e: any) => e.expense_date || e.created_at?.slice(0, 10) || "";
  const getSM = (p: any) => p.salary_month?.slice(0, 7) || p.payment_date?.slice(0, 7) || "";

  // ── EXPENSE BREAKDOWN ─────────────────────────────
  const breakdownForPeriod = (start: string, end: string): ExpenseBreakdown[] => {
    const pe = expenses.filter((e) => { const d = getED(e); return d >= start && d <= end; });
    const total = pe.reduce((s, e) => s + (e.amount || 0), 0);
    const catMap = new Map<string, number>();
    pe.forEach((e) => catMap.set(e.category || "Autre", (catMap.get(e.category || "Autre") || 0) + (e.amount || 0)));
    return Array.from(catMap.entries())
      .map(([category, amount]) => ({ category, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  };

  // ── MONTHLY P&L ───────────────────────────────────
  const curMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const historicalPnL: MonthlyPnL[] = months.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    const start = `${m}-01`, end = `${m}-${String(dim(y, mo)).padStart(2, "0")}`;
    const mr = reports.filter((r) => r.date >= start && r.date <= end);
    const revenue = mr.reduce((s, r) => s + (r.net_after_expenses || 0), 0);
    const eb = breakdownForPeriod(start, end);
    const totalExp = eb.reduce((s, e) => s + e.amount, 0);
    const salaries = payments.filter((p) => getSM(p) === m).reduce((s, p) => s + (p.amount || 0), 0);
    const maintenance = params.maintenanceCostPerMonth * nVehicles;
    const ebitda = revenue - totalExp - salaries - maintenance;
    const rDays = new Set(mr.map((r) => r.date)).size || 1;
    return { month: m, label: ml(m), revenue, expensesByCategory: eb, totalExpenses: totalExp, salaries, maintenance, ebitda, margin: revenue > 0 ? (ebitda / revenue) * 100 : 0, workingDays: rDays, dailyAvg: revenue / rDays, isProjection: false };
  });

  // ── CURRENT MONTH PROJECTION ──────────────────────
  const curPnL = historicalPnL.find((p) => p.month === curMonthStr) ?? historicalPnL[historicalPnL.length - 1];
  const daysTotal = dim(today.getFullYear(), today.getMonth() + 1);
  // Jours ouvrés : 26 pour mois de 30j, 27 pour mois de 31j (configurable via params)
  const autoWorkingDays = daysTotal <= 28 ? 24 : daysTotal <= 30 ? 26 : 27;
  const workingDaysTotal = params.workingDaysPerMonth > 0 ? params.workingDaysPerMonth : autoWorkingDays;
  // Jours ouvrés déjà réalisés = jours avec au moins un rapport
  const mtdWorkingDays = curPnL.workingDays || 1;
  const workingDaysRemaining = Math.max(0, workingDaysTotal - mtdWorkingDays);
  // CA projeté = réalisé MTD + moy journalière × jours ouvrés restants
  const dailyAvgCur = curPnL.revenue / mtdWorkingDays;
  const projRevenue = curPnL.revenue + dailyAvgCur * workingDaysRemaining;

  const past = historicalPnL.filter((p) => p.month !== curMonthStr && p.revenue > 0);
  const avgExpRatio = past.length > 0 ? past.reduce((s, p) => s + p.totalExpenses / p.revenue, 0) / past.length : 0.2;

  // Fuel
  const fuelExps = expenses.filter((e) => e.category === "Carburant");
  const totalFuelCostHist = fuelExps.reduce((s, e) => s + (e.amount || 0), 0);
  const activeDaysAll = new Set(reports.map((r) => r.date)).size || 1;
  const avgDailyFuelCost = totalFuelCostHist / activeDaysAll;
  let totalLiters = 0;
  fuelExps.forEach((e) => {
    const match = (e.description || "").match(/(\d+\.?\d*)L/i);
    if (match) totalLiters += parseFloat(match[1]);
  });
  const avgPricePerLiter = totalLiters > 0 ? totalFuelCostHist / totalLiters : 0;

  // Solde
  const soldeExps = expenses.filter((e) => e.category === "Solde Yango");
  const totalSoldeCostHist = soldeExps.reduce((s, e) => s + (e.amount || 0), 0);
  const avgDailySoldeCost = totalSoldeCostHist / activeDaysAll;

  const effectiveFuelPerDay = params.fuelDailyOverride > 0 ? params.fuelDailyOverride : avgDailyFuelCost;
  const effectiveSoldePerDay = params.soldeDailyOverride > 0 ? params.soldeDailyOverride : avgDailySoldeCost;

  // Projected salary
  const projNetPerDriver = profiles.length > 0 ? projRevenue / profiles.length : projRevenue;
  const projectedTotalSalary = tier(projNetPerDriver, params.salaryRules).total_salary * profiles.length;
  const projMaintenance = params.maintenanceCostPerMonth * nVehicles;

  // Projection dépenses : taux journalier MTD × jours ouvrés restants (pas de scaling proportionnel)
  // Fuel et solde utilisent l'override ou la moyenne réelle par jour ouvré
  const mtdFuelActual = curPnL.expensesByCategory.find((e) => e.category === "Carburant")?.amount || 0;
  const mtdSoldeActual = curPnL.expensesByCategory.find((e) => e.category === "Solde Yango")?.amount || 0;
  const projFuelTotal = mtdFuelActual + effectiveFuelPerDay * workingDaysRemaining;
  const projSoldeTotal = mtdSoldeActual + effectiveSoldePerDay * workingDaysRemaining;
  // Autres dépenses : taux journalier MTD × jours ouvrés restants
  const projExpByCategory = curPnL.expensesByCategory.map((e) => {
    if (e.category === "Carburant") return { ...e, amount: projFuelTotal };
    if (e.category === "Solde Yango") return { ...e, amount: projSoldeTotal };
    const dailyRate = e.amount / mtdWorkingDays;
    return { ...e, amount: e.amount + dailyRate * workingDaysRemaining };
  });
  // Si pas encore de données carburant/solde ce mois, ajouter la projection complète
  if (!curPnL.expensesByCategory.find((e) => e.category === "Carburant") && effectiveFuelPerDay > 0)
    projExpByCategory.push({ category: "Carburant", amount: effectiveFuelPerDay * workingDaysTotal, pct: 0 });
  if (!curPnL.expensesByCategory.find((e) => e.category === "Solde Yango") && effectiveSoldePerDay > 0)
    projExpByCategory.push({ category: "Solde Yango", amount: effectiveSoldePerDay * workingDaysTotal, pct: 0 });
  const projTotalExp = projExpByCategory.reduce((s, e) => s + e.amount, 0);
  const projEbitda = projRevenue - projTotalExp - projectedTotalSalary - projMaintenance;

  const currentProjection: MonthlyPnL = {
    month: curMonthStr, label: ml(curMonthStr) + " ★ proj.",
    revenue: projRevenue, expensesByCategory: projExpByCategory,
    totalExpenses: projTotalExp, salaries: projectedTotalSalary,
    maintenance: projMaintenance, ebitda: projEbitda,
    margin: projRevenue > 0 ? (projEbitda / projRevenue) * 100 : 0,
    workingDays: workingDaysTotal, dailyAvg: dailyAvgCur, isProjection: true,
  };

  // ── QUARTER & YEAR ────────────────────────────────
  // Projection mois futur = moy journalière actuelle × jours ouvrés + charges/salaires projetés
  const avgMonthRev = past.length > 0 ? past.reduce((s, p) => s + p.revenue, 0) / past.length : projRevenue;
  // Mois normalisé basé sur le rythme actuel (dailyAvgCur × workingDaysTotal)
  const futureMonthRev = dailyAvgCur * workingDaysTotal;
  const futureMonthExpPerDay = projTotalExp / (workingDaysTotal || 1);
  const futureMonthExp = futureMonthExpPerDay * workingDaysTotal;
  const futureMonthSalary = tier(futureMonthRev / nVehicles, params.salaryRules).total_salary * nVehicles;
  const futureMonthEbitda = futureMonthRev - futureMonthExp - futureMonthSalary - projMaintenance;
  const quarterRevenue = projRevenue + futureMonthRev * 2;
  const quarterEbitda = projEbitda + futureMonthEbitda * 2;
  const yearRevenue = projRevenue + futureMonthRev * 11;
  const yearEbitda = projEbitda + futureMonthEbitda * 11;
  const quarterProjection = { revenue: quarterRevenue, ebitda: quarterEbitda, marginPct: quarterRevenue > 0 ? (quarterEbitda / quarterRevenue) * 100 : 0 };
  const yearProjection = { revenue: yearRevenue, ebitda: yearEbitda, marginPct: yearRevenue > 0 ? (yearEbitda / yearRevenue) * 100 : 0 };

  // ── GLOBAL EXPENSE BREAKDOWN ──────────────────────
  const globalExpBreakdown = breakdownForPeriod(sixAgo, todayStr);

  // ── DAILY OPERATIONAL ─────────────────────────────
  // Build a map: date → fuel expense, solde expense
  const expByDate = new Map<string, { fuel: number; solde: number }>();
  expenses.forEach((e) => {
    const d = getED(e);
    if (!d) return;
    const cur = expByDate.get(d) || { fuel: 0, solde: 0 };
    if (e.category === "Carburant") cur.fuel += e.amount || 0;
    if (e.category === "Solde Yango") cur.solde += e.amount || 0;
    expByDate.set(d, cur);
  });

  // ── KM PAR RAPPORT (odomètre) ─────────────────────
  // Pré-calcul km par rapport : start_odometer - end_odometer si dispo,
  // sinon diff end_odometer J vs J-1 par conducteur
  const reportsByDriver = new Map<string, any[]>();
  reports.forEach((r) => {
    if (!reportsByDriver.has(r.driver_id)) reportsByDriver.set(r.driver_id, []);
    reportsByDriver.get(r.driver_id)!.push(r);
  });
  reportsByDriver.forEach((reps) => reps.sort((a: any, b: any) => a.date.localeCompare(b.date)));
  const reportKm = new Map<string, number>(); // key: date_driverId
  reportsByDriver.forEach((reps) => {
    reps.forEach((r: any, i: number) => {
      let km = 0;
      const endOdo = r.end_odometer || 0;
      const startOdo = r.start_odometer || 0;
      if (startOdo > 0 && endOdo > startOdo) {
        km = endOdo - startOdo;
      } else if (i > 0) {
        const prev = reps[i - 1];
        const prevEnd = prev.end_odometer || 0;
        if (prevEnd > 0 && endOdo > prevEnd && endOdo - prevEnd < 600) km = endOdo - prevEnd; // max 600km/j
      }
      if (km > 0) reportKm.set(`${r.date}_${r.driver_id}`, km);
    });
  });

  // Build daily ops from reports (last 90 days)
  const ninetyAgo = new Date(today.getFullYear(), today.getMonth() - 2, 1).toISOString().split("T")[0];
  const recentReports = reports.filter((r) => r.date >= ninetyAgo);

  // Group by date (sum if multiple drivers)
  const dateMap = new Map<string, { net: number; yangoGross: number; courses: number; km: number; solde: number }>();
  recentReports.forEach((r) => {
    const cur = dateMap.get(r.date) || { net: 0, yangoGross: 0, courses: 0, km: 0, solde: 0 };
    cur.net += r.net_after_expenses || 0;
    cur.yangoGross += r.yango_gross || 0;
    cur.courses += (r.yango_trip_count || 0) + (r.off_yango_trip_count || 0);
    cur.km += reportKm.get(`${r.date}_${r.driver_id}`) || 0;
    cur.solde += r.solde_yango || 0;
    dateMap.set(r.date, cur);
  });

  const dailyOps: DailyOperational[] = Array.from(dateMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => {
      const dt = new Date(date + "T12:00:00");
      const wdNum = dt.getDay();
      const expD = expByDate.get(date) || { fuel: 0, solde: 0 };
      // Use expense-based solde if report solde is 0
      const solde = d.solde > 0 ? d.solde : expD.solde;
      const fuel = expD.fuel;
      return {
        date, label: date.slice(5), weekday: WEEKDAYS[wdNum], weekdayNum: wdNum,
        net: d.net, yangoGross: d.yangoGross,
        courses: d.courses, km: d.km, solde, fuel,
        avgFare: d.courses > 0 ? d.yangoGross / d.courses : 0,
      };
    });

  // ── WEEKDAY STATS ─────────────────────────────────
  const wdMap = new Map<number, { net: number; courses: number; km: number; fare: number; fareCount: number; count: number }>();
  dailyOps.forEach((d) => {
    const cur = wdMap.get(d.weekdayNum) || { net: 0, courses: 0, km: 0, fare: 0, fareCount: 0, count: 0 };
    cur.net += d.net;
    cur.courses += d.courses;
    cur.km += d.km;
    if (d.avgFare > 0) { cur.fare += d.avgFare; cur.fareCount++; }
    cur.count++;
    wdMap.set(d.weekdayNum, cur);
  });

  const weekdayStats: WeekdayStats[] = [1, 2, 3, 4, 5, 6, 0].map((wdNum) => {
    const s = wdMap.get(wdNum);
    if (!s || s.count === 0) return { day: WEEKDAYS_FULL[wdNum], shortDay: WEEKDAYS[wdNum], avgNet: 0, avgCourses: 0, avgKm: 0, avgFare: 0, count: 0 };
    return { day: WEEKDAYS_FULL[wdNum], shortDay: WEEKDAYS[wdNum], avgNet: s.net / s.count, avgCourses: s.courses / s.count, avgKm: s.km / s.count, avgFare: s.fareCount > 0 ? s.fare / s.fareCount : 0, count: s.count };
  });

  // ── AVG DAILY METRICS ─────────────────────────────
  const totalRev = reports.reduce((s, r) => s + (r.net_after_expenses || 0), 0);
  const rDays = activeDaysAll;
  const totalFuel = totalFuelCostHist;
  const totalSolde = totalSoldeCostHist;
  const totalExpAll = expenses.reduce((s, e) => s + e.amount, 0);
  const totalCourses = reports.reduce((s, r) => s + (r.yango_trip_count || 0) + (r.off_yango_trip_count || 0), 0);
  const totalKm = Array.from(reportKm.values()).reduce((s, v) => s + v, 0);
  const totalYangoGross = reports.reduce((s, r) => s + (r.yango_gross || 0), 0);

  const avgDailyMetrics = {
    revenue: totalRev / rDays, fuel: effectiveFuelPerDay, solde: effectiveSoldePerDay,
    net: (totalRev - totalExpAll) / rDays,
    fuelPricePerLiter: avgPricePerLiter, totalLiters,
    fuelRawDailyAvg: avgDailyFuelCost, fuelNbDeclarations: fuelExps.length,
    fuelTotalDeclared: totalFuelCostHist, fuelActiveDays: activeDaysAll,
    avgCourses: rDays > 0 ? totalCourses / rDays : 0,
    avgKm: rDays > 0 ? totalKm / rDays : 0,
    avgFare: totalCourses > 0 ? totalYangoGross / totalCourses : 0,
  };

  // ── DRIVER PILOTAGE ───────────────────────────────
  const curStart = `${curMonthStr}-01`;
  const drivers: DriverPilotage[] = profiles.map((prof) => {
    const dr = reports.filter((r) => r.driver_id === prof.id && r.date >= curStart && r.date <= todayStr);
    const mtdNet = dr.reduce((s, r) => s + (r.net_after_expenses || 0), 0);
    const mtdDays = new Set(dr.map((r) => r.date)).size || 1;
    const dailyAvg = mtdNet / mtdDays;
    const driverWorkDaysRemaining = Math.max(0, workingDaysTotal - mtdDays);
    const needed = (params.targetMonthlyNet - mtdNet) / Math.max(driverWorkDaysRemaining, 1);
    const projNet = mtdNet + dailyAvg * driverWorkDaysRemaining;
    const projTier = tier(projNet, params.salaryRules);
    const curTier = tier(mtdNet, params.salaryRules);
    const sorted = [...params.salaryRules].sort((a, b) => a.min_net - b.min_net);
    const nextT = sorted.find((r) => r.min_net > mtdNet);
    const progress = nextT ? Math.min(100, ((mtdNet - curTier.min_net) / (nextT.min_net - curTier.min_net)) * 100) : 100;
    const prevD = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevM = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
    const prevReps = reports.filter((r) => r.driver_id === prof.id && r.date.startsWith(prevM));
    const prevNet = prevReps.reduce((s, r) => s + (r.net_after_expenses || 0), 0);
    const prevDays = new Set(prevReps.map((r) => r.date)).size || 1;
    const distanceToTiers = sorted.map((r) => ({ label: r.label, needed: Math.max(0, r.min_net - projNet), salary: r.total_salary, reachable: r.min_net <= projNet + dailyAvg * driverWorkDaysRemaining * 1.2 }));
    const daysElapsed = today.getDate();
    return { driverId: prof.driver_id, name: prof.full_name, mtdNet, mtdDays, dailyAvg, neededDailyAvg: Math.max(0, needed), projectedMonthNet: projNet, projectedSalary: projTier.total_salary, projectedTier: projTier.label, currentTier: curTier.label, paceAlert: dailyAvg < needed * 0.85, daysElapsed, daysRemaining: driverWorkDaysRemaining, daysInMonth: workingDaysTotal, progressToCurrentTierMax: progress, distanceToTiers, prevMonthNet: prevNet, prevDailyAvg: prevNet / prevDays };
  });

  // ── CASH FLOW ─────────────────────────────────────
  const cashFlow: CashFlowMonth[] = [0, 1, 2].map((offset) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const isProj = offset > 0;
    const rev = offset === 0 ? projRevenue : futureMonthRev;
    const mCalDays = dim(d.getFullYear(), d.getMonth() + 1);
    const mWorkDays = mCalDays <= 28 ? 24 : mCalDays <= 30 ? 26 : 27;
    const projDays = offset === 0 ? workingDaysTotal : (params.workingDaysPerMonth > 0 ? params.workingDaysPerMonth : mWorkDays);
    const fuel = effectiveFuelPerDay > 0 ? effectiveFuelPerDay * projDays : rev * (params.fuelPctOfRevenue / 100);
    const solde = effectiveSoldePerDay > 0 ? effectiveSoldePerDay * projDays : rev * (params.soldePctOfRevenue / 100);
    const other = Math.max(0, rev * avgExpRatio - fuel - solde);
    const maint = params.maintenanceCostPerMonth * nVehicles;
    const sal = tier(rev / nVehicles, params.salaryRules).total_salary * nVehicles;
    return { month: m, label: ml(m), revenue: rev, fuel, solde, other, maintenance: maint, salaries: sal, net: rev - fuel - solde - other - maint - sal, isProjection: isProj };
  });

  // ── VEHICLE SIMULATION ────────────────────────────
  const revPerVehicle = nVehicles > 0 ? avgMonthRev / nVehicles : avgMonthRev;
  const expPerVehicle = revPerVehicle * avgExpRatio;
  const vehicleSimulations: SimulationResult[] = [0, 1, 2, 3].map((extra) => {
    const n = nVehicles + extra;
    const rev = revPerVehicle * n;
    const exp = expPerVehicle * n;
    const maint = params.maintenanceCostPerMonth * n;
    const sal = tier(rev / n, params.salaryRules).total_salary * n;
    const ebitda = rev - exp - maint - sal;
    const base = revPerVehicle * nVehicles - expPerVehicle * nVehicles - params.maintenanceCostPerMonth * nVehicles - tier(revPerVehicle, params.salaryRules).total_salary * nVehicles;
    return { nVehicles: n, revenue: rev, expenses: exp, maintenance: maint, salaries: sal, ebitda, marginPct: rev > 0 ? (ebitda / rev) * 100 : 0, deltaEbitda: extra === 0 ? 0 : ebitda - base };
  });

  // ── INSIGHTS ──────────────────────────────────────
  const insights: PilotageData["insights"] = [];
  if (past.length >= 2) {
    const l = past[past.length - 1], p2 = past[past.length - 2];
    if (l.margin < p2.margin - 3) insights.push({ type: "warning", title: "Marge en baisse", body: `Marge ${ml(l.month)}: ${l.margin.toFixed(1)}% vs ${ml(p2.month)}: ${p2.margin.toFixed(1)}%.`, value: `${(l.margin - p2.margin).toFixed(1)}%` });
  }
  const totalRevAll = reports.reduce((s, r) => s + (r.net_after_expenses || 0), 0);
  const fuelPct = totalRevAll > 0 ? (totalFuel / totalRevAll) * 100 : 0;
  if (fuelPct > params.fuelPctOfRevenue * 1.15) insights.push({ type: "warning", title: "Carburant au-dessus du budget", body: `Carburant représente ${fuelPct.toFixed(1)}% du CA (budget: ${params.fuelPctOfRevenue}%).`, value: `${fuelPct.toFixed(1)}%` });
  drivers.filter((d) => d.paceAlert).forEach((d) => insights.push({ type: "warning", title: `${d.name} — Rythme faible`, body: `Moy: ${xofFmt(d.dailyAvg)} XOF/j. Besoin: ${xofFmt(d.neededDailyAvg)} XOF/j.`, value: `${xofFmt(d.projectedMonthNet)} XOF` }));
  if (vehicleSimulations.length > 1) insights.push({ type: "opportunity", title: "Simulation +1 véhicule", body: `+${xofFmt(vehicleSimulations[1].deltaEbitda)} XOF d'EBITDA/mois.`, value: `+${xofFmt(vehicleSimulations[1].deltaEbitda)} XOF` });
  const bestWd = [...weekdayStats].sort((a, b) => b.avgNet - a.avgNet)[0];
  if (bestWd && bestWd.count >= 2) insights.push({ type: "tip", title: `${bestWd.day} = meilleur jour`, body: `Moyenne de ${xofFmt(bestWd.avgNet)} XOF sur ${bestWd.count} ${bestWd.day.toLowerCase()}s — priorisez ce jour.`, value: xofFmt(bestWd.avgNet) });
  insights.push({ type: "tip", title: "Maintenance planifiée", body: `Provision de ${xofFmt(params.maintenanceCostPerMonth)}/véhicule/mois intégrée dans les projections.` });

  return { historicalPnL, currentProjection, quarterProjection, yearProjection, drivers, cashFlow, vehicleSimulations, globalExpBreakdown, avgDailyMetrics, dailyOps, weekdayStats, insights, params };
}

// ── MAIN HOOK ─────────────────────────────────────────
export function usePilotage(params: PilotageParams = DEFAULT_PARAMS, tenantId?: string | null, driverId?: string | null) {
  const [raw, setRaw] = useState<RawData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [computed, setComputed] = useState<Omit<PilotageData, "loading" | "fetching" | "error" | "refresh"> | null>(null);

  const fetchRaw = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      // Resolve tenantId via browser client if not passed
      let tid = tenantId || null;
      if (!tid) {
        const supabase = createClient() as any;
        const { data: { user } } = await supabase.auth.getUser();
        const { data: myProfile } = await supabase.from("profiles").select("tenant_id").eq("id", user?.id).maybeSingle();
        tid = myProfile?.tenant_id || null;
      }
      if (!tid) { setError("Tenant introuvable"); setFetching(false); return; }

      // Fetch via server-side API route (service role — bypasses RLS)
      const params_url = new URLSearchParams({ tenantId: tid, ...(driverId ? { driverId } : {}) });
      const res = await fetch(`/api/admin/pilotage-data?${params_url}`);
      if (!res.ok) throw new Error((await res.json()).error || "Erreur API");
      const json = await res.json();
      setRaw({ reports: json.reports || [], expenses: json.expenses || [], payments: json.payments || [], profiles: json.profiles || [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { fetchRaw(); }, [fetchRaw, tenantId, driverId]);

  // Recompute synchronously when raw data or params change (no DB call)
  useEffect(() => {
    if (!raw) return;
    try {
      const result = computeFromRaw(raw, params);
      setComputed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de calcul");
    }
  }, [raw, params]);

  const refresh = useCallback(() => { fetchRaw(); }, [fetchRaw]);

  const loading = fetching && !computed;

  return {
    ...(computed ?? {
      historicalPnL: [], currentProjection: null,
      quarterProjection: { revenue: 0, ebitda: 0, marginPct: 0 },
      yearProjection: { revenue: 0, ebitda: 0, marginPct: 0 },
      drivers: [], cashFlow: [], vehicleSimulations: [],
      globalExpBreakdown: [], avgDailyMetrics: { revenue: 0, fuel: 0, solde: 0, net: 0, fuelPricePerLiter: 0, totalLiters: 0, fuelRawDailyAvg: 0, fuelNbDeclarations: 0, fuelTotalDeclared: 0, fuelActiveDays: 0, avgCourses: 0, avgKm: 0, avgFare: 0 },
      dailyOps: [], weekdayStats: [], insights: [], params,
    }),
    loading, fetching, error, refresh,
  } as PilotageData;
}
