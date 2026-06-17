import { createClient } from "@/lib/supabase/client";
import { getTenantId } from "@/lib/supabase/tenanted";

export async function submitDailyReport(
  driverId: string,
  data: {
    date: string;
    endOdometer: number;
    yangoGross: number;
    yangoBonus: number;
    offYangoRevenue: number;
    yangoTripCount: number;
    offYangoTripCount: number;
    comment: string;
  }
) {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const totalGross = data.yangoGross + data.yangoBonus + data.offYangoRevenue;
  const commissionRate = 0.12;
  const commissionAmount = totalGross * commissionRate;
  const netAfterExpenses = totalGross - commissionAmount;

  const { data: report, error } = await supabase
    .from("daily_reports")
    .insert({
      tenant_id: tid,
      driver_id: driverId,
      date: data.date,
      end_odometer: data.endOdometer,
      gross_earnings: totalGross,
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      net_after_expenses: netAfterExpenses,
      expense_count: 0,
      status: "submitted",
      yango_gross: data.yangoGross,
      yango_bonus: data.yangoBonus,
      off_yango_revenue: data.offYangoRevenue,
      yango_trip_count: data.yangoTripCount,
      off_yango_trip_count: data.offYangoTripCount,
      comment: data.comment,
    })
    .select()
    .single();

  if (error) throw error;
  return report;
}

export async function getDailyReport(driverId: string, date: string) {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const { data, error } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("tenant_id", tid)
    .eq("driver_id", driverId)
    .eq("date", date)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getDriverReports(driverId: string, limit = 30) {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const { data, error } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("tenant_id", tid)
    .eq("driver_id", driverId)
    .order("date", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

export async function getMonthlyEarnings(driverId: string, month: string) {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const { data, error } = await supabase
    .from("daily_reports")
    .select("gross_earnings, commission_amount, net_after_expenses")
    .eq("tenant_id", tid)
    .eq("driver_id", driverId)
    .like("date", `${month}%`)
    .eq("status", "approved");

  if (error) throw error;

  const d = data as any[];
  return {
    totalGross: d?.reduce((sum: number, r: any) => sum + (r.gross_earnings || 0), 0) || 0,
    totalCommission: d?.reduce((sum: number, r: any) => sum + (r.commission_amount || 0), 0) || 0,
    totalNet: d?.reduce((sum: number, r: any) => sum + (r.net_after_expenses || 0), 0) || 0,
  };
}

export async function getPendingReports() {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const { data, error } = await supabase
    .from("daily_reports")
    .select("*, driver:driver_id(id, email, full_name)")
    .eq("tenant_id", tid)
    .eq("status", "submitted")
    .order("date", { ascending: false });

  if (error) throw error;
  return data;
}

export async function approveReport(reportId: string) {
  const supabase = createClient() as any;

  const { data, error } = await supabase
    .from("daily_reports")
    .update({ status: "approved" })
    .eq("id", reportId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function rejectReport(reportId: string, reason: string) {
  const supabase = createClient() as any;

  const { data, error } = await supabase
    .from("daily_reports")
    .update({ status: "rejected", rejection_reason: reason })
    .eq("id", reportId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
