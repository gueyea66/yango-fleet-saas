"use client";

import { useEffect, useMemo, useState } from "react";
import { BedDouble, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui";
import { ReportHistoryCard, ExpenseCard } from "@/components/driver/DriverCards";
import { useReposForm } from "@/components/driver/useReposForm";
import type { Profile } from "@/components/driver/shared";
import { displayLabel } from "@/lib/tenant/platformLabel";
import { formatAmount } from "@/lib/v2/format";
import { buildMonthGrid, dayStatus, monthNameFr, shortDayFr, type DayStatus } from "@/lib/v2/driver";
import { ScreenHeader, ScreenBody, DoneHero, SkeletonBlock, Label, fieldStyle } from "./parts";
import { useDriverMonth, type MonthReport } from "./useDriverMonth";

const CELL: Record<Exclude<DayStatus, null> | "none" | "future", { bg: string; bd: string; fg: string; label?: string }> = {
  approved: { bg: "rgba(34,197,94,.18)", bd: "var(--v2-validate)", fg: "var(--sk-t1)", label: "Validé" },
  submitted: { bg: "rgba(249,115,22,.16)", bd: "var(--fleet-warning)", fg: "var(--sk-t1)", label: "En attente" },
  rejected: { bg: "rgba(239,68,68,.16)", bd: "var(--fleet-negative)", fg: "var(--sk-t1)", label: "Rejeté" },
  repos: { bg: "var(--sk-surface)", bd: "var(--sk-border)", fg: "var(--sk-t2)", label: "Repos" },
  none: { bg: "transparent", bd: "var(--sk-surface)", fg: "var(--sk-t2)" },
  future: { bg: "transparent", bd: "var(--sk-surface)", fg: "var(--sk-t3)" },
};
const STATUS_TONE: Record<string, "ok" | "wait" | "neg" | "neutral"> = { approved: "ok", submitted: "wait", rejected: "neg", repos: "neutral" };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Historique & repos v2 (maquette 2c) : un calendrier du mois. Le détail du
 * jour réutilise les cartes actuelles (resoumission / archivage / pièces
 * jointes, mêmes écritures). « Déclarer un jour de repos » ouvre le formulaire
 * de repos actuel (useReposForm).
 */
export function CalendarV2({ profile, onBack, startWithRepos = false }: { profile: Profile; onBack: () => void; startWithRepos?: boolean }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string>(todayIso());
  const [repos, setRepos] = useState(startWithRepos);
  const { reports, expenses, loading, refresh } = useDriverMonth(profile, ym.y, ym.m);

  const grid = useMemo(() => buildMonthGrid(ym.y, ym.m), [ym]);
  const reportsByDay = useMemo(() => {
    const map = new Map<string, MonthReport[]>();
    for (const r of reports) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return map;
  }, [reports]);
  const today = todayIso();
  const shift = (delta: number) => setYm(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const isCurrentMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();

  if (repos) {
    return <ReposV2 profile={profile} defaultDate={selected} onDone={() => { setRepos(false); refresh(); }} onBack={() => setRepos(false)} />;
  }

  const dayReports = (reportsByDay.get(selected) ?? []).filter((r) => r.status !== "archived");
  const dayExpenses = expenses.filter((e) => (e.expense_date || e.created_at?.slice(0, 10)) === selected && e.status !== "archived");
  const st = dayStatus(dayReports);
  const active = dayReports.find((r) => r.status === "approved") ?? dayReports.find((r) => r.status === "submitted");
  const rejected = dayReports.filter((r) => r.status === "rejected");

  return (
    <>
      <ScreenHeader
        title="Historique"
        onBack={onBack}
        right={
          <div style={{ display: "flex", alignItems: "center" }}>
            <button type="button" aria-label="Mois précédent" onClick={() => shift(-1)} className="v2-focus" style={navBtn}><ChevronLeft size={18} aria-hidden /></button>
            <span style={{ fontSize: 13, color: "var(--v2-muted)", minWidth: 72, textAlign: "center" }}>{monthNameFr(ym.m)}{ym.y !== now.getFullYear() ? ` ${ym.y}` : ""}</span>
            <button type="button" aria-label="Mois suivant" onClick={() => shift(1)} disabled={isCurrentMonth} className="v2-focus" style={{ ...navBtn, opacity: isCurrentMonth ? 0.3 : 1 }}><ChevronRight size={18} aria-hidden /></button>
          </div>
        }
      />
      <ScreenBody padding="18px 16px" gap={14}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, fontSize: 11, color: "var(--sk-t2)", textAlign: "center" }} aria-hidden>
          {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        {loading ? <SkeletonBlock height={260} radius={12} /> : (
          <div role="grid" aria-label={`Calendrier ${monthNameFr(ym.m)} ${ym.y}`} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {grid.map((c, i) => {
              if (!c.date) return <span key={i} aria-hidden />;
              const s = dayStatus(reportsByDay.get(c.date) ?? []);
              const look = CELL[s ?? (c.date > today ? "future" : "none")];
              const on = c.date === selected;
              return (
                <button key={c.date} type="button" role="gridcell" aria-selected={on} onClick={() => setSelected(c.date!)}
                  aria-label={`${shortDayFr(c.date)}${look.label ? ` · ${look.label}` : ""}`} className="v2-num v2-focus"
                  style={{
                    aspectRatio: "1", borderRadius: 10, fontSize: 13, cursor: "pointer", padding: 0,
                    background: look.bg, border: `1px solid ${look.bd}`, color: look.fg,
                    boxShadow: on ? "0 0 0 2px var(--tenant-color)" : undefined,
                  }}>
                  {c.day}
                </button>
              );
            })}
          </div>
        )}
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--v2-nav-inactive)", flexWrap: "wrap" }}>
          {(["approved", "submitted", "rejected", "repos"] as const).map((k) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: k === "repos" ? "var(--sk-border)" : CELL[k].bd }} />{CELL[k].label}
            </span>
          ))}
        </div>

        <Card mobile padding="14px 16px" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{shortDayFr(selected)}</span>
            {st ? <Badge tone={STATUS_TONE[st]}>{CELL[st].label}</Badge> : <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>{selected > today ? "À venir" : "Aucun rapport"}</span>}
          </div>
          {active && st !== "repos" && (
            <Row label="Net" value={formatAmount(active.net_after_expenses ?? 0)} />
          )}
          {st === "repos" && active?.comment && active.comment.replace("[REPOS]", "").trim() && (
            <div style={{ fontSize: 13, color: "var(--sk-t2)" }}>{active.comment.replace("[REPOS]", "").trim()}</div>
          )}
          {dayExpenses.map((e) => (
            <Row key={e.id} label={`Dépense ${displayLabel(e.category || "").toLowerCase()}`} value={formatAmount(e.amount || 0)}
              tag={e.status === "rejected" ? "Rejetée" : e.status === "approved" ? undefined : "En attente"} />
          ))}
          {!active && dayExpenses.length === 0 && rejected.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Rien de déclaré ce jour-là.</div>
          )}
        </Card>

        {/* Corrections : cartes actuelles (resoumettre / archiver / pièces jointes). */}
        {rejected.map((r) => <ReportHistoryCard key={r.id} report={r} profile={profile} onRefresh={refresh} />)}
        {dayExpenses.filter((e) => e.status === "rejected").map((e) => (
          <ExpenseCard key={e.id} expense={e} driverId={profile.id} profile={profile} onRefresh={refresh} />
        ))}

        <Button variant="outline" size="lg" icon={BedDouble} block onClick={() => setRepos(true)} style={{ marginTop: "auto", height: 52 }}>
          Déclarer un jour de repos
        </Button>
      </ScreenBody>
    </>
  );
}

