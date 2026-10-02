"use client";

/**
 * Performance chauffeurs : Classement (tableau triable), KPI chauffeurs
 * (cartes + alertes) et Extraction (rapport → aperçu → Excel).
 * Données : GET /api/admin/analytics (même calcul pour les trois écrans).
 * Les indicateurs Fleetroom n'apparaissent que si le tenant a des commandes
 * importées sur la période ; l'admin peut aussi les masquer.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Play, TriangleAlert } from "lucide-react";
import { Button, Card, Segmented } from "@/components/ui";
import { formatAmount, formatDecimal } from "@/lib/v2/format";
import { totalRow, type Column, type ReportDef, type ReportKey, type ReportResult, type Row } from "@/lib/analytics/reports";
import type { SegmentFilter } from "@/lib/analytics/segment";
import { statutDe } from "@/lib/analytics/trends";
import { HorsYangoControl, ObjectifControl, ObjectiveValue, STATUS_COLOR, StatusPill, usePerfMeta } from "./perfShared";

type Range = { from: string; to: string };
type Statut = "approved" | "all";

interface Common {
  range: Range;
  driverIds: string[];
  periodLabel: string;
  /** filtre « type de véhicule » partagé par les écrans Performance */
  segment: SegmentFilter;
  onSegment: (s: SegmentFilter) => void;
  /** CA avec (true) ou sans (false) les recettes hors Yango */
  horsYango: boolean;
  onHorsYango: (v: boolean) => void;
}

/* ── Accès API ─────────────────────────────────────────────── */

const qs = (report: string, c: Common, statut: Statut, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams({ report, dateFrom: c.range.from, dateTo: c.range.to, statut, segment: c.segment, hors: c.horsYango ? "1" : "0", ...extra });
  if (c.driverIds.length) p.set("driverIds", c.driverIds.join(","));
  return `/api/admin/analytics?${p}`;
};

