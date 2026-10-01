import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";

const serviceClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/* ── GET — écarts ouverts : déclaration chauffeur vs Fleetroom ── */
export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const { data, error } = await serviceClient.schema("fleet").from("fleetroom_conflicts")
      .select("driver_id, jour, declared, fleetroom, updated_at, profiles(full_name)")
      .eq("tenant_id", tenantId).eq("resolved", false)
      .order("jour", { ascending: false }).limit(200);
    if (error) throw error;
    return NextResponse.json({ conflicts: data });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

/**
 * PATCH — trancher un écart.
 *  - keep_declared  : la déclaration du chauffeur reste, l'écart est clos.
 *  - use_fleetroom  : la déclaration passe en source 'fleetroom' et le jour est
 *                     recalculé depuis le brut (écrasement voulu, tracé).
 */
export async function PATCH(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const { driver_id, jour, action } = await req.json();
    if (!driver_id || !/^\d{4}-\d{2}-\d{2}$/.test(jour ?? "") || !["keep_declared", "use_fleetroom"].includes(action)) {
      return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
    }
    const db = serviceClient.schema("fleet");

    if (action === "use_fleetroom") {
      const { error: upErr } = await db.from("daily_reports")
        .update({ source: "fleetroom" })
        .eq("tenant_id", tenantId).eq("driver_id", driver_id).eq("date", jour).eq("status", "approved");
      if (upErr) throw upErr;
      const { error: rbErr } = await db.rpc("fleetroom_rebuild", { p_tenant: tenantId, p_from: jour, p_to: jour });
      if (rbErr) throw rbErr;
    }

    const { error } = await db.from("fleetroom_conflicts")
      .update({ resolved: true, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("driver_id", driver_id).eq("jour", jour);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
