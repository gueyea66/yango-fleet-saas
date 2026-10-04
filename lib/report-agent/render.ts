/**
 * report-agent — rendu HTML brandé imprimable (charte navy/gold par défaut,
 * surchargée par BrandTheme). Une seule fonction : renderReport().
 * RÈGLE : aucun import hors de lib/report-agent/ (voir README.md).
 */

import type { BrandTheme, Insight, NarrativeResult, ReportDataset, Section } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function css(t: BrandTheme): string {
  const c = {
    navy: "#0E2640", navyDeep: "#061A33", navySoft: "#1B3A5C",
    gold: "#C5A572", goldDark: "#A88859", goldLight: "#E8DCC1", bg: "#FAF8F4",
    ...(t.colors ?? {}),
  };
  return `
  :root{--navy:${c.navy};--navy-deep:${c.navyDeep};--navy-soft:${c.navySoft};--gold:${c.gold};--gold-dark:${c.goldDark};--gold-light:${c.goldLight};
    --ink:#1F2937;--ink2:#374151;--ink3:#6B7280;--border:#D1D5DB;--bg:${c.bg};
    --red:#B91C1C;--red-bg:#FEF2F2;--amber:#B45309;--amber-bg:#FFFBEB;--green:#15803D;--green-bg:#F0FDF4}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,'Segoe UI',Helvetica,sans-serif;color:var(--ink);background:var(--bg);font-size:11pt;line-height:1.55}
  .page{max-width:800px;margin:0 auto;padding:28px 34px 40px}
  h1,h2{font-family:'Cormorant Garamond',Garamond,Georgia,serif;color:var(--navy)}
  h2{font-size:19pt;margin:28px 0 10px;border-bottom:2px solid var(--gold);padding-bottom:4px}
  h3{font-size:10pt;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3);margin:16px 0 6px}
  .print-banner{background:var(--gold-light);border:1px solid var(--gold);border-radius:8px;padding:10px 14px;font-size:9.5pt;color:var(--navy-deep);margin-bottom:18px;display:flex;align-items:center;gap:12px;justify-content:space-between}
  .print-banner button{background:var(--navy);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:9.5pt;font-weight:700;cursor:pointer}
  @media print{.print-banner{display:none}.page{padding:0}body{background:#fff}}
  .doc-header{display:flex;align-items:center;gap:18px;border-bottom:3px solid var(--navy);padding-bottom:14px}
  .doc-header img{height:64px}
  .doc-header .brand{font-family:'Cormorant Garamond',Garamond,Georgia,serif;font-size:24pt;font-weight:700;color:var(--navy)}
  .doc-header .meta{margin-left:auto;text-align:right;font-size:9pt;color:var(--ink3)}
  .doc-header .meta b{color:var(--gold-dark);font-size:11pt;display:block}
  .tldr{background:linear-gradient(135deg,var(--navy) 0%,var(--navy-soft) 100%);color:#fff;border-left:5px solid var(--gold);border-radius:8px;padding:16px 20px;margin:20px 0;font-size:10.5pt}
  .tldr b{color:var(--gold-light)}
  .heroes{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
  .hero{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px}
  .hero .lbl{font-size:8pt;text-transform:uppercase;letter-spacing:.07em;color:var(--ink3);font-weight:700}
  .hero .val{font-size:15pt;font-weight:800;color:var(--navy);margin-top:2px}
  .hero .sub{font-size:8.5pt;color:var(--ink3)}
  .hero.gold{border-color:var(--gold);background:var(--gold-light)}
  .hero.gold .val{color:var(--navy-deep)}
  .hero .delta{font-size:8.5pt;font-weight:700;margin-top:2px}
  .hero .delta.good{color:var(--green)}.hero .delta.bad{color:var(--red)}.hero .delta.flat{color:var(--ink3)}
  .mini{display:inline-block;height:8px;border-radius:99px;background:linear-gradient(90deg,var(--gold-dark),var(--gold));vertical-align:middle}
  td.sub{padding-left:22px;color:var(--ink2);font-size:9pt}
  .pos{color:var(--green);font-weight:700}.neg{color:var(--red);font-weight:700}
  h2{break-after:avoid}table,.insight,.decisions,.bar-row{break-inside:avoid}
  table{border-collapse:collapse;width:100%;font-size:9.5pt;background:#fff}
  th{background:var(--navy);color:#fff;padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em}
  th.r,td.r{text-align:right;white-space:nowrap}
  td{padding:7px 8px;border-bottom:1px solid var(--border)}
  tr.total td{font-weight:800;background:var(--gold-light);color:var(--navy-deep);border-top:2px solid var(--gold)}
  tr.hl-ok td{background:var(--green-bg)}
  tr.hl-alert td{background:var(--red-bg)}
  .tag{display:inline-block;font-size:7.5pt;font-weight:700;padding:1px 7px;border-radius:99px;vertical-align:middle}
  .tag.amber{background:var(--amber-bg);color:var(--amber)}
  .tag.green{background:var(--green-bg);color:var(--green)}
  .tag.navy{background:#E8EEF6;color:var(--navy)}
  .tag.red{background:var(--red-bg);color:var(--red)}
  .bar-row{display:flex;align-items:center;gap:10px;margin:4px 0;font-size:9.5pt}
  .bar-row .cat{width:150px;color:var(--ink2)}
  .bar-row .track{flex:1;background:#EDE9E0;border-radius:99px;height:14px;overflow:hidden}
  .bar-row .fill{background:linear-gradient(90deg,var(--navy),var(--navy-soft));height:100%;border-radius:99px}
  .bar-row .fill.gold{background:linear-gradient(90deg,var(--gold-dark),var(--gold))}
  .bar-row .amt{width:150px;text-align:right;font-weight:600;color:var(--navy);white-space:nowrap}
  .insight{background:#fff;border:1px solid var(--border);border-left:4px solid var(--gold);border-radius:8px;padding:12px 16px;margin:8px 0;font-size:10pt}
  .insight b{color:var(--navy)}
  .insight.alert{border-left-color:var(--red);background:var(--red-bg)}
  .insight.warn{border-left-color:var(--amber);background:var(--amber-bg)}
  .insight.ok{border-left-color:var(--green);background:var(--green-bg)}
  .decisions{background:var(--navy);color:#fff;border-radius:10px;padding:16px 20px;margin:16px 0}
  .decisions h3{color:var(--gold-light);margin-top:0}
  .decisions ol{margin-left:18px}
  .decisions li{margin:7px 0;font-size:10pt}
  .decision{background:#fff;border:1px solid var(--border);border-top:3px solid var(--navy);border-radius:8px;padding:12px 16px;margin:10px 0;font-size:10pt;break-inside:avoid}
  .decision .dt{font-weight:800;color:var(--navy);font-size:10.5pt}
  .decision .opt{margin:6px 0 0 0;padding-left:12px;border-left:2px solid var(--border)}
  .decision .opt b{color:var(--ink2)}
  .decision .reco{margin-top:8px;background:var(--gold-light);border-radius:6px;padding:7px 10px;color:var(--navy-deep)}
  .focus{background:linear-gradient(135deg,var(--navy) 0%,var(--navy-soft) 100%);color:#fff;border-radius:10px;padding:14px 20px;margin:16px 0;font-size:10.5pt}
  .focus h3{color:var(--gold-light);margin:0 0 4px}
  .detail{margin-top:34px;padding-top:6px;border-top:3px solid var(--navy)}
  .detail > .lead{font-size:9pt;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-top:8px}
  .manques{font-size:9pt;color:var(--ink3);margin-top:14px}
  .manques li{margin-left:16px}
  footer{margin-top:28px;padding-top:12px;border-top:1px solid var(--border);font-size:8.5pt;color:var(--ink3);display:flex;justify-content:space-between}
  .note{font-size:8.5pt;color:var(--ink3);font-style:italic;margin-top:6px}`;
}

