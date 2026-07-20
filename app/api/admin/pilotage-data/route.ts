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

    const today = new Date();
    const sixAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().split("T")[0];

    const tQ = (q: any) => q.eq("tenant_id", tenantId);
    const dQ = (q: any) => driverId ? q.eq("driver_id", driverId) : q;
    const srcQ = (q: any) => q.or("source.eq.saas,source.is.null");

    const [{ data: reps }, { data: exps }, { data: pays }, { data: profs }, { data: vehs }] = await Promise.all([
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", sixAgo).neq("status", "rejected").order("date"),
      srcQ(dQ(tQ(admin.from("expenses").select("*")))),
      dQ(tQ(admin.from("payments").select("*"))),
      tQ(admin.from("profiles").select("*").eq("role", "driver")),
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
    const status = err.status ?? 500;
    return Response.json({ error: err.message }, { status });
  }
}
