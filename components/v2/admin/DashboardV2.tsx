"use client";

import { useEffect, useState, type ReactNode } from "react";
import AiBriefingSection from "@/components/ai/AiBriefingSection";
import { EXPENSE_COLORS } from "@/components/TreemapDepenses";
import { Segmented, type SegmentOption } from "@/components/ui";
import type { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import { displayLabel } from "@/lib/tenant/platformLabel";
import { formatAmount, formatPct } from "@/lib/v2/format";
import { costBreakdown, variationPct, cleanCategory, parseDashView, DASH_VIEW_KEY, LIGNE_AMORTISSEMENT, type DashView } from "@/lib/v2/dashboard";
import { ValidationQueueV2 } from "./ValidationQueueV2";

type Kpis = ReturnType<typeof useDashboardKPIs>;

/** Préférence Simple / Avancé, par appareil (comme le thème). */
export function useDashView(): [DashView, (v: DashView) => void] {
  const [view, setView] = useState<DashView>("simple");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- préférence lue après montage
      setView(parseDashView(localStorage.getItem(DASH_VIEW_KEY)));
    } catch { /* défaut simple */ }
  }, []);
  const set = (v: DashView) => {
    setView(v);
    try { localStorage.setItem(DASH_VIEW_KEY, v); } catch { /* best-effort */ }
  };
  return [view, set];
}

const VIEW_OPTIONS: SegmentOption<DashView>[] = [{ key: "simple", label: "Simple" }, { key: "avance", label: "Avancé" }];

export function DashViewToggle({ view, onChange }: { view: DashView; onChange: (v: DashView) => void }) {
  return <Segmented options={VIEW_OPTIONS} value={view} onChange={onChange} ariaLabel="Vue du tableau de bord" brand />;
}

/**
 * Tableau de bord v2 — vue simple (maquette 2a). « Avancé » = les sections
 * actuelles (AccordionSection), passées telles quelles dans `advanced`.
 */
