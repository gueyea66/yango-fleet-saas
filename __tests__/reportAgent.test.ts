import { foreignNumbers } from "@/lib/report-agent/guard";
import { renderReport } from "@/lib/report-agent/render";
import type { ReportDataset } from "@/lib/report-agent/types";

describe("report-agent · garde anti-hallucination", () => {
  it("reconnaît un montant écrit avec séparateur de milliers dans un tableau", () => {
    const payload = JSON.stringify({ sections: [{ lignes: [["Fall", "49 020", "2 030"]] }] });
    expect(foreignNumbers("Fall réalise 49020 F par jour pour 2030 F par course.", payload)).toEqual([]);
  });
  it("rejette toujours un montant absent des données", () => {
    const payload = JSON.stringify({ faits: { recette: 4862585 }, sections: [{ lignes: [["49 020"]] }] });
    expect(foreignNumbers("La recette atteint 4862585 F, soit 51234 F par jour.", payload)).toEqual(["51234"]);
  });
});

describe("report-agent · rendu du tableau de bord de direction", () => {
  const dataset: ReportDataset = {
    meta: { docTitle: "Rapport de direction mensuel", periodLabel: "Période : test", generatedLabel: "04/10/2026", shortLabel: "test" },
    kpis: Array.from({ length: 9 }, (_, i) => ({ label: `KPI ${i + 1}`, value: String(i), delta: i === 0 ? { label: "+7,9 % vs août", tone: "good" as const } : undefined })),
    sections: [{ kind: "table", title: "1. Compte de résultat", columns: [{ label: "Poste" }], rows: [{ cells: ["Recette"] }] }],
    facts: {},
    deterministicInsights: [
      { severity: "ok", html: "<b>Bon point.</b>" }, { severity: "warn", html: "<b>Point faible.</b>" },
      { severity: "alert", html: "<b>Alerte.</b>" }, { severity: "info", html: "<b>Info.</b>" },
    ],
    deterministicDecisions: [{ html: "<b>Décider.</b>" }],
    deterministicFocus: "<b>Priorité.</b>",
    deterministicTldr: "<b>L'essentiel.</b>",
  };
  const theme = { brandName: "TEST", footerBrand: "TEST" };

  it("repli déterministe : synthèse avant le détail, alerte en tête, 8 cartes au plus", () => {
    const html = renderReport(dataset, theme, null);
    const pos = (t: string) => html.indexOf(t);
    expect(pos("Ce qui va moins bien")).toBeGreaterThan(0);
    expect(pos("Ce qui va moins bien")).toBeLessThan(pos("Ce qui va bien"));
    expect(pos("Alerte.")).toBeLessThan(pos("Point faible."));
    expect(pos("Priorité de la période suivante")).toBeLessThan(pos("Le détail des chiffres"));
    expect(pos("Le détail des chiffres")).toBeLessThan(pos("1. Compte de résultat"));
    expect((html.match(/class="hero[ "]/g) || []).length).toBe(8);
    expect(html).toContain('class="delta good"');
  });

  it("narration : décisions en options avec recommandation, texte échappé", () => {
    const html = renderReport(dataset, theme, {
      tldr: "Verdict.", rolesHeard: ["analyste"],
      insights: [{ severity: "warn", title: "Refus", body: "337 refus <script>" }, { severity: "ok", title: "Recette", body: "En hausse" }],
      decisions: [{ title: "Règle sur les refus", body: "", urgence: "7 jours", options: ["Fixer un seuil", "Ne rien changer"], recommandation: "Option A." }],
      focus: "Tenir l'objectif.", manques: ["Carburant non saisi"],
    }, { decisionsTitle: "Décisions à prendre" });
    expect(html).toContain("<b>Option A.</b> Fixer un seuil");
    expect(html).toContain("<b>Option B.</b> Ne rien changer");
    expect(html).toContain("<b>Recommandation.</b> Option A.");
    expect(html).toContain("7 jours");
    expect(html).toContain("Données manquantes");
    expect(html).not.toContain("<script>");
  });
});
