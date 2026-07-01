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
    const type = searchParams.get("type") || null;
    const dateFrom = searchParams.get("dateFrom") || null;
    const dateTo = searchParams.get("dateTo") || null;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(500, Math.max(10, parseInt(searchParams.get("pageSize") || "200")));
    const offset = (page - 1) * pageSize;

    let q = admin.from("payments")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: false });

    if (driverId) q = q.eq("driver_id", driverId) as any;
    if (type) q = q.eq("type", type) as any;
    if (dateFrom) q = q.gte("payment_date", dateFrom) as any;
    if (dateTo) q = q.lte("payment_date", dateTo) as any;

    q = q.range(offset, offset + pageSize - 1) as any;

    const [{ data: payments, count: paymentsTotal }, { data: profiles }] = await Promise.all([
      q,
      admin.from("profiles").select("id,full_name,driver_id").eq("tenant_id", tenantId).eq("role", "driver").order("full_name"),
    ]);

    const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
    const paymentsWithProfile = (payments || []).map((p: any) => ({ ...p, profiles: profileMap[p.driver_id] || null }));

    return Response.json({
      payments: paymentsWithProfile,
      profiles: profiles || [],
      pagination: { page, pageSize, total: paymentsTotal ?? 0, totalPages: Math.ceil((paymentsTotal ?? 0) / pageSize) },
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    return Response.json({ error: err.message }, { status });
  }
}
