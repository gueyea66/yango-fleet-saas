/**
 * Passerelle LLM VISION — extraction de valeurs affichées sur images.
 * Même philosophie que llmGateway.narrate : fetch natif sans SDK, timeout
 * AbortController, retour null en cas d'échec (JAMAIS de throw) — le
 * formulaire manuel reste le chemin nominal.
 *
 * Pipeline : claude-haiku (rapide, $1/$5) → si confiance moyenne < seuil ou
 * timeout, retry claude-sonnet-5 (fallback qualité). Si aucune clé Anthropic,
 * un seul appel GPT-4o (fallback ultime, pattern narrate).
 *
 * Règle d'or : le LLM lit, il ne calcule jamais. calc.ts = source de vérité.
 */

import {
  ExtractionOutput,
  computeAverageConfidence,
  parseExtractionOutput,
} from "./extractionParser";
import { buildVisionPrompt } from "./visionPrompt";

const DEFAULT_PRIMARY_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_FALLBACK_MODEL = "claude-sonnet-5";

export interface VisionImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface VisionExtractionResult {
  output: ExtractionOutput;
  modelUsed: string;
  fallbackTriggered: boolean;
  durationMs: number;
  /** false = tous les appels ont échoué (timeout/API down) — mode dégradé */
  succeeded: boolean;
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] ?? "");
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

async function callAnthropicVision(
  model: string,
  prompt: string,
  images: VisionImage[],
  timeoutMs: number,
  apiKey: string
): Promise<ExtractionOutput | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const content: unknown[] = images.map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.base64 },
    }));
    content.push({ type: "text", text: prompt });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const j = await res.json();
    const text = (j?.content ?? [])
      .map((b: { text?: string }) => b?.text ?? "")
      .join("")
      .trim();
    return text ? parseExtractionOutput(text) : null;
  } catch (err) {
    console.error(`[ai/visionGateway] ${model} indisponible:`, String(err).slice(0, 200));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiVision(
  prompt: string,
  images: VisionImage[],
  timeoutMs: number,
  apiKey: string
): Promise<ExtractionOutput | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const content: unknown[] = images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    }));
    content.push({ type: "text", text: prompt });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 700,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const j = await res.json();
    const text = (j?.choices?.[0]?.message?.content ?? "").trim();
    return text ? parseExtractionOutput(text) : null;
  } catch (err) {
    console.error("[ai/visionGateway] gpt-4o indisponible:", String(err).slice(0, 200));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extraction vision complète avec fallback par seuil de confiance.
 * Ne throw jamais : `succeeded: false` + output vide si tout échoue.
 */
export async function extractVision(
  dateRef: string,
  images: VisionImage[]
): Promise<VisionExtractionResult> {
  const started = Date.now();
  const prompt = buildVisionPrompt(dateRef);

  const primaryModel = (process.env.ANTHROPIC_VISION_MODEL_PRIMARY ?? "").trim() || DEFAULT_PRIMARY_MODEL;
  const fallbackModel = (process.env.ANTHROPIC_VISION_MODEL_FALLBACK ?? "").trim() || DEFAULT_FALLBACK_MODEL;
  const primaryTimeout = envInt("ANTHROPIC_TIMEOUT_PRIMARY_MS", 10_000);
  const fallbackTimeout = envInt("ANTHROPIC_TIMEOUT_FALLBACK_MS", 20_000);
  const confidenceThreshold = envFloat("ANTHROPIC_FALLBACK_CONFIDENCE_THRESHOLD", 0.75);

  const anthropicKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();

  const degraded = (modelUsed: string, fallbackTriggered: boolean): VisionExtractionResult => ({
    // import circulaire évité : emptyExtractionOutput vit dans extractionParser
    output: {
      fields: {
        end_odometer: null, yango_gross: null, yango_bonus: null,
        solde_yango: null, yango_trip_count: null,
      },
      confidences: {
        end_odometer: 0, yango_gross: 0, yango_bonus: 0,
        solde_yango: 0, yango_trip_count: 0,
      },
      source_type: "unknown",
      conflicts: [],
    },
    modelUsed,
    fallbackTriggered,
    durationMs: Date.now() - started,
    succeeded: false,
  });

  if (anthropicKey) {
    const primary = await callAnthropicVision(primaryModel, prompt, images, primaryTimeout, anthropicKey);
    if (primary && computeAverageConfidence(primary.confidences) >= confidenceThreshold) {
      return {
        output: primary,
        modelUsed: primaryModel,
        fallbackTriggered: false,
        durationMs: Date.now() - started,
        succeeded: true,
      };
    }

    // Confiance insuffisante ou échec primaire → fallback Sonnet
    const fallback = await callAnthropicVision(fallbackModel, prompt, images, fallbackTimeout, anthropicKey);
    if (fallback) {
      return {
        output: fallback,
        modelUsed: fallbackModel,
        fallbackTriggered: true,
        durationMs: Date.now() - started,
        succeeded: true,
      };
    }
    // Le primaire avait quand même produit quelque chose (sous le seuil) :
    // mieux vaut des valeurs basse-confiance que rien — l'UI les marque en rouge.
    if (primary) {
      return {
        output: primary,
        modelUsed: primaryModel,
        fallbackTriggered: true,
        durationMs: Date.now() - started,
        succeeded: true,
      };
    }
    return degraded(primaryModel, true);
  }

  if (openaiKey) {
    const out = await callOpenAiVision(prompt, images, fallbackTimeout, openaiKey);
    if (out) {
      return {
        output: out,
        modelUsed: "gpt-4o",
        fallbackTriggered: false,
        durationMs: Date.now() - started,
        succeeded: true,
      };
    }
    return degraded("gpt-4o", false);
  }

  return degraded("none", false);
}
