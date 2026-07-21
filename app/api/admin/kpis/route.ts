import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driverId") || null;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const tQ = (q: any) => q.eq("tenant_id", tenantId);
    const dQ = (q: any) => driverId ? q.eq("driver_id", driverId) : q;
    const srcQ = (q: any) => q.or("source.eq.saas,source.is.null");

    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const periodStart = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const periodEnd = dateTo || today;

    // Période précédente de même durée, juste avant (pour l'évolution vs N-1)
    const msDay = 86400000;
    const lenDays = Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / msDay) + 1;
    const prevEnd = new Date(Date.parse(periodStart) - msDay).toISOString().split("T")[0];
    const prevStart = new Date(Date.parse(periodStart) - lenDays * msDay).toISOString().split("T")[0];

    const [
      { data: allReps },
      { data: allExps },
      { data: allPayments },
      { data: todayRep },
      { data: weekRep },
      { data: driverProfiles },
      { data: prevReps },
    ] = await Promise.all([
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", periodStart).lte("date", periodEnd).order("date"),
      srcQ(dQ(tQ(admin.from("expenses").select("*")))),
      dQ(tQ(admin.from("payments").select("*"))),
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).eq("date", today),
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", weekAgo).lte("date", today),
      admin.from("profiles").select("*").eq("tenant_id", tenantId).eq("role", "driver"),
      srcQ(dQ(tQ(admin.from("daily_reports").select("date,status,yango_gross,yango_bonus,off_yango_revenue,net_after_expenses,driver_id")))).gte("date", prevStart).lte("date", prevEnd),
    ]);

    // ── Évolution vs période précédente (Net final & Total recettes) ──
    const technicalIds = new Set((driverProfiles || []).filter((d: any) => d.account_type === "technical").map((d: any) => d.id));
    const salaryDate = (p: any) => (p.salary_month ? String(p.salary_month).slice(0, 10) : (p.payment_date || p.created_at?.slice(0, 10))) || "";
    const inPrev = (d: string) => d >= prevStart && d <= prevEnd;
    const prevAppr = (prevReps || []).filter((r: any) => r.status === "approved");
    const prevTotalBrut = prevAppr.reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0);
    const prevRecettes = prevAppr.reduce((s: number, r: any) => s + (r.yango_gross || 0) + (r.yango_bonus || 0) + (r.off_yango_revenue || 0), 0);
    const prevExpenses = (allExps || []).filter((e: any) => inPrev(e.expense_date || e.created_at?.slice(0, 10) || "") && (!e.status || e.status === "approved")).reduce((s: number, e: any) => s + (e.amount || 0), 0);
    const prevSalaries = (allPayments || []).filter((p: any) => inPrev(salaryDate(p)) && !technicalIds.has(p.driver_id)).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const prevNetFinal = prevTotalBrut - prevExpenses - prevSalaries;

    return Response.json({
      allReps: allReps || [],
      allExps: allExps || [],
      allPayments: allPayments || [],
      todayRep: todayRep || [],
      weekRep: weekRep || [],
      driverProfiles: driverProfiles || [],
      prev: { netFinal: prevNetFinal, totalBrut: prevTotalBrut, recettes: prevRecettes, start: prevStart, end: prevEnd },
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    return Response.json({ error: err.message }, { status });
  }
}
