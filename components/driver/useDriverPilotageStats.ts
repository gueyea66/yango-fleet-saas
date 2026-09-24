// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// logique partagée par l'UI actuelle et l'UI v2 — mêmes requêtes, mêmes
// écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_CFG, type Cfg, type Profile } from "./shared";

export function useDriverPilotageStats(profile: Profile, cfg: Cfg) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Derive RULES and TARGET from cfg — no hardcoding
  const RULES = cfg.salary_tiers.length > 0 ? cfg.salary_tiers : DEFAULT_CFG.salary_tiers;
  const TARGET = cfg.target_net > 0 ? cfg.target_net : (RULES[RULES.length - 1]?.min_net ?? 1300000);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const curMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      const start = `${curMonth}-01`;
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const daysElapsed = today.getDate();
      const daysRemaining = daysInMonth - daysElapsed;

      // Fetch MTD reports with all fields needed for accurate projections
      const [{ data: reps }, { data: fuelExps }] = await Promise.all([
        supabase.from("daily_reports")
          .select("date,net_after_expenses,yango_gross,yango_bonus,off_yango_revenue,solde_yango,end_odometer,commission_amount,service_supplementaire")
          .eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
          .gte("date", start).lte("date", todayStr).neq("status", "rejected")
          .order("date", { ascending: true }),
        supabase.from("expenses")
          .select("amount,fuel_liters,description,expense_date")
          .eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
          .eq("category", "Carburant").eq("status", "approved")
          .gte("expense_date", start),
      ]);

      const sortedReps = (reps || []).filter((r: any) => r.end_odometer > 0 || r.solde_yango != null);
      const mtdDays = new Set((reps || []).map((r: any) => r.date)).size || 1;

      // ── Revenue per working day (unaffected by lump expenses) ──
      const grossPerDay = (reps || []).map((r: any) =>
        (r.yango_gross || 0) + (r.yango_bonus || 0) + (r.off_yango_revenue || 0)
      );
      const avgDailyGross = grossPerDay.length > 0
        ? grossPerDay.reduce((s: number, v: number) => s + v, 0) / grossPerDay.length
        : 0;

      // ── Km/day from odometer deltas ──
      const kmDeltas: number[] = [];
      for (let i = 1; i < sortedReps.length; i++) {
        const prev = sortedReps[i - 1].end_odometer;
        const curr = sortedReps[i].end_odometer;
        if (prev > 0 && curr > 0 && curr > prev) {
          const delta = curr - prev;
          if (delta > 0 && delta < 800) kmDeltas.push(delta); // sanity: <800km/day
        }
      }
      const avgKmPerDay = kmDeltas.length > 0
        ? kmDeltas.reduce((s, v) => s + v, 0) / kmDeltas.length
        : null;

      // ── Solde consommé (« burnt ») par jour = commissions réellement déclarées :
      // commission Yango + partenaire (= commission_amount) + frais supplémentaires.
      // Aligné sur le « solde consommé » du dashboard admin (mesure la plus juste,
      // remplace l'ancien delta de wallet solde_yango).
      const dailyBurns = (reps || [])
        .map((r: any) => (r.commission_amount || 0) + (r.service_supplementaire || 0))
        .filter((b: number) => b > 0);
      const avgDailyWalletBurn = dailyBurns.length > 0
        ? dailyBurns.reduce((s: number, v: number) => s + v, 0) / dailyBurns.length
        : null;

      // ── Price per liter from approved fuel declarations ──
      // Prefer dedicated column, fallback to parsing description ("12L")
      let totalFuelAmount = 0, totalFuelLiters = 0;
      for (const e of (fuelExps || [])) {
        let liters = e.fuel_liters;
        if (!liters && e.description) {
          const m = String(e.description).match(/(\d+(?:\.\d+)?)\s*[Ll]/);
          if (m) liters = parseFloat(m[1]);
        }
        if (liters && liters > 0 && e.amount > 0) {
          totalFuelAmount += e.amount;
          totalFuelLiters += liters;
        }
      }
      const avgPricePerLiter = totalFuelLiters > 0 ? totalFuelAmount / totalFuelLiters : null;
      const avgFuelCostPerKm = (avgPricePerLiter && avgKmPerDay && totalFuelLiters > 0)
        ? totalFuelAmount / (kmDeltas.reduce((s, v) => s + v, 0) || avgKmPerDay)
        : null;

      // ── Projected daily net ──
      // Revenue: smoothed daily gross average
      // Expenses: wallet burn (real consumption) if available, else fallback to net_after_expenses diff
      const projDailyNet = avgDailyGross - (avgDailyWalletBurn ?? 0);

      // MTD net = sum of approved net_after_expenses (actual realized)
      const mtdNet = (reps || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0);

      // Projection from today forward uses smoothed daily net
      const projectedNet = mtdNet + projDailyNet * daysRemaining;
      const dailyAvg = mtdNet / mtdDays; // realized avg (for display)
      const needed = (TARGET - mtdNet) / Math.max(daysRemaining, 1);

      const tier = [...RULES].sort((a, b) => b.min_net - a.min_net).find((r) => projectedNet >= r.min_net) ?? RULES[0];
      const curTier = [...RULES].sort((a, b) => b.min_net - a.min_net).find((r) => mtdNet >= r.min_net) ?? RULES[0];
      const nextTier = [...RULES].sort((a, b) => a.min_net - b.min_net).find((r) => r.min_net > mtdNet);
      const progress = nextTier ? Math.min(100, ((mtdNet - curTier.min_net) / (nextTier.min_net - curTier.min_net)) * 100) : 100;

      // Last month for comparison
      const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevStart = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-01`;
      const prevEnd = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-${new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate()}`;
      const { data: prevReps } = await supabase.from("daily_reports").select("net_after_expenses,date")
        .eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
        .gte("date", prevStart).lte("date", prevEnd).neq("status", "rejected");
      const prevNet = (prevReps || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0);
      const prevDays = new Set((prevReps || []).map((r: any) => r.date)).size || 1;
      const prevDailyAvg = prevNet / prevDays;

      // Location model: net après loyer
      const rentDue = cfg.model === "location" ? cfg.daily_rent * daysElapsed : 0;
      const netAfterRent = cfg.model === "location" ? Math.max(0, mtdNet - rentDue) : 0;
      const rentProjected = cfg.model === "location" ? cfg.daily_rent * daysInMonth : 0;

      setStats({
        mtdNet, mtdDays, dailyAvg, projDailyNet, projectedNet, needed,
        tier, curTier, nextTier, progress, daysElapsed, daysRemaining, daysInMonth,
        prevNet, prevDailyAvg, rentDue, netAfterRent, rentProjected,
        // Consommation metrics
        avgKmPerDay, avgDailyWalletBurn, avgPricePerLiter, avgFuelCostPerKm,
        avgDailyGross, fuelDataPoints: totalFuelLiters > 0 ? (fuelExps || []).length : 0,
        kmDataPoints: kmDeltas.length,
      });
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, cfg.model, cfg.daily_rent, cfg.target_net]);

  return { stats, loading, RULES, TARGET };
}
