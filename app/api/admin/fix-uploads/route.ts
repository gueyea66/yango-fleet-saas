import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { db: { schema: "fleet" } });
export async function POST() {
  const { data, error, count } = await admin.from("uploads")
    .update({ driver_id: "0354fe8d-e95b-4952-b46e-e9ff50e89b50" })
    .eq("tenant_id", "120716d2-953a-49c7-bd89-21876d7668ba")
    .not("driver_id", "in", '("0354fe8d-e95b-4952-b46e-e9ff50e89b50","0c514048-c0a5-4f34-a4cf-ebe81377c593")')
    .select();
  return Response.json({ updated: data?.length ?? 0, error: error?.message });
}
