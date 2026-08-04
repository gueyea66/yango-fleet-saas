/**
 * Parsing et validation de la sortie du LLM vision — zéro dépendance
 * (pas de zod dans ce repo : validateur manuel exhaustif, testé).
 * Toute sortie invalide → null : l'appelant bascule en mode dégradé
 * (formulaire manuel intact), jamais d'exception qui remonte au chauffeur.
 */

import { extractJsonObject } from "./llmGateway";
import { EXTRACTION_FIELDS, FORM_FIELDS, ExtractionField } from "./visionPrompt";

export type ExtractedFields = Record<ExtractionField, number | null>;
export type FieldConfidences = Record<ExtractionField, number>;

export interface ExtractionOutput {
  fields: ExtractedFields;
  confidences: FieldConfidences;
  source_type: "yango_pro_screenshot" | "odometer_photo" | "mixed" | "unknown";
  conflicts: { field: string; values: (number | null)[] }[];
}

const SOURCE_TYPES = new Set(["yango_pro_screenshot", "odometer_photo", "mixed", "unknown"]);

/**
 * Champs affichés en NÉGATIF par Yango Pro (déductions) : le prompt demande la
 * valeur absolue, mais si le LLM renvoie quand même -6254, on normalise en
 * abs() plutôt que de perdre la lecture. Les autres champs négatifs = lecture
 * aberrante → null.
 */
const ABS_FIELDS: ReadonlySet<ExtractionField> = new Set([
  "commission_yango",
  "commission_partenaire",
  "services_supplementaires",
]);

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Valide et normalise la réponse texte du LLM.
 * Tolère le texte parasite autour du JSON (extractJsonObject) ; champ
 * manquant/invalide → null avec confiance 0 (dégradé par champ, pas global).
 * Retourne null uniquement si AUCUN objet exploitable n'est trouvé.
 */
export function parseExtractionOutput(rawText: string): ExtractionOutput | null {
  const obj = extractJsonObject(rawText);
  if (!obj) return null;

  const rawFields = (obj.fields ?? {}) as Record<string, unknown>;
  const rawConf = (obj.confidences ?? {}) as Record<string, unknown>;

  const fields = {} as ExtractedFields;
  const confidences = {} as FieldConfidences;

  for (const f of EXTRACTION_FIELDS) {
    let value = asFiniteNumber(rawFields[f]);
    let conf = asFiniteNumber(rawConf[f]) ?? 0;
    conf = Math.min(1, Math.max(0, conf));

    if (value !== null) {
      // Les montants FCFA et km sont des entiers ; les courses aussi.
      value = Math.round(value);
      // Déductions Yango affichées en négatif → valeur absolue ;
      // ailleurs, une valeur négative = lecture aberrante → null.
      if (value < 0) value = ABS_FIELDS.has(f) ? Math.abs(value) : null;
    }
    // Cohérence null ↔ confiance : un champ non lu ne porte pas de confiance,
    // et une confiance < 0.60 signifie "trop incertain" → null (règle prompt).
    if (value === null) conf = 0;
    if (conf < 0.6) value = null;
    if (value === null) conf = 0;

    fields[f] = value;
    confidences[f] = conf;
  }

  const sourceType = SOURCE_TYPES.has(String(obj.source_type))
    ? (obj.source_type as ExtractionOutput["source_type"])
    : "unknown";

  const conflicts = Array.isArray(obj.conflicts)
    ? (obj.conflicts as unknown[])
        .filter((c): c is { field: string; values: (number | null)[] } =>
          !!c && typeof c === "object" && typeof (c as { field?: unknown }).field === "string")
        .map((c) => ({
          field: String(c.field).slice(0, 40),
          values: Array.isArray(c.values) ? c.values.map(asFiniteNumber) : [],
        }))
    : [];

  return { fields, confidences, source_type: sourceType, conflicts };
}

/** Confiance moyenne sur les 5 champs (champs absents comptent 0 — volontaire :
 *  une extraction qui ne lit rien doit déclencher le fallback). */
export function computeAverageConfidence(confidences: FieldConfidences): number {
  const values = EXTRACTION_FIELDS.map((f) => confidences[f] ?? 0);
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Sortie vide (mode dégradé total) : champs null, confiances 0. */
export function emptyExtractionOutput(): ExtractionOutput {
  const fields = {} as ExtractedFields;
  const confidences = {} as FieldConfidences;
  for (const f of EXTRACTION_FIELDS) {
    fields[f] = null;
    confidences[f] = 0;
  }
  return { fields, confidences, source_type: "unknown", conflicts: [] };
}

// ── Validation MIME serveur par magic bytes (jamais file.type client) ────────
// Images uniquement — pas de PDF pour l'extraction vision.
export function detectImageMime(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return "image/webp";
  return null;
}

// ── Validation du body de /api/ai/extraction/:id/validate ────────────────────
// FORM_FIELDS uniquement : net_affiche est une contre-vérification, pas un
// champ du formulaire — il n'est ni validé ni compté dans le delta.
export type ValidatedFields = Partial<ExtractedFields>;

export function parseValidatedValues(body: unknown): ValidatedFields | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { validated_values?: unknown }).validated_values;
  if (!raw || typeof raw !== "object") return null;
  const out: ValidatedFields = {};
  for (const f of FORM_FIELDS) {
    const v = asFiniteNumber((raw as Record<string, unknown>)[f]);
    out[f] = v === null ? null : Math.round(v);
  }
  return out;
}

/** Delta proposé → validé par champ (mesure de précision réelle du modèle). */
export function computeCorrectionDelta(
  proposed: ExtractedFields,
  validated: ValidatedFields
): Record<string, { proposed: number | null; validated: number | null }> {
  const delta: Record<string, { proposed: number | null; validated: number | null }> = {};
  for (const f of FORM_FIELDS) {
    const v = validated[f] ?? null;
    if (proposed[f] !== v) {
      delta[f] = { proposed: proposed[f], validated: v };
    }
  }
  return delta;
}
