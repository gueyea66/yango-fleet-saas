"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLAN_LIMITS } from "@/lib/plans";

interface KPI {
  mrr: number;
  arr: number;
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  expiredTenants: number;
  expiringIn7d: number;
  totalDrivers: number;
  activeDriversThisMonth: number;
  reportsThisMonth: number;
  grossThisMonth: number;
  netThisMonth: number;
  expensesThisMonth: number;
  reportsAllTime: number;
  grossAllTime: number;
}

interface TenantRow {
  id: string; slug: string; name: string; plan: string; active: boolean;
  trial_ends_at: string | null; plan_expires_at: string | null;
  app_name: string; primary_color: string;
  driverCount: number;
  reportsMonth: number; grossMonth: number; netMonth: number;
  daysLeft: number | null;
}

interface DailyPoint { date: string; reports: number; gross: number; }

const fmt = (n: number) => n >= 1_000_000
  ? (n / 1_000_000).toFixed(1) + "M"
  : n >= 1_000 ? (n / 1_000).toFixed(0) + "k" : String(Math.round(n));

const fmtXOF = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " XOF";

function KPICard({ label, value, sub, color = "#f5a623", icon }: { label: string; value: string; sub?: string; color?: string; icon: string }) {
  return (
    <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: "18px 20px", flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: "-0.5px" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#374151", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function MiniBar({ points }: { points: DailyPoint[] }) {
  if (!points.length) return <div style={{ color: "#374151", fontSize: 12 }}>Pas de données</div>;
  const maxReports = Math.max(...points.map(p => p.reports), 1);
  const maxGross = Math.max(...points.map(p => p.gross), 1);
  const W = 600; const H = 80; const barW = Math.max(2, (W / points.length) - 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 80 }}>
      {points.map((p, i) => {
        const x = i * (W / points.length);
        const hReports = (p.reports / maxReports) * H;
        const hGross = (p.gross / maxGross) * H * 0.6;
        return (
          <g key={p.date}>
            <rect x={x} y={H - hGross} width={barW} height={hGross} fill="#f5a62320" rx={1} />
            <rect x={x} y={H - hReports} width={barW * 0.5} height={hReports} fill="#f5a623" rx={1} opacity={0.9} />
          </g>
        );
      })}
    </svg>
  );
}