const navBtn = { width: 36, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--sk-t2)", cursor: "pointer" } as const;

function Row({ label, value, tag }: { label: string; value: string; tag?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 14 }}>
      <span style={{ color: "var(--sk-t2)", flex: 1 }}>{label}{tag && <span style={{ marginLeft: 6, fontSize: 11, color: tag === "Rejetée" ? "var(--v2-negative-ink)" : "var(--fleet-warning)" }}>{tag}</span>}</span>
      <span className="v2-num">{value}</span>
    </div>
  );
}

/** Déclaration de repos : insert `daily_reports` [REPOS] de l'UI actuelle (useReposForm). */
function ReposV2({ profile, defaultDate, onDone, onBack }: { profile: Profile; defaultDate: string; onDone: () => void; onBack: () => void }) {
  const { date, setDate, motif, setMotif, saving, submitted, existing, submit } = useReposForm(profile);
  useEffect(() => {
    // Pré-sélectionne le jour choisi dans le calendrier (une seule fois).
    if (defaultDate) setDate(defaultDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (submitted) {
    return (
      <>
        <ScreenBody padding="24px 20px" style={{ justifyContent: "center" }}>
          <DoneHero title="Jour de repos déclaré" text="En attente de validation par ton gestionnaire." />
        </ScreenBody>
        <div style={{ padding: 16, flex: "none" }}>
          <Button size="xl" block onClick={onDone}>Retour au calendrier</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Déclarer un jour de repos" onBack={onBack} />
      <ScreenBody gap={16}>
        <div style={{ fontSize: 14, color: "var(--v2-muted)", lineHeight: 1.5 }}>
          Ton gestionnaire valide la déclaration. Elle n&apos;impacte pas tes revenus.
        </div>
        <div>
          <Label htmlFor="v2-repos-date">Date (passée ou à venir)</Label>
          <input id="v2-repos-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="v2-focus" style={{ ...fieldStyle, colorScheme: "inherit" as never }} />
        </div>
        <div>
          <Label htmlFor="v2-repos-motif">Motif (optionnel)</Label>
          <input id="v2-repos-motif" type="text" placeholder="Congé, maladie, entretien…" value={motif} onChange={(e) => setMotif(e.target.value)} className="v2-focus" style={fieldStyle} />
        </div>
        {existing.length > 0 && (
          <Card mobile flush>
            <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--v2-muted)", borderBottom: "1px solid var(--sk-surface)" }}>Repos déclarés ou prévus</div>
            {existing.map((r, i) => (
              <div key={r.date + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", minHeight: 52, borderBottom: i < existing.length - 1 ? "1px solid var(--sk-surface)" : "none" }}>
                <span className="v2-num" style={{ fontSize: 14 }}>{shortDayFr(r.date)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--sk-t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.comment?.replace("[REPOS]", "").trim() || ""}</span>
                <Badge tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "neg" : "wait"}>{r.status === "approved" ? "Validé" : r.status === "rejected" ? "Refusé" : "En attente"}</Badge>
              </div>
            ))}
          </Card>
        )}
        <Button size="xl" block disabled={saving || !date} onClick={() => void submit()} style={{ marginTop: "auto" }}>
          {saving ? "Envoi…" : "Déclarer ce jour de repos"}
        </Button>
      </ScreenBody>
    </>
  );
}
