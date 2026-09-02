/**
 * report-agent — contrats du noyau réutilisable.
 * RÈGLE : aucun import hors de lib/report-agent/ (voir README.md).
 */

/** Fonction LLM injectée (signature de lib/ai/llmGateway.narrate). */
export type NarrateFn = (
  payloadJson: string,
  opts?: { model?: string | null; timeoutMs?: number; maxTokens?: number; system?: string }
) => Promise<string | null>;

export interface BrandTheme {
  /** Nom affiché en header (ex: "M3A FLEET"). */
  brandName: string;
  /** Sous-titre header (ex: "Gestion de flotte Yango · Dakar"). */
  tagline?: string;
  /** Balise <img> complète (logo base64) ou "" si pas de logo. */
  logoImgTag?: string;
  /** Signature footer gauche (ex: "M3A GROUP"). */
  footerBrand: string;
  /** Couleurs (défauts = charte navy/gold M3A). */
  colors?: Partial<{
    navy: string; navyDeep: string; navySoft: string;
    gold: string; goldDark: string; goldLight: string; bg: string;
  }>;
}

export type Severity = "info" | "ok" | "warn" | "alert";

/** KPI de la bande "heroes" en tête de rapport. */
export interface Kpi {
  label: string;
  value: string;
  sub?: string;
  /** true → carte dorée (métrique phare). */
  accent?: boolean;
}

export interface TableSection {
  kind: "table";
  title: string;
  columns: { label: string; align?: "left" | "right" }[];
  /** Cellules déjà formatées (HTML inline autorisé : <b>, <span class="tag …">). */
  rows: { cells: string[]; total?: boolean; highlight?: "ok" | "alert" }[];
  note?: string;
}

export interface BarsSection {
  kind: "bars";
  title: string;
  bars: { label: string; amountLabel: string; pct: number; accent?: boolean }[];
  note?: string;
}

export type Section = TableSection | BarsSection;

export interface Insight {
  severity: Severity;
  /** Texte HTML inline (le <b>titre.</b> en tête est conseillé). */
  html: string;
}

export interface Decision {
  /** Texte HTML inline d'un item de la liste "Décisions proposées". */
  html: string;
}

/**
 * Dataset d'entrée du moteur — produit par un adaptateur métier.
 * `facts` est LA source de vérité chiffrée : tout nombre que la narration
 * peut citer doit s'y trouver (ou dans les sections). Aucun montant n'est
 * recalculé en aval.
 */
export interface ReportDataset {
  meta: {
    /** Ex: "Rapport d'activité mensuel". */
    docTitle: string;
    /** Ex: "Période : 1er au 31 août 2026". */
    periodLabel: string;
    /** Ex: "01/09/2026". */
    generatedLabel: string;
    /** Ex: "Août 2026" (footer + <title>). */
    shortLabel: string;
    /** Mention source (ex: "Source : M3A Fleet SaaS"). */
    sourceLabel?: string;
  };
  kpis: Kpi[];
  sections: Section[];
  /**
   * Tous les agrégats calculés, à plat, clé → valeur, en français lisible
   * (ex: "recette_brute_totale_fcfa": 2180127). C'est le payload envoyé au LLM.
   */
  facts: Record<string, string | number | null>;
  /** Contexte qualitatif non chiffré pour le panel (règles métier, historique). */
  context?: string[];
  /**
   * Pseudonymes → valeurs réelles (ex: drv_ab12 → nom du chauffeur). Le moteur
   * remplace les valeurs réelles par les pseudonymes dans le payload envoyé au
   * LLM, puis fait l'inverse sur la narration finale : aucune donnée nominative
   * ne sort vers le fournisseur LLM.
   */
  aliases?: Record<string, string>;
  /** Repli si le panel LLM est indisponible ou rejeté par le garde-fou. */
  deterministicInsights: Insight[];
  deterministicDecisions?: Decision[];
  /** TLDR de repli (déterministe). */
  deterministicTldr: string;
}

/** Un rôle du panel multi-agent. */
export interface AgentRole {
  id: string;
  /** Prompt système du rôle (sans les règles communes, ajoutées par le moteur). */
  system: string;
  model?: string | null;
  maxTokens?: number;
}

/** Sortie structurée du panel (rédacteur final). */
export interface NarrativeResult {
  tldr: string;
  insights: { severity: Severity; title: string; body: string }[];
  decisions: { title: string; body: string }[];
  /** Rôles ayant effectivement répondu (diagnostic). */
  rolesHeard: string[];
}

export interface AgentPanelOptions {
  narrate: NarrateFn;
  roles?: AgentRole[];
  /** Modèle du rédacteur final (défaut : celui du gateway). */
  editorModel?: string | null;
  /** Modèle par défaut des rôles du panel (un rôle peut le surcharger). */
  roleModel?: string | null;
  timeoutMs?: number;
  /** Titre des décisions (ex: "Décisions proposées pour septembre"). */
  decisionsTitle?: string;
}
