import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

async function getStoredKey(): Promise<string> {
  const { data } = await adminClient.from("superadmin_settings").select("value").eq("key", "access_key").single();
  return data?.value ?? process.env.SUPERADMIN_KEY ?? "";
}

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, plan, active, plan_expires_at, report_addon } = await req.json();

  const storedKey = await getStoredKey();
  if (!checkSuperadminKey(superadminKey, storedKey, getClientIp(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tenantId) return NextResponse.json({ error: "tenantId requis" }, { status: 400 });

  // Add-on « Rapport d'activité » — service complémentaire (payant) activable
  // par tenant, stocké dans superadmin_settings (liste JSON d'IDs) et piloté
  // UNIQUEMENT depuis la console super admin.
  if (report_addon !== undefined) {
    const { data } = await adminClient.from("superadmin_settings")
      .select("value").eq("key", "report_addon_tenants").maybeSingle();
    let list: string[] = [];
    try {
      const v = JSON.parse(data?.value || "[]");
      if (Array.isArray(v)) list = v;
    } catch { /* valeur corrompue → on repart d'une liste vide */ }
    list = report_addon ? [...new Set([...list, tenantId])] : list.filter((id) => id !== tenantId);
    const { error } = await adminClient.from("superadmin_settings")
      .upsert({ key: "report_addon_tenants", value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (plan !== undefined) update.plan = plan;
  if (active !== undefined) update.active = active;
  if (plan_expires_at !== undefined) update.plan_expires_at = plan_expires_at;

  if (Object.keys(update).length > 0) {
    const { error } = await adminClient.from("tenants").update(update).eq("id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