function useReport(report: ReportKey | null, c: Common, statut: Statut, auto: boolean) {
  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = report ? qs(report, c, statut) : null;
  // n° de requête : une réponse plus ancienne (période changée entre-temps, ou
  // aperçu invalidé par reset) n'écrase jamais la plus récente
  const seq = useRef(0);
  const run = useCallback(async () => {
    if (!key) return;
    const my = ++seq.current;
    setLoading(true); setError(null);
    try {
      const res = await fetch(key, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      if (my === seq.current) setData(json);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [key]);
  // Rechargement automatique quand la période / le filtre change (Classement, KPI)
  useEffect(() => { if (auto) void Promise.resolve().then(run); }, [auto, run]);
  const reset = useCallback(() => { seq.current++; setData(null); setLoading(false); }, []);
  return { data, loading, error, run, reset };
}

async function downloadXlsx(report: ReportKey, c: Common, statut: Statut) {
  const res = await fetch(qs(report, c, statut, { format: "xlsx" }), { cache: "no-store" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Erreur ${res.status}`);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || `${report}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ── Formatage ─────────────────────────────────────────────── */

export function formatCell(type: Column["type"], v: Row[string]): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") return type === "date" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : v;
  switch (type) {
    case "xof": return formatAmount(v);
    case "int": return new Intl.NumberFormat("fr-FR").format(Math.round(v));
    case "pct": return `${Math.round(v * 100)} %`;
    case "dec": case "h": return formatDecimal(v, 1);
    default: return String(v);
  }
}

const th: CSSProperties = { textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--v2-muted)", padding: "10px 12px", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--sk-card, var(--sk-bg))", zIndex: 1 };
const td: CSSProperties = { padding: "9px 12px", fontSize: 13.5, borderTop: "1px solid var(--sk-border)", whiteSpace: "nowrap" };
const isNum = (t: Column["type"]) => t !== "text" && t !== "date";

/* ── Tableau triable générique ─────────────────────────────── */

export function DataTable({ columns, rows, sortable = true, maxRows, initialSort, stickyFirst = false, renderCell }: {
  columns: Column[];
  rows: Row[];
  /** rendu spécifique d'une cellule (ex. CA/jour coloré selon l'objectif) ; undefined = rendu standard */
  renderCell?: (col: Column, row: Row) => React.ReactNode | undefined;
  sortable?: boolean;
  /** aperçu : n'affiche que les N premières lignes (le total porte sur tout) */
  maxRows?: number;
  initialSort?: { key: string; desc: boolean };
  stickyFirst?: boolean;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    return [...rows].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // valeurs absentes toujours en bas
      if (vb == null) return -1;
      const cmp = col && isNum(col.type) ? Number(va) - Number(vb) : String(va).localeCompare(String(vb), "fr");
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, sort, columns]);
  const total = useMemo(() => totalRow(columns, rows), [columns, rows]);
  const shown = maxRows ? sorted.slice(0, maxRows) : sorted;
  const click = (c: Column) => {
    if (!sortable) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: isNum(c.type) }));
  };
  const first = (i: number): CSSProperties => (stickyFirst && i === 0 ? { position: "sticky", left: 0, background: "var(--sk-card, var(--sk-bg))", zIndex: 2 } : {});
  return (
    <div style={{ overflow: "auto", maxHeight: "70dvh", WebkitOverflowScrolling: "touch" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key} style={{ ...th, ...first(i), textAlign: isNum(c.type) ? "right" : "left", cursor: sortable ? "pointer" : undefined, zIndex: i === 0 && stickyFirst ? 3 : 1 }}
                onClick={() => click(c)} aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {c.label}
                  {sort?.key === c.key && (sort.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri}>
              {columns.map((c, i) => (
                <td key={c.key} className={isNum(c.type) ? "v2-num" : undefined}
                  style={{ ...td, ...first(i), textAlign: isNum(c.type) ? "right" : "left", fontWeight: c.key === "name" || c.key === "chauffeur" ? 500 : undefined, maxWidth: c.type === "text" ? 280 : undefined, overflow: "hidden", textOverflow: "ellipsis" }}
                  title={typeof r[c.key] === "string" ? String(r[c.key]) : undefined}>
                  {renderCell?.(c, r) ?? formatCell(c.type, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={isNum(c.type) ? "v2-num" : undefined} style={{ ...td, ...first(i), fontWeight: 700, borderTop: "2px solid var(--sk-border)", textAlign: isNum(c.type) ? "right" : "left" }}>
                  {total[c.key] == null ? "" : formatCell(c.type, total[c.key])}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Header({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h3>
        {sub && <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>{sub}</span>}
      </div>
      {right && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{right}</div>}
    </div>
  );
}

const STATUT_OPTS = [{ key: "approved" as Statut, label: "Validées" }, { key: "all" as Statut, label: "+ en attente" }];

function ErrorBox({ msg }: { msg: string }) {
  return (
    <Card>
      <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--fleet-negative, #ef4444)", fontSize: 14 }}>
        <TriangleAlert size={16} aria-hidden /> {msg}
      </div>
    </Card>
  );
}

function ExportButton({ report, c, statut, disabled }: { report: ReportKey; c: Common; statut: Statut; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="outline" icon={Download} disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try { await downloadXlsx(report, c, statut); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
      }}>
      {busy ? "Préparation…" : "Excel"}
    </Button>
  );
}

/* ── Classement ────────────────────────────────────────────── */

const FR_KEYS = (k: string) => k.startsWith("fr.");

export function ClassementV2(c: Common) {
  const [statut, setStatut] = useState<Statut>("approved");
  const [showYango, setShowYango] = useState(true);
  const { data, loading, error, run } = useReport("classement", c, statut, true);
  const { meta, reload } = usePerfMeta();
  const objectif = meta?.objectif ?? 40_000;
  const columns = (data?.columns ?? []).filter((col) => showYango || !FR_KEYS(col.key));
  const rows = data?.rows ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Header title="Classement des chauffeurs" sub={c.periodLabel}
        right={<>
          <HorsYangoControl value={c.horsYango} onChange={c.onHorsYango} />
          <Segmented options={STATUT_OPTS} value={statut} onChange={setStatut} ariaLabel="Déclarations prises en compte" />
          <ObjectifControl meta={meta} onSaved={() => { void reload(); void run(); }} />
          {data?.hasFleetroom && (
            <Button size="sm" variant="outline" onClick={() => setShowYango((v) => !v)}>
              {showYango ? "Masquer les KPI Yango" : "Afficher les KPI Yango"}
            </Button>
          )}
          <ExportButton report="classement" c={c} statut={statut} disabled={!rows.length} />
        </>} />
      <p style={{ margin: 0, fontSize: 12, color: "var(--v2-muted)" }}>
        Cliquez sur un en-tête pour trier. Pastille du CA/jour : vert ≥ objectif, ambre 80–100 %, rouge &lt; 80 %. CA = brut Yango + bonus{c.horsYango ? " + hors Yango" : " (hors Yango exclu)"}. Km = compteur{data?.hasFleetroom ? ", sinon distance des courses Yango" : ""}. Comptes techniques exclus.
      </p>
      {data?.truncated && <ErrorBox msg="Données plafonnées à 30 000 lignes : chiffres partiels, réduisez la période." />}
      {error ? <ErrorBox msg={error} /> : (
        <Card flush>
          {loading && !data ? <div className="v2-skeleton" style={{ height: 180 }} aria-hidden />
            : rows.length === 0 ? <div style={{ padding: 18, fontSize: 14, color: "var(--v2-muted)" }}>Aucune activité sur la période.</div>
            : <DataTable columns={columns} rows={rows} initialSort={{ key: "ca", desc: true }} stickyFirst={false}
                renderCell={(col, r) => (col.key === "caParJour" ? <ObjectiveValue value={typeof r.caParJour === "number" ? r.caParJour : null} objectif={objectif} /> : undefined)} />}
        </Card>
      )}
    </div>
  );
}

/* ── KPI chauffeurs (monitoring) ───────────────────────────── */

interface Alert { tone: "warn" | "bad"; text: string }

/** Alertes par chauffeur, relatives à la moyenne de la flotte (seuils simples, lisibles). */
export function driverAlerts(r: Row, avg: { caParJour: number | null; coursesParJour: number | null }, objectif?: number): Alert[] {
  const out: Alert[] = [];
  if (objectif && typeof r.caParJour === "number") {
    const st = statutDe(r.caParJour, objectif);
    if (st === "sous") out.push({ tone: "bad", text: `CA/jour à ${Math.round((r.caParJour / objectif) * 100)} % de l'objectif` });
    else if (st === "proche") out.push({ tone: "warn", text: `CA/jour à ${Math.round((r.caParJour / objectif) * 100)} % de l'objectif` });
  }
  const acc = r["fr.tauxAcceptation"];
  if (typeof acc === "number" && acc < 0.8) out.push({ tone: acc < 0.65 ? "bad" : "warn", text: `Acceptation ${Math.round(acc * 100)} %` });
  const amp = r["fr.amplitudeMoy"];
  if (typeof amp === "number" && amp > 13) out.push({ tone: "warn", text: `Amplitude ${formatDecimal(amp, 1)} h/jour` });
  const occ = r["fr.occupation"];
  if (typeof occ === "number" && occ < 0.35) out.push({ tone: "warn", text: `Occupation ${Math.round(occ * 100)} %` });
  const cpj = r.caParJour;
  if (typeof cpj === "number" && avg.caParJour && cpj < avg.caParJour * 0.75) out.push({ tone: "warn", text: `CA/jour ${Math.round((1 - cpj / avg.caParJour) * 100)} % sous la moyenne` });
  const kpj = r.coursesParJour;
  if (typeof kpj === "number" && avg.coursesParJour && kpj < avg.coursesParJour * 0.75) out.push({ tone: "warn", text: "Peu de courses par jour" });
  if (typeof r.jours === "number" && r.jours === 0) out.push({ tone: "bad", text: "Aucune déclaration" });
  return out;
}

function Metric({ label, value, avg }: { label: string; value: string; avg?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--v2-muted)", whiteSpace: "nowrap" }}>{label}</div>
      <div className="v2-num" style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
      {avg && <div style={{ fontSize: 11, color: "var(--v2-muted)" }}>moy. {avg}</div>}
    </div>
  );
}

export function KpiChauffeursV2(c: Common) {
  const [statut, setStatut] = useState<Statut>("approved");
  const { data, loading, error, run } = useReport("classement", c, statut, true);
  const { meta, reload } = usePerfMeta();
  const objectif = meta?.objectif ?? 40_000;
  const rows = data?.rows ?? [];
  const actifs = rows.filter((r) => Number(r.jours) > 0 || r["fr.tauxAcceptation"] != null);
  const mean = (k: string) => {
    const v = actifs.map((r) => r[k]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const avg = { caParJour: mean("caParJour"), coursesParJour: mean("coursesParJour"), caParCourse: mean("caParCourse"), caParKm: mean("caParKm"), acc: mean("fr.tauxAcceptation"), amp: mean("fr.amplitudeMoy"), occ: mean("fr.occupation") };
  const fr = !!data?.hasFleetroom;
  const pct = (v: Row[string] | number | null) => (typeof v === "number" ? `${Math.round(v * 100)} %` : "—");
  const fmt = (v: Row[string] | number | null) => (typeof v === "number" ? formatAmount(v) : "—");
  const dec = (v: Row[string] | number | null) => (typeof v === "number" ? formatDecimal(v, 1) : "—");
  const withAlerts = rows.map((r) => ({ r, alerts: driverAlerts(r, avg, objectif) }))
    .sort((a, b) => b.alerts.length - a.alerts.length || Number(b.r.ca) - Number(a.r.ca));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Header title="KPI chauffeurs" sub={c.periodLabel}
        right={<>
          <HorsYangoControl value={c.horsYango} onChange={c.onHorsYango} />
          <Segmented options={STATUT_OPTS} value={statut} onChange={setStatut} ariaLabel="Déclarations prises en compte" />
          <ObjectifControl meta={meta} onSaved={() => { void reload(); void run(); }} />
        </>} />
      {data?.truncated && <ErrorBox msg="Données plafonnées à 30 000 lignes : chiffres partiels, réduisez la période." />}
      {error ? <ErrorBox msg={error} /> : loading && !data ? <div className="v2-skeleton" style={{ height: 220 }} aria-hidden /> : rows.length === 0 ? (
        <Card><div style={{ fontSize: 14, color: "var(--v2-muted)" }}>Aucune activité sur la période.</div></Card>
      ) : (
        <>
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 14 }}>
              <Metric label="Chauffeurs actifs" value={String(actifs.length)} />
              <Metric label="CA / jour (moyenne)" value={fmt(avg.caParJour)} avg={`objectif ${fmt(objectif)}`} />
              <Metric label="Courses / jour" value={dec(avg.coursesParJour)} />
              <Metric label="CA / course" value={fmt(avg.caParCourse)} />
              <Metric label="CA / km" value={fmt(avg.caParKm)} />
              {fr && <Metric label="Acceptation" value={pct(avg.acc)} />}
              {fr && <Metric label="Amplitude / jour" value={avg.amp != null ? `${dec(avg.amp)} h` : "—"} />}
              {fr && <Metric label="Occupation" value={pct(avg.occ)} />}
            </div>
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
            {withAlerts.map(({ r, alerts }) => (
              <Card key={String(r.driverId ?? r.name)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--v2-muted)", whiteSpace: "nowrap" }}>
                    <StatusPill compact statut={typeof r.caParJour === "number" ? statutDe(r.caParJour, objectif) : null} title="CA/jour vs objectif" />
                    #{r.rang}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--v2-muted)", marginBottom: 10 }}>
                  <span><strong style={{ color: "var(--sk-t1, inherit)" }}>{String(r.jours)}</strong> j travaillés</span>
                  <span><strong style={{ color: "var(--sk-t1, inherit)" }}>{String(r.repos ?? 0)}</strong> repos</span>
                  {r.sansDeclaration != null && <span>{Number(r.sansDeclaration) > 0 && <span aria-hidden style={{ color: STATUS_COLOR.proche }}>⚠ </span>}<strong style={{ color: "var(--sk-t1, inherit)" }}>{String(r.sansDeclaration)}</strong> sans déclaration</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <Metric label="CA" value={fmt(r.ca)} />
                  <Metric label="CA / jour" value={fmt(r.caParJour)} avg={fmt(avg.caParJour)} />
                  <Metric label="Courses / jour" value={dec(r.coursesParJour)} avg={dec(avg.coursesParJour)} />
                  <Metric label="CA / course" value={fmt(r.caParCourse)} avg={fmt(avg.caParCourse)} />
                  <Metric label="Km" value={fmt(r.km)} />
                  <Metric label="CA / km" value={fmt(r.caParKm)} avg={fmt(avg.caParKm)} />
                  {fr && r["fr.tauxAcceptation"] != null && <>
                    <Metric label="Acceptation" value={pct(r["fr.tauxAcceptation"])} avg={pct(avg.acc)} />
                    <Metric label="Refus" value={String(r["fr.refus"] ?? "—")} />
                    <Metric label="Heures en course" value={dec(r["fr.heuresCourse"])} />
                    <Metric label="Amplitude / jour" value={r["fr.amplitudeMoy"] != null ? `${dec(r["fr.amplitudeMoy"])} h` : "—"} avg={avg.amp != null ? `${dec(avg.amp)} h` : undefined} />
                    <Metric label="Occupation" value={pct(r["fr.occupation"])} avg={pct(avg.occ)} />
                    <Metric label="XOF / km Yango" value={fmt(r["fr.xofParKm"])} />
                  </>}
                </div>
                {alerts.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                    {alerts.map((a) => (
                      <span key={a.text} style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: a.tone === "bad" ? "rgba(239,68,68,.12)" : "rgba(245,158,11,.14)", color: a.tone === "bad" ? "#ef4444" : "#d97706" }}>
                        {a.text}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--v2-muted)" }}>
            Alertes : CA/jour sous l&apos;objectif de {fmt(objectif)} (ambre 80–100 %, rouge &lt; 80 %), CA/jour ou courses/jour à plus de 25 % sous la moyenne de la flotte{fr ? ", acceptation < 80 %, amplitude > 13 h, occupation < 35 % (données Yango Fleetroom)" : ""}.
          </p>
        </>
      )}
    </div>
  );
}

/* ── Extraction ────────────────────────────────────────────── */

const PREVIEW_ROWS = 200;

export function ExtractionV2(c: Common) {
  const [catalog, setCatalog] = useState<ReportDef[] | null>(null);
  const [report, setReport] = useState<ReportKey>("declarations");
  const [statut, setStatut] = useState<Statut>("all");
  const { data, loading, error, run, reset } = useReport(report, c, statut, false);
  useEffect(() => {
    fetch("/api/admin/analytics?report=catalog", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setCatalog(Array.isArray(j.reports) ? j.reports : [])).catch(() => setCatalog([]));
  }, []);
  // un autre choix (rapport, période, statut) invalide l'aperçu affiché
  useEffect(() => { reset(); }, [reset, report, statut, c.segment, c.horsYango, c.range.from, c.range.to, c.driverIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = catalog?.find((r) => r.key === report);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Header title="Extraction de données" sub={c.periodLabel} right={<>
        <HorsYangoControl value={c.horsYango} onChange={c.onHorsYango} />
      </>} />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>
            1. Période et chauffeurs : barre de filtres en haut ({c.periodLabel}{c.driverIds.length ? ` · ${c.driverIds.length} chauffeur(s)` : " · tous les chauffeurs"}{c.segment !== "all" ? ` · flotte ${c.segment === "interne" ? "interne" : "externe"}` : ""}).
          </div>
          <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>2. Rapport :</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))", gap: 8 }}>
            {(catalog ?? []).map((r) => (
              <button key={r.key} type="button" onClick={() => setReport(r.key)}
                style={{
                  textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${report === r.key ? "var(--tenant-color, #3b82f6)" : "var(--sk-border)"}`,
                  background: report === r.key ? "rgba(var(--tenant-color-rgb, 59,130,246), .08)" : "transparent", color: "inherit",
                }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{r.label}</div>
                <div style={{ fontSize: 12, color: "var(--v2-muted)", marginTop: 2 }}>{r.description}</div>
              </button>
            ))}
            {!catalog && <div className="v2-skeleton" style={{ height: 60 }} aria-hidden />}
          </div>
          {!def?.fleetroom && report !== "paiements" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>3. Déclarations :</span>
              <Segmented options={[{ key: "all" as Statut, label: "Validées + en attente" }, { key: "approved" as Statut, label: "Validées seulement" }]} value={statut} onChange={setStatut} ariaLabel="Statut" />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button icon={Play} onClick={() => void run()} disabled={loading}>{loading ? "Génération…" : "Générer l'aperçu"}</Button>
            <ExportButton report={report} c={c} statut={statut} />
          </div>
        </div>
      </Card>
      {error && <ErrorBox msg={error} />}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Header title={data.title} sub={`${data.rows.length} ligne(s)${data.rows.length > PREVIEW_ROWS ? ` · aperçu des ${PREVIEW_ROWS} premières` : ""}`}
            right={<span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--v2-muted)" }}><FileSpreadsheet size={14} aria-hidden /> Le fichier Excel contient toutes les lignes</span>} />
          {data.truncated && <ErrorBox msg="Extraction plafonnée à 30 000 lignes : réduisez la période." />}
          <Card flush>
            {data.rows.length === 0
              ? <div style={{ padding: 18, fontSize: 14, color: "var(--v2-muted)" }}>Aucune donnée pour cette sélection.</div>
              : <DataTable columns={data.columns} rows={data.rows} maxRows={PREVIEW_ROWS} />}
          </Card>
        </div>
      )}
    </div>
  );
}
