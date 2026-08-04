/**
 * Tests de la couche extraction vision — parsing, normalisation, garde-fous.
 * v2 : schéma « éléments réels Yango » calibré sur de vraies captures
 * (Espèces/Carte/Bonus/Commissions/Services + net affiché en contre-vérif).
 * Zéro appel réseau : tout est pur (extractionParser, checkNetCoherence).
 */
import {
  computeAverageConfidence,
  computeCorrectionDelta,
  detectImageMime,
  emptyExtractionOutput,
  parseExtractionOutput,
  parseValidatedValues,
  ExtractedFields,
} from "@/lib/ai/extractionParser";
import { checkNetCoherence } from "@/lib/ai/coherenceChecks";
import { buildVisionPrompt, EXTRACTION_FIELDS, FORM_FIELDS } from "@/lib/ai/visionPrompt";
import { envEnabled } from "@/lib/ai/killSwitch";

// Capture réelle du 03/08/2026 (vue Comparatif) : 20 commandes, net 33 990,
// Espèces 41 900, Bonus 200, Commission service -6 254, Services supp -605,
// Commissions partenaire -1 251. 41900+200-6254-605-1251 = 33990. Pas de carte.
const realCapture = {
  end_odometer: null, yango_cash: 41900, yango_card: null, yango_bonus: 200,
  commission_yango: 6254, commission_partenaire: 1251, services_supplementaires: 605,
  solde_yango: null, yango_trip_count: 20, net_affiche: 33990,
};
const highConf = Object.fromEntries(EXTRACTION_FIELDS.map((f) => [f, 0.95]));

describe("parseExtractionOutput — parsing nominal (capture réelle 03/08)", () => {
  const nominal = JSON.stringify({
    fields: realCapture,
    confidences: highConf,
    source_type: "yango_pro_screenshot",
    conflicts: [],
  });

  it("parse la capture réelle", () => {
    const out = parseExtractionOutput(nominal);
    expect(out).not.toBeNull();
    expect(out!.fields.yango_cash).toBe(41900);
    expect(out!.fields.yango_card).toBeNull();
    expect(out!.fields.commission_yango).toBe(6254);
    expect(out!.fields.commission_partenaire).toBe(1251);
    expect(out!.fields.services_supplementaires).toBe(605);
    expect(out!.fields.yango_trip_count).toBe(20);
    expect(out!.fields.net_affiche).toBe(33990);
    expect(out!.source_type).toBe("yango_pro_screenshot");
  });

  it("tolère le texte parasite autour du JSON (fences, préambule)", () => {
    const noisy = "Voici le résultat :\n```json\n" + nominal + "\n```\nFin.";
    expect(parseExtractionOutput(noisy)!.fields.yango_cash).toBe(41900);
  });

  it("commissions renvoyées en NÉGATIF (affichage Yango) → valeur absolue", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { ...realCapture, commission_yango: -6254, commission_partenaire: -1251, services_supplementaires: -605 },
      confidences: highConf,
      source_type: "yango_pro_screenshot",
    }));
    expect(out!.fields.commission_yango).toBe(6254);
    expect(out!.fields.commission_partenaire).toBe(1251);
    expect(out!.fields.services_supplementaires).toBe(605);
  });

  it("valeur négative sur un champ non-déduction (espèces) → null (aberrant)", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { ...realCapture, yango_cash: -41900 },
      confidences: highConf,
      source_type: "yango_pro_screenshot",
    }));
    expect(out!.fields.yango_cash).toBeNull();
  });
});

describe("parseExtractionOutput — sorties dégradées et garde-fous", () => {
  it("réponse non-JSON → null (mode dégradé, jamais de throw)", () => {
    expect(parseExtractionOutput("Je ne peux pas lire ces images.")).toBeNull();
    expect(parseExtractionOutput("")).toBeNull();
  });

  it("champ manquant → null avec confiance 0", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { yango_cash: 41900 },
      confidences: { yango_cash: 0.9 },
      source_type: "yango_pro_screenshot",
    }));
    expect(out!.fields.end_odometer).toBeNull();
    expect(out!.confidences.end_odometer).toBe(0);
    expect(out!.fields.yango_cash).toBe(41900);
  });

  it("confiance < 0.60 → valeur forcée à null (règle null-if-uncertain)", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { ...emptyExtractionOutput().fields, end_odometer: 187432 },
      confidences: { ...emptyExtractionOutput().confidences, end_odometer: 0.42 },
      source_type: "odometer_photo",
    }));
    expect(out!.fields.end_odometer).toBeNull();
    expect(out!.confidences.end_odometer).toBe(0);
  });

  it("confiance hors bornes → clampée dans [0,1]", () => {
    const out = parseExtractionOutput(JSON.stringify({
      fields: { ...emptyExtractionOutput().fields, yango_cash: 100000 },
      confidences: { ...emptyExtractionOutput().confidences, yango_cash: 1.7, yango_card: -2 },
      source_type: "unknown",
    }));
    expect(out!.confidences.yango_cash).toBe(1);
    expect(out!.confidences.yango_card).toBe(0);
  });

  it("source_type inconnu → 'unknown'", () => {
    const out = parseExtractionOutput(JSON.stringify({ fields: {}, confidences: {}, source_type: "invoice_scan" }));
    expect(out!.source_type).toBe("unknown");
  });
});

