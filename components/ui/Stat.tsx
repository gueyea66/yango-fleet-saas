import type { CSSProperties, ReactNode } from "react";

export type StatTone = "default" | "positive" | "negative" | "warning" | "accent" | "info" | "brand";

export const STAT_TONE_COLOR: Record<StatTone, string> = {
  default: "var(--sk-t1)",
  positive: "var(--fleet-positive)",
  negative: "var(--v2-negative-ink)",
  warning: "var(--v2-warning-ink)",
  accent: "var(--fleet-accent)",
  info: "var(--fleet-info)",
  brand: "var(--tenant-color)",
};

// Échelle README : KPI principal 34 (desktop) / 40 (mobile propriétaire),
// secondaire 20–28, tuiles 18.
const SIZES = { xl: 40, hero: 34, lg: 28, md: 22, sm: 18 } as const;

/**
 * Chiffre clé v2 : libellé (12–13, muted) + valeur mono tabulaire + unité discrète.
 * Aucune donnée calculée ici : la valeur arrive déjà formatée par l'appelant.
 */
export function Stat({
  label, value, unit, tone = "default", size = "md", sub, badge, style,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  tone?: StatTone;
  size?: keyof typeof SIZES;
  sub?: ReactNode;
  badge?: ReactNode;
  style?: CSSProperties;
}) {
  const px = SIZES[size];
  return (
    <div style={{ minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: size === "sm" ? 12 : 13, color: "var(--v2-muted)" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {badge}
      </div>
      <div
        className="v2-num"
        style={{
          marginTop: size === "sm" ? 6 : 4,
          fontSize: px,
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: px >= 28 ? "-.03em" : "-.01em",
          color: STAT_TONE_COLOR[tone],
          whiteSpace: "nowrap",
        }}
      >
        {value}
        {unit && <span style={{ fontSize: Math.max(12, Math.round(px * 0.4)), color: "var(--v2-muted)", fontWeight: 500, marginLeft: 6, letterSpacing: 0 }}>{unit}</span>}
      </div>
      {sub && <div style={{ marginTop: 6, fontSize: 12, color: "var(--v2-muted)" }}>{sub}</div>}
    </div>
  );
}
