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
    const dateFrom = searchParams.get("dateFrom") || null;
    const dateTo = searchParams.get("dateTo") || null;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(500, Math.max(10, parseInt(searchParams.get("pageSize") || "300")));
    const offset = (page - 1) * pageSize;

    const dQ = (q: any) => driverId ? q.eq("driver_id", driverId) : q;
    const dateQ = (q: any) => {
      if (dateFrom) q = q.gte("date", dateFrom);
      if (dateTo) q = q.lte("date", dateTo);
      return q;
    };

    const [{ data: reports, count: reportsTotal }, { data: expenses }, { data: profiles }] = await Promise.all([
      dateQ(dQ(admin.from("daily_reports").select("*", { count: "exact" }).eq("tenant_id", tenantId)))
        .order("date", { ascending: false })
        .range(offset, offset + pageSize - 1),
      dQ(admin.from("expenses").select("*").eq("tenant_id", tenantId))
        .order("expense_date", { ascending: false, nullsFirst: false })
        .limit(500),
      admin.from("profiles").select("id,full_name,driver_id").eq("tenant_id", tenantId).eq("role", "driver"),
    ]);

    const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
    const expensesWithProfile = (expenses || []).map((e: any) => ({ ...e, _profile: profileMap[e.driver_id] }));

    return Response.json({
      reports: reports || [],
      expenses: expensesWithProfile,
      pagination: { page, pageSize, total: reportsTotal ?? 0, totalPages: Math.ceil((reportsTotal ?? 0) / pageSize) },
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    return Response.json({ error: err.message }, { status });
  }
}
