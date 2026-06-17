import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface AnalyticsData {
  todayRevenue: number;
  todayTrips: number;
  todayExpenses: number;
  weekRevenue: number;
  monthRevenue: number;
  yearRevenue: number;
  averageDailyRevenue: number;
  activeVehicles: number;
  totalGrossCost: number;
  netProfit: number;
  loading: boolean;
  error: string | null;
}

const defaultData: AnalyticsData = {
  todayRevenue: 0,
  todayTrips: 0,
  todayExpenses: 0,
  weekRevenue: 0,
  monthRevenue: 0,
  yearRevenue: 0,
  averageDailyRevenue: 0,
  activeVehicles: 0,
  totalGrossCost: 0,
  netProfit: 0,
  loading: true,
  error: null,
};

export function useDriverAnalytics(driverId: string | undefined) {
  const [data, setData] = useState<AnalyticsData>(defaultData);

  useEffect(() => {
    if (!driverId) return;

    const loadAnalytics = async () => {
      try {
        const supabase = createClient();
        const today = new Date();
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

        const formatDate = (d: Date) => d.toISOString().split("T")[0];

        // Fetch today's reports
        const { data: todayReports } = await ((supabase
          .from("daily_reports") as any)
          .select("*")
          .eq("driver_id", driverId)
          .eq("date", formatDate(today))) as any;

        const todayTripsCount = ((todayReports || []) as any[]).reduce(
          (sum, r) => sum + (r.expense_count || 0),
          0
        );

        const todayRevenue = ((todayReports || []) as any[]).reduce(
          (sum, r) => sum + (r.net_after_expenses || 0),
          0
        );

        const todayExpenses = ((todayReports || []) as any[]).reduce(
          (sum, r) => sum + (r.expense_count || 0),
          0
        );

        // Fetch week reports
        const { data: weekReports } = await ((supabase
          .from("daily_reports") as any)
          .select("*")
          .eq("driver_id", driverId)
          .gte("date", formatDate(weekAgo))
          .lte("date", formatDate(today))) as any;

        const weekRevenue = ((weekReports || []) as any[]).reduce(
          (sum, r) => sum + (r.net_after_expenses || 0),
          0
        );

        const activeDaysThisWeek = new Set(
          ((weekReports || []) as any[]).map((r) => r.date)
        ).size;
        const averageDailyRevenue =
          activeDaysThisWeek > 0 ? weekRevenue / activeDaysThisWeek : 0;

        // Fetch month reports
        const { data: monthReports } = await ((supabase
          .from("daily_reports") as any)
          .select("*")
          .eq("driver_id", driverId)
          .gte("date", formatDate(monthAgo))
          .lte("date", formatDate(today))) as any;

        const monthRevenue = ((monthReports || []) as any[]).reduce(
          (sum, r) => sum + (r.net_after_expenses || 0),
          0
        );

        // Fetch year reports
        const { data: yearReports } = await ((supabase
          .from("daily_reports") as any)
          .select("*")
          .eq("driver_id", driverId)
          .gte("date", formatDate(yearAgo))
          .lte("date", formatDate(today))) as any;

        const yearRevenue = ((yearReports || []) as any[]).reduce(
          (sum, r) => sum + (r.net_after_expenses || 0),
          0
        );

        const yearGrossCost = ((yearReports || []) as any[]).reduce(
          (sum, r) => sum + (r.expense_count || 0),
          0
        );

        // Fetch vehicles
        const { data: vehicles } = await ((supabase
          .from("vehicles") as any)
          .select("*")
          .eq("driver_id", driverId)) as any;

        const activeVehicles = vehicles?.length || 0;

        setData({
          todayRevenue,
          todayTrips: todayTripsCount,
          todayExpenses,
          weekRevenue,
          monthRevenue,
          yearRevenue,
          averageDailyRevenue: Math.round(averageDailyRevenue),
          activeVehicles,
          totalGrossCost: yearGrossCost,
          netProfit: yearRevenue,
          loading: false,
          error: null,
        });
      } catch (err) {
        setData((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "Erreur de chargement",
        }));
      }
    };

    loadAnalytics();
  }, [driverId]);

  return data;
}