function renderSection(s: Section): string {
  if (s.kind === "bars") {
    const rows = s.bars.map((b) =>
      `<div class="bar-row"><div class="cat">${esc(b.label)}</div><div class="track"><div class="fill${b.accent ? " gold" : ""}" style="width:${Math.min(100, Math.max(1, b.pct))}%"></div></div><div class="amt">${esc(b.amountLabel)}</div></div>`
    ).join("\n");
    return `<h2>${esc(s.title)}</h2>\n${rows}${s.note ? `\n<div class="note">${esc(s.note)}</div>` : ""}`;
  }
  const head = s.columns.map((col) => `<th${col.align === "right" ? ' class="r"' : ""}>${esc(col.label)}</th>`).join("");
  const body = s.rows.map((r) => {
    const cls = r.total ? ' class="total"' : r.highlight ? ` class="hl-${r.highlight}"` : "";
    const cells = r.cells.map((cell, index) =>
      `<td${s.columns[index]?.align === "right" ? ' class="r"' : ""}>${cell}</td>`).join("");
    return `<tr${cls}>${cells}</tr>`;
  }).join("\n");
  return `<h2>${esc(s.title)}</h2>\n<table><thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody></table>${s.note ? `\n<div class="note">${esc(s.note)}</div>` : ""}`;
}

/**
 * Rend le rapport complet. `narrative` (sortie du panel, texte brut → échappé)
 * prime sur le repli déterministe du dataset (HTML de confiance, non échappé).
 */
