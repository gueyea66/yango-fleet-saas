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

async function toggleTenantList(key: string, tenantId: string, enabled: boolean): Promise<string | null> {
  const { data } = await adminClient.from("superadmin_settings")
    .select("value").eq("key", key).maybeSingle();
  let list: string[] = [];
  try {
    const v = JSON.parse(data?.value || "[]");
    if (Array.isArray(v)) list = v;
  } catch { /* valeur corrompue → on repart d'une liste vide */ }
  list = enabled ? [...new Set([...list, tenantId])] : list.filter((id) => id !== tenantId);
  const { error } = await adminClient.from("superadmin_settings")
    .upsert({ key, value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: "key" });
  return error ? error.message : null;
}

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, plan, active, plan_expires_at, report_addon, report_premium } = await req.json();

  const storedKey = await getStoredKey();
  if (!(await checkSuperadminKey(superadminKey, storedKey, getClientIp(req)))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tenantId) return NextResponse.json({ error: "tenantId requis" }, { status: 400 });
  // Audit du 18/10/2026 (M8) : chaque champ est contrôlé avant d'écrire.
  if (typeof tenantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return NextResponse.json({ error: "tenantId invalide" }, { status: 400 });
  if (plan !== undefined && !["trial", "pending_payment", "standard", "pro", "enterprise"].includes(plan)) return NextResponse.json({ error: "Formule inconnue" }, { status: 400 });
  if (active !== undefined && typeof active !== "boolean") return NextResponse.json({ error: "active doit valoir vrai ou faux" }, { status: 400 });
  if (plan_expires_at !== undefined && plan_expires_at !== null && (typeof plan_expires_at !== "string" || Number.isNaN(Date.parse(plan_expires_at)))) {
    return NextResponse.json({ error: "Date d'échéance invalide" }, { status: 400 });
  }

  // Add-on « Rapport d'activité » (standard) et niveau « premium » (narration
  // multi-agent + YTD + deep dive) — services complémentaires (payants)
  // activables par tenant, stockés dans superadmin_settings (listes JSON
  // d'IDs) et pilotés UNIQUEMENT depuis la console super admin.
  if (report_addon !== undefined) {
    const err = await toggleTenantList("report_addon_tenants", tenantId, !!report_addon);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  if (report_premium !== undefined) {
    const err = await toggleTenantList("report_premium_tenants", tenantId, !!report_premium);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
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
