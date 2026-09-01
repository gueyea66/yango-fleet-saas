import { createClient } from "@supabase/supabase-js";
import { REPORT_CSS, periodLabel } from "./reportHtml";

/**
 * Section « analyse » du rapport d'activité, produite par un système externe
 * (analyse multi-agents interfacée avec M3A Fleet).
 *
 * SÉCURITÉ — pourquoi des blocs structurés et jamais de HTML :
 * le rapport est servi par /api/admin/report-file en text/html SUR L'ORIGINE
 * DE L'APPLICATION, qui porte les cookies de session Supabase de l'admin.
 * Accepter du HTML depuis un producteur externe en ferait un vecteur XSS vers
 * ces sessions. Tout le contenu entrant est donc échappé au rendu, et le seul
 * balisage possible est celui que produit ce module.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

// ── Limites : une analyse est une section de rapport, pas un dépôt de données.
export const LIMITS = {
  blocks: 200,
  text: 4000,
  items: 100,
  tableRows: 200,
  tableCols: 12,
  cell: 200,
};

/** Cellule de tableau : valeur simple, ou valeur + annotation discrète en dessous. */
export type Cell = string | number | { v: string | number; note?: string };

export type AnalysisBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[]; ordered?: boolean }
  | { type: "insight"; level?: "info" | "ok" | "warn" | "alert"; text: string }
  | { type: "kpis"; items: { label: string; value: string; sub?: string }[] }
  | { type: "table"; columns: string[]; rows: Cell[][]; align?: ("l" | "r")[]; caption?: string };

/**
 * `section`  → injectée dans le rapport mensuel de la même période.
 * `document` → document autonome (deep dive, analyse hors période de rapport),
 *              rendu en page complète et déposé parmi les rapports du client.
 */
export type AnalysisKind = "section" | "document";

