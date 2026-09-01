/**
 * Analyse externe injectée dans le rapport.
 *
 * Le rapport est servi en text/html sur l'origine de l'application, qui porte
 * les cookies de session admin : le contenu venu d'un système tiers DOIT être
 * échappé, sans quoi l'intégration devient un vecteur XSS vers ces sessions.
 */
import {
  parseBlocks,
  renderAnalysisHtml,
  AnalysisValidationError,
  LIMITS,
  type ReportAnalysis,
} from "@/lib/reportAnalysis";

jest.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => ({}) }) }));

const analysis = (blocks: unknown[], extra: Partial<ReportAnalysis> = {}): ReportAnalysis => ({
  title: "Analyse", summary: null, model: null, source: "multi-agent", generatedAt: null,
  blocks: parseBlocks(blocks), ...extra,
});

describe("parseBlocks — validation du payload externe", () => {
  it("accepte les six types de blocs", () => {
    const blocks = parseBlocks([
      { type: "heading", text: "Marge" },
      { type: "paragraph", text: "La marge progresse." },
      { type: "bullets", items: ["a", "b"] },
      { type: "insight", level: "alert", text: "Carburant en hausse" },
      { type: "kpis", items: [{ label: "Marge", value: "18 %", sub: "vs 14 %" }] },
      { type: "table", columns: ["Chauffeur", "Net"], rows: [["Awa", 120000]], align: ["l", "r"] },
    ]);
    expect(blocks).toHaveLength(6);
    expect(blocks.map((b) => b.type)).toEqual(
      ["heading", "paragraph", "bullets", "insight", "kpis", "table"]
    );
  });

  it("rejette un type inconnu avec la position du bloc", () => {
    expect(() => parseBlocks([{ type: "paragraph", text: "ok" }, { type: "html", text: "<b>x</b>" }]))
      .toThrow(/blocs\[1\].*html/);
  });

  it("rejette un texte vide plutôt que de rendre un bloc muet", () => {
    expect(() => parseBlocks([{ type: "paragraph", text: "  " }])).toThrow(AnalysisValidationError);
  });

  it("rejette un tableau de blocs trop long", () => {
    const many = Array.from({ length: LIMITS.blocks + 1 }, () => ({ type: "paragraph", text: "x" }));
    expect(() => parseBlocks(many)).toThrow(/trop de blocs/);
  });

  it("tronque les textes trop longs au lieu de refuser", () => {
    const [b] = parseBlocks([{ type: "paragraph", text: "x".repeat(LIMITS.text + 500) }]);
    expect((b as { text: string }).text).toHaveLength(LIMITS.text);
  });

  it("normalise un niveau d'insight inconnu en info", () => {
    const [b] = parseBlocks([{ type: "insight", level: "catastrophe", text: "x" }]);
    expect(b).toMatchObject({ type: "insight", level: "info" });
  });

  it("tolère une analyse sans blocs", () => {
    expect(parseBlocks(undefined)).toEqual([]);
    expect(() => parseBlocks("pas un tableau")).toThrow(/tableau/);
  });
});

describe("renderAnalysisHtml — échappement du contenu externe", () => {
  it("neutralise le HTML injecté dans un paragraphe", () => {
    const html = renderAnalysisHtml(analysis([
      { type: "paragraph", text: '<script>fetch("/api/admin/drivers")</script>' },
    ]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("neutralise le HTML dans les cellules de tableau et les puces", () => {
    const html = renderAnalysisHtml(analysis([
      { type: "table", columns: ["<img onerror=x>"], rows: [['<a href="javascript:1">z</a>']] },
      { type: "bullets", items: ["<b>gras</b>"] },
    ]));
    expect(html).not.toMatch(/<img|<a href|<b>/);
    expect(html).toContain("&lt;img");
  });

  it("échappe aussi le titre, le résumé et le crédit", () => {
    const html = renderAnalysisHtml(analysis(
      [{ type: "paragraph", text: "ok" }],
      { title: "<x>T", summary: "<y>S", model: "<z>M" }
    ));
    expect(html).not.toMatch(/<x>|<y>|<z>/);
  });

  it("ne rend rien quand il n'y a ni résumé ni blocs", () => {
    expect(renderAnalysisHtml(null)).toBe("");
    expect(renderAnalysisHtml(analysis([]))).toBe("");
  });

  it("rend une section complète quand l'analyse est présente", () => {
    const html = renderAnalysisHtml(analysis(
      [{ type: "kpis", items: [{ label: "Marge", value: "18 %" }] }],
      { title: "Analyse multi-agents", summary: "Mois solide." }
    ));
    expect(html).toContain("Analyse multi-agents");
    expect(html).toContain("Mois solide.");
    expect(html).toContain("18 %");
    expect(html).toContain("Section produite par un système d'analyse externe");
  });
});

export {};
