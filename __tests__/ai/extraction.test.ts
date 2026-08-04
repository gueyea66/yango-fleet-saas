/**
 * Tests de la couche extraction vision — parsing, normalisation, garde-fous.
 * Zéro appel réseau : tout est pur (extractionParser) ou simulé (env).
 */
import {
  computeAverageConfidence,
  computeCorrectionDelta,
  detectImageMime,
  emptyExtractionOutput,
  parseExtractionOutput,
  parseValidatedValues,
} from "@/lib/ai/extractionParser";
import { buildVisionPrompt, EXTRACTION_FIELDS } from "@/lib/ai/visionPrompt";
import { envEnabled } from "@/lib/ai/killSwitch";

describe("parseExtractionOutput — parsing nominal", () => {
  const nominal = JSON.stringify({
    fields: { end_odometer: 187432, yango_gross: 4800, yango_bonus: 500, solde_yango: 2150, yango_trip_count: 12 },
    confidences: { end_odometer: 0.91, yango_gross: 0.95, yango_bonus: 0.95, solde_yango: 0.92, yango_trip_count: 0.97 },
    source_type: "mixed",
    conflicts: [],
  });

  it("parse un JSON propre", () => {
    const out = parseExtractionOutput(nominal);
    expect(out).not.toBeNull();
    expect(out!.fields.end_odometer).toBe(187432);
    expect(out!.fields.yango_gross).toBe(4800);
    expect(out!.confidences.yango_trip_count).toBe(0.97);
    expect(out!.source_type).toBe("mixed");
  });

  it("tolère le texte parasite autour du JSON (fences, préambule)", () => {
    const noisy = "Voici le résultat :\n```json\n" + nominal + "\n```\nFin.";
    const out = parseExtractionOutput(noisy);
    expect(out).not.toBeNull();
    expect(out!.fields.yango_gross).toBe(4800);
  });

  it("arrondit les valeurs non entières (FCFA/km entiers)", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { end_odometer: 187432.7, yango_gross: 4800.2, yango_bonus: null, solde_yango: null, yango_trip_count: null },
      confidences: { end_odometer: 0.9, yango_gross: 0.9, yango_bonus: 0, solde_yango: 0, yango_trip_count: 0 },
      source_type: "odometer_photo",
    }));
    expect(out!.fields.end_odometer).toBe(187433);
    expect(out!.fields.yango_gross).toBe(4800);
  });
});

describe("parseExtractionOutput — sorties dégradées et garde-fous", () => {
  it("réponse non-JSON → null (mode dégradé, jamais de throw)", () => {
    expect(parseExtractionOutput("Je ne peux pas lire ces images.")).toBeNull();
    expect(parseExtractionOutput("")).toBeNull();
  });

  it("champ manquant → null avec confiance 0", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { yango_gross: 4800 },
      confidences: { yango_gross: 0.9 },
      source_type: "yango_pro_screenshot",
    }));
    expect(out!.fields.end_odometer).toBeNull();
    expect(out!.confidences.end_odometer).toBe(0);
    expect(out!.fields.yango_gross).toBe(4800);
  });

  it("confiance < 0.60 → valeur forcée à null (règle null-if-uncertain)", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { end_odometer: 187432, yango_gross: null, yango_bonus: null, solde_yango: null, yango_trip_count: null },
      confidences: { end_odometer: 0.42, yango_gross: 0, yango_bonus: 0, solde_yango: 0, yango_trip_count: 0 },
      source_type: "odometer_photo",
    }));
    expect(out!.fields.end_odometer).toBeNull();
    expect(out!.confidences.end_odometer).toBe(0);
  });

  it("valeur négative → null (solde négatif, lecture aberrante)", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { end_odometer: null, yango_gross: null, yango_bonus: null, solde_yango: -3500, yango_trip_count: null },
      confidences: { end_odometer: 0, yango_gross: 0, yango_bonus: 0, solde_yango: 0.9, yango_trip_count: 0 },
      source_type: "yango_pro_screenshot",
    }));
    expect(out!.fields.solde_yango).toBeNull();
  });

  it("confiance hors bornes → clampée dans [0,1]", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { end_odometer: 100000, yango_gross: null, yango_bonus: null, solde_yango: null, yango_trip_count: null },
      confidences: { end_odometer: 1.7, yango_gross: -2, yango_bonus: 0, solde_yango: 0, yango_trip_count: 0 },
      source_type: "unknown",
    }));
    expect(out!.confidences.end_odometer).toBe(1);
    expect(out!.confidences.yango_gross).toBe(0);
  });

  it("source_type inconnu → 'unknown'", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: {}, confidences: {}, source_type: "invoice_scan",
    }));
    expect(out!.source_type).toBe("unknown");
  });
});

