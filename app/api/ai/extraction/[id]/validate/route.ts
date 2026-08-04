/**
 * POST /api/ai/extraction/:id/validate — feedback loop de précision.
 * Appelé APRÈS la soumission du rapport (flux existant, inchangé) : enregistre
 * les valeurs finales validées par le chauffeur et le delta proposé→validé,
 * pour mesurer la précision réelle du modèle champ par champ.
 *
 * N'écrit QUE dans fleet.ai_extractions. Best-effort côté client : un échec
 * ici n'affecte jamais la déclaration elle-même.
 */
import { NextRequest, NextResponse } from "next/server";
import { AI_OFF, requireAiAccessAny } from "@/lib/ai/routeGuards";
import { aiAdmin } from "@/lib/ai/adminClient";
import {
  computeCorrectionDelta,
  ExtractedFields,
  parseValidatedValues,
} from "@/lib/ai/extractionParser";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAiAccessAny(req);
    if (!ctx) return AI_OFF();
    const { tenantId, userId } = ctx;

    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "id invalide" }, { status: 400 });
    }

    const validated = parseValidatedValues(await req.json().catch(() => null));
    if (!validated) {
      return NextResponse.json({ error: "validated_values requis" }, { status: 400 });
    }

    // Service role bypasse la RLS → vérification manuelle tenant + driver
    const { data: extraction } = await aiAdmin()
      .from("ai_extractions")
      .select("id, tenant_id, driver_id, status, proposed_values")
      .eq("id", id)
      .maybeSingle();

    if (!extraction || extraction.tenant_id !== tenantId || extraction.driver_id !== userId) {
      return NextResponse.json({ error: "extraction introuvable" }, { status: 404 });
    }
    if (extraction.status === "validated") {
      return NextResponse.json({ error: "extraction déjà validée" }, { status: 409 });
    }

    const correctionDelta = computeCorrectionDelta(
      extraction.proposed_values as ExtractedFields,
      validated
    );

    const { error: updErr } = await aiAdmin()
      .from("ai_extractions")
      .update({
        status: "validated",
        validated_values: validated,
        correction_delta: correctionDelta,
        validated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updErr) {
      console.error("[ai/validate] update:", updErr.message);
      return NextResponse.json({ error: "validation non enregistrée" }, { status: 500 });
    }

    return NextResponse.json({
      extraction_id: id,
      status: "validated",
      correction_delta: correctionDelta,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    const status = e.status ?? 500;
    if (status >= 500) console.error("[ai/validate] erreur:", e.message);
    return NextResponse.json({ error: e.message ?? "erreur" }, { status });
  }
}
