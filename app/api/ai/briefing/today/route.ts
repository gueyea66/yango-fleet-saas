import { NextRequest } from "next/server";
import { aiAdmin } from "@/lib/ai/adminClient";
import { AI_OFF, requireAiAccess } from "@/lib/ai/routeGuards";
import { freshnessSnapshot, fetchTenantWindow } from "@/lib/ai/dataReader";

export const dynamic = "force-dynamic";

/** GET /api/ai/briefing/today — briefing du jour (pré-calculé, jamais généré ici). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAiAccess(req);
    if (!ctx) return AI_OFF();

    const today = new Date().toISOString().slice(0, 10);
    const { data } = await aiAdmin()
      .from("ai_briefings")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .order("briefing_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fraîcheur : des rapports plus récents que le calcul ? (badge, sans réécrire)
    let hasNewer = data?.has_newer_data ?? false;
    if (data && !hasNewer) {
      const win = await fetchTenantWindow(ctx.tenantId, 3);
      const snap = freshnessSnapshot(win);
      const computedAt = String(data.computed_at ?? "");
      hasNewer = Object.values(snap).some((d) => d + "T23:59:59Z" > computedAt && d >= data.briefing_date);
      if (hasNewer) {
        await aiAdmin().from("ai_briefings")
          .update({ has_newer_data: true }).eq("id", data.id);
      }
    }

    return Response.json({
      ai_layer_enabled: true,
      briefing: data ? { ...data, has_newer_data: hasNewer, is_today: data.briefing_date === today } : null,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
