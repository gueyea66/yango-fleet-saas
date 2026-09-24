"use client";

import { CircleCheck, Receipt, ClipboardList } from "lucide-react";
import { useValidationQueue } from "@/components/ValidationQueue";
import { displayLabel } from "@/lib/tenant/platformLabel";
import { formatAmount } from "@/lib/v2/format";
import { inRange } from "@/lib/v2/periodFilter";
import { Button } from "@/components/ui";

const ddmm = (iso?: string | null) => { if (!iso) return ""; const [, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}`; };

/**
 * File « À valider » compacte (tableau de bord v2, maquette 2a). Écritures :
 * celles du mode simple, via useValidationQueue (statut + action_logs + push).
 */
export function ValidationQueueV2({ tenantId, driverIds, range, onChanged, onOpenAll, limit = 4 }: {
  tenantId: string;
  driverIds: string[];
  range?: { from: string; to: string };
  onChanged: () => void;
  onOpenAll: () => void;
  limit?: number;
}) {
  const { pending, pendingExp, driverNames, acting, reportAction, expenseAction } = useValidationQueue(tenantId, onChanged);
  const keep = (id: string) => driverIds.length === 0 || driverIds.includes(id);
  const inPeriod = (d?: string | null) => !range || inRange(d, range);
  const items = [
    ...pending.filter((r) => keep(r.driver_id) && inPeriod(r.date)).map((r) => ({ kind: "report" as const, row: r, date: r.date as string })),
    ...pendingExp.filter((e) => keep(e.driver_id) && inPeriod(e.expense_date || e.created_at)).map((e) => ({ kind: "expense" as const, row: e, date: (e.expense_date || e.created_at || "") as string })),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const shown = items.slice(0, limit);

  return (
    <section style={{ borderRadius: 14, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--sk-surface)" }}>
        <h2 style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 600 }}>
          À valider {items.length > 0 && <span className="v2-num" style={{ color: "var(--fleet-warning)", fontSize: 13, marginLeft: 4 }}>{items.length}</span>}
        </h2>
        <button type="button" onClick={onOpenAll} className="v2-focus" style={{ background: "none", border: "none", color: "var(--sk-t2)", fontSize: 13, cursor: "pointer", minHeight: 32 }}>Tout voir</button>
      </div>
      {items.length === 0 ? (
        <div style={{ flex: 1, minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--v2-muted)", fontSize: 14 }}>
          <CircleCheck size={28} aria-hidden style={{ color: "var(--fleet-positive)" }} />
          Tout est validé
        </div>
      ) : (
        <>
          {shown.map(({ kind, row }, i) => {
            const name = driverNames[row.driver_id] || row._profile?.full_name || "Chauffeur";
            const busy = acting === row.id;
            return (
              <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < shown.length - 1 || items.length > limit ? "1px solid var(--sk-surface)" : "none" }}>
                {kind === "report"
                  ? <ClipboardList size={16} aria-hidden style={{ color: "var(--sk-t3)", flex: "none" }} />
                  : <Receipt size={16} aria-hidden style={{ color: "var(--sk-t3)", flex: "none" }} />}
                <button type="button" onClick={onOpenAll} className="v2-focus" style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", color: "inherit", cursor: "pointer" }}>
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name} · {kind === "report" ? `rapport ${ddmm(row.date)}` : displayLabel(row.category || "Autre").toLowerCase()}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--v2-muted)", marginTop: 2 }}>
                    {kind === "report" ? (row.comment?.startsWith("[REPOS]") ? "Jour de repos" : "Rapport du soir") : `Dépense du ${ddmm(row.expense_date || row.created_at)}`}
                  </div>
                </button>
                <span className="v2-num" style={{ fontSize: 14 }}>{formatAmount(kind === "report" ? row.net_after_expenses : row.amount)}</span>
                <Button variant="validate" size="sm" disabled={busy} style={{ minWidth: 96 }}
                  onClick={() => (kind === "report" ? reportAction(row, "approved") : expenseAction(row, "approved"))}>
                  {busy ? "…" : "Valider"}
                </Button>
              </div>
            );
          })}
          {items.length > limit && (
            <button type="button" onClick={onOpenAll} className="v2-row v2-focus" style={{ padding: "10px 18px", background: "none", border: "none", color: "var(--sk-t2)", fontSize: 13, textAlign: "left", cursor: "pointer" }}>
              + {items.length - limit} autre{items.length - limit > 1 ? "s" : ""}
            </button>
          )}
        </>
      )}
    </section>
  );
}
