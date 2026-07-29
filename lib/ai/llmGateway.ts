/**
 * Passerelle LLM — narration UNIQUEMENT. Reçoit un payload structuré compact
 * (jamais de données brutes, jamais de noms — pseudonymes drv_xxxx), renvoie
 * un texte français ou null (→ mode dégradé, les chiffres restent affichés).
 * fetch natif, timeout AbortController, aucun SDK.
 * Provider : Anthropic si ANTHROPIC_API_KEY, sinon OpenAI si OPENAI_API_KEY.
 */

const SYSTEM_FR = `Tu rédiges le briefing quotidien d'un opérateur de flotte VTC à Dakar.
Règles ABSOLUES :
- Tu n'inventes JAMAIS un chiffre. Tu ne peux citer que les montants présents dans le JSON fourni, à l'identique.
- Tu ne fais AUCUN calcul (pas d'addition, de pourcentage, de conversion).
- Les chauffeurs sont désignés par leur référence (ex: drv_ab12) — recopie-les telles quelles, elles seront remplacées par les prénoms.
- AUCUN markdown : pas d'astérisques, pas de titres, pas de puces (le texte est affiché brut).
- Français simple et direct, 120 mots maximum, 2 à 4 phrases.
- Termine par la phrase la plus actionnable du jour.`;

export interface LlmOptions {
  model?: string | null;   // override ai_config.llm_model_override
  timeoutMs?: number;      // défaut 10 000 (batch nocturne)
  maxTokens?: number;
  system?: string;         // prompt système alternatif (ex: briefing JSON structuré)
}

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export async function narrate(payloadJson: string, opts: LlmOptions = {}): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxTokens = opts.maxTokens ?? 400;
  const user = `Voici les données calculées du jour (source déterministe, ne pas recalculer) :\n${payloadJson}`;

  const anthropicKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  const openaiKey = (process.env.OPENAI_API_KEY ?? "").trim();

  try {
    if (anthropicKey) {
      return await withTimeout(timeoutMs, async (signal) => {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: opts.model || process.env.AI_LLM_MODEL || DEFAULT_ANTHROPIC_MODEL,
            max_tokens: maxTokens,
            system: opts.system ?? SYSTEM_FR,
            messages: [{ role: "user", content: user }],
          }),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}`);
        const j = await res.json();
        const text = (j?.content ?? []).map((b: { text?: string }) => b?.text ?? "").join("").trim();
        return text || null;
      });
    }
    if (openaiKey) {
      return await withTimeout(timeoutMs, async (signal) => {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: opts.model || process.env.AI_LLM_MODEL || DEFAULT_OPENAI_MODEL,
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: opts.system ?? SYSTEM_FR },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) throw new Error(`openai ${res.status}`);
        const j = await res.json();
        const text = (j?.choices?.[0]?.message?.content ?? "").trim();
        return text || null;
      });
    }
    return null; // aucune clé configurée → mode dégradé assumé
  } catch (err) {
    console.error("[ai/llmGateway] narration indisponible:", String(err).slice(0, 200));
    return null;
  }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Garde-fou anti-hallucination : vérifie que chaque nombre ≥ 4 chiffres cité
 * dans la narration existe dans le payload source (tolère les séparateurs).
 * En cas de chiffre étranger → narration rejetée (mode dégradé).
 */
export function narrativeCitesOnlyKnownNumbers(narrative: string, payloadJson: string): boolean {
  const known = new Set(
    (payloadJson.match(/-?\d+(?:\.\d+)?/g) ?? []).flatMap((s) => {
      const clean = s.replace(/\.0+$/, "");
      return [clean, clean.replace(/^-/, "")]; // la narration cite les montants en valeur absolue
    })
  );
  const cited = narrative.replace(/[  \s]/g, "").match(/\d{4,}/g) ?? [];
  return cited.every((c) => known.has(c) || known.has(String(Number(c))));
}

/**
 * Extrait le premier objet JSON d'une réponse LLM (tolère les fences ```json).
 * Retourne null si illisible — l'appelant bascule en mode dégradé.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
