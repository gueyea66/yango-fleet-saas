"use client";

import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import { ArrowLeft, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { groupInput } from "@/lib/v2/format";

/** En-tête de sous-écran mobile : retour 44×44, titre 16/600, zone droite. */
export function ScreenHeader({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header
      style={{
        display: "flex", alignItems: "center", gap: 8, minHeight: 60, flex: "none",
        padding: onBack ? "8px 12px 8px 4px" : "8px 16px",
        background: "var(--sk-bg)", borderBottom: "1px solid var(--sk-surface)",
      }}
    >
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Retour" className="v2-focus"
          style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--sk-t1)", cursor: "pointer", borderRadius: 10 }}>
          <ArrowLeft size={22} aria-hidden />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: "var(--sk-t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      {right}
    </header>
  );
}

/** Corps d'écran défilant (padding horizontal 16). */
export function ScreenBody({ children, gap = 16, padding = "24px 16px", style }: { children: ReactNode; gap?: number; padding?: string; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding, display: "flex", flexDirection: "column", gap, ...style }}>
      {children}
    </div>
  );
}

const NOTICE: Record<"ok" | "wait" | "neg" | "info", { bg: string; bd: string; fg: string; icon: LucideIcon }> = {
  ok: { bg: "var(--v2-ok-bg)", bd: "var(--v2-ok-bd)", fg: "var(--fleet-positive)", icon: CircleCheck },
  wait: { bg: "var(--v2-wait-bg)", bd: "var(--v2-wait-bd)", fg: "var(--fleet-warning)", icon: TriangleAlert },
  neg: { bg: "var(--v2-neg-bg)", bd: "var(--v2-neg-bd)", fg: "var(--v2-negative-ink)", icon: TriangleAlert },
  info: { bg: "var(--v2-info-bg)", bd: "var(--v2-info-bd)", fg: "var(--fleet-info)", icon: Info },
};

/** Bandeau d'état (vert / orange / rouge / bleu), rayon 14. */
export function Notice({ tone, children, style }: { tone: keyof typeof NOTICE; children: ReactNode; style?: CSSProperties }) {
  const t = NOTICE[tone];
  const Icon = t.icon;
  return (
    <div role={tone === "neg" || tone === "wait" ? "alert" : "status"}
      style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 14, background: t.bg, border: `1px solid ${t.bd}`, fontSize: 13, lineHeight: 1.45, color: "var(--sk-t1)", ...style }}>
      <Icon size={18} aria-hidden style={{ color: t.fg, flex: "none", marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Champ numérique compact aligné à droite (lignes de vérification). */
export function InlineNumber({ value, onChange, disabled, warn, suffix, ariaLabel, width = 116, inputMode = "numeric", style, ...rest }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  warn?: boolean;
  suffix?: string;
  ariaLabel: string;
  width?: number;
  inputMode?: "numeric" | "decimal";
  style?: CSSProperties;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "style">) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
      <input
        {...rest}
        aria-label={ariaLabel}
        type="text"
        inputMode={inputMode}
        value={groupInput(value)}
        disabled={disabled}
        placeholder="0"
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
        className="v2-num v2-focus"
        style={{
          width, height: 38, padding: "0 10px", borderRadius: 8, textAlign: "right", fontSize: 16,
          background: warn ? "transparent" : "var(--sk-deep)",
          border: `1px solid ${warn ? "var(--fleet-warning)" : "var(--sk-surface)"}`,
          color: "var(--sk-t1)", opacity: disabled ? 0.55 : 1, outline: "none",
          ...style,
        }}
      />
      {suffix && <span style={{ fontSize: 12, color: "var(--sk-t3)" }}>{suffix}</span>}
    </span>
  );
}

/** Écran de confirmation (pastille check 72 px). */
export function DoneHero({ title, text }: { title: string; text: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center" }}>
      <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(74,222,128,.12)", color: "var(--fleet-positive)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircleCheck size={36} aria-hidden />
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: "var(--sk-t1)" }}>{title}</div>
      <div style={{ fontSize: 15, color: "var(--v2-muted)", lineHeight: 1.5, maxWidth: 300 }}>{text}</div>
    </div>
  );
}

/** Style commun des champs texte / date / select v2 (48–52 px). */
export const fieldStyle: CSSProperties = {
  width: "100%", height: 48, padding: "0 14px", borderRadius: 12, fontSize: 15,
  background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", outline: "none",
};

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} style={{ display: "block", fontSize: 13, color: "var(--v2-muted)", marginBottom: 8 }}>{children}</label>;
}

/** Squelette de chargement (contexte 2G/3G : pas de spinner sur les listes). */
export function SkeletonBlock({ height = 56, radius = 16 }: { height?: number; radius?: number }) {
  return <div className="v2-skeleton" style={{ height, borderRadius: radius }} aria-hidden />;
}
