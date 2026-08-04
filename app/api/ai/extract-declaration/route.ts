/**
 * POST /api/ai/extract-declaration — pipeline extraction vision complet.
 * multipart/form-data : files[] (1-3 images JPEG/PNG/WebP ≤ 1 Mo après
 * compression client) + date (YYYY-MM-DD).
 *
 * Réponses :
 *  200 { extraction_id, status: 'completed'|'partial', fields, confidences,
 *        coherence_alerts, source_type, fallback_triggered, model_used }
 *  204 kill-switch OFF (env / ai_settings / rollout_stage) — UI rend null
 *  400 fichiers/date invalides · 429 quota mensuel tenant dépassé
 *
 * Garanties zéro-impact : n'écrit QUE dans fleet.ai_extractions et
 * fleet.ai_uploads_ref (+ fichiers Storage). daily_reports intact — seule la
 * validation explicite du chauffeur écrit, via le flux client existant.
 * Le timeout LLM ne produit JAMAIS de 500 : status 'partial', champs null,
 * le formulaire manuel reste disponible sans friction.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AI_OFF, requireAiAccessAny } from "@/lib/ai/routeGuards";
import { aiAdmin } from "@/lib/ai/adminClient";
import { detectImageMime } from "@/lib/ai/extractionParser";
import { extractVision, VisionImage } from "@/lib/ai/visionGateway";
import { runCoherenceChecks } from "@/lib/ai/coherenceChecks";
import { computeAverageConfidence } from "@/lib/ai/extractionParser";

// Extraction : jusqu'à 10 s Haiku + 20 s Sonnet + upload — marge large.
export const maxDuration = 60;

const BUCKET = "kyc-documents";
const MAX_IMAGES = 3;

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const adminStorage = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * GET — sonde kill-switch pour l'UI chauffeur.
 * 204 = couche OFF (le bloc scan ne se monte pas : app identique à avant) ;
 * 200 {enabled:true} = bloc scan visible. Aucune extraction déclenchée.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAiAccessAny(req);
    if (!ctx) return AI_OFF();
    return NextResponse.json({ enabled: true });
  } catch {
    return AI_OFF(); // non authentifié → comportement identique à OFF
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAiAccessAny(req);
    if (!ctx) return AI_OFF();
    const { tenantId, userId, access } = ctx;

    // ── Quota mensuel par tenant (thresholds JSONB existant, clé additive) ──
    const rawQuota = (access.thresholds as Record<string, unknown>)["monthly_quota"];
    const quota = typeof rawQuota === "number" && rawQuota > 0
      ? rawQuota
      : envInt("AI_DEFAULT_MONTHLY_QUOTA", 200);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count } = await aiAdmin()
      .from("ai_extractions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", monthStart.toISOString());
    if ((count ?? 0) >= quota) {
      return NextResponse.json(
        { error: `Quota mensuel d'extractions atteint (${quota}). Saisie manuelle disponible.` },
        { status: 429 }
      );
    }

    // ── Lecture et validation du multipart ──
    const formData = await req.formData();
    const date = String(formData.get("date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date requise (YYYY-MM-DD)" }, { status: 400 });
    }
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length < 1 || files.length > MAX_IMAGES) {
      return NextResponse.json({ error: `1 à ${MAX_IMAGES} images requises` }, { status: 400 });
    }

    const maxBytes = envInt("AI_MAX_IMAGE_SIZE_BYTES", 1_048_576);
    const images: VisionImage[] = [];
    const buffers: { buffer: Buffer; mime: string }[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        return NextResponse.json(
          { error: `Image trop lourde (max ${Math.round(maxBytes / 1024)} Ko après compression)` },
          { status: 400 }
        );
      }
      const mime = detectImageMime(buffer);
      if (!mime) {
        return NextResponse.json(
          { error: "Format non reconnu — JPEG, PNG ou WebP uniquement" },
          { status: 400 }
        );
      }
      buffers.push({ buffer, mime });
      images.push({ base64: buffer.toString("base64"), mediaType: mime });
    }

    // ── Upload Storage (bucket privé existant) + traçage ai_uploads_ref ──
    const storage = adminStorage();
    const uploadRefIds: string[] = [];
    for (const { buffer, mime } of buffers) {
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const path = `${tenantId}/ai-extractions/${date}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await storage.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: mime, upsert: false });
      if (upErr) {
        console.error("[ai/extract] upload storage:", upErr.message);
        continue; // l'extraction peut se faire même si l'archivage échoue
      }
      const { data: ref } = await aiAdmin()
        .from("ai_uploads_ref")
        .insert({
          tenant_id: tenantId,
          driver_id: userId,
          date_ref: date,
          storage_path: path,
          file_size: buffer.byteLength,
          mime_type: mime,
        })
        .select("id")
        .single();
      if (ref?.id) uploadRefIds.push(ref.id);
    }

    // ── Extraction LLM vision (ne throw jamais) ──
    const result = await extractVision(date, images);
    const avgConfidence = computeAverageConfidence(result.output.confidences);
    const responseStatus = result.succeeded && avgConfidence > 0 ? "completed" : "partial";

    // ── Contrôles de cohérence déterministes (lecture seule, jamais LLM) ──
    const alerts = result.succeeded
      ? await runCoherenceChecks(tenantId, userId, date, result.output.fields)
      : [];

    // ── Persistance de la proposition (couche additive uniquement) ──
    const { data: extraction, error: insErr } = await aiAdmin()
      .from("ai_extractions")
      .insert({
        tenant_id: tenantId,
        driver_id: userId,
        date_ref: date,
        status: result.succeeded ? "completed" : "failed",
        model_used: result.modelUsed,
        proposed_values: result.output.fields,
        field_level_confidence: result.output.confidences,
        coherence_alerts: alerts,
        fallback_triggered: result.fallbackTriggered,
        extraction_duration_ms: result.durationMs,
        source_type: result.output.source_type,
      })
      .select("id")
      .single();

    if (insErr || !extraction) {
      console.error("[ai/extract] insert ai_extractions:", insErr?.message);
      return NextResponse.json({ error: "extraction non enregistrée" }, { status: 500 });
    }

    if (uploadRefIds.length) {
      await aiAdmin()
        .from("ai_uploads_ref")
        .update({ extraction_id: extraction.id })
        .in("id", uploadRefIds);
    }

    return NextResponse.json({
      extraction_id: extraction.id,
      status: responseStatus,
      fields: result.output.fields,
      confidences: result.output.confidences,
      source_type: result.output.source_type,
      conflicts: result.output.conflicts,
      coherence_alerts: alerts,
      fallback_triggered: result.fallbackTriggered,
      model_used: result.modelUsed,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    const status = e.status ?? 500;
    if (status >= 500) console.error("[ai/extract] erreur:", e.message);
    return NextResponse.json({ error: e.message ?? "erreur" }, { status });
  }
}
