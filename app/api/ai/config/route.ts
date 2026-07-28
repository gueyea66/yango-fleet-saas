import { NextRequest, NextResponse } from "next/server";
import { aiAdmin } from "@/lib/ai/adminClient";
import { verifySuperadmin } from "@/lib/ai/routeGuards";
import { clearAiEnabledCache, envEnabled } from "@/lib/ai/killSwitch";

export const dynamic = "force-dynamic";

/**
 * SCR-07 — pilotage superadmin de la couche IA (header x-superadmin-key).
 * GET  : état global + configs tenants
 * PATCH: { enabled? } | { tenantId, rollout_stage?, thresholds?, llm_model_override? }
 * L'autorité du kill-switch est ICI (DB), modifiable sans redéploiement.
 */
export async function GET(req: NextRequest) {
  if (!(await verifySuperadmin(req))) {
    return NextResponse.json({ error: "superadmin requis" }, { status: 403 });
  }
  const admin = aiAdmin();
  const [settings, configs] = await Promise.all([
    admin.from("ai_settings").select("enabled, updated_at").eq("id", 1).maybeSingle(),
    admin.from("ai_config").select("*").order("updated_at", { ascending: false }),
  ]);
  return NextResponse.json({
    env_master_enabled: envEnabled(),
    enabled: settings.data?.enabled ?? false,
    tenants: configs.data ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  if (!(await verifySuperadmin(req))) {
    return NextResponse.json({ error: "superadmin requis" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const admin = aiAdmin();

  // Kill-switch global
  if (typeof body.enabled === "boolean") {
    const { error } = await admin.from("ai_settings")
      .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    clearAiEnabledCache();
    return NextResponse.json({ enabled: body.enabled });
  }

  // Config par tenant (rollout / seuils / modèle)
  if (typeof body.tenantId === "string" && body.tenantId) {
    const patch: Record<string, unknown> = { tenant_id: body.tenantId, updated_at: new Date().toISOString() };
    if (body.rollout_stage) {
      if (!["disabled", "shadow", "dogfood", "general"].includes(body.rollout_stage)) {
        return NextResponse.json({ error: "rollout_stage invalide" }, { status: 400 });
      }
      patch.rollout_stage = body.rollout_stage;
    }
    if (body.thresholds && typeof body.thresholds === "object") patch.thresholds = body.thresholds;
    if ("llm_model_override" in body) patch.llm_model_override = body.llm_model_override ?? null;

    const { data, error } = await admin.from("ai_config")
      .upsert(patch, { onConflict: "tenant_id" })
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config: data });
  }

  return NextResponse.json({ error: "corps invalide" }, { status: 400 });
}
