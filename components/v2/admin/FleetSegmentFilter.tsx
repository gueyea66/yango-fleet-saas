"use client";

import type { CSSProperties } from "react";
import { SEGMENTS, SEGMENT_META, basculerSegment, type Segment } from "@/lib/fleetSegment";

/**
 * Filtre de flotte v2 — sélection multiple.
 *
 * Reprend la pilule de `FilterBar` (hauteur 34, rayon 10, bordure et fond en
 * couleur de marque quand la pilule est active) plutôt que `Segmented`, qui ne
 * sait porter qu'un choix unique : ici on doit pouvoir voir les deux flottes en
 * même temps, c'est même l'état de départ.
 *
 * Composant contrôlé, sans accès aux données, comme le reste de `components/ui`.
 */
export function FleetSegmentFilter({
  counts, value, onChange, style,
}: {
  counts: Record<Segment, number>;
  value: string[];
  onChange: (next: string[]) => void;
  style?: CSSProperties;
}) {
  const total = counts.interne + counts.partenaire;

  return (
    <div
      role="group"
      aria-label="Filtrer par flotte"
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...style }}
    >
      <span style={{ fontSize: 12, color: "var(--v2-muted)", flex: "none" }}>
        Flotte
      </span>

      {SEGMENTS.map((s) => {
        const actif = value.includes(s);
        const meta = SEGMENT_META[s];
        return (
          <button
            key={s}
            type="button"
            className="v2-btn"
            aria-pressed={actif}
            onClick={() => onChange(basculerSegment(value, s))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 34,
              padding: "0 12px",
              borderRadius: 10,
              border: `1px solid ${actif ? "rgba(var(--tenant-color-rgb), .45)" : "var(--sk-surface)"}`,
              background: actif ? "rgba(var(--tenant-color-rgb), .08)" : "var(--sk-bg)",
              color: actif ? "var(--tenant-color)" : "var(--v2-nav-inactive)",
              whiteSpace: "nowrap",
              cursor: "pointer",
              fontSize: 13,
              flex: "none",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7, height: 7, borderRadius: "50%", flex: "none",
                background: meta.color, opacity: actif ? 1 : 0.4,
              }}
            />
            {meta.label}
            <span className="v2-num" style={{ opacity: 0.7 }}>{counts[s]}</span>
          </button>
        );
      })}

      {/* Le compte affiché n'apparaît qu'une fois le parc restreint : tant que
          tout est coché, il répéterait le total déjà lisible juste au-dessus. */}
      {value.length < SEGMENTS.length && (
        <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>
          {SEGMENTS.filter((s) => value.includes(s)).reduce((n, s) => n + counts[s], 0)} sur {total}
        </span>
      )}
    </div>
  );
}
