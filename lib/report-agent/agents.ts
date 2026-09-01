/**
 * report-agent — orchestration du panel multi-agent.
 * Rôles en parallèle (analyste / risques / stratège) → rédacteur final.
 * Le LLM ne calcule JAMAIS : payload = facts + sections, garde-fou sur chaque
 * sortie, repli déterministe si le panel échoue (l'appelant gère le null).
 * RÈGLE : aucun import hors de lib/report-agent/ (voir README.md).
 */

import type {
  AgentPanelOptions, AgentRole, NarrativeResult, ReportDataset, Severity,
} from "./types";
import { citesOnlyKnownNumbers, extractJsonObject } from "./guard";

const COMMON_RULES = `
Règles ABSOLUES (non négociables) :
- Tu n'inventes JAMAIS un chiffre. Tu ne cites que les nombres présents dans le JSON fourni, à l'identique (mêmes chiffres, sans séparateurs de milliers).
- Les personnes sont désignées par des références (ex: drv_ab12) — recopie-les TELLES QUELLES, elles seront remplacées par les vrais noms à l'affichage.
- Tu ne fais AUCUN calcul (ni addition, ni pourcentage, ni conversion, ni arrondi).
- Si une conclusion demanderait un calcul, formule-la sans chiffre.
- Réponds UNIQUEMENT avec l'objet JSON demandé, sans texte autour, sans markdown.
- Français direct et concret, niveau consultant senior qui parle à un patron de PME.`;

export const DEFAULT_ROLES: AgentRole[] = [
  {
    id: "analyste",
    system: `Tu es l'analyste opérations d'un cabinet de conseil. À partir des données JSON, dégage ce qui explique la performance de la période : dynamique, comparaison avec la période précédente, contributions par acteur, anomalies de données (valeurs incohérentes, saisies suspectes, trous).
Sortie : {"findings":[{"severity":"info|ok|warn|alert","title":"…","body":"…"}]} — 3 à 5 constats, les plus importants d'abord.${COMMON_RULES}`,
  },
  {
    id: "risques",
    system: `Tu es le responsable risques & conformité. À partir des données JSON, identifie les risques : concentration/dépendance à un acteur, dérive d'un poste de coût, données manquantes ou en attente qui faussent les chiffres, obligations non réglées, rythme de travail intenable.
Sortie : {"findings":[{"severity":"info|ok|warn|alert","title":"…","body":"…"}]} — 3 à 5 constats, les plus graves d'abord.${COMMON_RULES}`,
  },
  {
    id: "stratege",
    system: `Tu es le stratège. À partir des données JSON, dégage les leviers actionnables du mois suivant : quoi répliquer, quoi corriger, où est le plus gros gain, quel objectif chiffré donner (uniquement avec des nombres présents dans les données).
Sortie : {"findings":[{"severity":"info|ok|warn|alert","title":"…","body":"…"}]} — 3 à 5 leviers, le plus rentable d'abord.${COMMON_RULES}`,
  },
];

const EDITOR_SYSTEM = (decisionsTitle: string) => `Tu es le rédacteur final d'un rapport d'activité de direction. On te fournit les données JSON et les constats de trois experts (analyste, risques, stratège). Fusionne-les en un rapport cohérent, sans doublon, hiérarchisé.
Sortie EXACTE :
{"tldr":"l'essentiel en 3 à 5 phrases, les 2-3 chiffres qui comptent, le point stratégique en dernier",
"insights":[{"severity":"info|ok|warn|alert","title":"titre court","body":"2 à 3 phrases"}],
"decisions":[{"title":"décision actionnable","body":"1 à 2 phrases : pourquoi + comment"}]}
- 5 à 7 insights, ordonnés du plus important au moins important.
- 3 à 5 decisions concrètes ("${decisionsTitle}").
- Reprends les severity des experts sauf incohérence manifeste.${COMMON_RULES}`;

const OK_SEVERITIES = new Set<Severity>(["info", "ok", "warn", "alert"]);

interface Finding { severity: Severity; title: string; body: string }

