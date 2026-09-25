"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Calendar, ChevronDown, Users } from "lucide-react";
import { Segmented } from "./Segmented";
import { FILTER_PERIODS, rangeLabel, type FilterPeriod } from "@/lib/v2/filters";

export interface FilterDriver {
  id: string;
  label: string;
}

const pill = (filtered: boolean): CSSProperties => ({
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: 8,
  height: 34,
  padding: "0 12px",
  borderRadius: 10,
  border: `1px solid ${filtered ? "rgba(var(--tenant-color-rgb), .45)" : "var(--sk-surface)"}`,
  background: filtered ? "rgba(var(--tenant-color-rgb), .08)" : "var(--sk-bg)",
  color: filtered ? "var(--tenant-color)" : "var(--v2-nav-inactive)",
  whiteSpace: "nowrap",
  cursor: "pointer",
  fontSize: 13,
  flex: "none",
});

/**
 * FilterBar v2 (Filter Bar.dc.html) : période · plage de dates · chauffeur.
 * Composant contrôlé : il ne lit aucune donnée, la page le branche sur ses
 * états existants (filterDriverId, période de useDashboardKPIs…). Chaque bloc
 * n'apparaît que si son callback est fourni.
 *
 * `chips` : variante mobile du mode simple — le chauffeur devient une rangée
 * de puces 44 px défilante.
 */
export function FilterBar({
  period, onPeriodChange, periodOptions,
  range, onRangeChange,
  drivers, driverId = "", onDriverChange, allDriversLabel = "Tous les chauffeurs",
  variant = "bar", style,
}: {
  period?: FilterPeriod;
  onPeriodChange?: (p: FilterPeriod) => void;
  periodOptions?: FilterPeriod[];
  range?: { from: string; to: string };
  onRangeChange?: (r: { from: string; to: string }) => void;
  drivers?: FilterDriver[];
  driverId?: string;
  onDriverChange?: (id: string) => void;
  allDriversLabel?: string;
  variant?: "bar" | "chips";
  style?: CSSProperties;
}) {
  const opts = FILTER_PERIODS.filter((p) => !periodOptions || periodOptions.includes(p.key));
  const current = drivers?.find((d) => d.id === driverId);

  if (variant === "chips") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, ...style }}>
        {period && onPeriodChange && (
          <Segmented options={opts} value={period} onChange={onPeriodChange} size="mobile" ariaLabel="Période" />
        )}
        {drivers && onDriverChange && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
            {[{ id: "", label: "Tous" }, ...drivers].map((d) => {
              const on = d.id === driverId;
              return (
                <button
                  key={d.id || "all"}
                  type="button"
                  onClick={() => onDriverChange(d.id)}
                  aria-pressed={on}
                  className="v2-btn v2-focus"
                  style={{
                    height: 44,
                    padding: "0 16px",
                    borderRadius: 22,
                    fontSize: 14,
                    fontWeight: on ? 600 : 400,
                    cursor: "pointer",
                    border: `1px solid ${on ? "var(--tenant-color)" : "var(--sk-border)"}`,
                    background: on ? "var(--v2-select-bg)" : "transparent",
                    color: on ? "var(--tenant-color)" : "var(--sk-t1)",
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, rowGap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--sk-t1)", ...style }}>
      {period && onPeriodChange && (
        <Segmented options={opts} value={period} onChange={onPeriodChange} ariaLabel="Période" />
      )}
      {range && <RangePicker range={range} onChange={onRangeChange} />}
      {drivers && onDriverChange && (
        <label className="v2-hover-border" style={pill(!!current)}>
          <Users size={14} aria-hidden style={{ flex: "none" }} />
          <span>{current ? current.label : allDriversLabel}</span>
          <ChevronDown size={14} aria-hidden style={{ flex: "none", color: "var(--sk-t3)" }} />
          <select
            aria-label="Chauffeur"
            value={driverId}
            onChange={(e) => onDriverChange(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}
          >
            <option value="">{allDriversLabel}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function RangePicker({ range, onChange }: { range: { from: string; to: string }; onChange?: (r: { from: string; to: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const label = rangeLabel(range.from, range.to);
  const content = (
    <>
      <Calendar size={14} aria-hidden style={{ flex: "none", color: "var(--sk-t2)" }} />
      <span>{label}</span>
      {onChange && <ChevronDown size={14} aria-hidden style={{ flex: "none", color: "var(--sk-t3)" }} />}
    </>
  );

  if (!onChange) return <div style={{ ...pill(false), cursor: "default" }}>{content}</div>;

  const inputStyle: CSSProperties = {
    height: 34, padding: "0 10px", borderRadius: 8, fontSize: 13,
    background: "var(--sk-surface)", border: "1px solid var(--sk-border)", color: "var(--sk-t1)", colorScheme: "dark",
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="v2-hover-border v2-focus"
        aria-expanded={open}
        onClick={() => { setDraft(range); setOpen((o) => !o); }}
        style={pill(false)}
      >
        {content}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choisir une plage de dates"
          style={{
            position: "absolute", top: 40, left: 0, zIndex: 50, padding: 12, borderRadius: 12, minWidth: 260,
            background: "var(--sk-bg)", border: "1px solid var(--sk-border)", boxShadow: "var(--v2-toast-shadow)",
            display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--v2-muted)" }}>
            <span style={{ width: 28 }}>Du</span>
            <input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--v2-muted)" }}>
            <span style={{ width: 28 }}>Au</span>
            <input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
          </label>
          <button
            type="button"
            className="v2-btn v2-btn-fill"
            disabled={!draft.from || !draft.to || draft.from > draft.to}
            onClick={() => { onChange(draft); setOpen(false); }}
            style={{ height: 34, borderRadius: 8, border: "none", background: "var(--tenant-color)", color: "var(--sk-deep)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            Appliquer
          </button>
        </div>
      )}
    </div>
  );
}
