"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleCheck, TriangleAlert, MessageSquare, Sparkles, Info, ChevronDown, ChevronRight, Paperclip } from "lucide-react";
import { Badge, Button, Segmented, Toast } from "@/components/ui";
import { useReportReview } from "@/components/admin/useReportReview";
import { useExpenseReview } from "@/components/admin/useExpenseReview";
import { EXPENSE_CATEGORIES } from "@/lib/expenseCategories";
import { displayLabel, platLabel } from "@/lib/tenant/platformLabel";
import { formatAmount } from "@/lib/v2/format";
import { netCheck, shortDayFr } from "@/lib/v2/driver";
import { daysBetween, extractionConfidence, gpsGap, isNew, kmDeclared, nextSelection } from "@/lib/v2/validation";
import { useReviewContext } from "./useReviewContext";

/* eslint-disable @typescript-eslint/no-explicit-any -- lignes rapports / dépenses non typées (convention du projet) */

const nameOf = (r: any) => r?._profile?.full_name || r?.profiles?.full_name || r?._profile?.driver_id || "Chauffeur";
const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

/**
 * À valider v2 (maquette 2c) : liste 360 px + panneau de détail à droite
 * (plus de modale). Les écritures sont celles des modales actuelles, partagées
 * via useReportReview / useExpenseReview.
 */
