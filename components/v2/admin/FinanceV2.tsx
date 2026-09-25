"use client";

import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, CircleCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { formatAmount } from "@/lib/v2/format";
import type { Movement, SalaryRow } from "@/lib/v2/finance";

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const th: CSSProperties = { textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--v2-muted)", padding: "10px 12px", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "10px 12px", fontSize: 14, borderTop: "1px solid var(--sk-border)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...td, textAlign: "right" };

function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{children}</h3>
      {sub && <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>{sub}</span>}
    </div>
  );
}

/* ─── Salaires de la période : Chauffeur | Palier | Salaire dû | Avances | Reste à payer | Statut ─── */
export function SalaryTableV2({ rows, loading, periodLabel, onMarkPaid }: {
  rows: SalaryRow[];
  loading: boolean;
  periodLabel: string;
  onMarkPaid: (row: SalaryRow) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Title sub={periodLabel}>Salaires de la période</Title>
      <Card flush>
        {loading ? (
          <div className="v2-skeleton" style={{ height: 120 }} aria-hidden />
        ) : rows.length === 0 ? (
          <div style={{ padding: 18, fontSize: 14, color: "var(--v2-muted)" }}>Aucun chauffeur actif sur la période.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Chauffeur</th>
                  <th style={th}>Palier</th>
                  <th style={{ ...th, textAlign: "right" }}>Salaire dû</th>
                  <th style={{ ...th, textAlign: "right" }}>Avances</th>
                  <th style={{ ...th, textAlign: "right" }}>Reste à payer</th>
                  <th style={{ ...th, textAlign: "right" }}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.driverId}>
                    <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
                    <td style={{ ...td, color: "var(--v2-muted)" }}>{r.palier}</td>
                    <td className="v2-num" style={num}>{formatAmount(r.du)}</td>
                    <td className="v2-num" style={{ ...num, color: r.avances ? undefined : "var(--v2-muted)" }}>{r.avances ? formatAmount(r.avances) : "—"}</td>
                    <td className="v2-num" style={{ ...num, fontWeight: 600 }}>{formatAmount(r.reste)}</td>
                    <td style={num}>
                      {r.paidOn ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--fleet-positive)", fontSize: 13, fontWeight: 500 }}>
                          <CircleCheck size={14} aria-hidden /> Payé le {ddmm(r.paidOn)}
                        </span>
                      ) : r.reste > 0 ? (
                        <Button size="sm" variant="outline" onClick={() => onMarkPaid(r)}>Marquer payé</Button>
                      ) : (
                        <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── Derniers mouvements : date | libellé | montant (+ vert / − rouge) ─── */
export function MovementsV2({ movements, loading }: { movements: Movement[]; loading: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Title sub="paiements, avances, rapports et dépenses validés">Derniers mouvements</Title>
      <Card flush>
        {loading ? (
          <div className="v2-skeleton" style={{ height: 120 }} aria-hidden />
        ) : movements.length === 0 ? (
          <div style={{ padding: 18, fontSize: 14, color: "var(--v2-muted)" }}>Aucun mouvement sur la période.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {movements.map((m, i) => (
                <tr key={m.key}>
                  <td className="v2-num" style={{ ...td, borderTop: i ? td.borderTop : "none", width: 64, color: "var(--v2-muted)" }}>{ddmm(m.date)}</td>
                  <td style={{ ...td, borderTop: i ? td.borderTop : "none", whiteSpace: "normal" }}>{m.label}</td>
                  <td className="v2-num" style={{ ...num, borderTop: i ? td.borderTop : "none", fontWeight: 600, color: m.amount >= 0 ? "var(--fleet-positive)" : "var(--v2-negative-ink)" }}>
                    {m.amount >= 0 ? "+" : "−"}{formatAmount(Math.abs(m.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ─── Historique mois par mois, replié ─── */
export function CollapsedHistoryV2({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="v2-details">
      <summary className="v2-focus" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 15, fontWeight: 600, listStyle: "none" }}>
        <ChevronDown size={16} aria-hidden className="v2-details-chevron" /> {title}
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}
