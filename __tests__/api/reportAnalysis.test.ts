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
  renderAnalysisDocument,
  analysisFileName,
  AnalysisValidationError,
  LIMITS,
  type ReportAnalysis,
} from "@/lib/reportAnalysis";

jest.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => ({}) }) }));

const analysis = (blocks: unknown[], extra: Partial<ReportAnalysis> = {}): ReportAnalysis => ({
  kind: "section", title: "Analyse", subtitle: null, summary: null,
  model: null, source: "multi-agent", generatedAt: null,
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

describe("fidélité au rendu du système externe", () => {
  // Reproduit la structure réelle du « Deep Dive Opérations & Demande » :
  // sections numérotées, tableau annoté ligne par ligne, légende sous le
  // tableau, amorces en gras, décisions numérotées.
  const deepDive = [
    { type: "heading", text: "1. La semaine type — où est la demande" },
    {
      type: "table",
      columns: ["JOUR", "CA YANGO MOY.", "PANIER MOY.", "TOTAL JOUR", "LECTURE"],
      align: ["l", "r", "r", "r", "l"],
      caption: "Moyennes par jour-chauffeur travaillé sur 66 rapports (20/06 → 31/07), repos exclus.",
      rows: [
        ["Lundi", 48290, 2169, 49835, "volume max, petites courses"],
        [{ v: "Mercredi", note: "meilleur total" }, 47180, 2497, 66227, "moins de courses, plus longues"],
        [{ v: "Jeudi", note: "creux réel" }, 41290, 2343, 45721, "−23 % vs mardi : LE jour faible"],
      ],
    },
    { type: "paragraph", text: "**Le jeudi est ton vrai jour faible** (45 721 F total, −31 % vs mercredi) — pas le lundi." },
    { type: "heading", text: "4. Ce que les données ne disent pas encore" },
    { type: "insight", level: "warn", text: "Le niveau « service client » n'est pas encore mesurable." },
    {
      type: "bullets",
      ordered: true,
      items: [
        "**Recruter vite** — le retard se paie 350-400 000 F/semaine (mesuré en S29).",
        "**Poser les repos et entretiens le JEUDI** (jour le plus faible).",
      ],
    },
  ];

  it("accepte la structure complète du deep dive", () => {
    expect(parseBlocks(deepDive)).toHaveLength(6);
  });

  it("rend les amorces en gras sans laisser passer de HTML", () => {
    const html = renderAnalysisHtml(analysis(deepDive));
    expect(html).toContain("<b>Le jeudi est ton vrai jour faible</b>");
    const injected = renderAnalysisHtml(analysis([
      { type: "paragraph", text: "**<script>x</script>**" },
    ]));
    expect(injected).toContain("<b>&lt;script&gt;");
    expect(injected).not.toContain("<script>");
  });

  it("numérote les décisions proposées", () => {
    const html = renderAnalysisHtml(analysis([{ type: "bullets", ordered: true, items: ["a", "b"] }]));
    expect(html).toContain("<ol");
    expect(renderAnalysisHtml(analysis([{ type: "bullets", items: ["a"] }]))).toContain("<ul");
  });

  it("rend les annotations de cellule et la légende du tableau", () => {
    const html = renderAnalysisHtml(analysis(deepDive));
    expect(html).toContain("creux réel");
    expect(html).toContain("Moyennes par jour-chauffeur");
  });

  it("rend un document autonome en page complète, hors du rapport mensuel", () => {
    const a = analysis(deepDive, {
      kind: "document",
      title: "Deep Dive Opérations & Demande",
      subtitle: "Analyse approfondie",
      summary: "**Ce que les chiffres disent du fonctionnement.** La demande a un rythme clair.",
    });

    // Un document ne s'insère jamais dans le rapport mensuel.
    expect(renderAnalysisHtml(a)).toBe("");

    const doc = renderAnalysisDocument(a, {
      tenantName: "M3A FLEET",
      dateFrom: "2026-06-20",
      dateTo: "2026-07-31",
    });
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("Deep Dive Opérations &amp; Demande");
    expect(doc).toContain("Analyse approfondie");
    expect(doc).toContain("20/06/2026 → 31/07/2026");
    expect(doc).toContain("<b>Ce que les chiffres disent du fonctionnement.</b>");
  });

  it("nomme le fichier de façon lisible et sûre", () => {
    expect(analysisFileName("Deep Dive", "2026-06-20", "2026-07-31"))
      .toBe("analyse_deep-dive_2026-06-20_2026-07-31.html");
    expect(analysisFileName("../../etc", "2026-06-20", "2026-07-31"))
      .toBe("analyse_etc_2026-06-20_2026-07-31.html");
  });
});

export {};
