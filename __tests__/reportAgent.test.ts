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

  it("plan par défaut (sans profil) : alerte en tête, 8 cartes au plus, variation affichée", () => {
    const html = renderReport(dataset, theme, null);
    const pos = (t: string) => html.indexOf(t);
    expect(pos("Alerte.")).toBeGreaterThan(0);
    expect(pos("Alerte.")).toBeLessThan(pos("Point faible."));
    expect((html.match(/class="hero[ "]/g) || []).length).toBe(8);
    expect(html).toContain('class="delta good"');
  });

  it("profil : les faits d'abord, le jugement ensuite, les décisions à la fin", () => {
    const html = renderReport({
      ...dataset,
      sections: [{ kind: "table", title: "1. Compte de résultat", lead: "<b>À retenir.</b>", columns: [{ label: "Poste" }], rows: [{ cells: ["Recette"] }] }],
      deterministicManques: ["Carburant non saisi"],
      profile: {
        roles: [{ id: "contrôle financier", system: "périmètre" }], editorSystem: "rédacteur",
        decisionStyle: "options", caps: { forces: 3, alertes: 3, info: 0 },
        labels: { forces: "Ce qui va bien", alertes: "Ce qui va moins bien", decisions: "Décisions à prendre ce mois-ci", focus: "Focus du mois prochain", manques: "Données manquantes" },
        layout: ["tldr", "kpis", { sections: [0] }, "forces", "alertes", "decisions", "focus", "manques", { heading: "Pour aller plus loin", text: "Voir le deep dive." }],
      },
    }, theme, null);
    const pos = (t: string) => html.indexOf(t);
    const ordre = ["1. Compte de résultat", "À retenir.", "Ce qui va bien", "Ce qui va moins bien", "Décisions à prendre ce mois-ci", "Focus du mois prochain", "Données manquantes", "Pour aller plus loin"].map(pos);
    expect(ordre.every((v) => v > 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(html).not.toContain("Info."); // rubrique « à savoir » fermée par le profil
  });

  it("profil « actions » : plan d'action en tableau (qui, quand, gain)", () => {
    const html = renderReport({
      ...dataset,
      deterministicDecisions: [{ html: "<b>Déplacer le repos</b>", responsable: "Exploitation", echeance: "cette semaine", gain: "+60 000 F / mois" }],
      profile: { roles: [], editorSystem: "", decisionStyle: "actions", labels: { decisions: "Plan d'action" }, layout: ["tldr", { sections: [0] }, "alertes", "decisions"] },
    }, theme, null);
    expect(html).toContain("Plan d'action");
    expect(html).toContain("<th>Responsable</th>");
    expect(html).toContain("<td>Exploitation</td><td>cette semaine</td><td>+60 000 F / mois</td>");
    expect(html.indexOf("Point faible.")).toBeLessThan(html.indexOf("Plan d'action"));
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

describe("report-agent · graphiques", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { columnsChart, targetBars, heatmap } = require("@/lib/report-agent/charts");
  const fmt = (v: number) => String(Math.round(v));
  const sane = (svg: string) => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  };

  it("colonnes : une marque par valeur, légende dès deux séries, repère d'objectif", () => {
    const svg = columnsChart({
      label: "test", categories: ["a", "b", "c"], fmt, highlight: 2, target: { value: 40, label: "Objectif 40" },
      series: [{ name: "Recette", values: [10, 50, 30] }, { name: "Net", values: [5, 20, 0] }],
    });
    sane(svg);
    expect((svg.match(/<path /g) || []).length).toBe(5); // la valeur nulle ne dessine rien
    expect(svg).toContain("Recette");
    expect(svg).toContain("Objectif 40");
  });

  it("colonnes : tient sans donnée et avec des zéros", () => {
    sane(columnsChart({ label: "vide", categories: ["a"], fmt, series: [{ name: "x", values: [0] }] }));
  });

  it("barres face à une cible et carte de chaleur", () => {
    const bars = targetBars({ label: "t", target: 40000, targetLabel: "Objectif", fmt, rows: [{ label: "Chauffeur <A>", value: 49020, note: "atteint" }, { label: "B", value: 0 }] });
    sane(bars);
    expect(bars).toContain("Chauffeur &lt;A&gt;");
    const hm = heatmap({ label: "h", rows: ["Lundi", "Mardi"], cols: ["6–8h", "8–10h"], values: [[0, 10], [20, 5]], fmt, legend: "Chiffre" });
    sane(hm);
    expect((hm.match(/<title>/g) || []).length).toBe(4);
  });
});

describe("report-agent · panel par profil (LLM simulé)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runAgentPanel } = require("@/lib/report-agent/agents");
  const base: ReportDataset = {
    meta: { docTitle: "Deep dive opérationnel", periodLabel: "test", generatedLabel: "04/10/2026", shortLabel: "test" },
    kpis: [], sections: [{ kind: "table", title: "Performance", columns: [{ label: "Chauffeur" }, { label: "CA / jour", align: "right" }], rows: [{ cells: ["Awa Diop", "38 681"] }] }],
    facts: { objectif: 40000, chauffeur_drv_abc123_gain_mensuel_estime_fcfa: 60506 },
    aliases: { drv_abc123: "Awa Diop" },
    deterministicInsights: [], deterministicTldr: "",
    profile: {
      roles: [{ id: "demande", system: "périmètre demande" }, { id: "chauffeurs", system: "périmètre chauffeurs" }],
      editorSystem: "Tu es le responsable d'exploitation.", decisionStyle: "actions",
      caps: { alertes: 5, decisions: 6 }, layout: ["tldr", "alertes", "decisions"],
    },
  };

  it("chaque rôle reste dans son périmètre, le rédacteur lit leurs constats, le plan d'action est structuré", async () => {
    const calls: { system: string; payload: string }[] = [];
    const narrate = async (payload: string, opts?: { system?: string }) => {
      calls.push({ system: opts?.system ?? "", payload });
      if (opts?.system?.startsWith("périmètre")) {
        return JSON.stringify({ findings: [{ severity: "warn", title: "Repos mal placé", body: "drv_abc123 s'arrête un jour fort : 60506 F par mois." }] });
      }
      return JSON.stringify({
        synthese: "drv_abc123 réalise 38681 F par jour pour un objectif de 40000 F.",
        alertes: [{ severity: "alert", title: "Repos de drv_abc123", body: "60506 F par mois à récupérer." }],
        points_forts: [{ title: "Constance", body: "Les lundis tiennent." }],
        actions: [{ action: "Déplacer le repos de drv_abc123 au mercredi", responsable: "exploitation", echeance: "cette semaine", gain_attendu: "60506 F par mois, estimation" }],
        donnees_manquantes: [],
      });
    };
    const out = await runAgentPanel(base, { narrate });
    expect(out).not.toBeNull();
    // 2 rôles + 1 rédacteur ; le nom réel n'est jamais envoyé
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => !c.payload.includes("Awa Diop"))).toBe(true);
    expect(calls[0].system).toContain("STRICTEMENT dans ton périmètre");
    expect(calls[2].system.startsWith("Tu es le responsable d'exploitation.")).toBe(true);
    expect(calls[2].payload).toContain("constats_experts");
    // noms réinjectés, montants mis en forme, plan d'action structuré
    expect(out.tldr).toContain("Awa Diop");
    expect(out.tldr).toMatch(/38.681/);
    expect(out.insights.map((i: { severity: string }) => i.severity)).toEqual(["alert", "ok"]);
    expect(out.decisions[0]).toMatchObject({ title: "Déplacer le repos de Awa Diop au mercredi", responsable: "exploitation", urgence: "cette semaine" });
    expect(out.decisions[0].gain).toMatch(/60.506/);
    expect(out.rolesHeard).toEqual(["demande", "chauffeurs"]);
  });

  it("un montant inventé par le rédacteur fait retomber sur le repli", async () => {
    const narrate = async (_p: string, opts?: { system?: string }) => (opts?.system?.startsWith("périmètre")
      ? JSON.stringify({ findings: [{ severity: "info", title: "x", body: "y" }] })
      : JSON.stringify({ synthese: "Gain de 99999 F.", alertes: [{ severity: "warn", title: "a", body: "b" }], actions: [] }));
    expect(await runAgentPanel(base, { narrate })).toBeNull();
  });
});
