import type { CSSProperties, ReactNode } from "react";
import { Calculator, Sparkles } from "lucide-react";

export type BadgeTone = "ok" | "wait" | "neg" | "info" | "ai" | "calc" | "brand" | "neutral";

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  ok: { bg: "rgba(74,222,128,.14)", fg: "var(--fleet-positive)" },
  wait: { bg: "rgba(249,115,22,.14)", fg: "var(--fleet-warning)" },
  neg: { bg: "rgba(239,68,68,.14)", fg: "var(--v2-negative-ink)" },
  info: { bg: "rgba(56,189,248,.14)", fg: "var(--fleet-info)" },
  ai: { bg: "var(--v2-ai-bg)", fg: "var(--v2-ai-ink)" },
  calc: { bg: "var(--v2-calc-bg)", fg: "var(--v2-calc-ink)" },
  brand: { bg: "var(--v2-select-bg)", fg: "var(--tenant-color)" },
  neutral: { bg: "var(--sk-surface)", fg: "var(--sk-t2)" },
};

/** Badge v2 : 11/600, rayon 10 (pilule) ou 5 (`square`). */
export function Badge({
  children, tone = "neutral", square = false, title, style,
}: { children: ReactNode; tone?: BadgeTone; square?: boolean; title?: string; style?: CSSProperties }) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: square ? "2px 6px" : "3px 8px",
        borderRadius: square ? 5 : 10,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        flex: "none",
        background: t.bg,
        color: t.fg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Badges de provenance, équivalents v2 de CalcBadge / AiBadge
 * (components/ai/AiBriefingSection.tsx, laissé inchangé tant que le drapeau
 * n'est pas généralisé) : mêmes libellés, mêmes infobulles.
 */
export function CalcBadge() {
  return (
    <Badge tone="calc" square title="Chiffre issu du moteur de calcul déterministe" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>
      <Calculator size={10} aria-hidden /> Calculé
    </Badge>
  );
}

export function AiBadge() {
  return (
    <Badge tone="ai" square title="Texte rédigé par IA à partir des chiffres calculés" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>
      <Sparkles size={10} aria-hidden /> IA
    </Badge>
  );
}

/** Compteur de nav (ex. « À valider 5 ») : pastille mono orange. */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="v2-num"
      style={{
        minWidth: 20, height: 20, padding: "0 6px", borderRadius: 10, flex: "none",
        background: "var(--fleet-warning)", color: "var(--sk-deep)",
        fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