describe("computeAverageConfidence — déclencheur de fallback", () => {
  it("image dégradée (exemple D.5 de la spec) → sous le seuil 0.75", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { end_odometer: null, yango_gross: null, yango_bonus: null, solde_yango: null, yango_trip_count: null },
      confidences: { end_odometer: 0.42, yango_gross: 0, yango_bonus: 0, solde_yango: 0, yango_trip_count: 0 },
      source_type: "odometer_photo",
    }));
    expect(computeAverageConfidence(out!.confidences)).toBeLessThan(0.75);
  });

  it("extraction nette → au-dessus du seuil", () => {
    const conf = { end_odometer: 0.91, yango_gross: 0.95, yango_bonus: 0.95, solde_yango: 0.92, yango_trip_count: 0.97 };
    expect(computeAverageConfidence(conf)).toBeGreaterThan(0.75);
  });

  it("sortie vide → 0", () => {
    expect(computeAverageConfidence(emptyExtractionOutput().confidences)).toBe(0);
  });
});

describe("detectImageMime — magic bytes serveur (jamais file.type client)", () => {
  const pad = (bytes: number[]) => Buffer.from([...bytes, ...new Array(Math.max(0, 12 - bytes.length)).fill(0)]);

  it("JPEG FF D8 FF", () => {
    expect(detectImageMime(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });
  it("PNG 89 50 4E 47", () => {
    expect(detectImageMime(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png");
  });
  it("WebP RIFF....WEBP", () => {
    expect(detectImageMime(Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });
  it("PDF refusé (pas d'extraction vision sur PDF)", () => {
    expect(detectImageMime(pad([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });
  it("buffer trop court ou inconnu → null", () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageMime(pad([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe("feedback loop — validated_values et correction_delta", () => {
  it("parseValidatedValues normalise et arrondit", () => {
    const v = parseValidatedValues({ validated_values: { end_odometer: 48900.6, yango_gross: 4800, yango_bonus: null, solde_yango: "abc", yango_trip_count: 12 } });
    expect(v).not.toBeNull();
    expect(v!.end_odometer).toBe(48901);
    expect(v!.solde_yango).toBeNull(); // string invalide → null
  });

  it("body invalide → null", () => {
    expect(parseValidatedValues(null)).toBeNull();
    expect(parseValidatedValues({})).toBeNull();
    expect(parseValidatedValues({ validated_values: "x" })).toBeNull();
  });

  it("correction_delta ne liste que les champs corrigés", () => {
    const proposed = { end_odometer: 48900, yango_gross: 4800, yango_bonus: 500, solde_yango: null, yango_trip_count: 12 };
    const validated = { end_odometer: 48910, yango_gross: 4800, yango_bonus: 500, solde_yango: 2000, yango_trip_count: 12 };
    const delta = computeCorrectionDelta(proposed, validated);
    expect(Object.keys(delta).sort()).toEqual(["end_odometer", "solde_yango"]);
    expect(delta.end_odometer).toEqual({ proposed: 48900, validated: 48910 });
  });

  it("extraction parfaite → delta vide", () => {
    const vals = { end_odometer: 1, yango_gross: 2, yango_bonus: 3, solde_yango: 4, yango_trip_count: 5 };
    expect(computeCorrectionDelta(vals, { ...vals })).toEqual({});
  });
});

describe("kill-switch — contrat flag OFF (zéro impact)", () => {
  const env = (v?: string) =>
    ({ ...(v !== undefined ? { AI_LAYER_ENABLED: v } : {}) }) as unknown as NodeJS.ProcessEnv;
  it("AI_LAYER_ENABLED=off → étage 1 coupé (les routes répondent 204)", () => {
    expect(envEnabled(env("off"))).toBe(false);
    expect(envEnabled(env("OFF"))).toBe(false);
  });
  it("défaut : étage env ouvert (l'étage DB décide, défaut FALSE en 033)", () => {
    expect(envEnabled(env())).toBe(true);
  });
});

describe("prompt vision — invariants de sécurité", () => {
  it("statique : seule la date (contrôlée serveur) est interpolée", () => {
    const p1 = buildVisionPrompt("2026-08-04");
    const p2 = buildVisionPrompt("2026-08-05");
    expect(p1.replace("2026-08-04", "X")).toBe(p2.replace("2026-08-05", "X"));
  });
  it("contient les 5 champs attendus et la règle null-si-illisible", () => {
    const p = buildVisionPrompt("2026-08-04");
    for (const f of EXTRACTION_FIELDS) expect(p).toContain(f);
    expect(p).toContain("null");
    expect(p).toContain("NE CALCULES PAS");
  });
});
