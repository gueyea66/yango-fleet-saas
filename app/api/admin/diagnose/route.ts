import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ROUTE TEMPORAIRE — diagnostic UUID mismatch, à supprimer après usage
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const tenantId = "120716d2-953a-49c7-bd89-21876d7668ba";
    const uuids = [
      "5544843b-9795-484b-b0d8-de3f60fca9f2",
      "0354fe8d-e95b-4952-b46e-e9ff50e89b50",
      "0c514048-c0a5-4f34-a4cf-ebe81377c593",
    ];

    // Lire les profils fleet
    const { data: profiles } = await admin
      .schema("fleet")
      .from("profiles")
      .select("id,full_name,role,tenant_id")
      .in("id", uuids);

    // Lire les auth users via l'API admin Supabase
    const authResults = await Promise.all(
      uuids.map(async (id) => {
        const { data, error } = await admin.auth.admin.getUserById(id);
        return { id, email: data?.user?.email || null, error: error?.message || null };
      })
    );

    // Rapports driver_ids
    const { data: reports } = await admin
      .schema("fleet")
      .from("daily_reports")
      .select("driver_id")
      .eq("tenant_id", tenantId);

    const reportDriverIds = [...new Set((reports || []).map((r: any) => r.driver_id))];

    return Response.json({ profiles, authUsers: authResults, reportDriverIds });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
