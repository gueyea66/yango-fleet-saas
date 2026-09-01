import { createClient } from "@supabase/supabase-js";

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

export type AnalysisBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "insight"; level?: "info" | "ok" | "warn" | "alert"; text: string }
  | { type: "kpis"; items: { label: string; value: string; sub?: string }[] }
  | { type: "table"; columns: string[]; rows: (string | number)[][]; align?: ("l" | "r")[] };

export interface ReportAnalysis {
  title: string | null;
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
        return { type: "bullets", items };
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
        const rows = block.rows.map((r, j) => {
          if (!Array.isArray(r)) throw new AnalysisValidationError(`${at}.rows[${j}] : tableau attendu`);
          return r.slice(0, columns.length).map((c) => (typeof c === "number" ? c : str(c, LIMITS.cell)));
        });
        const align = Array.isArray(block.align)
          ? block.align.slice(0, columns.length).map((a) => (a === "r" ? "r" : "l") as "l" | "r")
          : undefined;
        return { type: "table", columns, rows, ...(align ? { align } : {}) };
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
      .select("title, summary, blocks, model, source, generated_at")
      .eq("tenant_id", tenantId)
      .eq("date_from", dateFrom)
      .eq("date_to", dateTo)
      .order("received_at", { ascending: false })
      .limit(1);

    const row = data?.[0];
    if (!row) return null;
    return {
      title: row.title ?? null,
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

/** Rend la section analyse en HTML — tout le contenu externe est échappé. */
export function renderAnalysisHtml(a: ReportAnalysis | null): string {
  if (!a || (a.blocks.length === 0 && !a.summary)) return "";

  const body = a.blocks.map((b) => {
    switch (b.type) {
      case "heading":
        return `<div class="an-h">${esc(b.text)}</div>`;
      case "paragraph":
        return `<p class="an-p">${esc(b.text)}</p>`;
      case "bullets":
        return `<ul class="an-ul">${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      case "insight": {
        const cls = b.level === "info" || !b.level ? "" : b.level;
        return `<div class="insight ${cls}">${esc(b.text)}</div>`;
      }
      case "kpis":
        return `<div class="heroes">${b.items.map((k) =>
          `<div class="hero"><div class="lbl">${esc(k.label)}</div><div class="val">${esc(k.value)}</div>` +
          `${k.sub ? `<div class="sub">${esc(k.sub)}</div>` : ""}</div>`
        ).join("")}</div>`;
      case "table": {
        const al = (i: number) => (b.align?.[i] === "r" ? ' class="r"' : "");
        const head = b.columns.map((c, i) => `<th${al(i)}>${esc(c)}</th>`).join("");
        const rows = b.rows.map((r) =>
          `<tr>${b.columns.map((_, i) => `<td${al(i)}>${esc(r[i] ?? "")}</td>`).join("")}</tr>`
        ).join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
      }
    }
  }).join("\n");

  const credit = [a.source, a.model, a.generatedAt ? new Date(a.generatedAt).toLocaleDateString("fr-FR") : null]
    .filter(Boolean).map((x) => esc(x)).join(" · ");

  return `<h2>${esc(a.title || "Analyse")}</h2>
${a.summary ? `<div class="tldr">${esc(a.summary)}</div>` : ""}
${body}
<div class="note">Section produite par un système d'analyse externe${credit ? ` — ${credit}` : ""}. Les montants restent ceux calculés par le moteur M3A Fleet.</div>`;
}