export interface ReportAnalysis {
  kind: AnalysisKind;
  title: string | null;
  subtitle: string | null;
  summary: string | null;
  blocks: AnalysisBlock[];
  model: string | null;
  source: string;
  generatedAt: string | null;
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const str = (v: unknown, max = LIMITS.text): string => String(v ?? "").slice(0, max);

/**
 * Échappe le texte, PUIS convertit `**gras**` en <b>.
 *
 * L'ordre compte : l'échappement neutralise d'abord tout balisage entrant, si
 * bien que le seul HTML produit ici est le <b> que nous écrivons nous-mêmes.
 * Les analyses du système externe reposent entièrement sur des amorces en gras
 * (« **Le carburant pèse 25,7 %** … ») ; sans ça, la section devient illisible.
 */
const rich = (v: unknown): string =>
  esc(v).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

/** Erreur de validation du payload entrant — remontée en 400 par la route. */
export class AnalysisValidationError extends Error {}

/**
 * Valide et normalise les blocs reçus. Tout bloc inconnu ou malformé est
 * REJETÉ explicitement : mieux vaut un 400 lisible côté producteur qu'une
 * section silencieusement tronquée dans un rapport envoyé au client.
 */
export function parseBlocks(raw: unknown): AnalysisBlock[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new AnalysisValidationError("`blocks` doit être un tableau");
  if (raw.length > LIMITS.blocks) {
    throw new AnalysisValidationError(`trop de blocs (${raw.length} > ${LIMITS.blocks})`);
  }

  return raw.map((b, i) => {
    const at = `blocs[${i}]`;
    if (typeof b !== "object" || b === null) throw new AnalysisValidationError(`${at} : objet attendu`);
    const block = b as Record<string, unknown>;

    switch (block.type) {
      case "heading":
      case "paragraph": {
        const text = str(block.text);
        if (!text.trim()) throw new AnalysisValidationError(`${at} : \`text\` requis`);
        return { type: block.type, text } as AnalysisBlock;
      }
      case "insight": {
        const text = str(block.text);
        if (!text.trim()) throw new AnalysisValidationError(`${at} : \`text\` requis`);
        const lv = block.level;
        const level = lv === "ok" || lv === "warn" || lv === "alert" ? lv : "info";
        return { type: "insight", level, text };
      }
      case "bullets": {
        if (!Array.isArray(block.items)) throw new AnalysisValidationError(`${at} : \`items\` doit être un tableau`);
        const items = block.items.slice(0, LIMITS.items).map((x) => str(x)).filter((x) => x.trim());
        if (items.length === 0) throw new AnalysisValidationError(`${at} : \`items\` vide`);
        // Les « décisions proposées » sont numérotées : l'ordre porte du sens.
        return { type: "bullets", items, ...(block.ordered === true ? { ordered: true } : {}) };
      }
      case "kpis": {
        if (!Array.isArray(block.items)) throw new AnalysisValidationError(`${at} : \`items\` doit être un tableau`);
        const items = block.items.slice(0, LIMITS.items).map((x) => {
          const k = (x ?? {}) as Record<string, unknown>;
          return {
            label: str(k.label, LIMITS.cell),
            value: str(k.value, LIMITS.cell),
            ...(k.sub === undefined ? {} : { sub: str(k.sub, LIMITS.cell) }),
          };
        });
        if (items.length === 0) throw new AnalysisValidationError(`${at} : \`items\` vide`);
        return { type: "kpis", items };
      }
      case "table": {
        if (!Array.isArray(block.columns) || !Array.isArray(block.rows)) {
          throw new AnalysisValidationError(`${at} : \`columns\` et \`rows\` requis`);
        }
        const columns = block.columns.slice(0, LIMITS.tableCols).map((c) => str(c, LIMITS.cell));
        if (columns.length === 0) throw new AnalysisValidationError(`${at} : \`columns\` vide`);
        if (block.rows.length > LIMITS.tableRows) {
          throw new AnalysisValidationError(`${at} : trop de lignes (${block.rows.length} > ${LIMITS.tableRows})`);
        }
        const cell = (c: unknown): Cell => {
          if (typeof c === "number") return c;
          if (c && typeof c === "object") {
            const o = c as Record<string, unknown>;
            if (!("v" in o)) throw new AnalysisValidationError(`${at} : cellule objet sans \`v\``);
            return {
              v: typeof o.v === "number" ? o.v : str(o.v, LIMITS.cell),
              ...(o.note === undefined ? {} : { note: str(o.note, LIMITS.cell) }),
            };
          }
          return str(c, LIMITS.cell);
        };
        const rows = block.rows.map((r, j) => {
          if (!Array.isArray(r)) throw new AnalysisValidationError(`${at}.rows[${j}] : tableau attendu`);
          return r.slice(0, columns.length).map(cell);
        });
        const align = Array.isArray(block.align)
          ? block.align.slice(0, columns.length).map((a) => (a === "r" ? "r" : "l") as "l" | "r")
          : undefined;
        const caption = block.caption === undefined ? undefined : str(block.caption);
        return { type: "table", columns, rows, ...(align ? { align } : {}), ...(caption ? { caption } : {}) };
      }
      default:
        throw new AnalysisValidationError(
          `${at} : type « ${String(block.type)} » inconnu (heading|paragraph|bullets|insight|kpis|table)`
        );
    }
  });
}

/** Analyse stockée pour une période, ou null. Ne lève jamais : une analyse absente ne bloque pas un rapport. */
export async function getReportAnalysis(
  tenantId: string,
  dateFrom: string,
  dateTo: string
): Promise<ReportAnalysis | null> {
  try {
    const { data } = await admin
      .from("report_analyses")
      .select("kind, title, subtitle, summary, blocks, model, source, generated_at")
      .eq("tenant_id", tenantId)
      .eq("date_from", dateFrom)
      .eq("date_to", dateTo)
      .order("received_at", { ascending: false })
      .limit(1);

    const row = data?.[0];
    if (!row) return null;
    return {
      kind: row.kind === "document" ? "document" : "section",
      title: row.title ?? null,
      subtitle: row.subtitle ?? null,
      summary: row.summary ?? null,
      blocks: Array.isArray(row.blocks) ? (row.blocks as AnalysisBlock[]) : [],
      model: row.model ?? null,
      source: row.source ?? "external",
      generatedAt: row.generated_at ?? null,
    };
  } catch {
    // Table absente (migration 046 non appliquée) → rapport rendu sans la section.
    return null;
  }
}

/** Rend un bloc — utilisé par la section injectée comme par le document autonome. */
function renderBlock(b: AnalysisBlock): string {
  switch (b.type) {
    case "heading":
      return `<div class="an-h">${esc(b.text)}</div>`;
    case "paragraph":
      return `<p class="an-p">${rich(b.text)}</p>`;
    case "bullets": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag} class="an-ul">${b.items.map((i) => `<li>${rich(i)}</li>`).join("")}</${tag}>`;
    }
    case "insight": {
      const cls = b.level === "info" || !b.level ? "" : b.level;
      return `<div class="insight ${cls}">${rich(b.text)}</div>`;
    }
    case "kpis":
      return `<div class="heroes">${b.items.map((k) =>
        `<div class="hero"><div class="lbl">${esc(k.label)}</div><div class="val">${esc(k.value)}</div>` +
        `${k.sub ? `<div class="sub">${esc(k.sub)}</div>` : ""}</div>`
      ).join("")}</div>`;
    case "table": {
      const al = (i: number) => (b.align?.[i] === "r" ? ' class="r"' : "");
      const head = b.columns.map((c, i) => `<th${al(i)}>${esc(c)}</th>`).join("");
      const cell = (c: Cell | undefined) => {
        if (c && typeof c === "object") {
          return `${rich(c.v)}${c.note ? `<div class="an-cell-note">${esc(c.note)}</div>` : ""}`;
        }
        return rich(c ?? "");
      };
      const rows = b.rows.map((r) =>
        `<tr>${b.columns.map((_, i) => `<td${al(i)}>${cell(r[i])}</td>`).join("")}</tr>`
      ).join("");
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
        + (b.caption ? `<div class="note">${rich(b.caption)}</div>` : "");
    }
  }
  return "";
}

/** Rend la section analyse en HTML — tout le contenu externe est échappé. */
export function renderAnalysisHtml(a: ReportAnalysis | null): string {
  if (!a || (a.blocks.length === 0 && !a.summary)) return "";
  // Un document autonome a sa propre page : il n'est pas fondu dans le rapport.
  if (a.kind === "document") return "";

  const body = a.blocks.map(renderBlock).join("\n");

  const credit = [a.source, a.model, a.generatedAt ? new Date(a.generatedAt).toLocaleDateString("fr-FR") : null]
    .filter(Boolean).map((x) => esc(x)).join(" · ");

  return `<h2>${esc(a.title || "Analyse")}</h2>
${a.summary ? `<div class="tldr">${rich(a.summary)}</div>` : ""}
${body}
<div class="note">Section produite par un système d'analyse externe${credit ? ` — ${credit}` : ""}. Les montants restent ceux calculés par le moteur M3A Fleet.</div>`;
}


/**
 * Rend une analyse `document` en page complète, au même format que le rapport
 * d'activité (même feuille de style, même en-tête, même pied).
 *
 * Sert les analyses dont la période ne correspond à aucun rapport mensuel —
 * un deep dive « 20/06 → 31/07 » n'a pas de rapport hôte où s'insérer. Le
 * fichier produit est déposé dans le même bucket que les rapports : il
 * apparaît donc dans « Rapports reçus » côté client et dans la console
 * opérateur sans plomberie supplémentaire.
 */
export function renderAnalysisDocument(
  a: ReportAnalysis,
  opts: { tenantName: string; dateFrom: string; dateTo: string }
): string {
  const period = periodLabel(opts.dateFrom, opts.dateTo);
  const title = a.title || "Analyse";
  const generated = a.generatedAt ? new Date(a.generatedAt) : new Date();

  const body = a.blocks.map(renderBlock).join("\n");
  const credit = [a.source, a.model].filter(Boolean).map((x) => esc(x)).join(" · ");

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(opts.tenantName)} — ${esc(title)} ${esc(period)}</title>
<style>${REPORT_CSS}
</style></head><body><div class="page">
<div class="print-banner"><span>📄 Ce document est prêt à imprimer ou archiver.</span><button onclick="window.print()">⬇ Télécharger en PDF</button></div>
<div class="doc-header">
  <div class="brand">${esc(opts.tenantName)}</div>
  <div style="font-size:9pt;color:var(--ink3)">${esc(a.subtitle || title)}</div>
  <div class="meta"><b style="color:#A88859;font-size:11pt">${esc(period)}</b><br>Généré le ${generated.toLocaleDateString("fr-FR")} · M3A Fleet SaaS</div>
</div>
${a.summary ? `<div class="tldr">${rich(a.summary)}</div>` : ""}
${body}
<footer><div>${esc(opts.tenantName)} — ${esc(title)} · ${esc(period)}</div><div>Chiffres calculés par le moteur — analyse produite hors application${credit ? ` (${credit})` : ""}.</div></footer>
</div></body></html>`;
}

/** Nom de fichier d'un document d'analyse, stocké aux côtés des rapports. */
export function analysisFileName(source: string, dateFrom: string, dateTo: string): string {
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "analyse";
  return `analyse_${slug}_${dateFrom}_${dateTo}.html`;
}
