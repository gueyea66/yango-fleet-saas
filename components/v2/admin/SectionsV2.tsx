"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, Clock, CircleX, CircleDashed, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Segmented } from "@/components/ui";
import { formatAmount } from "@/lib/v2/format";
import { monthNameFr, shortDayFr, type DayStatus } from "@/lib/v2/driver";
import { financeKpis, kycState, teamCounts, driverDayGrid, type KycState } from "@/lib/v2/team";
import { initials } from "@/lib/v2/format";
import { ReportPanel } from "./PendingV2";

/* eslint-disable @typescript-eslint/no-explicit-any -- lignes non typées (convention du projet) */

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <Card padding="16px 18px">
      <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>{label}</div>
      <div className="v2-num" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", marginTop: 8, color: tone === "pos" ? "var(--fleet-positive)" : tone === "neg" ? "var(--v2-negative-ink)" : undefined }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--v2-muted)", marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

/* ─── 4b Finance : 4 KPI au-dessus des onglets Paiements / Avances ─── */
export function FinanceKpisV2({ kpis }: { kpis: any }) {
  if (kpis.loading) return <div className="v2-skeleton" style={{ height: 96, borderRadius: 14 }} aria-hidden />;
  const f = financeKpis(kpis);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
      <Kpi label="Encaissements" value={formatAmount(f.encaissements)} sub="recettes encaissées" />
      <Kpi label="Décaissements" value={formatAmount(f.decaissements)} sub="dépenses + avances" tone="neg" />
      <Kpi label="Masse salariale" value={f.masseSalariale != null ? formatAmount(f.masseSalariale) : "—"} sub="sur la période" />
      <Kpi label="Marge après salaires" value={formatAmount(f.margeApresSalaires)} tone={f.margeApresSalaires >= 0 ? "pos" : "neg"} sub="net final" />
    </div>
  );
}

/* ─── 4c Historique : grille chauffeurs × jours ─── */
const CELL: Record<Exclude<DayStatus, null>, { bg: string; bd: string; label: string }> = {
  approved: { bg: "rgba(34,197,94,.22)", bd: "var(--v2-validate)", label: "Validé" },
  submitted: { bg: "rgba(249,115,22,.2)", bd: "var(--fleet-warning)", label: "En attente" },
  rejected: { bg: "rgba(239,68,68,.2)", bd: "var(--fleet-negative)", label: "Rejeté" },
  repos: { bg: "var(--sk-surface)", bd: "var(--sk-border)", label: "Repos" },
};