function cleanFindings(raw: unknown, cap: number): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, cap).flatMap((f) => {
    const o = f as Record<string, unknown>;
    const title = String(o?.title ?? "").trim();
    const body = String(o?.body ?? "").trim();
    if (!title && !body) return [];
    const sev = OK_SEVERITIES.has(o?.severity as Severity) ? (o.severity as Severity) : "info";
    return [{ severity: sev, title: title.slice(0, 200), body: body.slice(0, 800) }];
  });
}

/**
 * Payload compact envoyé aux agents : facts + sections sans HTML.
 * Les valeurs réelles des `aliases` (noms) sont remplacées par leur pseudonyme :
 * aucune donnée nominative ne part vers le fournisseur LLM.
 */
export function buildAgentPayload(dataset: ReportDataset): string {
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const sections = dataset.sections.map((s) =>
    s.kind === "table"
      ? { titre: s.title, colonnes: s.columns.map((c) => c.label), lignes: s.rows.map((r) => r.cells.map(stripHtml)), note: s.note }
      : { titre: s.title, barres: s.bars.map((b) => ({ label: b.label, valeur: b.amountLabel })), note: s.note }
  );
  let payload = JSON.stringify({
    document: dataset.meta.docTitle,
    periode: dataset.meta.periodLabel,
    faits: dataset.facts,
    sections,
    contexte: dataset.context ?? [],
  });
  for (const [pseudo, real] of Object.entries(dataset.aliases ?? {})) {
    if (real) payload = payload.split(real).join(pseudo);
  }
  return payload;
}

/**
 * Lance le panel. Retourne null si le rédacteur échoue ou si le garde-fou
 * rejette sa sortie → l'appelant bascule sur le repli déterministe.
 */
export async function runAgentPanel(
  dataset: ReportDataset,
  opts: AgentPanelOptions
): Promise<NarrativeResult | null> {
  const roles = opts.roles ?? DEFAULT_ROLES;
  const payload = buildAgentPayload(dataset);
  const timeoutMs = opts.timeoutMs ?? 90_000;

  // 1) rôles en parallèle — un rôle qui échoue ou hallucine est simplement écarté
  const roleOutputs = await Promise.all(
    roles.map(async (role) => {
      try {
        const out = await opts.narrate(payload, {
          system: role.system,
          model: role.model ?? null,
          maxTokens: role.maxTokens ?? 1200,
          timeoutMs,
        });
        if (!out || !citesOnlyKnownNumbers(out, payload)) return null;
        const findings = cleanFindings(extractJsonObject(out)?.findings, 5);
        return findings.length > 0 ? { id: role.id, findings } : null;
      } catch {
        return null;
      }
    })
  );
  const heard = roleOutputs.filter((r): r is { id: string; findings: Finding[] } => r !== null);
  if (heard.length === 0) return null;

  // 2) rédacteur final
  const editorUser = JSON.stringify({
    donnees: JSON.parse(payload),
    constats_experts: Object.fromEntries(heard.map((r) => [r.id, r.findings])),
  });
  const editorOut = await opts.narrate(editorUser, {
    system: EDITOR_SYSTEM(opts.decisionsTitle ?? "décisions proposées pour la période suivante"),
    model: opts.editorModel ?? null,
    maxTokens: 3000,
    timeoutMs,
  }).catch(() => null);
  // le garde compare aux données + constats (déjà validés contre les données)
  if (!editorOut || !citesOnlyKnownNumbers(editorOut, editorUser)) return null;

  const parsed = extractJsonObject(editorOut);
  if (!parsed) return null;
  // pseudonymes → vrais noms, uniquement à l'affichage
  const unalias = (s: string) => {
    let out = s;
    for (const [pseudo, real] of Object.entries(dataset.aliases ?? {})) out = out.split(pseudo).join(real);
    return out;
  };
  const tldr = unalias(String(parsed.tldr ?? "").trim());
  const insights = cleanFindings(parsed.insights, 7)
    .map((i) => ({ ...i, title: unalias(i.title), body: unalias(i.body) }));
  const decisions = cleanFindings(parsed.decisions, 5)
    .map(({ title, body }) => ({ title: unalias(title), body: unalias(body) }));
  if (!tldr || insights.length === 0) return null;

  return { tldr: tldr.slice(0, 1500), insights, decisions, rolesHeard: heard.map((r) => r.id) };
}
