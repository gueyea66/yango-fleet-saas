"use client";

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type ButtonVariant = "primary" | "outline" | "validate" | "danger" | "ghost";
export type ButtonSize = "xl" | "lg" | "md" | "sm";

// Mobile : principal 56–58, secondaire 48–56. Desktop : 32–42.
const HEIGHT: Record<ButtonSize, number> = { xl: 58, lg: 52, md: 40, sm: 32 };
const FONT: Record<ButtonSize, number> = { xl: 17, lg: 15, md: 14, sm: 13 };
const RADIUS: Record<ButtonSize, number> = { xl: 14, lg: 14, md: 10, sm: 8 };

const VARIANT: Record<ButtonVariant, { bg: string; fg: string; bd: string; cls: string; weight: number }> = {
  primary: { bg: "var(--tenant-color)", fg: "var(--sk-deep)", bd: "transparent", cls: "v2-btn-fill", weight: 700 },
  validate: { bg: "var(--v2-validate)", fg: "var(--v2-validate-ink)", bd: "transparent", cls: "v2-btn-fill", weight: 600 },
  outline: { bg: "transparent", fg: "var(--sk-t1)", bd: "var(--sk-border)", cls: "v2-btn-outline", weight: 600 },
  danger: { bg: "transparent", fg: "var(--v2-negative-ink)", bd: "rgba(239,68,68,.45)", cls: "v2-btn-outline", weight: 600 },
  ghost: { bg: "transparent", fg: "var(--sk-t2)", bd: "transparent", cls: "", weight: 500 },
};

/** Bouton v2 : nowrap, flex none, transition .15s, focus anneau --tenant-color. */
export function Button({
  children, variant = "primary", size = "md", icon: Icon, block = false, style, className, type = "button", ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  block?: boolean;
  style?: CSSProperties;
}) {
  const v = VARIANT[variant];
  const h = HEIGHT[size];
  return (
    <button
      type={type}
      className={`v2-btn ${v.cls} ${className ?? ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: size === "xl" ? 10 : 8,
        height: h,
        width: block ? "100%" : undefined,
        padding: `0 ${size === "sm" ? 12 : 16}px`,
        borderRadius: RADIUS[size],
        border: `1px solid ${v.bd}`,
        background: v.bg,
        color: v.fg,
        fontSize: FONT[size],
        fontWeight: size === "xl" ? 700 : v.weight,
        cursor: "pointer",
        ...style,
      }}
      {...rest}
    >
      {Icon && <Icon size={size === "xl" ? 20 : size === "sm" ? 15 : 17} aria-hidden />}
      {children}
    </button>
  );
}