function PlanPie({ counts }: { counts: Record<string, number> }) {
  const colors: Record<string, string> = { standard: "#f5a623", pro: "#8b5cf6", none: "#1e2330" };
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  let cumAngle = -90;
  const slices = Object.entries(counts).map(([plan, count]) => {
    const angle = (count / total) * 360;
    const start = cumAngle; cumAngle += angle;
    return { plan, count, angle, start };
  });
  const R = 40; const cx = 50; const cy = 50;
  function polarToXY(angle: number, r: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  return (
    <svg viewBox="0 0 100 100" style={{ width: 100, height: 100 }}>
      {slices.map(({ plan, angle, start }) => {
        if (angle < 1) return null;
        const p1 = polarToXY(start, R); const p2 = polarToXY(start + angle, R);
        const large = angle > 180 ? 1 : 0;
        return (
          <path key={plan} d={`M${cx},${cy} L${p1.x},${p1.y} A${R},${R} 0 ${large} 1 ${p2.x},${p2.y} Z`}
            fill={colors[plan] || "#374151"} opacity={0.85} />
        );
      })}
      <circle cx={cx} cy={cy} r={22} fill="#0d1117" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={10} fill="#f0f2f7" fontWeight="bold">{total}</text>
    </svg>
  );
}

export default function Dashboard() {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [tenantRows, setTenantRows] = useState<TenantRow[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"grossMonth" | "reportsMonth" | "driverCount" | "daysLeft">("grossMonth");
  const sb = createClient() as any;

  async function load() {
    setLoading(true);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const [
      { data: tenants },
      { data: profiles },
      { data: reportsMonth },
      { data: reportsAll },
      { data: dailyReports },
      { data: settings },
    ] = await Promise.all([
      sb.from("tenants").select("id,slug,name,plan,active,trial_ends_at,plan_expires_at,created_at"),
      sb.from("profiles").select("id,tenant_id,role,created_at"),
      sb.from("daily_reports").select("tenant_id,gross_income,net_income,expenses").gte("report_date", monthStart),
      sb.from("daily_reports").select("gross_income,net_income"),
      sb.from("daily_reports").select("report_date,gross_income").gte("report_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).order("report_date"),
      sb.from("tenant_settings").select("tenant_id,app_name,primary_color"),
    ]);

    const settingsMap: Record<string, { app_name: string; primary_color: string }> = {};
    (settings || []).forEach((s: any) => { settingsMap[s.tenant_id] = s; });

    const driversByTenant: Record<string, number> = {};
    (profiles || []).filter((p: any) => p.role === "driver").forEach((p: any) => {
      driversByTenant[p.tenant_id] = (driversByTenant[p.tenant_id] || 0) + 1;
    });

    const reportsByTenant: Record<string, { count: number; gross: number; net: number }> = {};
    (reportsMonth || []).forEach((r: any) => {
      if (!reportsByTenant[r.tenant_id]) reportsByTenant[r.tenant_id] = { count: 0, gross: 0, net: 0 };
      reportsByTenant[r.tenant_id].count++;
      reportsByTenant[r.tenant_id].gross += r.gross_income || 0;
      reportsByTenant[r.tenant_id].net += r.net_income || 0;
    });

    // Daily points aggregated
    const dailyMap: Record<string, DailyPoint> = {};
    (dailyReports || []).forEach((r: any) => {
      if (!dailyMap[r.report_date]) dailyMap[r.report_date] = { date: r.report_date, reports: 0, gross: 0 };
      dailyMap[r.report_date].reports++;
      dailyMap[r.report_date].gross += r.gross_income || 0;
    });
    setDaily(Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)));

    // Compute KPIs
    let mrr = 0; let activeTenants = 0; let trialTenants = 0; let suspendedTenants = 0; let expiredTenants = 0; let expiringIn7d = 0;
    const rows: TenantRow[] = (tenants || []).map((t: any) => {
      const expiresAt = t.plan_expires_at ?? t.trial_ends_at;
      const daysLeft = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : null;
      const expired = daysLeft !== null && daysLeft <= 0;
      const isTrial = !t.plan_expires_at && t.trial_ends_at;

      if (!t.active || expired) { expired ? expiredTenants++ : suspendedTenants++; }
      else if (isTrial) trialTenants++;
      else { activeTenants++; mrr += PLAN_LIMITS[t.plan as "standard" | "pro"]?.priceXOF || 0; }
      if (daysLeft !== null && daysLeft > 0 && daysLeft <= 7) expiringIn7d++;

      return {
        id: t.id, slug: t.slug, name: t.name, plan: t.plan, active: t.active,
        trial_ends_at: t.trial_ends_at, plan_expires_at: t.plan_expires_at,
        app_name: settingsMap[t.id]?.app_name || t.name,
        primary_color: settingsMap[t.id]?.primary_color || "#f5a623",
        driverCount: driversByTenant[t.id] || 0,
        reportsMonth: reportsByTenant[t.id]?.count || 0,
        grossMonth: reportsByTenant[t.id]?.gross || 0,
        netMonth: reportsByTenant[t.id]?.net || 0,
        daysLeft,
      };
    });
    setTenantRows(rows);

    const grossMonth = (reportsMonth || []).reduce((s: number, r: any) => s + (r.gross_income || 0), 0);
    const netMonth = (reportsMonth || []).reduce((s: number, r: any) => s + (r.net_income || 0), 0);
    const grossAll = (reportsAll || []).reduce((s: number, r: any) => s + (r.gross_income || 0), 0);

    setKpi({
      mrr, arr: mrr * 12,
      totalTenants: (tenants || []).length,
      activeTenants, trialTenants, suspendedTenants, expiredTenants, expiringIn7d,
      totalDrivers: Object.values(driversByTenant).reduce((a, b) => a + b, 0),
      activeDriversThisMonth: (reportsMonth || []).map((r: any) => r.driver_id).filter(Boolean).length,
      reportsThisMonth: (reportsMonth || []).length,
      grossThisMonth: grossMonth,
      netThisMonth: netMonth,
      expensesThisMonth: grossMonth - netMonth,
      reportsAllTime: (reportsAll || []).length,
      grossAllTime: grossAll,
    });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const sorted = [...tenantRows].sort((a, b) => {
    if (sortBy === "daysLeft") return (a.daysLeft ?? 999) - (b.daysLeft ?? 999);
    return b[sortBy] - a[sortBy];
  });

  const planCounts: Record<string, number> = {};
  tenantRows.forEach(t => { planCounts[t.plan] = (planCounts[t.plan] || 0) + 1; });

  const expiring = tenantRows.filter(t => t.daysLeft !== null && t.daysLeft > 0 && t.daysLeft <= 7)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  const PLAN_C: Record<string, string> = { standard: "#f5a623", pro: "#8b5cf6" };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#6b7280", padding: 40 }}>
      <div style={{ width: 16, height: 16, border: "2px solid #f5a623", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      Chargement des données...
    </div>
  );

  return (
    <div>
      {/* ── HEADER KPIs ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
        <KPICard icon="💰" label="MRR" value={fmtXOF(kpi!.mrr)} sub={`ARR: ${fmtXOF(kpi!.arr)}`} color="#f5a623" />
        <KPICard icon="🏢" label="Clients actifs" value={String(kpi!.activeTenants)} sub={`${kpi!.trialTenants} en essai`} color="#22c55e" />
        <KPICard icon="🚗" label="Chauffeurs total" value={String(kpi!.totalDrivers)} color="#60a5fa" />
        <KPICard icon="📋" label="Rapports ce mois" value={String(kpi!.reportsThisMonth)} sub={`All-time: ${fmt(kpi!.reportsAllTime)}`} color="#a78bfa" />
        <KPICard icon="📈" label="CA géré ce mois" value={fmt(kpi!.grossThisMonth)} sub={`Net: ${fmt(kpi!.netThisMonth)} XOF`} color="#34d399" />
        <KPICard icon="⚠️" label="Expirent < 7j" value={String(kpi!.expiringIn7d)} sub={`${kpi!.expiredTenants} expiré(s)`} color={kpi!.expiringIn7d > 0 ? "#f97316" : "#374151"} />
      </div>

      {/* ── ALERTS ── */}
      {expiring.length > 0 && (
        <div style={{ background: "#2a150010", border: "1px solid #f9731640", borderRadius: 12, padding: "16px 20px", marginBottom: 28 }}>
          <div style={{ fontSize: 12, color: "#f97316", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            ⚠ Clients qui expirent bientôt
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {expiring.map(t => (
              <div key={t.id} style={{ background: "#0d1117", border: `1px solid ${t.daysLeft! <= 1 ? "#ef444440" : t.daysLeft! <= 3 ? "#f9731640" : "#f5a62340"}`, borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.daysLeft! <= 1 ? "#ef4444" : t.daysLeft! <= 3 ? "#f97316" : "#f5a623", display: "inline-block" }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f0f2f7" }}>{t.app_name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>J-{t.daysLeft} · {t.plan} · {t.driverCount} chauffeurs</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>

        {/* ── ACTIVITY CHART ── */}
        <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#f0f2f7" }}>Activité — 30 derniers jours</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                <span style={{ color: "#f5a623" }}>█</span> Rapports &nbsp;
                <span style={{ color: "#f5a62340" }}>█</span> CA (relatif)
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f5a623" }}>{kpi!.reportsThisMonth}</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>ce mois</div>
            </div>
          </div>
          <MiniBar points={daily} />
          {daily.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#374151", marginTop: 4 }}>
              <span>{daily[0]?.date}</span>
              <span>{daily[daily.length - 1]?.date}</span>
            </div>
          )}
        </div>

        {/* ── REVENUE BREAKDOWN ── */}
        <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#f0f2f7", marginBottom: 16 }}>Répartition clients & revenus</div>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <PlanPie counts={planCounts} />
            <div style={{ flex: 1 }}>
              {Object.entries(PLAN_LIMITS).map(([plan, limits]) => {
                const count = planCounts[plan] || 0;
                const revenue = count * limits.priceXOF;
                return (
                  <div key={plan} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: PLAN_C[plan] || "#6b7280", display: "inline-block" }} />
                      <span style={{ fontSize: 13, color: "#f0f2f7", fontWeight: 600 }}>{limits.label}</span>
                      <span style={{ fontSize: 11, color: "#6b7280" }}>{count} client{count > 1 ? "s" : ""}</span>
                    </div>
                    <span style={{ fontSize: 13, color: PLAN_C[plan] || "#6b7280", fontWeight: 700 }}>{fmtXOF(revenue)}</span>
                  </div>
                );
              })}
              <div style={{ borderTop: "0.5px solid #1e2330", paddingTop: 10, marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>MRR Total</span>
                <span style={{ fontSize: 14, color: "#f5a623", fontWeight: 800 }}>{fmtXOF(kpi!.mrr)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 11, color: "#6b7280" }}>En essai (non payant)</span>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{kpi!.trialTenants} clients</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FINANCIAL SUMMARY ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 28 }}>
        {[
          { label: "CA total géré (all-time)", value: fmtXOF(kpi!.grossAllTime), color: "#34d399" },
          { label: "CA ce mois (toutes flottes)", value: fmtXOF(kpi!.grossThisMonth), color: "#60a5fa" },
          { label: "Dépenses ce mois", value: fmtXOF(kpi!.expensesThisMonth), color: "#f87171" },
          { label: "Net ce mois", value: fmtXOF(kpi!.netThisMonth), color: "#a78bfa" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── TENANT TABLE ── */}
      <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "0.5px solid #1e2330" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#f0f2f7", flex: 1 }}>Détail par client</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["grossMonth", "reportsMonth", "driverCount", "daysLeft"] as const).map(col => (
              <button key={col} onClick={() => setSortBy(col)}
                style={{ background: sortBy === col ? "#f5a62320" : "#080a0f", border: `0.5px solid ${sortBy === col ? "#f5a62360" : "#1e2330"}`, borderRadius: 6, padding: "5px 10px", color: sortBy === col ? "#f5a623" : "#6b7280", cursor: "pointer", fontSize: 11, fontWeight: sortBy === col ? 700 : 400 }}>
                {col === "grossMonth" ? "CA mois" : col === "reportsMonth" ? "Rapports" : col === "driverCount" ? "Drivers" : "Expiry"}
              </button>
            ))}
          </div>
          <button onClick={load} style={{ background: "#1e2330", border: "none", borderRadius: 6, padding: "5px 10px", color: "#9ca3af", cursor: "pointer", fontSize: 11 }}>↻</button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "0.5px solid #1e2330" }}>
                {["Client", "Plan", "Statut", "Drivers", "Rapports/mois", "CA mois", "Net mois", "Expiry"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", color: "#6b7280", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => {
                const expired = t.daysLeft !== null && t.daysLeft <= 0;
                const warning = t.daysLeft !== null && t.daysLeft > 0 && t.daysLeft <= 7;
                const expiryColor = expired ? "#ef4444" : warning ? "#f97316" : t.daysLeft !== null && t.daysLeft <= 14 ? "#f5a623" : "#22c55e";
                const rowBg = i % 2 === 0 ? "transparent" : "#080a0f08";
                return (
                  <tr key={t.id} style={{ borderBottom: "0.5px solid #1e2330", background: rowBg }}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 6, background: t.primary_color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#080a0f", flexShrink: 0 }}>
                          {t.app_name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: "#f0f2f7" }}>{t.app_name}</div>
                          <div style={{ color: "#374151", fontSize: 10 }}>{t.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ background: (PLAN_C[t.plan] || "#6b7280") + "20", color: PLAN_C[t.plan] || "#6b7280", border: `0.5px solid ${(PLAN_C[t.plan] || "#6b7280")}50`, borderRadius: 20, padding: "3px 8px", fontWeight: 700 }}>
                        {t.plan}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ color: t.active && !expired ? "#22c55e" : "#ef4444", fontSize: 11 }}>
                        {!t.active ? "Suspendu" : expired ? "Expiré" : t.plan_expires_at ? "Actif" : "Essai"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#f0f2f7", fontWeight: 600, textAlign: "right" }}>{t.driverCount}</td>
                    <td style={{ padding: "12px 16px", color: "#f0f2f7", fontWeight: 600, textAlign: "right" }}>{t.reportsMonth}</td>
                    <td style={{ padding: "12px 16px", color: "#34d399", fontWeight: 700, textAlign: "right" }}>{t.grossMonth > 0 ? fmt(t.grossMonth) : "—"}</td>
                    <td style={{ padding: "12px 16px", color: "#60a5fa", fontWeight: 700, textAlign: "right" }}>{t.netMonth > 0 ? fmt(t.netMonth) : "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ color: expiryColor, fontWeight: 700 }}>
                        {t.daysLeft === null ? "—" : t.daysLeft <= 0 ? "Expiré" : `J-${t.daysLeft}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "#374151" }}>Aucun client</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