export function renderReport(
  dataset: ReportDataset,
  theme: BrandTheme,
  narrative: NarrativeResult | null,
  opts?: { decisionsTitle?: string }
): string {
  const m = dataset.meta;
  const tldr = narrative
    ? `<b>L'essentiel en 30 secondes.</b> ${esc(narrative.tldr)}`
    : dataset.deterministicTldr;

  const insights: Insight[] = narrative
    ? narrative.insights.map((i) => ({
        severity: i.severity,
        html: `<b>${esc(i.title)}${/[.!?]$/.test(i.title) ? "" : "."}</b> ${esc(i.body)}`,
      }))
    : dataset.deterministicInsights;

  const heroes = dataset.kpis.slice(0, 8).map((k) =>
    `<div class="hero${k.accent ? " gold" : ""}"><div class="lbl">${esc(k.label)}</div><div class="val">${esc(k.value)}</div>${k.delta ? `<div class="delta ${k.delta.tone}">${esc(k.delta.label)}</div>` : ""}${k.sub ? `<div class="sub">${esc(k.sub)}</div>` : ""}</div>`
  ).join("\n");

  // Synthèse de direction : ce qui va bien, ce qui va moins bien, puis le reste.
  const block = (list: Insight[]) => list.map((i) =>
    `<div class="insight${i.severity === "info" ? "" : ` ${i.severity}`}">${i.html}</div>`).join("\n");
  const bien = insights.filter((i) => i.severity === "ok");
  const moinsBien = insights.filter((i) => i.severity === "warn" || i.severity === "alert")
    .sort((x, y) => Number(y.severity === "alert") - Number(x.severity === "alert"));
  const aSavoir = insights.filter((i) => i.severity === "info");
  const synthese = [
    moinsBien.length ? `<h2>Ce qui va moins bien</h2>\n${block(moinsBien)}` : "",
    bien.length ? `<h2>Ce qui va bien</h2>\n${block(bien)}` : "",
    aSavoir.length ? `<h2>À savoir</h2>\n${block(aSavoir)}` : "",
  ].filter(Boolean).join("\n\n");

  const decisionsTitle = esc(opts?.decisionsTitle ?? "Décisions proposées");
  const letters = ["A", "B", "C"];
  const decisionsBlock = narrative
    ? (narrative.decisions.length > 0
      ? `<h2>${decisionsTitle}</h2>\n` + narrative.decisions.map((d, n) =>
        `<div class="decision"><div class="dt">${n + 1}. ${esc(d.title)}${d.urgence ? ` <span class="tag amber">${esc(d.urgence)}</span>` : ""}</div>`
        + (d.body ? `<div>${esc(d.body)}</div>` : "")
        + (d.options ?? []).map((o, k) => `<div class="opt"><b>Option ${letters[k] ?? k + 1}.</b> ${esc(o)}</div>`).join("")
        + (d.recommandation ? `<div class="reco"><b>Recommandation.</b> ${esc(d.recommandation)}</div>` : "")
        + `</div>`).join("\n")
      : "")
    : ((dataset.deterministicDecisions ?? []).length > 0
      ? `<div class="decisions">\n  <h3>${decisionsTitle}</h3>\n  <ol>\n${(dataset.deterministicDecisions ?? []).map((d) => `    <li>${d.html}</li>`).join("\n")}\n  </ol>\n</div>`
      : "");

  const focus = narrative?.focus ? esc(narrative.focus) : dataset.deterministicFocus ?? "";
  const focusBlock = focus ? `<div class="focus"><h3>Priorité de la période suivante</h3>${focus}</div>` : "";
  const manques = narrative?.manques ?? [];
  const manquesBlock = manques.length
    ? `<div class="manques"><b>Données manquantes</b><ul>${manques.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(theme.brandName)} — ${esc(m.docTitle)} · ${esc(m.shortLabel)}</title>
<style>${css(theme)}</style></head>
<body><div class="page">
<div class="print-banner"><span>📄 Ce rapport est prêt à imprimer ou archiver.</span><button onclick="window.print()">⬇ Télécharger en PDF</button></div>
<div class="doc-header">
${theme.logoImgTag ?? ""}
  <div>
    <div class="brand">${esc(theme.brandName)}</div>
    ${theme.tagline ? `<div style="font-size:9pt;color:var(--ink3)">${esc(theme.tagline)}</div>` : ""}
  </div>
  <div class="meta">
    <b>${esc(m.docTitle)}</b>
    ${esc(m.periodLabel)}<br>
    Généré le ${esc(m.generatedLabel)}${m.sourceLabel ? ` · ${esc(m.sourceLabel)}` : ""}
  </div>
</div>
<div class="tldr">${tldr}</div>
<div class="heroes">
${heroes}
</div>
${synthese}
${decisionsBlock}
${focusBlock}
${dataset.sections.length > 0 ? `<div class="detail"><div class="lead">Le détail des chiffres</div>\n${dataset.sections.map(renderSection).join("\n\n")}\n</div>` : ""}
${manquesBlock}
<footer>
  <div>${esc(theme.footerBrand)} — ${esc(m.docTitle)} · ${esc(m.shortLabel)}</div>
  <div>Chiffres calculés par le moteur — ${narrative ? "analyse rédigée par le panel IA, aucun montant recalculé" : "règles déterministes, aucun montant recalculé"}.</div>
</footer>
</div></body></html>`;
}
