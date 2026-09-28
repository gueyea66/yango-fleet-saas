"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { buildMonthGrid } from "@/lib/v2/driver";
import {
  PERIOD_OPTIONS, dateShortcuts, daysInclusive, driversLabel, isoDate, monthLabel, nextMonthSelection, periodLabel, periodRange,
  selectedMonths, shiftMonth, withMonths, type AdminPeriod, type PeriodKind,
} from "@/lib/v2/periodFilter";
import { Segmented } from "./Segmented";

/* Popover commun : se ferme au clic extérieur et sur Échap. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, ref };
}

const pill = (active: boolean): CSSProperties => ({
  display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px", borderRadius: 10, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap", flex: "none",
  border: `1px solid ${active ? "rgba(var(--tenant-color-rgb), .45)" : "var(--sk-surface)"}`,
  background: active ? "rgba(var(--tenant-color-rgb), .08)" : "var(--sk-bg)",
  color: active ? "var(--tenant-color)" : "var(--v2-nav-inactive)",
});
const panel: CSSProperties = {
  position: "absolute", top: 40, right: 0, zIndex: 60, borderRadius: 14, background: "var(--sk-bg)",
  border: "1px solid var(--sk-border)", boxShadow: "var(--v2-toast-shadow)",
};
const ghostBtn: CSSProperties = { height: 32, padding: "0 12px", borderRadius: 8, border: "none", background: "none", color: "var(--sk-t2)", fontSize: 13, cursor: "pointer" };
const brandBtn: CSSProperties = { height: 32, padding: "0 14px", borderRadius: 8, border: "none", background: "var(--tenant-color)", color: "var(--sk-deep)", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const navBtn: CSSProperties = { width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", color: "var(--sk-t2)", cursor: "pointer", borderRadius: 6 };

/**
 * Période (maquette 6a) : Jour / 7 j / Mois / Année / Dates + pastille qui
 * ouvre le choix du mois, de l'année ou de la plage. Contrôlé : la page
 * transforme la période en dateFrom / dateTo pour useDashboardKPIs.
 */
export function PeriodFilter({ value, onChange, options, today = new Date() }: {
  value: AdminPeriod;
  onChange: (p: AdminPeriod) => void;
  options?: PeriodKind[];
  today?: Date;
}) {
  const opts = PERIOD_OPTIONS.filter((o) => !options || options.includes(o.key));
  const { open: popOpen, setOpen: setPopOpen, ref: popRef } = usePopover();
  const setKind = (k: PeriodKind) => {
    if (k === "dates") {
      const r = periodRange(value, today);
      onChange({ ...value, kind: "dates", from: r.from, to: r.to });
      setPopOpen(true);
    } else {
      onChange({ ...value, kind: k });
    }
  };
  const editable = value.kind === "mois" || value.kind === "annee" || value.kind === "dates";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Segmented options={opts} value={value.kind} onChange={setKind} ariaLabel="Période" />
      <div ref={popRef} style={{ position: "relative" }}>
        <button type="button" onClick={() => editable && setPopOpen((o) => !o)} aria-expanded={popOpen} aria-haspopup="dialog"
          className="v2-hover-border v2-focus" style={{ ...pill(value.kind === "dates"), cursor: editable ? "pointer" : "default" }}>
          <Calendar size={14} aria-hidden style={{ color: "var(--sk-t2)" }} />
          <span className={value.kind === "dates" ? "v2-num" : undefined}>{periodLabel(value, today)}</span>
          {editable && <ChevronDown size={14} aria-hidden style={{ color: "var(--sk-t3)" }} />}
        </button>
        {popOpen && value.kind === "mois" && (
          <MonthPicker months={selectedMonths(value)} onChange={(ms, close) => { onChange(withMonths(value, ms)); if (close) setPopOpen(false); }} onClose={() => setPopOpen(false)} />
        )}
        {popOpen && value.kind === "annee" && (
          <div role="dialog" aria-label="Choisir l'année" style={{ ...panel, padding: 8, display: "flex", flexDirection: "column", gap: 2, minWidth: 120 }}>
            {Array.from({ length: 5 }, (_, i) => today.getFullYear() - i).map((y) => (
              <button key={y} type="button" onClick={() => { onChange({ ...value, year: y }); setPopOpen(false); }} className="v2-focus v2-num"
                style={{ height: 34, borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: y === value.year ? "var(--sk-surface)" : "none", color: "var(--sk-t1)", fontWeight: y === value.year ? 600 : 400 }}>
                {y}
              </button>
            ))}
          </div>
        )}
        {popOpen && value.kind === "dates" && (
          <RangePicker from={value.from} to={value.to} today={today}
            onCancel={() => setPopOpen(false)}
            onApply={(from, to) => { onChange({ ...value, kind: "dates", from, to }); setPopOpen(false); }} />
        )}
      </div>
    </div>
  );
}