export function PendingV2({ reports, expenses, loading, onRefresh }: {
  reports: any[];
  expenses: any[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [kind, setKind] = useState<"reports" | "expenses">("reports");
  const list = kind === "reports" ? reports : expenses;
  const ids = useMemo(() => list.map((x) => x.id as string), [list]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const pendingAction = useRef<{ id: string; label: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const now = useMemo(() => new Date(), [list]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sélection : garde l'élément, sinon prend celui qui a pris sa place (« Valider et suivant »).
  useEffect(() => {
    const next = nextSelection(ids, selectedId, lastIndex.current);
    const acted = pendingAction.current;
    if (acted && !ids.includes(acted.id)) {
      setToast(acted.label);
      pendingAction.current = null;
    }
    if (next !== selectedId) setSelectedId(next);
  }, [ids, selectedId]);

  const select = (id: string) => { lastIndex.current = ids.indexOf(id); setSelectedId(id); };
  const selected = list.find((x) => x.id === selectedId) ?? null;
  const onAction = (id: string, label: string) => {
    lastIndex.current = ids.indexOf(id);
    pendingAction.current = { id, label };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr]" style={{ borderRadius: 14, border: "1px solid var(--sk-surface)", background: "var(--sk-deep)", overflow: "hidden", minHeight: 560 }}>
      {/* ── Liste ── */}
      <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--sk-surface)", minWidth: 0 }}>
        <div style={{ padding: "14px 16px" }}>
          <Segmented
            options={[{ key: "reports", label: `Rapports ${reports.length}` }, { key: "expenses", label: `Dépenses ${expenses.length}` }]}
            value={kind} onChange={(k) => { setKind(k); setSelectedId(null); lastIndex.current = 0; }} ariaLabel="Type d'élément" style={{ width: "100%" }} size="mobile"
          />
        </div>
        <div role="listbox" aria-label="Éléments à valider" style={{ overflowY: "auto", flex: 1 }}>
          {loading && list.length === 0 ? (
            [0, 1, 2].map((i) => <div key={i} className="v2-skeleton" style={{ height: 58, margin: "8px 16px", borderRadius: 10 }} aria-hidden />)
          ) : list.length === 0 ? (
            <div style={{ padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--v2-muted)", fontSize: 14 }}>
              <CircleCheck size={28} aria-hidden style={{ color: "var(--fleet-positive)" }} />Tout est validé
            </div>
          ) : list.map((x) => {
            const on = x.id === selectedId;
            const isReport = kind === "reports";
            const repos = isReport && typeof x.comment === "string" && x.comment.startsWith("[REPOS]");
            return (
              <button key={x.id} type="button" role="option" aria-selected={on} onClick={() => select(x.id)} className="v2-row v2-focus"
                style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", padding: "14px 20px", textAlign: "left", cursor: "pointer", border: "none", borderBottom: "1px solid var(--sk-surface)", color: "inherit",
                  background: on ? "var(--v2-select-bg)" : "transparent", boxShadow: on ? "inset 2px 0 0 var(--tenant-color)" : undefined }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: on ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(x)}</span>
                  {isNew(x.created_at, now) && <Badge tone="brand" square style={{ fontSize: 10 }}>NOUVEAU</Badge>}
                  <span className="v2-num" style={{ fontSize: 14 }}>{formatAmount(isReport ? x.net_after_expenses : x.amount)}</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>
                  {isReport
                    ? `${shortDayFr(x.date)} · ${repos ? "jour de repos" : x.yango_trip_count ? `${x.yango_trip_count} courses` : "rapport"}`
                    : `${shortDayFr((x.expense_date || x.created_at || "").slice(0, 10))} · ${displayLabel(x.category || "Autre")}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Détail ── */}
      <div style={{ minWidth: 0 }}>
        {!selected ? (
          <div style={{ height: "100%", minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--v2-muted)", fontSize: 14 }}>
            {list.length ? "Sélectionne un élément" : "Rien à valider pour l'instant"}
          </div>
        ) : kind === "reports" ? (
          <ReportPanel key={selected.id} report={selected} onRefresh={onRefresh} onAction={onAction} />
        ) : (
          <ExpensePanel key={selected.id} expense={selected} onRefresh={onRefresh} onAction={onAction} />
        )}
      </div>
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}

function PanelShell({ title, sub, badge, children, actions }: { title: string; sub: string; badge?: React.ReactNode; children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div style={{ padding: "22px 28px", display: "flex", flexDirection: "column", gap: 16, height: "100%" }} className="max-lg:p-4!">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
          <div style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 4 }}>{sub}</div>
        </div>
        {badge}
      </div>
      {children}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 14, borderTop: "1px solid var(--sk-surface)", marginTop: "auto", flexWrap: "wrap" }}>{actions}</div>
    </div>
  );
}

function Check2({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) {
  const tone = warn ? { bd: "var(--v2-wait-bd)", bg: "var(--v2-wait-bg)", fg: "var(--fleet-warning)", I: TriangleAlert } : ok ? { bd: "var(--v2-ok-bd)", bg: "rgba(74,222,128,.06)", fg: "var(--fleet-positive)", I: CircleCheck } : { bd: "var(--sk-surface)", bg: "var(--sk-bg)", fg: "var(--sk-t2)", I: Info };
  return (
    <div style={{ borderRadius: 12, padding: "12px 14px", border: `1px solid ${tone.bd}`, background: tone.bg, fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <tone.I size={16} aria-hidden style={{ color: tone.fg, flex: "none", marginTop: 1 }} /><span>{children}</span>
    </div>
  );
}

export function ReportPanel({ report, onRefresh, onAction }: { report: any; onRefresh: () => void; onAction: (id: string, label: string) => void }) {
  const rv = useReportReview(report, onRefresh);
  const ctx = useReviewContext(report);
  const [edit, setEdit] = useState(false);
  const plat = platLabel();
  const name = nameOf(report);

  const hasElements = report.yango_cash != null || report.yango_card != null;
  const rows: [string, number | null, "neg" | "pos" | undefined][] = [
    ...(hasElements
      ? ([["Espèces", report.yango_cash, undefined], ["Carte", report.yango_card, undefined]] as [string, number | null, undefined][])
      : ([[`Brut ${plat}`, report.yango_gross, undefined]] as [string, number | null, undefined][])),
    ["Bonus", report.yango_bonus, undefined],
    [`Commissions ${plat} + partenaire`, (report.commission_amount || 0) + (report.service_supplementaire || 0), "neg"],
    [`Hors ${plat}`, report.off_yango_revenue, "pos"],
  ];

  const netYango = (report.net_after_expenses || 0) - (report.off_yango_revenue || 0);
  const check = ctx.extraction ? netCheck(ctx.extraction.net_affiche, netYango) : "none";
  const conf = extractionConfidence(ctx.extraction?.confidences);
  const kmDecl = kmDeclared(report.end_odometer, ctx.prevOdometer);
  const gap = gpsGap({ kmDecl, kmGps: ctx.gps?.km_gps ?? null, coverage: ctx.gps?.coverage, points: ctx.gps?.points, daysCovered: ctx.prevDate ? daysBetween(ctx.prevDate, report.date) : null });
  const repos = typeof report.comment === "string" && report.comment.startsWith("[REPOS]");
  const images = rv.uploads.filter((u: any) => u.isImg);
  const files = rv.uploads.filter((u: any) => !u.isImg);

  const act = async (status: "approved" | "rejected") => {
    onAction(report.id, status === "approved" ? `Rapport validé — ${name} est notifié` : `Rapport rejeté — ${name} est notifié`);
    await rv.updateStatus(status);
  };

  return (
    <PanelShell
      title={`${name} · ${repos ? "repos" : "rapport"} du ${shortDayFr(report.date).split(" ")[1]}`}
      sub={[ctx.plate, report.created_at ? `envoyé à ${hhmm(report.created_at)}` : null].filter(Boolean).join(" · ")}
      badge={ctx.extraction ? (
        <Badge tone="ai" square style={{ padding: "5px 10px", fontSize: 12 }}>
          <Sparkles size={13} aria-hidden />Lu sur captures{conf.min != null ? ` · confiance ${Math.round(conf.min * 100)} %` : ""}
        </Badge>
      ) : ctx.loaded && !repos ? <Badge tone="neutral" square style={{ padding: "5px 10px", fontSize: 12 }}>Saisie manuelle</Badge> : undefined}
      actions={
        // Mêmes actions que la modale actuelle : Rejeter / Valider tant que le
        // rapport n'est pas validé, « Annuler la validation » sinon.
        report.status === "approved" ? (
          <Button variant="danger" size="md" disabled={rv.saving} onClick={() => void act("rejected")} style={{ height: 42 }}>Annuler la validation</Button>
        ) : (
          <>
            <Button variant="danger" size="md" disabled={rv.saving} onClick={() => void act("rejected")} style={{ height: 42 }}>Rejeter</Button>
            <Button variant="validate" size="md" icon={Check} disabled={rv.saving} onClick={() => void act("approved")} style={{ height: 42, fontWeight: 700 }}>
              {rv.saving ? "…" : report.status === "submitted" ? "Valider et suivant" : "Valider"}
            </Button>
          </>
        )
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_200px]" style={{ gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {!repos && (
            <div style={{ borderRadius: 14, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", overflow: "hidden", fontSize: 14 }}>
              {rows.map(([l, v, t]) => (
                <div key={l} style={{ display: "flex", padding: "11px 18px", borderBottom: "1px solid var(--sk-surface)" }}>
                  <span style={{ flex: 1, color: "var(--sk-t2)" }}>{l}</span>
                  <span className="v2-num" style={{ color: t === "neg" ? "var(--v2-negative-ink)" : undefined }}>
                    {v == null ? "—" : `${t === "neg" ? "− " : t === "pos" && v > 0 ? "+ " : ""}${formatAmount(v)}`}
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", padding: "14px 18px", alignItems: "baseline" }}>
                <span style={{ flex: 1, fontWeight: 600 }}>Net total</span>
                <span className="v2-num" style={{ fontSize: 20, fontWeight: 600, color: "var(--fleet-positive)" }}>{formatAmount(report.net_after_expenses)} XOF</span>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {!ctx.loaded ? (
              <div className="v2-skeleton" style={{ height: 46, borderRadius: 12 }} aria-hidden />
            ) : (
              <>
                {check === "match" && <Check2 ok>Net affiché {plat} = net calculé</Check2>}
                {check === "mismatch" && <Check2 warn>Net affiché {plat} <b className="v2-num">{formatAmount(ctx.extraction?.net_affiche)}</b> ≠ calculé <b className="v2-num">{formatAmount(netYango)}</b></Check2>}
                {kmDecl != null && ctx.gps?.km_gps != null ? (
                  <Check2 ok={gap.exploitable && !gap.alert} warn={gap.alert}>
                    <span className="v2-num">{formatAmount(kmDecl)}</span> km déclarés · <span className="v2-num">{formatAmount(ctx.gps.km_gps)}</span> km GPS
                    {gap.alert && gap.pct != null && <> · écart {Math.round(Math.abs(gap.pct))} %</>}
                  </Check2>
                ) : kmDecl != null ? (
                  <Check2><span className="v2-num">{formatAmount(kmDecl)}</span> km déclarés · pas de GPS ce jour</Check2>
                ) : null}
              </>
            )}
          </div>
          {ctx.extraction?.coherence_alerts.map((a, i) => <Check2 key={i} warn>{a.message}</Check2>)}

          {report.comment && !repos && (
            <div style={{ borderRadius: 12, padding: "12px 14px", background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", fontSize: 14, display: "flex", gap: 10 }}>
              <MessageSquare size={16} aria-hidden style={{ color: "var(--sk-t2)", flex: "none", marginTop: 2 }} />« {report.comment} »
            </div>
          )}
          {repos && <Check2>Jour de repos déclaré{report.comment.replace("[REPOS]", "").trim() ? ` : ${report.comment.replace("[REPOS]", "").trim()}` : ""}</Check2>}

          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--v2-muted)" }}>
            Commentaire / motif de rejet (visible par le chauffeur en cas de rejet)
            <textarea value={rv.note} onChange={(e) => rv.setNote(e.target.value)} rows={2} className="v2-focus"
              style={{ padding: "10px 12px", borderRadius: 10, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", fontSize: 14, resize: "vertical", outline: "none" }} />
          </label>

          <button type="button" onClick={() => setEdit((o) => !o)} aria-expanded={edit} className="v2-focus"
            style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--sk-t2)", fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
            {edit ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}Modifier le rapport
          </button>
          {edit && <ReportEditForm rv={rv} report={report} />}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>Captures</div>
          {images.length === 0 && files.length === 0 && <div style={{ fontSize: 13, color: "var(--sk-t3)" }}>Aucune pièce jointe</div>}
          {images.map((u: any, i: number) => (
            <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer" className="v2-focus" style={{ display: "block", borderRadius: 10, overflow: "hidden", border: "1px solid var(--sk-surface)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- URL de stockage signée */}
              <img src={u.publicUrl} alt={u.file_name} style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />
            </a>
          ))}
          {files.map((u: any, i: number) => (
            <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--sk-t2)", padding: "8px 10px", borderRadius: 8, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
              <Paperclip size={13} aria-hidden /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.file_name}</span>
            </a>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

function ReportEditForm({ rv, report }: { rv: ReturnType<typeof useReportReview>; report: any }) {
  const plat = platLabel();
  const preview = rv.recalc(parseFloat(rv.yangoGrossEdit) || 0, parseFloat(rv.yangoBonus) || 0, parseFloat(rv.horsYangoEdit) || 0, parseFloat(rv.serviceSuppEdit) || 0);
  const fields: [string, string, (v: string) => void, string][] = [
    ["Date", rv.dateEdit, rv.setDateEdit, "date"],
    [`Brut ${plat}`, rv.yangoGrossEdit, rv.setYangoGrossEdit, "number"],
    [`Bonus ${plat}`, rv.yangoBonus, rv.setYangoBonus, "number"],
    [`Hors ${plat}`, rv.horsYangoEdit, rv.setHorsYangoEdit, "number"],
    ["Solde wallet", rv.soldeEdit, rv.setSoldeEdit, "number"],
    ["Km fin de journée", rv.kmEdit, rv.setKmEdit, "number"],
    [`Courses ${plat}`, rv.yangoTripsEdit, rv.setYangoTripsEdit, "number"],
    [`Courses hors ${plat}`, rv.offYangoTripsEdit, rv.setOffYangoTripsEdit, "number"],
    ["Service supplémentaire", rv.serviceSuppEdit, rv.setServiceSuppEdit, "number"],
  ];
  return (
    <div style={{ borderRadius: 14, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        {fields.map(([label, value, set, type]) => (
          <label key={label} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--v2-muted)" }}>
            {label}
            <input type={type} value={value} onChange={(e) => set(e.target.value)} className="v2-num v2-focus"
              style={{ height: 36, padding: "0 10px", borderRadius: 8, background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", fontSize: 14, outline: "none", colorScheme: "inherit" as never }} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ flex: 1, fontSize: 13, color: "var(--sk-t2)" }}>
          Net recalculé ({preview.mode === "elements_reels" ? "éléments réels" : "taux figés du rapport"}) :{" "}
          <b className="v2-num" style={{ color: "var(--fleet-positive)" }}>{formatAmount(preview.netAfterExpenses)}</b>
          {Math.round(preview.netAfterExpenses) !== Math.round(report.net_after_expenses || 0) && <span style={{ color: "var(--v2-muted)" }}> (actuel {formatAmount(report.net_after_expenses)})</span>}
        </span>
        <Button variant="outline" size="md" disabled={rv.saving} onClick={() => void rv.saveFields()}>{rv.saving ? "…" : "Enregistrer les modifications"}</Button>
      </div>
    </div>
  );
}

function ExpensePanel({ expense, onRefresh, onAction }: { expense: any; onRefresh: () => void; onAction: (id: string, label: string) => void }) {
  const ev = useExpenseReview(expense, onRefresh);
  const [edit, setEdit] = useState(false);
  const name = nameOf(expense);
  const images = ev.uploads.filter((u: any) => u.isImg);
  const autres = ev.uploads.filter((u: any) => !u.isImg);
  const pjRef = useRef<HTMLInputElement>(null);
  const act = async (status: "approved" | "rejected") => {
    onAction(expense.id, status === "approved" ? `Dépense validée — ${name} est notifié` : `Dépense rejetée — ${name} est notifié`);
    await ev.updateStatus(status);
  };
  const input = { height: 36, padding: "0 10px", borderRadius: 8, background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", fontSize: 14, outline: "none", colorScheme: "inherit" as never };

  return (
    <PanelShell
      title={`${name} · ${displayLabel(expense.category || "Autre").toLowerCase()}`}
      sub={`Dépense du ${shortDayFr((expense.expense_date || expense.created_at || "").slice(0, 10))}${expense.created_at ? ` · envoyée à ${hhmm(expense.created_at)}` : ""}`}
      badge={images.length ? <Badge tone="ok" square style={{ padding: "5px 10px", fontSize: 12 }}>avec reçu photo</Badge> : <Badge tone="wait" square style={{ padding: "5px 10px", fontSize: 12 }}>sans reçu</Badge>}
      actions={
        <>
          <Button variant="danger" size="md" disabled={ev.saving} onClick={() => void act("rejected")} style={{ height: 42 }}>Rejeter</Button>
          <Button variant="validate" size="md" icon={Check} disabled={ev.saving} onClick={() => void act("approved")} style={{ height: 42, fontWeight: 700 }}>
            {ev.saving ? "…" : "Valider et suivant"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_200px]" style={{ gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ borderRadius: 14, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", overflow: "hidden", fontSize: 14 }}>
            <div style={{ display: "flex", padding: "11px 18px", borderBottom: "1px solid var(--sk-surface)" }}><span style={{ flex: 1, color: "var(--sk-t2)" }}>Catégorie</span><span>{displayLabel(expense.category || "Autre")}</span></div>
            {expense.description && <div style={{ display: "flex", padding: "11px 18px", borderBottom: "1px solid var(--sk-surface)", gap: 12 }}><span style={{ flex: 1, color: "var(--sk-t2)" }}>Détail</span><span style={{ textAlign: "right" }}>{expense.description}</span></div>}
            <div style={{ display: "flex", padding: "14px 18px", alignItems: "baseline" }}><span style={{ flex: 1, fontWeight: 600 }}>Montant</span><span className="v2-num" style={{ fontSize: 20, fontWeight: 600, color: "var(--v2-negative-ink)" }}>{formatAmount(expense.amount)} XOF</span></div>
          </div>
          <button type="button" onClick={() => setEdit((o) => !o)} aria-expanded={edit} className="v2-focus"
            style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--sk-t2)", fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
            {edit ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}Modifier la dépense
          </button>
          {edit && (
            <div style={{ borderRadius: 14, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--v2-muted)" }}>Catégorie
                <select value={ev.editCategory} onChange={(e) => ev.setEditCategory(e.target.value)} className="v2-focus" style={input}>
                  {EXPENSE_CATEGORIES.map((t) => <option key={t} value={t}>{displayLabel(t)}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--v2-muted)" }}>Montant (XOF)
                <input type="number" value={ev.editAmount} onChange={(e) => ev.setEditAmount(e.target.value)} className="v2-num v2-focus" style={input} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--v2-muted)" }}>Date
                <input type="date" value={ev.editDate} onChange={(e) => ev.setEditDate(e.target.value)} className="v2-focus" style={input} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--v2-muted)", gridColumn: "1 / -1" }}>Description
                <input type="text" value={ev.editDesc} onChange={(e) => ev.setEditDesc(e.target.value)} className="v2-focus" style={input} />
              </label>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
                <Button variant="outline" size="md" disabled={ev.saving} onClick={() => void ev.saveEdit()}>{ev.saving ? "…" : "Enregistrer les modifications"}</Button>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>Reçu</span>
            {/* Ajout et retrait : la v2 ne savait qu'afficher. Un reçu envoyé
                sur la mauvaise dépense y restait attaché pour toujours, et un
                reçu oublié ne pouvait pas être rattrapé côté gestionnaire. */}
            <button type="button" onClick={() => pjRef.current?.click()} disabled={ev.uploading} className="v2-focus"
              style={{ background: "none", border: "none", color: "var(--tenant-color)", fontSize: 12, cursor: "pointer", padding: 0 }}>
              {ev.uploading ? "Envoi\u2026" : "+ Ajouter"}
            </button>
          </div>
          <input ref={pjRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf" multiple hidden
            onChange={(e) => { Array.from(e.target.files || []).forEach(ev.uploadFile); e.target.value = ""; }} />
          {ev.uploads.length === 0 && <div style={{ fontSize: 13, color: "var(--sk-t3)" }}>Aucune photo</div>}
          {images.map((u: any, i: number) => (
            <div key={i} style={{ position: "relative" }}>
              <a href={u.publicUrl} target="_blank" rel="noopener noreferrer" className="v2-focus" style={{ display: "block", borderRadius: 10, overflow: "hidden", border: "1px solid var(--sk-surface)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- URL de stockage signée */}
                <img src={u.publicUrl} alt={u.file_name} style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />
              </a>
              <button type="button" onClick={() => ev.deleteUpload(u)} disabled={ev.uploading}
                aria-label={`Supprimer ${u.file_name}`} title={`Supprimer ${u.file_name}`}
                style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 13, background: "rgba(0,0,0,.65)", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
            </div>
          ))}
          {autres.map((u: any, i: number) => (
            <div key={`f${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, background: "var(--sk-surface)", fontSize: 13 }}>
              <span aria-hidden>📄</span>
              <a href={u.publicUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, color: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.file_name}</a>
              <button type="button" onClick={() => ev.deleteUpload(u)} disabled={ev.uploading}
                aria-label={`Supprimer ${u.file_name}`} style={{ background: "none", border: "none", color: "var(--v2-negative-ink)", cursor: "pointer" }}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}
