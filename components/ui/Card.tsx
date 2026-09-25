import type { CSSProperties, ReactNode } from "react";

type Tone = "default" | "ok" | "wait" | "neg" | "info" | "select";

const TONES: Record<Tone, { bg: string; bd: string }> = {
  default: { bg: "var(--sk-bg)", bd: "var(--sk-surface)" },
  ok: { bg: "var(--v2-ok-bg)", bd: "var(--v2-ok-bd)" },
  wait: { bg: "var(--v2-wait-bg)", bd: "var(--v2-wait-bd)" },
  neg: { bg: "var(--v2-neg-bg)", bd: "var(--v2-neg-bd)" },
  info: { bg: "var(--v2-info-bg)", bd: "var(--v2-info-bd)" },
  select: { bg: "var(--v2-select-bg)", bd: "var(--tenant-color)" },
};

/**
 * Carte v2 : fond --sk-bg, bordure --sk-surface, sans ombre.
 * `mobile` → rayon 18 (écrans chauffeur / propriétaire), sinon 14 (desktop).
 */
export function Card({
  children, mobile = false, tone = "default", padding, flush = false, className, style, as: As = "div",
}: {
  children: ReactNode;
  mobile?: boolean;
  tone?: Tone;
  /** padding CSS ; défaut 18×16 (mobile) ou 16×18 (desktop). `flush` = 0 (listes). */
  padding?: string | number;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "article";
}) {
  const t = TONES[tone];
  return (
    <As
      className={className}
      style={{
        borderRadius: mobile ? 18 : 14,
        background: t.bg,
        border: `1px solid ${t.bd}`,
        padding: flush ? 0 : padding ?? (mobile ? "18px 16px" : "16px 18px"),
        overflow: flush ? "hidden" : undefined,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </As>
  );
}

/** Surtitre 11/600 uppercase (ex. « IL VOUS MANQUE »). */
export function Overline({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--v2-muted)", ...style }}>
      {children}
    </div>
  );
}

/** Titre de carte desktop (15/600) avec action optionnelle à droite. */
export function CardTitle({ children, right, style }: { children: ReactNode; right?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, ...style }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: "var(--sk-t1)" }}>{children}</div>
      {right}
    </div>
  );
}
