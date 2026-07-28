import { NextRequest } from "next/server";
import { aiAdmin } from "@/lib/ai/adminClient";
import { AI_OFF, requireAiAccess } from "@/lib/ai/routeGuards";

export const dynamic = "force-dynamic";

/** PATCH /api/ai/recommendations/[id] — { status: "acted_on" | "ignored" } */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAiAccess(req);
    if (!ctx) return AI_OFF();

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const status = body?.status;
    if (status !== "acted_on" && status !== "ignored") {
      return Response.json({ error: "status invalide (acted_on | ignored)" }, { status: 400 });
    }

    const { data, error } = await aiAdmin()
      .from("ai_recommendations")
      .update({ status, acted_at: status === "acted_on" ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)   // jamais cross-tenant, même en service_role
      .select("id, status")
      .maybeSingle();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "introuvable" }, { status: 404 });
    return Response.json({ ai_layer_enabled: true, recommendation: data });
  } catch (err) {
    const e = err as Error & { status?: number };
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
