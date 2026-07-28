import { NextRequest } from "next/server";
import { aiAdmin } from "@/lib/ai/adminClient";
import { AI_OFF, requireAiAccess } from "@/lib/ai/routeGuards";

export const dynamic = "force-dynamic";

/** GET /api/ai/insights — derniers insights (un par KPI, le plus récent). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAiAccess(req);
    if (!ctx) return AI_OFF();

    const { data } = await aiAdmin()
      .from("ai_insights")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false })
      .limit(12);

    // Un insight par KPI (le plus récent), marqué stale si expiré — jamais masqué en frais
    const now = new Date().toISOString();
    const byKpi = new Map<string, Record<string, unknown>>();
    for (const ins of data ?? []) {
      if (!byKpi.has(ins.kpi_name)) {
        byKpi.set(ins.kpi_name, { ...ins, is_stale: String(ins.expires_at) < now });
      }
    }

    return Response.json({ ai_layer_enabled: true, insights: [...byKpi.values()] });
  } catch (err) {
    const e = err as Error & { status?: number };
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
