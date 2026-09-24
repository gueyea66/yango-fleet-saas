"use client";

import type { LucideIcon } from "lucide-react";

export interface BottomNavItem<K extends string> {
  key: K;
  label: string;
  icon: LucideIcon;
}

/**
 * Barre d'onglets du bas (Driver.dc.html) : 64 px, icône 22, libellé 11,
 * onglet actif coloré + indicateur 2 px en bas sur 40 % de la largeur.
 * Couleur active : --fleet-positive (chauffeur) ou --tenant-color (propriétaire).
 */
export function BottomNav<K extends string>({
  items, active, onChange, accent = "var(--fleet-positive)", fixed = true,
}: {
  items: BottomNavItem<K>[];
  active: K | null;
  onChange: (key: K) => void;
  accent?: string;
  fixed?: boolean;
}) {
  return (
    <nav
      aria-label="Navigation principale"
      style={{
        position: fixed ? "fixed" : "relative",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        height: "calc(64px + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        background: "var(--sk-bg)",
        borderTop: "1px solid var(--sk-surface)",
        flex: "none",
      }}
    >
      {items.map(({ key, label, icon: Icon }) => {
        const on = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-current={on ? "page" : undefined}
            className="v2-focus"
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              height: 64,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: on ? 600 : 400,
              color: on ? accent : "var(--sk-t2)",
            }}
          >
            <Icon size={22} aria-hidden />
            {label}
            {on && (
              <span aria-hidden style={{ position: "absolute", bottom: 0, left: "30%", right: "30%", height: 2, borderRadius: 2, background: accent }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}
