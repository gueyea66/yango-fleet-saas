import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");
    const driverId = searchParams.get("driverId") || null;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    if (!tenantId) return Response.json({ error: "tenantId requis" }, { status: 400 });

    const tQ = (q: any) => q.eq("tenant_id", tenantId);
    const dQ = (q: any) => driverId ? q.eq("driver_id", driverId) : q;
    const srcQ = (q: any) => q.or("source.eq.saas,source.is.null");

    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const periodStart = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const periodEnd = dateTo || today;

    const [
      { data: allReps },
      { data: allExps },
      { data: allPayments },
      { data: todayRep },
      { data: weekRep },
      { data: driverProfiles },
    ] = await Promise.all([
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", periodStart).lte("date", periodEnd).order("date"),
      srcQ(dQ(tQ(admin.from("expenses").select("*")))),
      dQ(tQ(admin.from("payments").select("*"))),
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).eq("date", today),
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", weekAgo).lte("date", today),
      admin.from("profiles").select("id,full_name,driver_id").eq("tenant_id", tenantId).eq("role", "driver"),
    ]);

    return Response.json({
      allReps: allReps || [],
      allExps: allExps || [],
      allPayments: allPayments || [],
      todayRep: todayRep || [],
      weekRep: weekRep || [],
      driverProfiles: driverProfiles || [],
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
