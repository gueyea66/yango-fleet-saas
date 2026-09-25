"use client";

import { TrendingUp, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui";
import { useDriverPilotageStats } from "@/components/driver/useDriverPilotageStats";
import type { Cfg, Profile } from "@/components/driver/shared";
import { formatAmount, formatDecimal } from "@/lib/v2/format";
import { dailyNeeded, dayStatus, monthNameFr } from "@/lib/v2/driver";
import { ScreenHeader, ScreenBody, SkeletonBlock } from "./parts";
import { useDriverMonth, type MonthReport } from "./useDriverMonth";

/**
 * Pilotage chauffeur v2 (maquette 2b) : rythme nécessaire vs moyenne actuelle.
 * Statistiques = hook de l'UI actuelle (useDriverPilotageStats) ; barres du
 * net par jour = lecture du mois (useDriverMonth).
 */
export function PilotageV2({ profile, cfg }: { profile: Profile; cfg: Cfg }) {
  const now = new Date();
  const { stats, loading, TARGET } = useDriverPilotageStats(profile, cfg);
  const month = useDriverMonth(profile, now.getFullYear(), now.getMonth());

  const header = <ScreenHeader title="Mon mois" right={<span style={{ fontSize: 13, color: "var(--v2-muted)" }}>{monthNameFr(now.getMonth())}</span>} />;

  if (loading || !stats) {
    return (
      <>
        {header}
        <ScreenBody padding="22px 16px"><SkeletonBlock height={150} radius={18} /><SkeletonBlock height={150} /><SkeletonBlock height={200} radius={18} /></ScreenBody>
      </>
    );
  }

  // Objectif affiché : palier suivant (modèle à paliers), sinon l'objectif du mois.
  const tiered = cfg.model === "tiered" && stats.nextTier;
  const goalLabel = tiered ? stats.nextTier.label : "l'objectif";
  const goalAmount: number = tiered ? stats.nextTier.min_net : TARGET;
  const remaining = goalAmount - stats.mtdNet;
  const perDay = dailyNeeded(remaining, stats.daysRemaining);
  const reached = remaining <= 0;
  const onPace = stats.dailyAvg >= perDay;

  // Salaire projeté selon le modèle (mêmes données que l'écran actuel).
  let projected: string = "—";
  if (cfg.model === "tiered" && stats.tier) projected = formatAmount(stats.tier.total_salary);
  else if (cfg.model === "fixed") projected = formatAmount(cfg.base_amount);
  else if (cfg.model === "percent") projected = formatAmount(stats.projectedNet * cfg.commission_rate);
  else if (cfg.model === "location") projected = formatAmount(stats.projectedNet - stats.rentProjected);

  // Courses / jour et barres : rapports du mois hors rejetés / archivés / repos.
  const byDay = new Map<string, MonthReport[]>();
  for (const r of month.reports) {
    const list = byDay.get(r.date) ?? [];
    list.push(r);
    byDay.set(r.date, list);
  }
  const workDays: { date: string; net: number; trips: number }[] = [];
  for (const [date, list] of byDay) {
    const st = dayStatus(list);
    if (st !== "approved" && st !== "submitted") continue;
    const active = list.find((r) => r.status === "approved") ?? list.find((r) => r.status === "submitted");
    workDays.push({ date, net: active?.net_after_expenses || 0, trips: active?.yango_trip_count || 0 });
  }
  const tripsKnown = workDays.filter((d) => d.trips > 0);
  const tripsPerDay = tripsKnown.length ? tripsKnown.reduce((s, d) => s + d.trips, 0) / tripsKnown.length : null;

  const daysInMonth: number = stats.daysInMonth;
  const dailyGoal = goalAmount > 0 ? goalAmount / daysInMonth : 0;
  const bars = Array.from({ length: now.getDate() }, (_, i) => {
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    return { iso, net: workDays.find((d) => d.date === iso)?.net ?? 0 };
  });
  const maxBar = Math.max(dailyGoal * 1.15, ...bars.map((b) => b.net), 1);

  return (
    <>
      {header}
      <ScreenBody padding="22px 16px">
        <Card mobile style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {reached ? (
            <>
              <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Objectif du mois</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: "var(--fleet-positive)" }}>Atteint</div>
              <div style={{ fontSize: 14, color: "var(--v2-nav-inactive)" }}>Net du mois : <span className="v2-num">{formatAmount(stats.mtdNet)} XOF</span></div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Pour atteindre {goalLabel}, il faut</div>
              <div className="v2-num" style={{ fontSize: 30, fontWeight: 600, color: "var(--fleet-accent)", letterSpacing: "-.02em" }}>
                {formatAmount(perDay)} <span style={{ fontSize: 14, color: "var(--v2-muted)" }}>XOF / jour</span>
              </div>
              <div style={{ fontSize: 14, color: "var(--v2-nav-inactive)" }}>
                {stats.daysRemaining > 0 ? `pendant les ${stats.daysRemaining} jours restants` : "aujourd'hui, dernier jour du mois"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: onPace ? "var(--fleet-positive)" : "var(--fleet-warning)" }}>
                {onPace ? <TrendingUp size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
                Ta moyenne actuelle : <span className="v2-num">{formatAmount(stats.dailyAvg)}</span> / jour
              </div>
            </>
          )}
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Tile label="Net du mois" value={formatAmount(stats.mtdNet)} />
          <Tile label={cfg.model === "location" ? "Net après loyer projeté" : "Salaire projeté"} value={projected} />
          <Tile label="Courses / jour" value={tripsPerDay != null ? formatDecimal(tripsPerDay, 1) : "—"} />
          <Tile label="Km / jour" value={stats.avgKmPerDay != null ? formatAmount(stats.avgKmPerDay) : "—"} />
        </div>

        <Card mobile padding="16px" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 200, flex: 1 }}>
          <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Net par jour</div>
          {month.loading ? <SkeletonBlock height={140} radius={8} /> : (
            <div style={{ flex: 1, minHeight: 140, display: "flex", alignItems: "flex-end", gap: 3, position: "relative" }} role="img"
              aria-label={`Net par jour ce mois, objectif ${formatAmount(dailyGoal)} par jour`}>
              {dailyGoal > 0 && (
                <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(dailyGoal / maxBar) * 100}%`, borderTop: "1px dashed var(--fleet-accent)" }}>
                  <span className="v2-num" style={{ position: "absolute", right: 0, bottom: 3, fontSize: 11, color: "var(--fleet-accent)" }}>objectif {formatAmount(dailyGoal)}</span>
                </div>
              )}
              {bars.map((b) => (
                <div key={b.iso} title={`${b.iso.slice(8)} : ${formatAmount(b.net)}`}
                  style={{ flex: 1, height: `${Math.max(b.net > 0 ? 3 : 2, (b.net / maxBar) * 100)}%`, borderRadius: "3px 3px 0 0",
                    background: b.net <= 0 ? "var(--sk-surface)" : b.net >= dailyGoal ? "var(--fleet-positive)" : "var(--sk-border)" }} />
              ))}
            </div>
          )}
        </Card>
      </ScreenBody>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="14px">
      <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>{label}</div>
      <div className="v2-num" style={{ fontSize: 18, fontWeight: 600, marginTop: 6 }}>{value}</div>
    </Card>
  );
}
