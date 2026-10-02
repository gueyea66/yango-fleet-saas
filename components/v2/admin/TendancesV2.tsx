"use client";

/**
 * Performance → Tendances : vue semaine / mois / trimestre / année.
 *
 * Lecture en 4 niveaux (du plus synthétique au plus fin) :
 * 1. chiffres clés de la fenêtre (CA, CA/jour vs objectif, % journées à l'objectif) ;
 * 2. CA par jour et par chauffeur, période par période, avec la ligne d'objectif ;
 * 3. répartition des journées-chauffeur atteint / proche / sous ;
 * 4. carte chauffeurs × périodes, colorée selon l'objectif.
 * Un seul axe par graphique (jamais deux échelles). Statuts toujours doublés
 * d'un pictogramme et d'un libellé. Période en cours signalée (hachurée).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Download, Lightbulb, Minus, TriangleAlert } from "lucide-react";
import { Button, Card, Segmented } from "@/components/ui";
import { formatAmount } from "@/lib/v2/format";
import type { SegmentFilter } from "@/lib/analytics/segment";
import type { BucketStats, Granularite, Statut, TrendsResult } from "@/lib/analytics/trends";
import { ObjectifControl, SegmentFilterControl, SERIES_COLOR, STATUS_COLOR, STATUS_ICON, STATUS_LABEL, StatusPill, usePerfMeta } from "./perfShared";

type Statut2 = "approved" | "all";

const GRAN_OPTS: { key: Granularite; label: string }[] = [
  { key: "semaine", label: "Semaine" }, { key: "mois", label: "Mois" },
  { key: "trimestre", label: "Trimestre" }, { key: "annee", label: "Année" },
];
const STATUT_OPTS = [{ key: "approved" as Statut2, label: "Validées" }, { key: "all" as Statut2, label: "+ en attente" }];

const k = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1_000 ? `${Math.round(v / 1_000)} k` : String(Math.round(v)));
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)} %`);

/* ── Données ───────────────────────────────────────────────── */

function useTrends(params: { granularite: Granularite; segment: SegmentFilter; statut: Statut2; driverIds: string[]; dateTo: string; tick: number; enabled: boolean }) {
  const [data, setData] = useState<(TrendsResult & { truncated?: boolean }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const url = (() => {
    const p = new URLSearchParams({ report: "tendances", granularite: params.granularite, segment: params.segment, statut: params.statut, dateTo: params.dateTo });
    if (params.driverIds.length) p.set("driverIds", params.driverIds.join(","));
    return `/api/admin/analytics?${p}`;
  })();
  const run = useCallback(async () => {
    if (!params.enabled) return;
    const my = ++seq.current;
    setLoading(true); setError(null);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`);
      if (my === seq.current) setData(j);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url, params.enabled]);
  useEffect(() => { void Promise.resolve().then(run); }, [run, params.tick]);
  return { data, loading, error, url };
}

/* ── Éléments visuels ─────────────────────────────────────── */

const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };

function Delta({ value, label, points = false }: { value: number | null; label: string; points?: boolean }) {
  if (value == null) return <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>—</span>;
  const up = value > 0.005, down = value < -0.005;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const c = up ? STATUS_COLOR.atteint : down ? STATUS_COLOR.sous : "var(--v2-muted)";
  const txt = points ? `${value > 0 ? "+" : ""}${Math.round(value * 100)} pts` : `${value > 0 ? "+" : ""}${Math.round(value * 100)} %`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color: "var(--v2-muted)" }}>
      <Icon size={14} color={c} aria-hidden />
      <span style={{ color: "var(--sk-t1, inherit)", fontWeight: 600 }}>{txt}</span> {label}
    </span>
  );
}

function Hero({ title, value, sub, children }: { title: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <div style={card}>
        <div style={{ fontSize: 12, color: "var(--v2-muted)", fontWeight: 500, letterSpacing: ".02em" }}>{title}</div>
        <div className="v2-num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{value}</div>
        {sub}
        {children}
      </div>
    </Card>
  );
}

/** Jauge vers l'objectif : remplissage couleur de statut, repère à 100 %. */
function ObjectiveGauge({ ratio, statut }: { ratio: number | null; statut: Statut | null }) {
  const w = Math.min(Math.max(ratio ?? 0, 0), 1.25) / 1.25; // échelle 0–125 %
  return (
    <div style={{ position: "relative", height: 8, borderRadius: 999, background: "var(--sk-surface)", marginTop: 4 }} aria-hidden>
      <div style={{ position: "absolute", inset: 0, width: `${w * 100}%`, borderRadius: 999, background: statut ? STATUS_COLOR[statut] : SERIES_COLOR, transition: "width .4s ease" }} />
      <div style={{ position: "absolute", left: `${100 / 1.25}%`, top: -3, bottom: -3, width: 2, borderRadius: 2, background: "var(--sk-t1, #fff)", opacity: 0.7 }} title="Objectif" />
    </div>
  );
}

/** Barre 100 % empilée atteint / proche / sous (2 px d'écart entre segments). */
function SplitBar({ jours, height = 10 }: { jours: Record<Statut, number>; height?: number }) {
  const tot = jours.atteint + jours.proche + jours.sous;
  if (!tot) return <div style={{ height, borderRadius: 999, background: "var(--sk-surface)" }} />;
  return (
    <div style={{ display: "flex", gap: 2, height }} role="img"
      aria-label={`Atteint ${jours.atteint}, proche ${jours.proche}, sous ${jours.sous}`}>
      {(["atteint", "proche", "sous"] as Statut[]).filter((s) => jours[s] > 0).map((s, i, arr) => (
        <div key={s} title={`${STATUS_LABEL[s]} : ${jours[s]} journée(s)`} style={{
          flex: jours[s], background: STATUS_COLOR[s],
          borderRadius: `${i === 0 ? 4 : 0}px ${i === arr.length - 1 ? 4 : 0}px ${i === arr.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
        }} />
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--v2-muted)" }}>
      {(["atteint", "proche", "sous"] as Statut[]).map((s) => (
        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLOR[s] }} />
          <span aria-hidden style={{ color: STATUS_COLOR[s], fontWeight: 800 }}>{STATUS_ICON[s]}</span>
          {s === "atteint" ? "≥ objectif" : s === "proche" ? "80–100 %" : "< 80 %"}
        </span>
      ))}
    </div>
  );
}

