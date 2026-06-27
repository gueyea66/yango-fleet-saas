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
    const type = searchParams.get("type") || null; // "acompte" pour avances

    if (!tenantId) return Response.json({ error: "tenantId requis" }, { status: 400 });

    let q = admin.from("payments").select("*").eq("tenant_id", tenantId).order("payment_date", { ascending: false }).limit(200);
    if (driverId) q = q.eq("driver_id", driverId) as any;
    if (type) q = q.eq("type", type) as any;

    const [{ data: payments }, { data: profiles }] = await Promise.all([
      q,
      admin.from("profiles").select("id,full_name,driver_id").eq("tenant_id", tenantId).eq("role", "driver").order("full_name"),
    ]);

    const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
    const paymentsWithProfile = (payments || []).map((p: any) => ({ ...p, profiles: profileMap[p.driver_id] || null }));

    return Response.json({ payments: paymentsWithProfile, profiles: profiles || [] });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