export function DashboardV2({ view, kpis, plat, tenantId, driverIds, range, onKpisChanged, onOpenValidation, advanced }: {
  view: DashView;
  kpis: Kpis;
  plat: string;
  tenantId: string | null;
  driverIds: string[];
  /** période de la barre de filtres : la file À valider s'y limite */
  range?: { from: string; to: string };
  onKpisChanged: () => void;
  onOpenValidation: () => void;
  advanced: ReactNode;
}) {
  if (view === "avance") return <>{advanced}</>;

  const recettes = kpis.brutYango + kpis.horsYango;
  const netVar = variationPct(kpis.netFinal, kpis.prevNetFinal, kpis.joursOuvres, kpis.prevJoursOuvres);
  // Le grand chiffre est net d'amortissement. La variation, elle, reste
  // calculée hors amortissement des deux côtés : la période précédente n'en a
  // pas de calculé, et comparer un net amorti à un net non amorti fabriquerait
  // une chute qui n'a pas eu lieu.
  const amort = kpis.amortissement || 0;
  const netAffiche = amort > 0 ? kpis.netFinalApresAmort : kpis.netFinal;
  const margeAffichee = amort > 0 ? kpis.margeApresAmort : kpis.monthMarginPercent;
  const costs = costBreakdown(kpis.expenseBreakdown, recettes, kpis.amortissement);
  const days = kpis.dailyRows;
  const maxDay = Math.max(1, ...days.map((d) => Math.max(d.brutYango + d.horsYango, d.netFinal)));

  const card = { borderRadius: 14, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" } as const;
  const loadingBlock = (h: number) => <div className="v2-skeleton" style={{ height: h, borderRadius: 14 }} aria-hidden />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Hero : 3 chiffres */}
      {kpis.loading ? loadingBlock(116) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ ...card, padding: "18px 20px", gridColumn: "span 1" }}>
            <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>{amort > 0 ? "Résultat net" : "Net final"}</div>
            <div className="v2-num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.03em", marginTop: 6, color: netAffiche >= 0 ? "var(--fleet-positive)" : "var(--v2-negative-ink)" }}>
              {formatAmount(netAffiche)} <span style={{ fontSize: 14, color: "var(--v2-muted)", letterSpacing: 0 }}>XOF</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 4 }}>
              {netVar != null && <><span style={{ color: netVar >= 0 ? "var(--fleet-positive)" : "var(--v2-negative-ink)" }}>{netVar >= 0 ? "+" : ""}{Math.round(netVar)} %</span> vs période précédente · </>}
              marge {formatPct(margeAffichee)}
            </div>
            {/* La décomposition reste sous les yeux : sans elle, un exploitant
                qui dégage 400 000 en devant encore rembourser 200 000 de
                véhicule lirait « 400 000 » et se croirait rentable. */}
            {amort > 0 && (
              <div style={{ fontSize: 12, color: "var(--v2-muted)", marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--sk-surface)" }}>
                avant amortissement <span className="v2-num">{formatAmount(kpis.netFinal)}</span>
                {" · "}amortissement <span className="v2-num" style={{ color: "var(--v2-negative-ink)" }}>−{formatAmount(amort)}</span>
              </div>
            )}
            {(kpis.amortNonRenseignes?.length ?? 0) > 0 && (
              <div style={{ fontSize: 12, color: "var(--v2-warning-ink, #f59e0b)", marginTop: 6 }}>
                Capital non renseigné sur {kpis.amortNonRenseignes.join(", ")} — résultat encore optimiste.
              </div>
            )}
          </div>
          <div style={{ ...card, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Total recettes</div>
            <div className="v2-num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", marginTop: 10 }}>{formatAmount(recettes)}</div>
            <div style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 6 }}>dont hors {plat} <span className="v2-num">{formatAmount(kpis.horsYango)}</span></div>
          </div>
          <div style={{ ...card, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Trésorerie nette</div>
            <div className="v2-num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", marginTop: 10, color: kpis.tresorerie < 0 ? "var(--v2-negative-ink)" : undefined }}>{formatAmount(kpis.tresorerie)}</div>
            <div style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 6 }}>après dépenses et avances</div>
          </div>
        </div>
      )}

      {/* File + briefing */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12, alignItems: "start" }}>
        {tenantId
          ? <ValidationQueueV2 tenantId={tenantId} driverIds={driverIds} range={range} onChanged={onKpisChanged} onOpenAll={onOpenValidation} />
          : loadingBlock(240)}
        <div style={{ minWidth: 0 }}>
          {/* Briefing IA inchangé (rend null si la couche IA est coupée). */}
          <AiBriefingSection />
        </div>
      </div>

      {/* Coûts par poste + net par jour */}
      {kpis.loading ? loadingBlock(236) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
          <section style={{ ...card, padding: "14px 18px", minWidth: 0 }} aria-label="Coûts par poste">
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr .8fr .9fr", gap: 8, alignItems: "baseline", paddingBottom: 8, borderBottom: "1px solid var(--sk-surface)" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Coûts par poste</span>
              <span style={{ fontSize: 11, color: "var(--v2-muted)", textAlign: "right" }}>XOF</span>
              <span style={{ fontSize: 11, color: "var(--v2-muted)", textAlign: "right" }}>% du CA</span>
              <span style={{ fontSize: 11, color: "var(--v2-muted)", textAlign: "right" }}>% des coûts</span>
            </div>
            {costs.rows.length === 0 ? (
              <div style={{ padding: "16px 0", fontSize: 13, color: "var(--v2-muted)" }}>Aucune dépense validée sur la période.</div>
            ) : costs.rows.map((c, i) => {
              const color = EXPENSE_COLORS[i % EXPENSE_COLORS.length];
              return (
                <div key={c.type} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr .8fr .9fr", gap: 8, alignItems: "center", padding: "6px 0", fontSize: 13 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "none" }} />{displayLabel(cleanCategory(c.type))}
                    {c.type === LIGNE_AMORTISSEMENT && (
                      <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "var(--sk-surface)", color: "var(--v2-muted)", flex: "none" }}>calculé</span>
                    )}
                  </span>
                  <span className="v2-num" style={{ textAlign: "right" }}>{formatAmount(c.amount)}</span>
                  <span className="v2-num" style={{ textAlign: "right", color: "var(--v2-nav-inactive)" }}>{formatPct(c.pctCA)}</span>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                    <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--sk-surface)", overflow: "hidden", display: "flex" }}>
                      <span style={{ width: `${c.pctCosts ?? 0}%`, background: color }} />
                    </span>
                    <span className="v2-num" style={{ width: 52, textAlign: "right" }}>{formatPct(c.pctCosts)}</span>
                  </span>
                </div>
              );
            })}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr .8fr .9fr", gap: 8, alignItems: "center", paddingTop: 7, borderTop: "1px solid var(--sk-surface)", fontSize: 13, fontWeight: 600 }}>
              <span>Total coûts</span>
              <span className="v2-num" style={{ textAlign: "right", color: "var(--v2-negative-ink)" }}>{formatAmount(costs.total.amount)}</span>
              <span className="v2-num" style={{ textAlign: "right" }}>{formatPct(costs.total.pctCA)}</span>
              <span className="v2-num" style={{ textAlign: "right" }}>{costs.total.pctCosts != null ? "100 %" : "—"}</span>
            </div>
          </section>

          <section style={{ ...card, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, minHeight: 236, minWidth: 0 }} aria-label="Net par jour">
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--sk-t2)" }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--sk-t1)" }}>Net par jour</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--fleet-positive)" }} />Net final</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--sk-border)" }} />Brut</span>
            </div>
            {days.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--v2-muted)" }}>Aucune activité sur la période.</div>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: days.length > 40 ? 2 : 6, minHeight: 160 }}>
                {days.map((d) => {
                  const brut = d.brutYango + d.horsYango;
                  return (
                    <div key={d.date} title={`${d.date.slice(8)}/${d.date.slice(5, 7)} · net ${formatAmount(d.netFinal)} · brut ${formatAmount(brut)}`}
                      style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", position: "relative" }}>
                      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${(brut / maxDay) * 100}%`, background: "var(--sk-surface)", borderRadius: "3px 3px 0 0" }} />
                      <div style={{ position: "relative", width: "100%", height: `${(Math.max(0, d.netFinal) / maxDay) * 100}%`, background: d.netFinal >= 0 ? "var(--fleet-positive)" : "var(--fleet-negative)", borderRadius: "3px 3px 0 0" }} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
