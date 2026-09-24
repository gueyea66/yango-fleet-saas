"use client";

import { Receipt, BedDouble, History, ScanLine, ClipboardList, ChevronRight } from "lucide-react";
import { Card, Overline, ListRow, StatusDot, Button } from "@/components/ui";
import { formatAmount } from "@/lib/v2/format";
import { greeting, firstName, longDateFr, nextTierInfo, type DriverTab } from "@/lib/v2/driver";
import { salaryLevel, type Cfg, type Profile } from "@/components/driver/shared";
import { platLabel } from "@/lib/tenant/platformLabel";
import { useDriverHomeData } from "@/components/driver/useDriverHomeData";
import { SkeletonBlock } from "./parts";

/** 1a — Accueil : un seul bouton principal, carte palier en 4 niveaux, raccourcis. */
export function HomeV2({ profile, cfg, aiEnabled, onNav }: {
  profile: Profile;
  cfg: Cfg;
  aiEnabled: boolean;
  onNav: (t: DriverTab) => void;
}) {
  const now = new Date();
  // Rechargé à chaque retour sur l'Accueil (le composant est remonté).
  const { monthNet, monthPending, todayStatus, rejectedCount, loaded } = useDriverHomeData(profile);

  return (
    <>
      <div>
        <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>{longDateFr(now)}</div>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.01em", marginTop: 2 }}>
          {greeting(now.getHours())} {firstName(profile.full_name)}
        </div>
      </div>

      {loaded && rejectedCount > 0 && (
        <button type="button" onClick={() => onNav("history")} className="v2-focus"
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 52, padding: "12px 14px", borderRadius: 14, background: "var(--v2-neg-bg)", border: "1px solid var(--v2-neg-bd)", color: "var(--sk-t1)", fontSize: 14, fontWeight: 600, textAlign: "left", cursor: "pointer" }}>
          <StatusDot tone="neg" />
          <span style={{ flex: 1 }}>{rejectedCount > 1 ? `${rejectedCount} rapports rejetés` : "Rapport rejeté"} — corrige et renvoie</span>
          <ChevronRight size={18} aria-hidden style={{ color: "var(--sk-t3)" }} />
        </button>
      )}

      {!loaded ? (
        <SkeletonBlock height={150} radius={18} />
      ) : !todayStatus ? (
        <Card mobile style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusDot tone="wait" />
            <div style={{ fontSize: 15, fontWeight: 600 }}>Ton rapport du jour n&apos;est pas encore envoyé</div>
          </div>
          <Button size="xl" icon={aiEnabled ? ScanLine : ClipboardList} block onClick={() => onNav("report")}>Faire mon rapport</Button>
          <div style={{ fontSize: 13, color: "var(--v2-muted)", textAlign: "center" }}>
            {aiEnabled ? `2 captures ${platLabel()} Pro + photo du compteur suffisent` : "Tes chiffres du jour, en une minute"}
          </div>
        </Card>
      ) : (
        <Card mobile tone="ok" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusDot tone="ok" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{todayStatus === "approved" ? "Rapport du jour validé" : "Rapport du jour envoyé"}</div>
            <div style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 2 }}>
              {todayStatus === "approved" ? "Ton gestionnaire l'a validé." : "En attente de validation."}
            </div>
          </div>
        </Card>
      )}

      {!loaded ? <SkeletonBlock height={150} radius={18} /> : <SalaryCard cfg={cfg} monthNet={monthNet} monthApproved={monthPending} />}

      <Card mobile flush>
        <ListRow icon={Receipt} label="Ajouter une dépense" chevron onClick={() => onNav("expense")} />
        <ListRow icon={BedDouble} label="Repos" chevron onClick={() => onNav("repos")} />
        <ListRow icon={History} label="Historique" chevron divider={false} onClick={() => onNav("history")} />
      </Card>
    </>
  );
}

