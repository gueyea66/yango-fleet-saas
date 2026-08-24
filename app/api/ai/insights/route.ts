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

    // Un insight par KPI (le plus récent), marqué stale si expiré. Au-delà de
    // 7 jours de données, l'insight est MASQUÉ : sans nouveau franchissement de
    // seuil, l'ancien restait affiché indéfiniment (bloc net opérationnel figé
    // au 11/08, constaté le 24/08).
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const byKpi = new Map<string, Record<string, unknown>>();
    for (const ins of data ?? []) {
      if (String(ins.period_end) < cutoff) continue;
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