/**
 * Grille des mois. Clic = ce mois seul (ferme) ; Ctrl/Cmd+clic = ajoute ou
 * retire ; Maj+clic = plage depuis le dernier mois cliqué. Mobile : appui long
 * ou case « Plusieurs mois ». Les mois choisis sont en couleur d'accent.
 */
function MonthPicker({ months, onChange, onClose }: { months: string[]; onChange: (ms: string[], close: boolean) => void; onClose: () => void }) {
  const [year, setYear] = useState(Number(months[months.length - 1].slice(0, 4)));
  const [multi, setMulti] = useState(months.length > 1);
  const [anchor, setAnchor] = useState<string | null>(months[months.length - 1]);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const MOIS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
  const pick = (m: string, mods: { toggle: boolean; range: boolean }) => {
    const next = nextMonthSelection(months, m, { ...mods, anchor });
    setAnchor(m);
    const plain = !mods.toggle && !mods.range;
    onChange(next, plain);
  };
  const startPress = (m: string) => {
    press.current.fired = false;
    press.current.timer = setTimeout(() => {
      press.current.fired = true;
      setMulti(true);
      pick(m, { toggle: true, range: false });
    }, 450);
  };
  const endPress = () => { if (press.current.timer) clearTimeout(press.current.timer); press.current.timer = null; };
  return (
    <div role="dialog" aria-label="Choisir le ou les mois" style={{ ...panel, width: 260, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 14, fontWeight: 600 }}>
        <button type="button" aria-label="Année précédente" onClick={() => setYear((y) => y - 1)} className="v2-focus" style={navBtn}><ChevronLeft size={16} aria-hidden /></button>
        <span className="v2-num" style={{ flex: 1, textAlign: "center" }}>{year}</span>
        <button type="button" aria-label="Année suivante" onClick={() => setYear((y) => y + 1)} className="v2-focus" style={navBtn}><ChevronRight size={16} aria-hidden /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {MOIS.map((label, i) => {
          const m = `${year}-${String(i + 1).padStart(2, "0")}`;
          const on = months.includes(m);
          return (
            <button key={m} type="button" aria-pressed={on} aria-label={monthLabel(m)} className="v2-focus"
              onClick={(e) => {
                if (press.current.fired) { press.current.fired = false; return; } // appui long déjà traité
                pick(m, { toggle: multi || e.ctrlKey || e.metaKey, range: e.shiftKey });
              }}
              onPointerDown={(e) => { if (e.pointerType !== "mouse") startPress(m); }}
              onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
              onContextMenu={(e) => e.preventDefault()}
              style={{ height: 34, borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, userSelect: "none", WebkitTouchCallout: "none", background: on ? "var(--tenant-color)" : "var(--sk-deep)", color: on ? "var(--sk-deep)" : "var(--sk-t1)", fontWeight: on ? 600 : 400 }}>
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--sk-border)", paddingTop: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--sk-t2)", cursor: "pointer", flex: 1 }}>
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} style={{ accentColor: "var(--tenant-color)" }} />
          Plusieurs mois
        </label>
        {(multi || months.length > 1) && (
          <button type="button" onClick={onClose} className="v2-btn v2-btn-fill v2-focus" style={brandBtn}>OK</button>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--sk-t3)" }}>Ctrl+clic : ajouter un mois · Maj+clic : une plage</div>
    </div>
  );
}

function RangePicker({ from, to, today, onApply, onCancel }: { from: string; to: string; today: Date; onApply: (f: string, t: string) => void; onCancel: () => void }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState<string | null>(to);
  const [view, setView] = useState(to.slice(0, 7));
  const shortcuts = useMemo(() => dateShortcuts(today), [today]);
  const lo = b && b < a ? b : a;
  const hi = b ? (b < a ? a : b) : a;
  const grid = buildMonthGrid(Number(view.slice(0, 4)), Number(view.slice(5, 7)) - 1);
  const todayIso = isoDate(today);
  const pick = (d: string) => {
    if (b === null) { setB(d); } else { setA(d); setB(null); }
  };

  return (
    <div role="dialog" aria-label="Choisir une plage de dates" style={{ ...panel, width: 420, maxWidth: "calc(100vw - 32px)", display: "flex", flexWrap: "wrap" }}>
      <div style={{ width: 130, borderRight: "1px solid var(--sk-surface)", padding: 10, display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
        {shortcuts.map((s) => {
          const on = s.from === lo && s.to === hi;
          return (
            <button key={s.key} type="button" onClick={() => { setA(s.from); setB(s.to); setView(s.to.slice(0, 7)); }} className="v2-focus"
              style={{ textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, background: on ? "var(--sk-surface)" : "none", color: on ? "var(--sk-t1)" : "var(--v2-nav-inactive)", fontWeight: on ? 600 : 400 }}>
              {s.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minWidth: 250, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 14, fontWeight: 600 }}>
          <button type="button" aria-label="Mois précédent" onClick={() => setView((v) => shiftMonth(v, -1))} className="v2-focus" style={navBtn}><ChevronLeft size={16} aria-hidden /></button>
          <span style={{ flex: 1, textAlign: "center" }}>{monthLabel(view)}</span>
          <button type="button" aria-label="Mois suivant" onClick={() => setView((v) => shiftMonth(v, 1))} className="v2-focus" style={navBtn}><ChevronRight size={16} aria-hidden /></button>
        </div>
        <div aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, fontSize: 11, color: "var(--sk-t2)", textAlign: "center" }}>
          {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div role="grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {grid.map((c, i) => {
            if (!c.date) return <span key={i} aria-hidden />;
            const edge = c.date === lo || c.date === hi;
            const inside = c.date > lo && c.date < hi;
            return (
              <button key={c.date} type="button" role="gridcell" aria-selected={edge || inside} onClick={() => pick(c.date!)} className="v2-num v2-focus"
                style={{ height: 30, border: "none", cursor: "pointer", fontSize: 12, padding: 0,
                  borderRadius: edge ? 8 : 0,
                  background: edge ? "var(--tenant-color)" : inside ? "rgba(var(--tenant-color-rgb),.14)" : "none",
                  color: edge ? "var(--sk-deep)" : c.date > todayIso ? "var(--sk-t3)" : "var(--sk-t1)",
                  fontWeight: edge ? 600 : 400 }}>
                {c.day}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 6, borderTop: "1px solid var(--sk-surface)" }}>
          <button type="button" onClick={onCancel} className="v2-focus" style={ghostBtn}>Annuler</button>
          <button type="button" onClick={() => onApply(lo, hi)} className="v2-btn v2-btn-fill v2-focus" style={brandBtn}>
            Appliquer · {daysInclusive(lo, hi)} j
          </button>
        </div>
      </div>
    </div>
  );
}

export interface DriverOption {
  id: string;
  label: string;
  plate?: string | null;
  active?: boolean | null;
}

/**
 * Chauffeurs (maquette 6b) : recherche, « Tous les chauffeurs », cases à
 * cocher, inactifs grisés, Effacer / Appliquer. Bordure orange quand filtré.
 */
export function DriverMultiSelect({ drivers, value, onChange }: { drivers: DriverOption[]; value: string[]; onChange: (ids: string[]) => void }) {
  const { open: popOpen, setOpen: setPopOpen, ref: popRef } = usePopover();
  const [draft, setDraft] = useState<string[]>(value);
  const [q, setQ] = useState("");
  const openIt = () => { setDraft(value); setQ(""); setPopOpen((o) => !o); };
  const shown = drivers.filter((d) => !q || `${d.label} ${d.plate ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setDraft((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const box = (on: boolean): ReactNode => (
    <span aria-hidden style={{ width: 18, height: 18, borderRadius: 5, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
      background: on ? "var(--tenant-color)" : "transparent", border: on ? "none" : "1.5px solid var(--sk-border)", color: "var(--sk-deep)" }}>
      {on && <Check size={13} strokeWidth={3} />}
    </span>
  );

  return (
    <div ref={popRef} style={{ position: "relative" }}>
      <button type="button" onClick={openIt} aria-expanded={popOpen} aria-haspopup="dialog" className="v2-hover-border v2-focus" style={pill(value.length > 0)}>
        <Users size={14} aria-hidden />
        <span>{driversLabel(value, drivers)}</span>
        <ChevronDown size={14} aria-hidden style={{ color: "var(--sk-t3)" }} />
      </button>
      {popOpen && (
        <div role="dialog" aria-label="Choisir les chauffeurs" style={{ ...panel, width: 300, padding: 8, display: "flex", flexDirection: "column", gap: 2, fontSize: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 10px", borderRadius: 9, border: "1px solid var(--sk-surface)", marginBottom: 4, color: "var(--sk-t3)" }}>
            <Search size={14} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" aria-label="Rechercher un chauffeur" autoFocus
              style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--sk-t1)", fontSize: 13 }} />
          </label>
          <button type="button" role="checkbox" aria-checked={draft.length === 0} onClick={() => setDraft([])} className="v2-row v2-focus"
            style={{ display: "flex", alignItems: "center", gap: 10, height: 40, padding: "0 10px", borderRadius: 8, border: "none", background: "none", color: "var(--sk-t1)", cursor: "pointer", fontSize: 14, textAlign: "left" }}>
            {box(draft.length === 0)}<span style={{ flex: 1 }}>Tous les chauffeurs</span>
          </button>
          <div style={{ height: 1, background: "var(--sk-surface)", margin: "2px 0" }} />
          <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {shown.length === 0 && <div style={{ padding: "10px", fontSize: 13, color: "var(--v2-muted)" }}>Aucun chauffeur</div>}
            {shown.map((d) => {
              const on = draft.includes(d.id);
              return (
                <button key={d.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(d.id)} className="v2-row v2-focus"
                  style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "0 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, textAlign: "left", color: "var(--sk-t1)",
                    background: on ? "rgba(var(--tenant-color-rgb),.06)" : "none", opacity: d.active === false ? 0.5 : 1 }}>
                  {box(on)}
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
                  {d.active === false
                    ? <span style={{ fontSize: 12, color: "var(--sk-t2)" }}>inactif</span>
                    : d.plate && <span className="v2-num" style={{ fontSize: 12, color: "var(--sk-t2)" }}>{d.plate}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 4px 2px", borderTop: "1px solid var(--sk-surface)", marginTop: 4 }}>
            <button type="button" onClick={() => setDraft([])} className="v2-focus" style={ghostBtn}>Effacer</button>
            <button type="button" onClick={() => { onChange(draft); setPopOpen(false); }} className="v2-btn v2-btn-fill v2-focus" style={brandBtn}>Appliquer</button>
          </div>
        </div>
      )}
    </div>
  );
}
