"use client";

import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * Ligne de liste v2 (hauteur 52–56 mobile, cible tactile ≥ 44).
 * `selected` → fond de sélection + liseré intérieur gauche --tenant-color.
 */
export function ListRow({
  icon: Icon, label, sub, trailing, chevron = false, onClick, height = 56, divider = true,
  selected = false, tone, style,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  height?: number;
  divider?: boolean;
  selected?: boolean;
  /** fond d'alerte (ex. champ « à vérifier ») */
  tone?: "wait";
  style?: CSSProperties;
}) {
  const body = (
    <>
      {Icon && <Icon size={20} strokeWidth={2} style={{ flex: "none", color: "var(--sk-t2)" }} aria-hidden />}
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "block", fontSize: 15, color: "var(--sk-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {sub && <span style={{ display: "block", fontSize: 12, color: "var(--v2-muted)", marginTop: 2 }}>{sub}</span>}
      </span>
      {trailing}
      {chevron && <ChevronRight size={18} style={{ flex: "none", color: "var(--sk-t3)" }} aria-hidden />}
    </>
  );
  const s: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    minHeight: height,
    padding: sub ? "8px 16px" : "0 16px",
    borderTop: 0,
    borderLeft: 0,
    borderRight: 0,
    borderBottom: divider ? "1px solid var(--sk-surface)" : 0,
    background: selected ? "var(--v2-select-bg)" : tone === "wait" ? "rgba(249,115,22,.07)" : "transparent",
    boxShadow: selected ? "inset 2px 0 0 var(--tenant-color)" : undefined,
    font: "inherit",
    color: "inherit",
    ...style,
  };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="v2-row v2-focus" style={{ ...s, cursor: "pointer" }}>
        {body}
      </button>
    );
  }
  return <div style={s}>{body}</div>;
}
