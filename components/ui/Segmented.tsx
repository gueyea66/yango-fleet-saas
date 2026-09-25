"use client";

import type { CSSProperties } from "react";

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
}

/**
 * Segment v2 (Filter Bar.dc.html) : conteneur --sk-bg bordé, rayon 10, padding 3 ;
 * segment actif fond --sk-surface, texte t1/600 ; inactif t2.
 */
export function Segmented<K extends string>({
  options, value, onChange, size = "desktop", ariaLabel, style, brand = false,
}: {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  size?: "desktop" | "mobile";
  ariaLabel?: string;
  style?: CSSProperties;
  /** segment actif en couleur de marque (bascule Simple / Avancé) */
  brand?: boolean;
}) {
  const mobile = size === "mobile";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        padding: 3,
        borderRadius: mobile ? 12 : 10,
        background: "var(--sk-bg)",
        border: "1px solid var(--sk-surface)",
        flex: "none",
        ...style,
      }}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className="v2-btn"
            style={{
              flex: mobile ? 1 : "none",
              height: mobile ? 38 : 26,
              padding: "0 11px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              background: active ? (brand ? "var(--tenant-color)" : "var(--sk-surface)") : "transparent",
              color: active ? (brand ? "var(--sk-deep)" : "var(--sk-t1)") : "var(--sk-t2)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
