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
    const driverId = searchParams.get("driverId") || null; // optional filter

    if (!tenantId) return Response.json({ error: "tenantId requis" }, { status: 400 });

    const today = new Date();
    const sixAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().split("T")[0];

    const tQ = (q: any) => q.eq("tenant_id", tenantId);
    const dQ = (q: any) => driverId ? q.eq("driver_id", driverId) : q;
    const srcQ = (q: any) => q.or("source.eq.saas,source.is.null");

    const [{ data: reps }, { data: exps }, { data: pays }, { data: profs }, { data: vehs }] = await Promise.all([
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", sixAgo).neq("status", "rejected").order("date"),
      srcQ(dQ(tQ(admin.from("expenses").select("*")))),
      dQ(tQ(admin.from("payments").select("*"))),
      tQ(admin.from("profiles").select("id,full_name,driver_id").eq("role", "driver")),
      tQ(admin.from("vehicles").select("id,plate,driver_id")),
    ]);

    return Response.json({
      reports: reps || [],
      expenses: exps || [],
      payments: pays || [],
      profiles: profs || [],
      vehicles: vehs || [],
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