describe("checkNetCoherence — contre-vérification arithmétique (jamais LLM)", () => {
  it("capture réelle : les éléments recoupent le net → aucune alerte", () => {
    expect(checkNetCoherence(realCapture as ExtractedFields)).toBeNull();
  });

  it("lecture fausse (espèces 44900 au lieu de 41900) → alerte net_mismatch", () => {
    const alert = checkNetCoherence({ ...realCapture, yango_cash: 44900 } as ExtractedFields);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe("net_mismatch");
    // toLocaleString("fr-FR") sépare les milliers par une espace fine insécable
    expect(alert!.message).toMatch(/36\s990/); // reconstitué
    expect(alert!.message).toMatch(/33\s990/); // net affiché
  });

  it("avec carte : espèces + carte comptent dans la reconstitution", () => {
    const withCard = { ...realCapture, yango_card: 5000, net_affiche: 38990 };
    expect(checkNetCoherence(withCard as ExtractedFields)).toBeNull();
  });

  it("tolérance d'arrondi ±5 FCFA", () => {
    expect(checkNetCoherence({ ...realCapture, net_affiche: 33987 } as ExtractedFields)).toBeNull();
    expect(checkNetCoherence({ ...realCapture, net_affiche: 33980 } as ExtractedFields)).not.toBeNull();
  });

  it("net absent ou espèces absentes → pas de contrôle (pas de faux positif)", () => {
    expect(checkNetCoherence({ ...realCapture, net_affiche: null } as ExtractedFields)).toBeNull();
    expect(checkNetCoherence({ ...realCapture, yango_cash: null } as ExtractedFields)).toBeNull();
  });
});

describe("computeAverageConfidence — déclencheur de fallback", () => {
  it("image dégradée → sous le seuil 0.75", () => {
    const conf = { ...emptyExtractionOutput().confidences, end_odometer: 0.42 };
    expect(computeAverageConfidence(conf)).toBeLessThan(0.75);
  });
  it("extraction nette → au-dessus du seuil", () => {
    expect(computeAverageConfidence(highConf as Record<(typeof EXTRACTION_FIELDS)[number], number>)).toBeGreaterThan(0.75);
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
  it("parseValidatedValues normalise, arrondit, ignore net_affiche", () => {
    const v = parseValidatedValues({ validated_values: { yango_cash: 41900.6, yango_card: null, commission_yango: 6254, net_affiche: 99999, solde_yango: "abc" } });
    expect(v).not.toBeNull();
    expect(v!.yango_cash).toBe(41901);
    expect(v!.solde_yango).toBeNull();
    expect("net_affiche" in v!).toBe(false);
  });

  it("body invalide → null", () => {
    expect(parseValidatedValues(null)).toBeNull();
    expect(parseValidatedValues({})).toBeNull();
    expect(parseValidatedValues({ validated_values: "x" })).toBeNull();
  });

  it("correction_delta ne liste que les champs corrigés (net_affiche exclu)", () => {
    const proposed = { ...realCapture } as ExtractedFields;
    const validated: Record<string, number | null> = { ...realCapture, yango_cash: 42000 };
    delete validated.net_affiche;
    const delta = computeCorrectionDelta(proposed, validated);
    expect(Object.keys(delta)).toEqual(["yango_cash"]);
    expect(delta.yango_cash).toEqual({ proposed: 41900, validated: 42000 });
  });

  it("extraction parfaite → delta vide", () => {
    const vals = { ...realCapture } as ExtractedFields;
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

describe("prompt vision v2 — invariants", () => {
  it("statique : seule la date (contrôlée serveur) est interpolée", () => {
    const p1 = buildVisionPrompt("2026-08-04");
    const p2 = buildVisionPrompt("2026-08-05");
    expect(p1.replace(/2026-08-04/g, "X")).toBe(p2.replace(/2026-08-05/g, "X"));
  });
  it("contient les 10 champs, l'ancrage par libellés et la règle null-si-illisible", () => {
    const p = buildVisionPrompt("2026-08-04");
    for (const f of EXTRACTION_FIELDS) expect(p).toContain(f);
    expect(p).toContain("Espèces");
    expect(p).toContain("Commission du service");
    expect(p).toContain("LIBELLÉS");
    expect(p).toContain("NE CALCULES PAS");
  });
  it("FORM_FIELDS = tous les champs sauf net_affiche", () => {
    expect(FORM_FIELDS).not.toContain("net_affiche");
    expect(FORM_FIELDS.length).toBe(EXTRACTION_FIELDS.length - 1);
  });
});
