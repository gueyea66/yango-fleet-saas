import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";

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
    // Mois de référence (YYYY-MM) : permet de piloter un mois ANTÉRIEUR
    // (retour Abdou 02/09) — défaut : mois courant.
    const refMonth = /^\d{4}-\d{2}$/.test(searchParams.get("refMonth") || "") ? searchParams.get("refMonth")! : null;

    const now = new Date();
    const ref = refMonth ? new Date(Number(refMonth.slice(0, 4)), Number(refMonth.slice(5, 7)) - 1, 1) : now;
    const sixAgo = new Date(ref.getFullYear(), ref.getMonth() - 5, 1).toISOString().split("T")[0];
    const refEnd = refMonth ? new Date(ref.getFullYear(), ref.getMonth() + 1, 0).toISOString().split("T")[0] : null;

    const tQ = (q: any) => q.eq("tenant_id", tenantId);
    const dQ = (q: any) => driverId ? q.eq("driver_id", driverId) : q;
    const srcQ = (q: any) => q;

    // Lectures paginées : 6 mois d'une flotte de 15 véhicules dépassent le
    // plafond PostgREST de 1000 lignes — la projection se calculait sinon sur
    // une base tronquée (cf. lib/fetchAllRows).
    const [reps, exps, pays, profs, vehs] = await Promise.all([
      fetchAllRows(() => (refEnd
        ? srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", sixAgo).lte("date", refEnd).neq("status", "rejected").order("date")
        : srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", sixAgo).neq("status", "rejected").order("date"))),
      fetchAllRows(() => srcQ(dQ(tQ(admin.from("expenses").select("*")))).order("expense_date")),
      fetchAllRows(() => dQ(tQ(admin.from("payments").select("*"))).order("payment_date")),
      tQ(admin.from("profiles").select("*").eq("role", "driver")).then((r: any) => r.data || []),
      tQ(admin.from("vehicles").select("id,plate,driver_id")).then((r: any) => r.data || []),
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
