import { NextRequest } from "next/server";
import { aiAdmin } from "@/lib/ai/adminClient";
import { AI_OFF, requireAiAccess } from "@/lib/ai/routeGuards";

export const dynamic = "force-dynamic";

/** GET /api/ai/recommendations — recommandations actives, priorisées. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAiAccess(req);
    if (!ctx) return AI_OFF();

    const now = new Date().toISOString();
    const { data } = await aiAdmin()
      .from("ai_recommendations")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "active")
      .gt("expires_at", now)
      .order("priority", { ascending: true })   // HIGH < LOW < MEDIUM alphabétique…
      .order("impact_fcfa", { ascending: false })
      .limit(20);

    // Tri métier explicite (l'ordre SQL alphabétique ne suffit pas)
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>;
    const recommendations = (data ?? []).sort(
      (a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || b.impact_fcfa - a.impact_fcfa
    );

    return Response.json({
      ai_layer_enabled: true,
      recommendations,
      total_active: recommendations.length,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