export function HistoryV2({ reports, drivers, loading, onRefresh, list }: {
  reports: any[];
  drivers: { id: string; full_name?: string; driver_id?: string }[];
  loading: boolean;
  onRefresh: () => void;
  list: ReactNode;
}) {
  const [view, setView] = useState<"grille" | "liste">("grille");
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [sel, setSel] = useState<{ driver: string; date: string } | null>(null);
  const grid = useMemo(() => driverDayGrid(reports, ym.y, ym.m), [reports, ym]);
  const shift = (d: number) => setYm(({ y, m }) => { const t = new Date(y, m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const selectedReport = sel
    ? (() => {
      const rs = reports.filter((r) => r.driver_id === sel.driver && r.date === sel.date && r.status !== "archived");
      return rs.find((r) => r.status === "approved") ?? rs.find((r) => r.status === "submitted") ?? rs[0] ?? null;
    })()
    : null;
  const shownDrivers = drivers.filter((d) => reports.some((r) => r.driver_id === d.id) || drivers.length <= 12);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button variant="outline" size="sm" onClick={() => setView(view === "grille" ? "liste" : "grille")}>
          {view === "grille" ? "Voir en liste" : "Voir la grille"}
        </Button>
        {view === "grille" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" aria-label="Mois précédent" onClick={() => shift(-1)} className="v2-focus" style={navBtn}><ChevronLeft size={16} aria-hidden /></button>
            <span style={{ fontSize: 14, fontWeight: 600, minWidth: 130, textAlign: "center", textTransform: "capitalize" }}>{monthNameFr(ym.m)} {ym.y}</span>
            <button type="button" aria-label="Mois suivant" onClick={() => shift(1)} className="v2-focus" style={navBtn}><ChevronRight size={16} aria-hidden /></button>
          </div>
        )}
        {view === "grille" && (
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--v2-nav-inactive)", marginLeft: "auto", flexWrap: "wrap" }}>
            {(Object.keys(CELL) as (keyof typeof CELL)[]).map((k) => (
              <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: CELL[k].bd }} />{CELL[k].label}</span>
            ))}
          </div>
        )}
      </div>

      {view === "liste" ? list : (
        <>
          <Card flush style={{ overflowX: "auto" }}>
            {loading && reports.length === 0 ? <div className="v2-skeleton" style={{ height: 200, margin: 16 }} aria-hidden /> : (
              <table style={{ borderCollapse: "separate", borderSpacing: 3, padding: 12, fontSize: 12, minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: "left", fontWeight: 500, color: "var(--v2-muted)", padding: "0 8px 4px 4px", position: "sticky", left: 0, background: "var(--sk-bg)" }}>Chauffeur</th>
                    {grid.days.map((d) => <th key={d} scope="col" className="v2-num" style={{ fontWeight: 400, color: "var(--sk-t3)", width: 22, textAlign: "center" }}>{Number(d.slice(8))}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shownDrivers.map((dr) => (
                    <tr key={dr.id}>
                      <th scope="row" style={{ textAlign: "left", fontWeight: 500, fontSize: 13, padding: "0 10px 0 4px", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--sk-bg)" }}>{dr.full_name || dr.driver_id}</th>
                      {grid.days.map((d) => {
                        const st = grid.cell(dr.id, d);
                        const on = sel?.driver === dr.id && sel.date === d;
                        return (
                          <td key={d} style={{ padding: 0 }}>
                            <button type="button" disabled={!st} onClick={() => setSel({ driver: dr.id, date: d })}
                              aria-label={`${dr.full_name || dr.driver_id} · ${shortDayFr(d)}${st ? ` · ${CELL[st].label}` : ""}`} className="v2-focus"
                              style={{ width: 22, height: 22, borderRadius: 5, padding: 0, cursor: st ? "pointer" : "default",
                                background: st ? CELL[st].bg : "transparent", border: `1px solid ${st ? CELL[st].bd : "var(--sk-surface)"}`,
                                boxShadow: on ? "0 0 0 2px var(--tenant-color)" : undefined }} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {selectedReport ? (
            <Card flush>
              <ReportPanel key={selectedReport.id} report={selectedReport} onRefresh={onRefresh} onAction={() => {}} />
            </Card>
          ) : (
            <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Choisis une case pour voir le détail du jour.</div>
          )}
        </>
      )}
    </div>
  );
}
const navBtn = { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "1px solid var(--sk-surface)", borderRadius: 8, color: "var(--sk-t2)", cursor: "pointer" } as const;

/* ─── 4a Équipe : liste des chauffeurs + fiche ─── */
const KYC_LOOK: Record<KycState, { tone: "ok" | "wait" | "neg" | "neutral"; label: string; Icon: typeof CircleCheck }> = {
  approved: { tone: "ok", label: "KYC validé", Icon: CircleCheck },
  in_review: { tone: "wait", label: "KYC à vérifier", Icon: Clock },
  rejected: { tone: "neg", label: "KYC rejeté", Icon: CircleX },
  incomplete: { tone: "neutral", label: "KYC incomplet", Icon: CircleDashed },
};

export function TeamV2({ drivers, renderDocuments, onOpenHistory }: {
  drivers: any[];
  renderDocuments: (driverId: string) => ReactNode;
  onOpenHistory: (driverId: string) => void;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(drivers[0]?.id ?? null);
  const [tab, setTab] = useState<"profil" | "documents" | "remuneration" | "activite">("documents");
  const sel = drivers.find((d) => d.id === selId) ?? drivers[0] ?? null;
  const c = teamCounts(drivers);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Kpi label="Chauffeurs" value={String(c.total)} />
        <Kpi label="Actifs" value={String(c.actifs)} />
        <Kpi label="Dossiers validés" value={String(c.kycValides)} tone="pos" />
        <Kpi label="Dossiers à vérifier" value={String(c.kycAVerifier)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]" style={{ borderRadius: 14, border: "1px solid var(--sk-surface)", overflow: "hidden", minHeight: 420 }}>
        <div role="listbox" aria-label="Chauffeurs" style={{ borderRight: "1px solid var(--sk-surface)", overflowY: "auto" }}>
          {drivers.length === 0 && <div style={{ padding: 20, fontSize: 13, color: "var(--v2-muted)" }}>Aucun chauffeur</div>}
          {drivers.map((d) => {
            const on = d.id === sel?.id;
            const k = KYC_LOOK[kycState(d.onboarding_status)];
            return (
              <button key={d.id} type="button" role="option" aria-selected={on} onClick={() => setSelId(d.id)} className="v2-row v2-focus"
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px", border: "none", borderBottom: "1px solid var(--sk-surface)", color: "inherit", textAlign: "left", cursor: "pointer",
                  background: on ? "var(--v2-select-bg)" : "transparent", boxShadow: on ? "inset 2px 0 0 var(--tenant-color)" : undefined, opacity: d.active === false ? 0.6 : 1 }}>
                <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--sk-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "var(--sk-t2)", flex: "none" }}>{initials(d.full_name || d.driver_id)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: on ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.full_name || d.driver_id}</span>
                  <span className="v2-num" style={{ display: "block", fontSize: 12, color: "var(--v2-muted)" }}>{[d.driver_id, d.plate].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <k.Icon size={16} aria-label={k.label} style={{ color: k.tone === "ok" ? "var(--fleet-positive)" : k.tone === "wait" ? "var(--fleet-warning)" : k.tone === "neg" ? "var(--v2-negative-ink)" : "var(--sk-t3)", flex: "none" }} />
              </button>
            );
          })}
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {!sel ? <div style={{ color: "var(--v2-muted)", fontSize: 14 }}>Sélectionne un chauffeur</div> : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--sk-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 600, color: "var(--v2-nav-inactive)" }}>{initials(sel.full_name || sel.driver_id)}</span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{sel.full_name || sel.driver_id}</h2>
                  <div className="v2-num" style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 2 }}>{[sel.driver_id, sel.plate].filter(Boolean).join(" · ")}</div>
                </div>
                <Badge tone={KYC_LOOK[kycState(sel.onboarding_status)].tone}>{KYC_LOOK[kycState(sel.onboarding_status)].label}</Badge>
                {sel.active === false && <Badge tone="neutral">Inactif</Badge>}
              </div>
              <Segmented
                options={[{ key: "profil", label: "Profil" }, { key: "documents", label: "Documents" }, { key: "remuneration", label: "Rémunération" }, { key: "activite", label: "Activité" }]}
                value={tab} onChange={setTab} ariaLabel="Fiche chauffeur" style={{ alignSelf: "flex-start" }}
              />
              {tab === "profil" && (
                <Card flush>
                  {([
                    ["Identifiant", sel.driver_id], ["Téléphone", sel.phone], ["Ville", sel.city], ["Permis", sel.license_number],
                    ["Expiration du permis", sel.license_expiry], ["Véhicule", sel.plate], ["Arrivée", sel.joined_at?.slice(0, 10)],
                  ] as [string, string | null | undefined][]).map(([l, v], i, arr) => (
                    <div key={l} style={{ display: "flex", padding: "11px 18px", fontSize: 14, borderBottom: i < arr.length - 1 ? "1px solid var(--sk-surface)" : "none" }}>
                      <span style={{ flex: 1, color: "var(--sk-t2)" }}>{l}</span><span className="v2-num">{v || "—"}</span>
                    </div>
                  ))}
                </Card>
              )}
              {tab === "documents" && <div style={{ minWidth: 0 }}>{renderDocuments(sel.id)}</div>}
              {tab === "remuneration" && (
                <Card style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, fontSize: 14, color: "var(--sk-t2)" }}>Le modèle de rémunération par chauffeur se règle dans la gestion des conducteurs.</span>
                  <Button variant="outline" size="md" icon={ExternalLink} onClick={() => router.push("/admin/drivers")}>Ouvrir</Button>
                </Card>
              )}
              {tab === "activite" && (
                <Card style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ flex: 1, fontSize: 14, color: "var(--sk-t2)" }}>Rapports et repos de {sel.full_name || "ce chauffeur"}, jour par jour.</span>
                  <Button variant="outline" size="md" onClick={() => onOpenHistory(sel.id)}>Voir l&apos;historique</Button>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
