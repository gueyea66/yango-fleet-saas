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
    if (!tenantId) return Response.json({ error: "tenantId requis" }, { status: 400 });

    const [{ data: reports }, { data: expenses }, { data: profiles }] = await Promise.all([
      admin.from("daily_reports").select("*").eq("tenant_id", tenantId).order("date", { ascending: false }).limit(300),
      admin.from("expenses").select("*").eq("tenant_id", tenantId).order("expense_date", { ascending: false, nullsFirst: false }).limit(300),
      admin.from("profiles").select("id,full_name,driver_id").eq("tenant_id", tenantId).eq("role", "driver"),
    ]);

    const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
    const expensesWithProfile = (expenses || []).map((e: any) => ({ ...e, _profile: profileMap[e.driver_id] }));

    return Response.json({ reports: reports || [], expenses: expensesWithProfile });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
