"use client";

/**
 * Briques communes aux écrans Performance : filtre « type de véhicule »
 * (interne / partenaire), objectif de CA par jour et par chauffeur, et codes
 * couleur de statut (atteint / proche / sous).
 *
 * Couleurs de statut : palette de statut de référence (dataviz), réservée à
 * ce sens et jamais utilisée pour une série. Validée au script : séparation
 * daltonisme ΔE 11,3 entre voisins. L'ambre est sous 3:1 sur fond clair : un
 * statut est donc TOUJOURS accompagné d'un pictogramme et d'un libellé.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Pencil, X } from "lucide-react";
import { Button, Segmented } from "@/components/ui";
import { formatAmount } from "@/lib/v2/format";
import type { SegmentFilter } from "@/lib/analytics/segment";
import { statutDe, type Statut } from "@/lib/analytics/trends";

export const STATUS_COLOR: Record<Statut, string> = { atteint: "#0ca30c", proche: "#fab219", sous: "#d03b3b" };
export const STATUS_LABEL: Record<Statut, string> = { atteint: "Atteint", proche: "Proche", sous: "Sous" };
export const STATUS_ICON: Record<Statut, string> = { atteint: "✓", proche: "≈", sous: "✗" };
/** Série neutre (CA total…) : bleu de la palette de référence, pas une couleur de statut */
export const SERIES_COLOR = "var(--perf-series, #3987e5)";

/** Pastille de statut : couleur + pictogramme + libellé (jamais la couleur seule). */
export function StatusPill({ statut, compact = false, title }: { statut: Statut | null; compact?: boolean; title?: string }) {
  if (!statut) return <span style={{ color: "var(--v2-muted)", fontSize: 12 }}>—</span>;
  const c = STATUS_COLOR[statut];
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: compact ? "1px 7px" : "2px 9px", borderRadius: 999,
      fontSize: compact ? 11 : 12, fontWeight: 600, whiteSpace: "nowrap",
      color: "var(--sk-t1, inherit)", background: `${c}26`, boxShadow: `inset 0 0 0 1px ${c}66`,
    }}>
      <span aria-hidden style={{ color: c, fontWeight: 800 }}>{STATUS_ICON[statut]}</span>
      {STATUS_LABEL[statut]}
    </span>
  );
}

/** Valeur colorée selon l'objectif (texte en encre normale + pastille de couleur). */
export function ObjectiveValue({ value, objectif }: { value: number | null; objectif: number }) {
  const st = statutDe(value, objectif);
  if (value == null) return <span>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}
      title={st ? `${Math.round((value / objectif) * 100)} % de l'objectif (${formatAmount(objectif)})` : undefined}>
      {st && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLOR[st], flex: "none" }} />}
      {formatAmount(value)}
      {st && <span className="sr-only">{STATUS_LABEL[st]}</span>}
    </span>
  );
}

/* ── Métadonnées Performance (segments du parc, objectif) ─────────── */

export interface PerfMeta {
  segments: { interne: number; partenaire: number };
  objectif: number;
  modifiable: boolean;
  message?: string;
}

export function usePerfMeta() {
  const [meta, setMeta] = useState<PerfMeta | null>(null);
  const load = useCallback(async () => {
    try {
      const [cat, obj] = await Promise.all([
        fetch("/api/admin/analytics?report=catalog", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/admin/objectifs", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setMeta({
        segments: cat?.segments ?? { interne: 0, partenaire: 0 },
        objectif: Number(obj?.objectif) || Number(cat?.objectif) || 40_000,
        modifiable: !!obj?.modifiable, message: obj?.message,
      });
    } catch {
      setMeta({ segments: { interne: 0, partenaire: 0 }, objectif: 40_000, modifiable: false });
    }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return { meta, reload: load };
}

/* ── Filtre type de véhicule ─────────────────────────────────────── */

const SEG_OPTS: { key: SegmentFilter; label: string }[] = [
  { key: "all", label: "Tous véhicules" },
  { key: "interne", label: "Interne" },
  { key: "partenaire", label: "Externe" },
];

/** Affiché seulement si le parc mélange interne et partenaire (sinon le filtre ne sert à rien). */
export function SegmentFilterControl({ value, onChange, meta }: { value: SegmentFilter; onChange: (s: SegmentFilter) => void; meta: PerfMeta | null }) {
  if (!meta || !(meta.segments.interne > 0 && meta.segments.partenaire > 0)) return null;
  return <Segmented options={SEG_OPTS} value={value} onChange={onChange} ariaLabel="Type de véhicule" />;
}

/* ── Filtre hors Yango ───────────────────────────────────────────── */

const HORS_OPTS: { key: "1" | "0"; label: string }[] = [
  { key: "1", label: "Avec hors Yango" },
  { key: "0", label: "Yango seul" },
];

/** Inclut ou exclut les recettes (et courses) hors Yango du CA de Performance. */
export function HorsYangoControl({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <span title="Yango seul : périmètre comparable à un compte alimenté par Fleetroom (Yango uniquement)">
      <Segmented options={HORS_OPTS} value={value ? "1" : "0"} onChange={(k) => onChange(k === "1")} ariaLabel="Recettes hors Yango" />
    </span>
  );
}

/* ── Objectif (lecture + réglage) ────────────────────────────────── */

export function ObjectifControl({ meta, onSaved }: { meta: PerfMeta | null; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!meta) return null;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/objectifs", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectif: Number(val.replace(/\s/g, "")) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`);
      setEdit(false); onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  if (!edit) {
    return (
      <button type="button" onClick={() => { setVal(String(meta.objectif)); setEdit(true); }}
        title={meta.modifiable ? "Modifier l'objectif" : meta.message}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, cursor: "pointer",
          border: "1px solid var(--sk-border)", background: "transparent", color: "inherit", fontSize: 13,
        }}>
        <span style={{ color: "var(--v2-muted)" }}>Objectif</span>
        <strong className="v2-num">{formatAmount(meta.objectif)}</strong>
        <span style={{ color: "var(--v2-muted)" }}>/ jour / chauffeur</span>
        <Pencil size={12} aria-hidden />
      </button>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <label style={{ fontSize: 13, color: "var(--v2-muted)" }} htmlFor="perf-objectif">Objectif / jour</label>
      <input id="perf-objectif" inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEdit(false); }}
        style={{ width: 110, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--sk-border)", background: "var(--sk-bg)", color: "inherit", fontSize: 16 }} />
      <Button size="sm" icon={Check} onClick={() => void save()} disabled={busy || !meta.modifiable}>OK</Button>
      <Button size="sm" variant="outline" icon={X} onClick={() => setEdit(false)}>Annuler</Button>
      {(err || !meta.modifiable) && (
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12, color: STATUS_COLOR.sous }}>
          <CircleAlert size={13} aria-hidden /> {err || meta.message}
        </span>
      )}
    </div>
  );
}
