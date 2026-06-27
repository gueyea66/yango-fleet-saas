import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ROUTE TEMPORAIRE — réattribution reports/expenses admin → driver Ahmadou
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ADMIN_UUID = "5544843b-9795-484b-b0d8-de3f60fca9f2";   // gueye.a (admin)
const AHMADOU_UUID = "0354fe8d-e95b-4952-b46e-e9ff50e89b50"; // driver-ahmada
const TENANT_ID = "120716d2-953a-49c7-bd89-21876d7668ba";

export async function POST() {
  try {
    const [r1, r2] = await Promise.all([
      admin.schema("fleet").from("daily_reports")
        .update({ driver_id: AHMADOU_UUID })
        .eq("driver_id", ADMIN_UUID)
        .eq("tenant_id", TENANT_ID)
        .select("id"),
      admin.schema("fleet").from("expenses")
        .update({ driver_id: AHMADOU_UUID })
        .eq("driver_id", ADMIN_UUID)
        .eq("tenant_id", TENANT_ID)
        .select("id"),
    ]);

    return Response.json({
      reports_updated: r1.data?.length ?? 0,
      expenses_updated: r2.data?.length ?? 0,
      errors: [r1.error?.message, r2.error?.message].filter(Boolean),
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
