/**
 * report-agent — garde anti-hallucination (autonome).
 * Copie assumée de lib/ai/llmGateway.foreignNumbers pour garder le dossier
 * portable sans dépendance (contrat README) — si l'un évolue, aligner l'autre.
 */

/** Nombres ≥ 4 chiffres cités dans `narrative` mais absents de `payloadJson`. */
export function foreignNumbers(narrative: string, payloadJson: string): string[] {
  const known = new Set(
    (payloadJson.match(/-?\d+(?:\.\d+)?/g) ?? []).flatMap((s) => {
      const clean = s.replace(/\.0+$/, "");
      return [clean, clean.replace(/^-/, "")];
    })
  );
  const cited = narrative.replace(/[  \s]/g, "").match(/\d{4,}/g) ?? [];
  return cited.filter((c) => !known.has(c) && !known.has(String(Number(c))));
}

export function citesOnlyKnownNumbers(narrative: string, payloadJson: string): boolean {
  return foreignNumbers(narrative, payloadJson).length === 0;
}

/** Premier objet JSON d'une réponse LLM (tolère les fences ```json). */
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