function ChartTip({ active, payload, objectif }: { active?: boolean; payload?: { payload: BucketStats }[]; objectif: number }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-border)", borderRadius: 10, padding: "10px 12px", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.25)", minWidth: 200 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{b.label}{b.enCours ? " · en cours" : ""}</div>
      <Row k="CA / jour / chauffeur" v={b.caParJour != null ? formatAmount(b.caParJour) : "—"} />
      <Row k="Atteinte" v={b.atteinte != null ? `${Math.round(b.atteinte * 100)} % de ${formatAmount(objectif)}` : "—"} />
      <Row k="CA total" v={formatAmount(b.ca)} />
      <Row k="Journées-chauffeur" v={String(b.journees)} />
      <Row k="Chauffeurs actifs" v={String(b.chauffeurs)} />
      <div style={{ marginTop: 6 }}><StatusPill statut={b.statut} compact /></div>
    </div>
  );
}
const Row = ({ k: key, v }: { k: string; v: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--v2-muted)" }}>
    <span>{key}</span><span className="v2-num" style={{ color: "var(--sk-t1, inherit)", fontWeight: 600 }}>{v}</span>
  </div>
);

/* ── Écran ─────────────────────────────────────────────────── */

export function TendancesV2({ driverIds, segment, onSegment, anchor, demo }: {
  driverIds: string[];
  segment: SegmentFilter;
  onSegment: (s: SegmentFilter) => void;
  /** fin de la période choisie dans la barre de filtres : dernière période affichée (jamais après aujourd'hui) */
  anchor?: string;
  /** vitrine /ui-v2 : données fictives, aucun appel réseau */
  demo?: TrendsResult;
}) {
  const [granularite, setGranularite] = useState<Granularite>("mois");
  const [statut, setStatut] = useState<Statut2>("approved");
  const [tick, setTick] = useState(0);
  const { meta, reload } = usePerfMeta();
  const today = new Date().toISOString().slice(0, 10);
  const dateTo = anchor && anchor < today ? anchor : today;
  const fetched = useTrends({ granularite, segment, statut, driverIds, dateTo, tick, enabled: !demo });
  const { loading, error, url } = fetched;
  const data: (TrendsResult & { truncated?: boolean }) | null = demo ?? fetched.data;
  const [exporting, setExporting] = useState(false);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${url}&format=xlsx`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erreur ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "tendances.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setExporting(false); }
  };

  const objectif = data?.objectif ?? meta?.objectif ?? 40_000;
  const buckets = data?.buckets ?? [];
  const last = [...buckets].reverse().find((b) => b.journees > 0);
  // graduations régulières (pas « rond ») couvrant le max et l'objectif
  const yAxis = (() => {
    const max = Math.max(objectif, ...buckets.map((b) => b.caParJour ?? 0)) * 1.08;
    const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
    const top = Math.ceil(max / step) * step;
    return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
  })();
  const cmpLabel = data?.comparaison ? `vs ${data.comparaison.precedente}` : "";

  return (
    <div className="perf-root" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`
        .perf-root { --perf-series: #3987e5; }
        html[data-theme="light"] .perf-root { --perf-series: #2a78d6; }
        .perf-hatch { background-image: repeating-linear-gradient(135deg, transparent 0 4px, rgba(127,127,127,.35) 4px 6px); }
      `}</style>

      {/* Barre de commandes : tout sur une ligne au-dessus des graphiques */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Tendances</h3>
          <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>
            {buckets.length ? `${buckets[0].label} → ${buckets[buckets.length - 1].label}` : ""}{segment !== "all" ? ` · flotte ${segment === "interne" ? "interne" : "externe"}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Segmented options={GRAN_OPTS} value={granularite} onChange={setGranularite} ariaLabel="Granularité" />
          <SegmentFilterControl value={segment} onChange={onSegment} meta={meta} />
          <Segmented options={STATUT_OPTS} value={statut} onChange={setStatut} ariaLabel="Déclarations prises en compte" />
          <ObjectifControl meta={meta} onSaved={() => { void reload(); setTick((t) => t + 1); }} />
          <Button size="sm" variant="outline" icon={Download} disabled={exporting || !data} onClick={() => void exportXlsx()}>{exporting ? "…" : "Excel"}</Button>
        </div>
      </div>

      {error && <Card><div style={{ display: "flex", gap: 8, alignItems: "center", color: STATUS_COLOR.sous }}><TriangleAlert size={16} aria-hidden /> {error}</div></Card>}
      {data?.truncated && <Card><div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><TriangleAlert size={16} color={STATUS_COLOR.proche} aria-hidden /> Données plafonnées à 30 000 lignes : choisissez une granularité plus fine.</div></Card>}

      {loading && !data ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="v2-skeleton" style={{ height: 110 }} aria-hidden />
          <div className="v2-skeleton" style={{ height: 300 }} aria-hidden />
        </div>
      ) : data && data.total.journees === 0 ? (
        <Card><div style={{ fontSize: 14, color: "var(--v2-muted)" }}>Aucune déclaration sur la fenêtre affichée.</div></Card>
      ) : data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
          {/* 1. Chiffres clés */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12 }}>
            <Hero title="CA de la fenêtre" value={formatAmount(data.total.ca)}
              sub={<Delta value={data.comparaison?.ca ?? null} label={data.comparaison ? `${data.comparaison.courante} ${cmpLabel}` : "comparaison indisponible"} />} />
            <Hero title="CA / jour / chauffeur" value={data.total.caParJour != null ? formatAmount(data.total.caParJour) : "—"}
              sub={<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <StatusPill statut={data.total.statut} />
                <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>{data.total.caParJour != null ? `${Math.round((data.total.caParJour / objectif) * 100)} % de ${formatAmount(objectif)}` : ""}</span>
              </div>}>
              <ObjectiveGauge ratio={data.total.caParJour != null ? data.total.caParJour / objectif : null} statut={data.total.statut} />
            </Hero>
            <Hero title="Journées à l'objectif" value={pct(data.total.tauxJoursAtteints)}
              sub={<Delta value={data.comparaison?.tauxJoursAtteints ?? null} points label={cmpLabel} />}>
              <SplitBar jours={buckets.reduce((acc, b) => ({ atteint: acc.atteint + b.jours.atteint, proche: acc.proche + b.jours.proche, sous: acc.sous + b.jours.sous }), { atteint: 0, proche: 0, sous: 0 })} />
            </Hero>
            <Hero title="Courses" value={new Intl.NumberFormat("fr-FR").format(data.total.courses)}
              sub={<span style={{ fontSize: 12, color: "var(--v2-muted)" }}>
                {data.total.journees} journées-chauffeur · {last ? `${last.chauffeurs} chauffeurs actifs (${last.label})` : ""}
              </span>} />
          </div>

          {/* 2. CA / jour / chauffeur vs objectif */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>CA par jour et par chauffeur</div>
                <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>Ligne pointillée : objectif {formatAmount(objectif)}. Période en cours hachurée.</div>
              </div>
              <Legend />
            </div>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={buckets} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                  <defs>
                    {(["atteint", "proche", "sous"] as Statut[]).map((s) => (
                      <pattern key={s} id={`hatch-${s}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="6" height="6" fill={STATUS_COLOR[s]} opacity="0.45" />
                        <line x1="0" y1="0" x2="0" y2="6" stroke={STATUS_COLOR[s]} strokeWidth="3" />
                      </pattern>
                    ))}
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--sk-border)" strokeOpacity={0.5} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--v2-muted)" }} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "var(--v2-muted)" }} tickFormatter={k}
                    domain={[0, yAxis.top]} ticks={yAxis.ticks} />
                  <Tooltip cursor={{ fill: "var(--sk-surface)", opacity: 0.5 }} content={<ChartTip objectif={objectif} />} />
                  <ReferenceLine y={objectif} stroke="var(--sk-t1, #fff)" strokeOpacity={0.7} strokeDasharray="5 4" strokeWidth={1.5} />
                  <Bar dataKey="caParJour" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                    {buckets.map((b) => (
                      <Cell key={b.key} fill={b.statut ? (b.enCours ? `url(#hatch-${b.statut})` : STATUS_COLOR[b.statut]) : "var(--sk-surface)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 3. Répartition des journées + CA total */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 12 }}>
            <Card>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Répartition des journées-chauffeur</div>
              <div style={{ fontSize: 12, color: "var(--v2-muted)", marginBottom: 10 }}>Part des journées à l&apos;objectif, proches (80–100 %) et sous 80 %, par période.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {buckets.map((b) => {
                  const tot = b.jours.atteint + b.jours.proche + b.jours.sous;
                  return (
                    <div key={b.key} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr) 44px", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--v2-muted)", whiteSpace: "nowrap" }}>{b.label}{b.enCours ? " •" : ""}</span>
                      <SplitBar jours={b.jours} height={12} />
                      <span className="v2-num" style={{ fontSize: 12, textAlign: "right", fontWeight: 600 }}>{tot ? pct(b.jours.atteint / tot) : "—"}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10 }}><Legend /></div>
            </Card>
            <Card>
              <div style={{ fontSize: 15, fontWeight: 600 }}>CA total par période</div>
              <div style={{ fontSize: 12, color: "var(--v2-muted)", marginBottom: 8 }}>Volume de la flotte (brut + bonus + hors Yango).</div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={buckets} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--sk-border)" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--v2-muted)" }} interval="preserveStartEnd" />
                    <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "var(--v2-muted)" }} tickFormatter={k} />
                    <Tooltip cursor={{ fill: "var(--sk-surface)", opacity: 0.5 }} content={<ChartTip objectif={objectif} />} />
                    <Bar dataKey="ca" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                      {buckets.map((b) => <Cell key={b.key} fill={SERIES_COLOR} fillOpacity={b.enCours ? 0.45 : 1} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* 4. Chauffeurs × périodes */}
          {data.drivers.length > 0 && (
            <Card flush>
              <div style={{ padding: "14px 16px 6px", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Chauffeurs × périodes</div>
                  <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>CA par jour travaillé. Survolez une case pour le détail.</div>
                </div>
                <Legend />
              </div>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "4px 0 10px" }}>
                <table style={{ borderCollapse: "separate", borderSpacing: 3, minWidth: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "var(--sk-card, var(--sk-bg))", textAlign: "left", fontSize: 11, color: "var(--v2-muted)", fontWeight: 500, padding: "4px 10px", zIndex: 1 }}>Chauffeur</th>
                      {buckets.map((b) => <th key={b.key} style={{ fontSize: 11, color: "var(--v2-muted)", fontWeight: 500, padding: "4px 2px", whiteSpace: "nowrap" }}>{b.label}</th>)}
                      <th style={{ fontSize: 11, color: "var(--v2-muted)", fontWeight: 500, padding: "4px 10px", textAlign: "right" }}>Fenêtre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.drivers.map((d) => (
                      <tr key={d.driverId}>
                        <td style={{ position: "sticky", left: 0, background: "var(--sk-card, var(--sk-bg))", fontSize: 13, fontWeight: 500, padding: "4px 10px", whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", zIndex: 1 }}>{d.name}</td>
                        {d.cells.map((c) => {
                          const b = buckets.find((x) => x.key === c.key)!;
                          return (
                            <td key={c.key} title={c.caParJour != null ? `${d.name} · ${b.label}\n${formatAmount(c.caParJour)} / jour (${Math.round((c.caParJour / objectif) * 100)} %)\n${c.journees} journée(s) · CA ${formatAmount(c.ca)}${c.statut ? `\n${STATUS_ICON[c.statut]} ${STATUS_LABEL[c.statut]}` : ""}` : `${d.name} · ${b.label} : aucune déclaration`}
                              className={b.enCours && c.statut ? "perf-hatch" : undefined}
                              style={{
                                minWidth: 46, height: 30, borderRadius: 6, textAlign: "center", fontSize: 11, fontWeight: 600,
                                background: c.statut ? `${STATUS_COLOR[c.statut]}${b.enCours ? "55" : "cc"}` : "var(--sk-surface)",
                                color: c.statut ? (b.enCours ? "var(--sk-t1, #fff)" : "#0b0b0b") : "var(--v2-muted)",
                              }}>
                              {c.caParJour != null ? k(c.caParJour) : "·"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "4px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <span className="v2-num" style={{ fontSize: 13, fontWeight: 600, marginRight: 6 }}>{d.caParJour != null ? formatAmount(d.caParJour) : "—"}</span>
                          <StatusPill statut={d.statut} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* 5. Constats */}
          {data.insights.length > 0 && (
            <Card>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                <Lightbulb size={16} aria-hidden /> À retenir
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5 }}>
                {data.insights.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