/** Carte rémunération : palier en 4 niveaux (tiered), sinon résumé du modèle. */
function SalaryCard({ cfg, monthNet, monthApproved }: { cfg: Cfg; monthNet: number; monthApproved: number }) {
  const netLine = (
    <div style={{ fontSize: 12, color: "var(--v2-muted)", marginTop: 10 }}>
      Net déclaré ce mois : <span className="v2-num" style={{ color: "var(--sk-t1)" }}>{formatAmount(monthNet)}</span>
      {monthApproved > 0 && <> · dont <span className="v2-num" style={{ color: "var(--fleet-positive)" }}>{formatAmount(monthApproved)}</span> validé</>}
    </div>
  );

  if (cfg.model === "tiered") {
    const level = salaryLevel(monthNet, cfg);
    const { next, missing, progressPct } = nextTierInfo(monthNet, cfg.salary_tiers || [], level);
    if (!next) {
      return (
        <Card mobile padding="20px 16px" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Overline>Palier atteint</Overline>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--fleet-positive)" }}>{level.label}</div>
          <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>
            salaire : <span className="v2-num" style={{ color: "var(--sk-t1)" }}>{formatAmount(level.total_salary)} XOF</span>/mois
          </div>
          {netLine}
        </Card>
      );
    }
    return (
      <Card mobile padding="20px 16px" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Overline>Il vous manque</Overline>
        <div className="v2-num" style={{ fontSize: 28, fontWeight: 600, color: "var(--fleet-accent)", letterSpacing: "-.02em" }}>
          {formatAmount(missing)} <span style={{ fontSize: 14, color: "var(--v2-muted)" }}>XOF</span>
        </div>
        <div style={{ fontSize: 14 }}>pour atteindre <span style={{ fontWeight: 600 }}>{next.label}</span></div>
        <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>
          salaire : <span className="v2-num" style={{ color: "var(--sk-t1)" }}>{formatAmount(next.total_salary)} XOF</span>/mois
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPct)} aria-label={`Progression vers ${next.label}`}
          style={{ height: 6, borderRadius: 3, background: "var(--sk-surface)", marginTop: 14, overflow: "hidden" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", background: "var(--fleet-accent)", borderRadius: 3 }} />
        </div>
        {netLine}
      </Card>
    );
  }

  let line: React.ReactNode = null;
  if (cfg.model === "fixed") line = <>Salaire fixe : <b className="v2-num">{formatAmount(cfg.base_amount)} XOF</b>/mois</>;
  if (cfg.model === "percent") line = <>Ta part ({Math.round(cfg.commission_rate * 100)} %) : <b className="v2-num">{formatAmount(monthNet * cfg.commission_rate)} XOF</b></>;
  if (cfg.model === "hybrid") {
    const reached = cfg.bonus_threshold > 0 && monthNet >= cfg.bonus_threshold;
    line = <>Fixe <b className="v2-num">{formatAmount(cfg.base_amount)}</b>{cfg.bonus_threshold > 0 && <> · bonus {reached ? "atteint" : `à ${formatAmount(cfg.bonus_threshold)}`}</>}</>;
  }
  if (cfg.model === "location") {
    const rentDue = cfg.daily_rent * new Date().getDate();
    line = <>Loyer dû : <b className="v2-num" style={{ color: "var(--v2-negative-ink)" }}>{formatAmount(rentDue)}</b> · net après loyer <b className="v2-num">{formatAmount(Math.max(0, monthNet - rentDue))}</b></>;
  }
  return (
    <Card mobile padding="20px 16px" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Overline>Mois en cours</Overline>
      <div className="v2-num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-.02em" }}>
        {formatAmount(monthNet)} <span style={{ fontSize: 14, color: "var(--v2-muted)" }}>XOF</span>
      </div>
      {line && <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>{line}</div>}
      {monthPending(monthNet, monthApproved)}
    </Card>
  );
}

function monthPending(monthNet: number, approved: number) {
  if (approved <= 0) return null;
  return (
    <div style={{ fontSize: 12, color: "var(--v2-muted)", marginTop: 8 }}>
      dont <span className="v2-num" style={{ color: "var(--fleet-positive)" }}>{formatAmount(approved)}</span> validé
      {monthNet - approved > 0 && <> · <span className="v2-num">{formatAmount(monthNet - approved)}</span> en attente</>}
    </div>
  );
}
