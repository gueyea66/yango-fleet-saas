"use client";

export const dynamic = "force-dynamic";

// Audit UI : icônes vectorielles monochromes (remplacent les émojis en nav → premium).
// L'accent couleur reste la couleur de marque du tenant (white-label) — inchangé.
const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, pending: Inbox, history: History, calendrier: Calendar,
  payments: Banknote, avances: HandCoins, pilotage: Gauge,
  vehicles: Car, drivers: Users, kyc: BadgeCheck,
  remuneration: Briefcase, journal: BookText, import: Upload, settings: Settings,
};

import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Inbox, History, Calendar, Banknote, HandCoins, Gauge,
  Car, Users, BadgeCheck, Briefcase, BookText, Upload, Settings, BarChart3, Download, BellRing,
  AlertTriangle, Info, type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import NotificationBell from "@/components/NotificationBell";
import ImportHistoriqueModal from "@/components/ImportHistoriqueModal";
import { useTenant } from "@/lib/tenant/context";
import { BrandLogo } from "@/components/brand/BrandShell";
import TrialBanner from "@/components/TrialBanner";
import { computeCommissions } from "@/lib/calc";
import {
  BarChart, Bar, Treemap,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface DailyReport {
  id: string;
  driver_id: string;
  date: string;
  net_after_expenses: number;
  expense_count: number;
  status: string;
}

const EXPENSE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

// Cellule treemap style Power BI : nom + montant + % selon la place disponible
function TreemapCell(props: any) {
  const { x, y, width, height, index, name, value, percent, depth } = props;
  if (depth === 0 || width <= 0 || height <= 0) return null;
  const fill = EXPENSE_COLORS[index % EXPENSE_COLORS.length];
  const showName = width > 60 && height > 28;
  const showValue = width > 110 && height > 58;
  const showPercent = width > 110 && height > 78;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4}
        style={{ fill, stroke: "var(--sk-bg)", strokeWidth: 3 }} />
      {showName && (
        <text x={x + 10} y={y + 22} fill="#fff" fontSize={13} fontWeight={700}>
          {name}
        </text>
      )}
      {showValue && (
        <text x={x + 10} y={y + 42} fill="rgba(255,255,255,0.92)" fontSize={12} fontFamily="ui-monospace, monospace">
          {Math.round(value).toLocaleString("fr-FR")} XOF
        </text>
      )}
      {showPercent && (
        <text x={x + 10} y={y + 62} fill="rgba(255,255,255,0.75)" fontSize={12} fontFamily="ui-monospace, monospace">
          {typeof percent === "number" ? percent.toFixed(1) : "—"}%
        </text>
      )}
    </g>
  );
}

export default function AdminPage() {
  const { user, loading, signOut } = useAuth();
  const { settings } = useTenant();
  const router = useRouter();
  const [tab, setTab] = useState("dashboard");
  const [showAllZeros, setShowAllZeros] = useState(false); // audit UI : révéler les postes à zéro masqués
  const [showImportModal, setShowImportModal] = useState(false);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<DailyReport>>({});
  const [loadingReports, setLoadingReports] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Driver / vehicle filter (global, shared across tabs)
  const [filterDriverId, setFilterDriverId] = useState("");
  // Barre de filtres masquable (préférence par appareil, partagée avec Pilotage)
  const [showFilters, setShowFilters] = useState(true);
  useEffect(() => { setShowFilters(localStorage.getItem("m3a_filters_on") !== "0"); }, []);
  const toggleFilters = (v: boolean) => { setShowFilters(v); localStorage.setItem("m3a_filters_on", v ? "1" : "0"); };
  const [allDrivers, setAllDrivers] = useState<any[]>([]); // { id, full_name, driver_id, plate }
  const [adminTenantId, setAdminTenantId] = useState<string | null>(null);
  const [remunCfg, setRemunCfg] = useState<any>(null);

  // Get tenant_id from the admin's own profile FIRST, then load filtered data
  // Ensure storage bucket exists (idempotent)
  useEffect(() => {
    fetch("/api/setup-storage", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const supabase = createClient() as any;
      const { data: adminProfile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      const tenantId = adminProfile?.tenant_id;
      if (!tenantId) return;
      setAdminTenantId(tenantId);
      const [{ data: profs }, { data: vehs }, { data: rc }] = await Promise.all([
        supabase.from("profiles").select("*").eq("role", "driver").eq("tenant_id", tenantId).order("full_name"),
        supabase.from("vehicles").select("driver_id, plate").eq("tenant_id", tenantId),
        supabase.from("remuneration_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      const plateMap = Object.fromEntries((vehs || []).map((v: any) => [v.driver_id, v.plate]));
      setAllDrivers((profs || []).map((p: any) => ({ ...p, plate: plateMap[p.id] || null })));
      if (rc) setRemunCfg(rc);
    })();
  }, [user]);

  // Date filter for dashboard
  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonths, setFilterMonths] = useState<number[]>([now.getMonth() + 1]);
  const periodFrom = `${filterYear}-${String(Math.min(...filterMonths)).padStart(2, "0")}-01`;
  const lastMonth = Math.max(...filterMonths);
  const lastDay = new Date(filterYear, lastMonth, 0).getDate();
  const periodTo = `${filterYear}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const kpis = useDashboardKPIs(periodFrom, periodTo, adminTenantId, filterDriverId || undefined);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user && adminTenantId && (tab === "history" || tab === "pending")) {
      loadReports(filterDriverId || null);
    }
  }, [user, tab, adminTenantId, filterDriverId]);

  const loadReports = async (driverId: string | null = null) => {
    if (!adminTenantId) return;
    setLoadingReports(true);
    try {
      const params = new URLSearchParams({ tenantId: adminTenantId });
      if (driverId) params.set("driverId", driverId);
      const res = await fetch(`/api/admin/reports?${params}`);
      if (res.status === 401) {
        setSessionError("Session expirée — veuillez vous reconnecter.");
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error || "Erreur chargement rapports");
      const json = await res.json();
      setReports(json.reports || []);
      setExpenses(json.expenses || []);
    } catch (err: any) {
      console.error("Error loading:", err);
      setSessionError(err.message || "Erreur de chargement");
    } finally {
      setLoadingReports(false);
    }
  };

  const handleSaveEdit = async (reportId: string) => {
    try {
      const supabase = createClient();
      const updateData = { status: "approved" as const };
      const { error } = await ((supabase
        .from("daily_reports") as any)
        .update(updateData)
        .eq("id", reportId) as any);

      if (error) {
        console.error("Error updating report:", error);
        alert("Erreur lors de la mise à jour");
      } else {
        setEditingId(null);
        setEditForm({});
        loadReports();
        alert("Rapport approuvé ✓");
      }
    } catch (err) {
      console.error("Error saving edit:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-600">Chargement...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const tabGroups = [
    {
      label: "Opérations",
      items: [
        ["dashboard",   "📊", "Dashboard"],
        ["pending",     "⏳", "Soumissions"],
        ["history",     "📜", "Historique"],
        ["calendrier",  "📅", "Calendrier"],
      ],
    },
    {
      label: "Finance",
      items: [
        ["payments",    "💵", "Paiements"],
        ["avances",     "💰", "Avances"],
        ["pilotage",    "🎯", "Pilotage"],
      ],
    },
    {
      label: "Flotte",
      items: [
        ["vehicles",    "🔧", "Véhicules"],
        ["drivers",     "🚗", "Conducteurs"],
        ["kyc",         "🪪", "KYC"],
      ],
    },
    {
      label: "Config",
      items: [
        ["remuneration","💼", "Rémunération"],
        ["journal",     "📋", "Journal"],
        ["import",      "📥", "Import historique"],
        ["settings",    "⚙️", "Paramètres"],
      ],
    },
  ];
  const tabs = tabGroups.flatMap((g) => g.items.map(([id, , label]) => [id, label]));

  return (
    <div className="min-h-screen flex" style={{ background: "var(--sk-deep)" }}>

      {/* ── SIDEBAR DESKTOP (lg+) ── */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 h-full z-50"
        style={{ width: 220, background: "var(--sk-bg)", borderRight: "1px solid var(--sk-surface)" }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="flex items-center gap-2.5">
            <BrandLogo size={32} />
            <div>
              <div className="font-bold text-white text-sm">{settings.app_name}</div>
              <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>{settings.operator_name || "Powered by M3A Solution"}</div>
            </div>
          </div>
        </div>

        {/* Nav items grouped */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {tabGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="px-3 mb-1 text-[9px] uppercase tracking-[0.12em] font-bold" style={{ color: "var(--sk-t4)" }}>{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(([id, icon, label]) => (
                  <button key={id} onClick={() => id === "drivers" ? router.push("/admin/drivers") : setTab(id)} className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2.5"
                    style={{
                      background: tab === id ? "rgba(245,166,35,.12)" : "transparent",
                      color: tab === id ? "#f5a623" : "var(--sk-t2)",
                      border: `1px solid ${tab === id ? "rgba(245,166,35,.2)" : "transparent"}`,
                    }}>
                    {(() => { const I = NAV_ICONS[id]; return I
                      ? <I size={16} strokeWidth={1.75} className="flex-shrink-0" />
                      : <span className="text-sm leading-none w-4 text-center flex-shrink-0">{icon}</span>; })()}
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User + logout */}
        <div className="px-3 py-4 border-t" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="px-3 py-2 rounded-xl flex items-center justify-between" style={{ background: "var(--sk-surface)" }}>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white mb-0.5 truncate">
                {user?.user_metadata?.full_name || user?.email || "Admin"}
              </div>
              <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>Administrateur</div>
            </div>
            <NotificationBell />
          </div>
          <button onClick={() => signOut()} className="w-full mt-2 text-xs px-3 py-2 rounded-xl text-left font-medium transition-all"
            style={{ color: "#ef4444", background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            ⎋ Déconnexion
          </button>
        </div>
      </aside>

      {/* ── TOP BAR MOBILE (< lg) ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 px-4 py-3 flex items-center justify-between"
        style={{ background: "rgba(13,17,23,.97)", borderBottom: "1px solid var(--sk-surface)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-2">
          <BrandLogo size={28} />
          <span className="font-bold text-white text-sm">{settings.app_name}</span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button onClick={() => signOut()} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
            Déconnexion
          </button>
        </div>
      </div>

      {/* ── MOBILE NAV TABS ── */}
      <div className="lg:hidden fixed top-12 left-0 right-0 z-40 flex items-center gap-0 overflow-x-auto"
        style={{ background: "var(--sk-bg)", borderBottom: "1px solid var(--sk-surface)" }}>
        {tabGroups.map((group, gi) => (
          <React.Fragment key={group.label}>
            {gi > 0 && <div className="flex-shrink-0 w-px h-6 mx-1" style={{ background: "var(--sk-surface)" }} />}
            {group.items.map(([id, icon]) => (
              <button key={id} onClick={() => id === "drivers" ? router.push("/admin/drivers") : setTab(id)}
                className="flex-shrink-0 flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium"
                style={{ color: tab === id ? "#f5a623" : "var(--sk-t3)", borderBottom: tab === id ? "2px solid #f5a623" : "2px solid transparent" }}>
                {(() => { const I = NAV_ICONS[id]; return I
                  ? <I size={18} strokeWidth={1.75} />
                  : <span className="text-base leading-none">{icon}</span>; })()}
              </button>
            ))}
          </React.Fragment>
        ))}
      </div>

      {/* ── MAIN CONTENT ── */}
      {/* min-w-0 : sans lui, un tableau large (nowrap) élargit toute la page sur mobile */}
      <main className="flex-1 min-w-0 min-h-screen" style={{ marginLeft: 0 }}>
        <div className="lg:hidden" style={{ height: 88 }} /> {/* mobile header offset */}
        <div className="lg:pl-[220px]">
        <div className="p-6 lg:p-10 w-full max-w-none" style={{ background: "var(--sk-deep)", minHeight: "100vh" }}>

        {/* Expiration essai / abonnement */}
        <TrialBanner />

        {/* Session error banner */}
        {sessionError && (
          <div style={{ background: "#2d1515", border: "1px solid #c53030", borderRadius: 12, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div>
                <div style={{ color: "#fc8181", fontWeight: 700, fontSize: 14 }}>{sessionError}</div>
                <div style={{ color: "#a0aab8", fontSize: 12 }}>Vos données sont intactes — reconnectez-vous pour y accéder.</div>
              </div>
            </div>
            <button onClick={() => signOut()} style={{ background: "#c53030", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              Se reconnecter →
            </button>
          </div>
        )}

        {/* ── DRIVER / VEHICLE FILTER BAR — visible on all data tabs, masquable ── */}
        {!["drivers", "remuneration", "settings", "kyc", "journal", "pilotage"].includes(tab) && allDrivers.length > 0 && !showFilters && (
          <div className="mb-6">
            <button onClick={() => toggleFilters(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", color: filterDriverId ? "#f5a623" : "var(--sk-t3)" }}>
              🔍 Filtres{filterDriverId ? ` · ${allDrivers.find((d) => d.id === filterDriverId)?.full_name || "1 chauffeur"}` : ""}
            </button>
          </div>
        )}
        {!["drivers", "remuneration", "settings", "kyc", "journal", "pilotage"].includes(tab) && allDrivers.length > 0 && showFilters && (
          <div className="mb-6 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
            <span className="text-[10px] font-bold uppercase tracking-widest mr-1" style={{ color: "var(--sk-t4)" }}>Vue :</span>
            <button onClick={() => setFilterDriverId("")}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
              style={{ background: !filterDriverId ? "#f5a623" : "var(--sk-surface)", color: !filterDriverId ? "#000" : "var(--sk-t3)" }}>
              👥 Tous
            </button>
            {allDrivers.map((d) => (
              <button key={d.id} onClick={() => setFilterDriverId(filterDriverId === d.id ? "" : d.id)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5"
                style={{ background: filterDriverId === d.id ? "rgba(245,166,35,.15)" : "var(--sk-surface)",
                  color: filterDriverId === d.id ? "#f5a623" : "var(--sk-t3)",
                  border: `1px solid ${filterDriverId === d.id ? "rgba(245,166,35,.35)" : "transparent"}`,
                  opacity: d.active === false ? 0.55 : 1 }}>
                👤 {d.full_name || d.driver_id}
                {d.plate && <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--sk-deep)", color: "var(--sk-t2)", fontSize: 10 }}>🚗 {d.plate}</span>}
                {d.active === false && <span className="text-[9px] uppercase" style={{ color: "var(--sk-t4)" }}>inactif</span>}
              </button>
            ))}
            <button onClick={() => toggleFilters(false)} title="Masquer les filtres"
              className="ml-auto text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "transparent", color: "var(--sk-t4)" }}>
              ✕ Masquer
            </button>
          </div>
        )}

        {tab === "dashboard" && (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-3xl font-bold text-white">Dashboard Flotte</h2>
              {/* Period selector */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Year */}
                <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}
                  className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg px-3 py-2">
                  {[now.getFullYear() - 1, now.getFullYear()].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                {/* Month toggles */}
                <div className="flex gap-1 flex-wrap">
                  {["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"].map((m, i) => {
                    const mn = i + 1;
                    const active = filterMonths.includes(mn);
                    return (
                      <button key={mn} onClick={() => setFilterMonths((prev) =>
                        prev.includes(mn) ? (prev.length > 1 ? prev.filter((x) => x !== mn) : prev) : [...prev, mn].sort()
                      )}
                        className="text-xs px-2 py-1 rounded-lg font-semibold transition-all"
                        style={{ background: active ? "#f5a623" : "var(--sk-surface)", color: active ? "#000" : "var(--sk-t3)" }}>
                        {m}
                      </button>
                    );
                  })}
                  <button onClick={() => setFilterMonths([1,2,3,4,5,6,7,8,9,10,11,12])}
                    className="text-xs px-2 py-1 rounded-lg font-semibold"
                    style={{ background: filterMonths.length === 12 ? "#f5a623" : "var(--sk-surface)", color: filterMonths.length === 12 ? "#000" : "var(--sk-t3)" }}>
                    Année
                  </button>
                </div>
                <span className="text-xs" style={{ color: "var(--sk-t3)" }}>{periodFrom} → {periodTo}</span>
                <ExportMenu dateFrom={periodFrom} dateTo={periodTo} />
              </div>
            </div>

            <RemindBanner />
            <AlertsPanel />

            {kpis.loading ? (
              <DashboardSkeleton />
            ) : (
              <>
                {/* ── Audit UI — HERO BAR : 3 KPIs décisionnels, toujours en tête ── */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">
                  <HeroCard label="Net Final" value={kpis.netFinal} color={kpis.netFinal >= 0 ? "#22c55e" : "#ef4444"} sub={`${kpis.monthMarginPercent.toFixed(1)}% de marge · période`} primary />
                  <HeroCard label="Total Recettes" value={kpis.totalBrut} color="#f5a623" sub="net · période sélectionnée" />
                  <HeroCard label="Trésorerie Nette" value={kpis.tresorerie} color={kpis.tresorerie >= 0 ? "#22c55e" : "#ef4444"} sub="cash net" />
                </div>

                {/* ── Audit UI — État vide : aucune donnée sur la période ── */}
                {kpis.dailyRows.length === 0 && (
                  <EmptyState icon={BarChart3} title="Aucune activité sur cette période"
                    hint="Dès qu'un rapport chauffeur est approuvé, les graphiques et les totaux détaillés apparaissent ici. Ajuste la période ci-dessus si besoin." />
                )}

                {/* ── Audit UI — ACTIVITÉ (graphique-first, comme la maquette) ── */}
                {kpis.dailyRows.length > 0 && (
                  <AccordionSection title="Activité — Recettes par jour" subtitle="Brut Yango · Hors Yango · Net final — la vue de lecture principale" defaultOpen>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={kpis.dailyRows} barGap={2}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--sk-surface)" vertical={false} />
                        <XAxis dataKey="date" stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(d) => d.slice(5)} />
                        <YAxis stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                        <Tooltip contentStyle={{ backgroundColor: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: any) => [Number(v).toLocaleString("fr-FR") + " XOF"]} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                        <Bar dataKey="brutYango" fill="#f5a623" name="Brut Yango" radius={[3,3,0,0]} />
                        <Bar dataKey="horsYango" fill="#a855f7" name="Hors Yango" radius={[3,3,0,0]} />
                        <Bar dataKey="netFinal" fill="#22c55e" name="Net final" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </AccordionSection>
                )}

                {/* ── PÉRIODE SÉLECTIONNÉE ── */}
                <AccordionSection title="Période — Recettes vs Charges" subtitle="Détail des postes — replié par défaut (le hero suffit pour la lecture 5 s)">
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
                    <KPICard label="Brut Yango" value={kpis.brutYango} color="#f5a623" sub={`Moy/jour: ${Math.round(kpis.avgBrutPerDay).toLocaleString("fr-FR")} XOF`} />
                    <KPICard label="Net Yango" value={kpis.netYango} color="#3b82f6" sub="Après commission" />
                    <KPICard label="Hors Yango" value={kpis.horsYango} color="#a855f7" sub="Recettes off-platform" />
                    <KPICard label="Total Recettes (net)" value={kpis.totalBrut} color="#22c55e" sub={`Moy/jour: ${Math.round(kpis.avgNetPerDay).toLocaleString("fr-FR")} XOF`} />
                    <KPICard label="Total Dépenses" value={kpis.totalDepenses} color="#ef4444" negative sub={`Moy/jour: ${Math.round(kpis.avgDepensesPerDay).toLocaleString("fr-FR")} XOF`} />
                    <KPICard label="NET FINAL" value={kpis.netFinal} color={kpis.netFinal >= 0 ? "#22c55e" : "#ef4444"} big sub={`${kpis.monthMarginPercent.toFixed(1)}% de marge`} />
                  </div>
                  <p className="text-xs mb-2" style={{ color: "var(--sk-t4)" }}>Vue commissions (taux %) — base de la rémunération.</p>
                </AccordionSection>

                {/* ── RÉSULTAT OPÉRATIONNEL RÉEL ── */}
                <AccordionSection title="Résultat opérationnel réel" subtitle="Consommations mesurées (solde & carburant), hors provisions front-loadées">
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                    <KPICard label="Recettes réelles" value={kpis.brutYango + kpis.horsYango} color="#22c55e" />
                    <KPICard label="Solde consommé" value={kpis.soldeConsomme} color="#ef4444" negative sub="mesuré (wallet)" hideWhenZero showZeros={showAllZeros} />
                    <KPICard label="Carburant consommé" value={kpis.carburantConsomme} color="#ef4444" negative sub={`${Math.round(kpis.coutCarburantKm).toLocaleString("fr-FR")} XOF/km`} hideWhenZero showZeros={showAllZeros} />
                    <KPICard label="Autres dépenses" value={kpis.autresDepensesOpe} color="#ef4444" negative sub="hors solde & carburant" hideWhenZero showZeros={showAllZeros} />
                    <KPICard label="Salaires" value={kpis.totalDepenses - kpis.provisionsSolde - kpis.achatsCarburant - kpis.autresDepensesOpe} color="#ef4444" negative hideWhenZero showZeros={showAllZeros} />
                    <KPICard label="NET OPÉRATIONNEL" value={kpis.netOperationnel} color={kpis.netOperationnel >= 0 ? "#22c55e" : "#ef4444"} big sub="vrai résultat" />
                  </div>
                  {(() => {
                    // Audit UI : compte les postes à zéro masqués et propose de les révéler.
                    const salaires = kpis.totalDepenses - kpis.provisionsSolde - kpis.achatsCarburant - kpis.autresDepensesOpe;
                    const zeroCount = [kpis.soldeConsomme, kpis.carburantConsomme, kpis.autresDepensesOpe, salaires]
                      .filter((v) => Math.round(v) === 0).length;
                    if (zeroCount === 0) return null;
                    return (
                      <button type="button" onClick={() => setShowAllZeros((s) => !s)}
                        className="text-xs mt-3 underline underline-offset-2 transition-colors"
                        style={{ color: "var(--sk-t3)" }}>
                        {showAllZeros ? "Masquer les postes à zéro" : `Afficher tout (${zeroCount} poste${zeroCount > 1 ? "s" : ""} à zéro)`}
                      </button>
                    );
                  })()}
                </AccordionSection>

                {/* ── TRÉSORERIE ── */}
                <AccordionSection title="Trésorerie (cash)" subtitle="Décaissements réels — inclut les provisions front-loadées">
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                    <KPICard label="Encaissements" value={kpis.brutYango + kpis.horsYango} color="#22c55e" />
                    <KPICard label="Provisions solde" value={kpis.provisionsSolde} color="#f5a623" negative sub="achats de solde" />
                    <KPICard label="Achats carburant" value={kpis.achatsCarburant} color="#f5a623" negative sub="pleins payés" />
                    <KPICard label="Décaissements" value={kpis.decaissements} color="#ef4444" negative />
                    <KPICard label="TRÉSORERIE" value={kpis.tresorerie} color={kpis.tresorerie >= 0 ? "#22c55e" : "#ef4444"} big sub="cash net" />
                    <KPICard label="Avance immobilisée" value={kpis.avanceSolde + kpis.avanceCarburant} color="#a855f7" sub="solde + carburant avancés" />
                  </div>
                </AccordionSection>

                {/* ── AUJOURD'HUI ── */}
                <AccordionSection title="Aujourd'hui" subtitle="Activité du jour — revenus, dépenses, marge"
                  right={<span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: kpis.todayNetMargin > 0 ? "#22c55e" : "#ef4444" }}>{Math.round(kpis.todayNetMargin).toLocaleString("fr-FR")} XOF</span>}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800 border-l-4 border-yellow-500 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Revenus
                      </div>
                      <div className="text-2xl font-bold text-white font-mono mt-2">
                        {Math.round(kpis.todayRevenue).toLocaleString("fr-FR")}
                        <span className="text-sm text-gray-400"> XOF</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {kpis.activeDriversToday} chauffeurs actifs
                      </div>
                    </div>

                    <div className="bg-gray-800 border-l-4 border-red-500 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Dépenses
                      </div>
                      <div className="text-2xl font-bold text-white font-mono mt-2">
                        {Math.round(kpis.todayExpenses).toLocaleString("fr-FR")}
                        <span className="text-sm text-gray-400"> XOF</span>
                      </div>
                    </div>

                    <div
                      className={`bg-gray-800 border-l-4 rounded-lg p-4 ${
                        kpis.todayNetMargin > 0
                          ? "border-green-500"
                          : "border-red-500"
                      }`}
                    >
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Marge nette
                      </div>
                      <div
                        className={`text-2xl font-bold font-mono mt-2 ${
                          kpis.todayNetMargin > 0
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {Math.round(kpis.todayNetMargin).toLocaleString("fr-FR")}
                        <span className="text-sm text-gray-400"> XOF</span>
                      </div>
                    </div>

                    <div className="bg-gray-800 border-l-4 border-blue-500 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Conso moyenne
                      </div>
                      <div className="text-2xl font-bold text-white font-mono mt-2">
                        {kpis.avgFuelConsumption.toFixed(2)}
                        <span className="text-sm text-gray-400"> L/100km</span>
                      </div>
                    </div>
                  </div>
                </AccordionSection>

                {/* Week KPIs */}
                <AccordionSection title="7 derniers jours" subtitle="Tendance sur la semaine glissante"
                  right={<span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: kpis.weekNetMargin > 0 ? "#22c55e" : "#ef4444" }}>{Math.round(kpis.weekNetMargin).toLocaleString("fr-FR")} XOF</span>}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Revenus
                      </div>
                      <div className="text-2xl font-bold text-yellow-400 font-mono mt-2">
                        {Math.round(kpis.weekRevenue).toLocaleString("fr-FR")} XOF
                      </div>
                      <div className="text-xs text-gray-400 mt-2">
                        Moy/jour: {Math.round(kpis.weekAvgDailyRevenue).toLocaleString("fr-FR")} XOF
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Dépenses
                      </div>
                      <div className="text-2xl font-bold text-red-400 font-mono mt-2">
                        {Math.round(kpis.weekExpenses).toLocaleString("fr-FR")} XOF
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Marge nette
                      </div>
                      <div
                        className={`text-2xl font-bold font-mono mt-2 ${
                          kpis.weekNetMargin > 0
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {Math.round(kpis.weekNetMargin).toLocaleString("fr-FR")} XOF
                      </div>
                    </div>
                  </div>
                </AccordionSection>

                {/* Period KPIs */}
                <AccordionSection title={`Période sélectionnée (${periodFrom} → ${periodTo})`} subtitle="Totaux sur la plage de dates choisie"
                  right={<span className="text-sm font-mono font-bold flex-shrink-0" style={{ color: "#f5a623" }}>{Math.round(kpis.monthRevenue).toLocaleString("fr-FR")} XOF</span>}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Revenus totaux
                      </div>
                      <div className="text-2xl font-bold text-yellow-400 font-mono mt-2">
                        {Math.round(kpis.monthRevenue).toLocaleString("fr-FR")} XOF
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Dépenses totales
                      </div>
                      <div className="text-2xl font-bold text-red-400 font-mono mt-2">
                        {Math.round(kpis.monthExpenses).toLocaleString("fr-FR")} XOF
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Marge %
                      </div>
                      <div
                        className={`text-2xl font-bold font-mono mt-2 ${
                          kpis.monthMarginPercent > 0
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {kpis.monthMarginPercent.toFixed(1)}%
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Moy/chauffeur
                      </div>
                      <div className="text-2xl font-bold text-white font-mono mt-2">
                        {Math.round(kpis.avgRevenuePerDriver).toLocaleString("fr-FR")} XOF
                      </div>
                    </div>
                  </div>
                </AccordionSection>

                {/* ── CHARTS ── */}
                <div className="space-y-6">

                  {/* Chart 1 (Recettes par jour) promu en tête → section « Activité » sous le hero */}

                  {/* Chart 2 : Treemap dépenses par catégorie (style Power BI) */}
                  {kpis.expenseBreakdown.length > 0 && (
                    <div className="rounded-xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                      <h3 className="text-sm font-bold text-white mb-1">⛽ Dépenses par catégorie</h3>
                      <p className="text-xs mb-4" style={{ color: "var(--sk-t3)" }}>
                        Taille des blocs proportionnelle au montant sur la période
                      </p>
                      <ResponsiveContainer width="100%" height={280}>
                        <Treemap
                          data={kpis.expenseBreakdown.map((cat) => ({
                            name: cat.type, size: cat.amount, percent: cat.percent,
                          }))}
                          dataKey="size"
                          aspectRatio={16 / 9}
                          isAnimationActive={false}
                          content={<TreemapCell />}
                        >
                          <Tooltip contentStyle={{ backgroundColor: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any, _n: any, entry: any) => [
                              Number(v).toLocaleString("fr-FR") + " XOF (" +
                                (typeof entry?.payload?.percent === "number" ? entry.payload.percent.toFixed(1) : "—") + "%)",
                              entry?.payload?.name,
                            ]} />
                        </Treemap>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                        {kpis.expenseBreakdown.map((cat, i) => (
                          <div key={cat.type} className="flex items-center gap-1.5 text-xs">
                            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: EXPENSE_COLORS[i % EXPENSE_COLORS.length] }} />
                            <span style={{ color: "var(--sk-t2)" }}>{cat.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Chart 3 : KM par jour */}
                    {kpis.dailyRows.some((r) => r.km > 0) && (
                      <div className="rounded-xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                        <h3 className="text-sm font-bold text-white mb-1">🚗 KM parcourus / jour</h3>
                        <p className="text-xs mb-4" style={{ color: "var(--sk-t3)" }}>Calculé depuis les relevés kilométriques fin de journée. Moy: {kpis.avgKmPerDay} km/j</p>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={kpis.dailyRows.filter((r) => r.km > 0)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sk-surface)" vertical={false} />
                            <XAxis dataKey="date" stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(d) => d.slice(5)} />
                            <YAxis stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} />
                            <Tooltip contentStyle={{ backgroundColor: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderRadius: 8, fontSize: 12 }}
                              formatter={(v: any) => [v + " km", "KM"]} />
                            <Bar dataKey="km" fill="#3b82f6" name="KM / jour" radius={[3,3,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Chart 4 : Dépenses par jour (empilé par catégorie) */}
                    {kpis.dailyExpByCategory.length > 0 && kpis.expenseBreakdown.length > 0 && (
                      <div className="rounded-xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                        <h3 className="text-sm font-bold text-white mb-4">📅 Dépenses par jour</h3>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={kpis.dailyExpByCategory}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sk-surface)" vertical={false} />
                            <XAxis dataKey="date" stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(d) => d.slice(5)} />
                            <YAxis stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                            <Tooltip contentStyle={{ backgroundColor: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderRadius: 8, fontSize: 12 }}
                              formatter={(v: any) => [Number(v).toLocaleString("fr-FR") + " XOF"]} />
                            {kpis.expenseBreakdown.map((cat, i) => (
                              <Bar key={cat.type} dataKey={cat.type} stackId="a"
                                fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]}
                                name={cat.type} radius={i === kpis.expenseBreakdown.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>

                {/* Daily breakdown table */}
                {kpis.dailyRows.length > 0 && (
                  <DailyTable data={kpis.dailyRows} periodFrom={periodFrom} periodTo={periodTo} />
                )}

                {/* Rémunération estimée — adaptatif selon modèle */}
                {remunCfg && <RemunerationDashboardBlock kpis={kpis} cfg={remunCfg} />}

                {/* Per-driver allocation */}
                {kpis.driverAllocations.length > 0 && remunCfg && (
                  <DriverAllocationsBlock allocations={kpis.driverAllocations} cfg={remunCfg} />
                )}

                {/* Insights */}
                <InsightsPanel kpis={kpis} />
              </>
            )}
          </div>
        )}

        {tab === "pending" && (
          <ReportList
            reports={reports.filter((r) => r.status === "submitted")}
            expenses={expenses.filter((e) => (e.status || "submitted") === "submitted")}
            loading={loadingReports}
            emptyMsg="Aucune soumission en attente"
            title="Soumissions en attente"
            onRefresh={() => loadReports(filterDriverId || null)}
          />
        )}

        {tab === "history" && (
          <ReportList
            reports={reports}
            expenses={expenses}
            loading={loadingReports}
            emptyMsg="Aucun rapport"
            title="Tous les rapports"
            onRefresh={() => loadReports(filterDriverId || null)}
          />
        )}

        {tab === "history_old_delete" && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Tous les rapports</h2>
            {loadingReports ? (
              <div className="text-center text-gray-400 py-12">Chargement...</div>
            ) : reports.length === 0 ? (
              <div className="text-center text-gray-400 py-12">Aucun rapport</div>
            ) : (
              <div className="space-y-4">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="bg-gray-800 rounded-lg border border-gray-700 p-4"
                  >
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-700">
                      <div>
                        <div className="font-semibold text-white">{report.date}</div>
                        <div className="text-sm text-gray-400">
                          Chauffeur: {report.driver_id} · {report.expense_count} événements
                        </div>
                      </div>
                      <div>
                        <div className="font-bold text-yellow-500 font-mono">
                          {Math.round(report.net_after_expenses).toLocaleString("fr-FR")} XOF
                        </div>
                        <span
                          className={`inline-block text-xs font-semibold px-2 py-1 rounded mt-1 ${
                            report.status === "submitted"
                              ? "bg-yellow-900 bg-opacity-30 text-yellow-300"
                              : "bg-gray-700 text-gray-300"
                          }`}
                        >
                          {report.status === "submitted" ? "Soumis" : "Validé"}
                        </span>
                      </div>
                    </div>

                    {editingId === report.id ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Montant net (XOF)
                          </label>
                          <input
                            type="number"
                            value={editForm.net_after_expenses || ""}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                net_after_expenses: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(report.id)}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded text-sm"
                          >
                            ✓ Enregistrer
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditForm({});
                            }}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 rounded text-sm"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(report.id);
                          setEditForm({ net_after_expenses: report.net_after_expenses });
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded text-sm"
                      >
                        ✏️ Modifier
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "vehicles" && adminTenantId && <FleetTab tenantId={adminTenantId} />}
        {tab === "vehicles" && !adminTenantId && <div className="p-6 text-sm" style={{ color: "var(--sk-t3)" }}>Chargement...</div>}

        {tab === "drivers" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Gestion des conducteurs</h2>
              <button
                onClick={() => router.push("/admin/drivers")}
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-4 py-2 rounded"
              >
                Gérer les conducteurs →
              </button>
            </div>
            <p className="text-gray-400">
              Cliquez sur le bouton ci-dessus pour gérer les comptes conducteurs (créer, modifier, supprimer).
            </p>
          </div>
        )}

        {tab === "calendrier" && <CalendrierTab filterDriverId={filterDriverId} allDrivers={allDrivers} />}
        {tab === "payments" && adminTenantId && <PaymentsTab filterDriverId={filterDriverId} tenantId={adminTenantId} />}
        {tab === "avances" && adminTenantId && <AvancesTab filterDriverId={filterDriverId} tenantId={adminTenantId} />}
        {tab === "pilotage" && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🎯</div>
            <p className="text-white font-semibold mb-2">Module Pilotage</p>
            <p className="text-sm mb-4" style={{ color: "var(--sk-t3)" }}>Projections, P&L, simulation de flotte et insights avancés.</p>
            <a href="/admin/pilotage" className="inline-block px-6 py-3 rounded-xl text-sm font-bold text-black"
              style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>
              Ouvrir le module Pilotage →
            </a>
          </div>
        )}

        {tab === "journal" && <ActionLogsTab filterDriverId={filterDriverId} />}

        {tab === "import" && (
          <div className="p-6 max-w-2xl">
            <h2 className="text-xl font-bold text-white mb-2">Import d'historique</h2>
            <p className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>
              Importez vos données historiques (rapports journaliers) depuis un fichier CSV.
              Vous vérifiez les données — M3A procède à l'injection dans les 24h.
            </p>
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-3 px-5 py-3 rounded-xl font-bold text-sm text-black mb-8"
              style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}
            >
              <span>📥</span> Importer un fichier CSV
            </button>
            <ImportBatchList />
          </div>
        )}

        {tab === "remuneration" && adminTenantId && <RemunerationSettingsTab tenantId={adminTenantId} />}
        {tab === "remuneration" && !adminTenantId && (
          <div className="p-6 text-sm" style={{ color: "var(--sk-t3)" }}>Chargement du tenant...</div>
        )}

        {tab === "kyc" && adminTenantId && <KycAdminTab tenantId={adminTenantId} filterDriverId={filterDriverId} />}
        {tab === "kyc" && !adminTenantId && <div className="p-6 text-sm" style={{ color: "var(--sk-t3)" }}>Chargement...</div>}

        {tab === "settings" && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Paramètres</h2>
            <div className="rounded-2xl p-6 max-w-md" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
              <p className="text-sm mb-4" style={{ color: "var(--sk-t3)" }}>
                La configuration des commissions et du modèle de rémunération se trouve dans l'onglet <strong className="text-white">💼 Rémunération</strong>.
              </p>
            </div>
          </div>
        )}
        </div>{/* end max-w-none */}
        </div>{/* end lg:pl-[220px] */}
      </main>

      {showImportModal && <ImportHistoriqueModal onClose={() => setShowImportModal(false)} />}
    </div>
  );
}

/* ─── ImportBatchList — historique des imports du tenant ─── */
function ImportBatchList() {
  const [batches, setBatches] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/admin/import")
      .then((r) => r.json())
      .then((d) => { setBatches(d.batches ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const statusLabel: Record<string, { label: string; color: string; bg: string }> = {
    pending_admin_review: { label: "En cours de saisie", color: "#92400e", bg: "#fef3c7" },
    admin_confirmed:      { label: "En attente M3A",    color: "#1d4ed8", bg: "#dbeafe" },
    injected:             { label: "Injecté",            color: "#15803d", bg: "#dcfce7" },
    rejected:             { label: "Rejeté",             color: "#dc2626", bg: "#fee2e2" },
  };

  if (loading) return <div style={{ color: "var(--sk-t3)", fontSize: 13 }}>Chargement…</div>;
  if (batches.length === 0) return (
    <div style={{ color: "var(--sk-t3)", fontSize: 13 }}>
      Aucun import pour l'instant. Cliquez sur "Importer un fichier CSV" pour commencer.
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--sk-t2)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
        Historique des imports
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {batches.map((b) => {
          const s = statusLabel[b.status] ?? { label: b.status, color: "var(--sk-t3)", bg: "#f5f4f0" };
          return (
            <div key={b.id} style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderRadius: 12, padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                    {b.date_from} → {b.date_to}
                    <span style={{ marginLeft: 8, fontSize: 11, color: "var(--sk-t3)" }}>
                      ({b.valid_count}/{b.row_count} lignes valides)
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sk-t3)" }}>
                    {b.drivers_found?.join(", ") || "—"}
                    {b.duplicate_count > 0 && ` · ${b.duplicate_count} doublon(s)`}
                    {b.error_count > 0 && ` · ${b.error_count} erreur(s)`}
                  </div>
                  {b.status === "injected" && (
                    <div style={{ fontSize: 11, color: "#22c55e", marginTop: 4 }}>
                      ✓ {b.injected_count} rapports injectés le {new Date(b.injected_at).toLocaleDateString("fr-FR")}
                    </div>
                  )}
                  {b.status === "rejected" && b.reject_reason && (
                    <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>Motif : {b.reject_reason}</div>
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 100, color: s.color, background: s.bg, flexShrink: 0 }}>
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SHARED FORM HELPERS (admin) ─────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--sk-t3)" }}>{label}</div>
      {children}
    </div>
  );
}

function InpText({ type, placeholder, value, onChange }: { type: string; placeholder?: string; value: string; onChange: (v: string) => void }) {
  return (
    <input type={type} placeholder={placeholder} value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl px-3 py-2 text-sm outline-none"
      style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }} />
  );
}

// ─── FLEET TAB ───────────────────────────────────────
const VEHICLE_STATUS_META: Record<string, { label: string; color: string }> = {
  active:      { label: "Actif",        color: "#22c55e" },
  maintenance: { label: "Maintenance",  color: "#f5a623" },
  inactive:    { label: "Inactif",      color: "var(--sk-t3)" },
  sold:        { label: "Vendu",        color: "var(--sk-t4)" },
};

const MAINT_TYPE_META: Record<string, string> = {
  maintenance:       "🔧 Entretien",
  reparation:        "🔨 Réparation",
  accident:          "⚠️ Accident",
  visite_technique:  "📋 Visite technique",
  vidange:           "🛢️ Vidange",
  autre:             "📌 Autre",
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ label, dateStr }: { label: string; dateStr: string | null }) {
  const days = daysUntil(dateStr);
  const color = days === null ? "var(--sk-t4)" : days < 0 ? "#ef4444" : days < 30 ? "#f5a623" : "#22c55e";
  const text = days === null ? "Non renseigné" : days < 0 ? `Expiré (${Math.abs(days)}j)` : days === 0 ? "Expire aujourd'hui" : `${days}j`;
  return (
    <div className="text-[10px]">
      <span style={{ color: "var(--sk-t3)" }}>{label} : </span>
      <span style={{ color }}>{text}</span>
    </div>
  );
}

const EMPTY_VEH = { plate: "", make: "", model: "", year: "", color: "", fuel_type: "essence", transmission: "manuelle", vin: "", mileage: "0", status: "active", insurance_company: "", insurance_number: "", insurance_expiry: "", visite_expiry: "", notes: "", driver_id: "" };

function FleetTab({ tenantId }: { tenantId: string }) {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [maintenance, setMaintenance] = useState<any[]>([]);
  const [form, setForm] = useState({ ...EMPTY_VEH });
  const [maintForm, setMaintForm] = useState({ type: "maintenance", title: "", description: "", cost: "0", mileage_at: "", date: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const [savingMaint, setSavingMaint] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const supabase = (createClient as any)();
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

  const loadVehicles = async () => {
    const { data } = await supabase.from("vehicles").select("*").eq("tenant_id", tenantId).order("plate");
    setVehicles(data || []);
  };

  const loadDrivers = async () => {
    const { data } = await supabase.from("profiles").select("id,full_name,driver_id").eq("tenant_id", tenantId).eq("role", "driver").order("full_name");
    setDrivers(data || []);
  };

  const loadVehicle = async (id: string) => {
    const [{ data: v }, { data: m }] = await Promise.all([
      supabase.from("vehicles").select("*").eq("id", id).single(),
      supabase.from("vehicle_maintenance").select("*").eq("vehicle_id", id).order("date", { ascending: false }),
    ]);
    setVehicle(v);
    setMaintenance(m || []);
    if (v) setForm({ plate: v.plate || "", make: v.make || "", model: v.model || "", year: String(v.year || ""), color: v.color || "", fuel_type: v.fuel_type || "essence", transmission: v.transmission || "manuelle", vin: v.vin || "", mileage: String(v.mileage || 0), status: v.status || "active", insurance_company: v.insurance_company || "", insurance_number: v.insurance_number || "", insurance_expiry: v.insurance_expiry || "", visite_expiry: v.visite_expiry || "", notes: v.notes || "", driver_id: v.driver_id || "" });
  };

  useEffect(() => { loadVehicles(); loadDrivers(); }, [tenantId]);

  const selectVehicle = async (id: string) => { setSelected(id); setShowForm(false); setShowMaintForm(false); await loadVehicle(id); };

  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const saveVehicle = async () => {
    if (!form.plate) { alert("Plaque requise"); return; }
    setSaving(true);
    const payload = { tenant_id: tenantId, plate: form.plate, make: form.make, model: form.model, year: form.year ? parseInt(form.year) : null, color: form.color, fuel_type: form.fuel_type, transmission: form.transmission, vin: form.vin, mileage: parseInt(form.mileage) || 0, status: form.status, insurance_company: form.insurance_company, insurance_number: form.insurance_number, insurance_expiry: form.insurance_expiry || null, visite_expiry: form.visite_expiry || null, notes: form.notes, driver_id: form.driver_id || null };
    if (isNew) {
      const { data } = await supabase.from("vehicles").insert(payload).select().single();
      await loadVehicles();
      if (data) { setSelected(data.id); await loadVehicle(data.id); }
    } else {
      await supabase.from("vehicles").update(payload).eq("id", selected);
      await loadVehicles();
      await loadVehicle(selected!);
    }
    setSaving(false);
    setShowForm(false);
    setIsNew(false);
  };

  const saveMaint = async () => {
    if (!maintForm.title) { alert("Titre requis"); return; }
    setSavingMaint(true);
    const driver = drivers.find((d) => d.id === vehicle?.driver_id);
    await supabase.from("vehicle_maintenance").insert({ vehicle_id: selected, tenant_id: tenantId, driver_id: driver?.id || null, type: maintForm.type, title: maintForm.title, description: maintForm.description, cost: parseFloat(maintForm.cost) || 0, mileage_at: maintForm.mileage_at ? parseInt(maintForm.mileage_at) : null, date: maintForm.date, status: "done" });
    setMaintForm({ type: "maintenance", title: "", description: "", cost: "0", mileage_at: "", date: new Date().toISOString().slice(0, 10) });
    setSavingMaint(false);
    setShowMaintForm(false);
    await loadVehicle(selected!);
  };

  const totalMaintCost = maintenance.reduce((s, m) => s + (m.cost || 0), 0);
  const assignedDriver = drivers.find((d) => d.id === vehicle?.driver_id);

  // ── VEHICLE DETAIL VIEW ──
  if (selected && vehicle) {
    const statusMeta = VEHICLE_STATUS_META[vehicle.status] || VEHICLE_STATUS_META.active;
    return (
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelected(null); setVehicle(null); setShowForm(false); }} className="text-sm px-3 py-1.5 rounded-lg" style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>← Flotte</button>
          <div className="flex-1">
            <div className="font-bold text-white text-lg">{vehicle.plate}</div>
            <div className="text-xs" style={{ color: "var(--sk-t3)" }}>{vehicle.make} {vehicle.model} {vehicle.year}</div>
          </div>
          <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: `${statusMeta.color}18`, color: statusMeta.color }}>{statusMeta.label}</span>
          <button onClick={() => setShowForm(!showForm)} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "rgba(245,166,35,.1)", color: "#f5a623", border: "1px solid rgba(245,166,35,.2)" }}>✏️ Modifier</button>
        </div>

        {/* Edit form */}
        {showForm && (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sk-t4)" }}>Modifier le véhicule</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plaque *"><InpText type="text" value={form.plate} onChange={(v) => setF("plate", v)} /></Field>
              <Field label="Statut">
                <select value={form.status} onChange={(e) => setF("status", e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }}>
                  {Object.entries(VEHICLE_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Marque"><InpText type="text" value={form.make} onChange={(v) => setF("make", v)} /></Field>
              <Field label="Modèle"><InpText type="text" value={form.model} onChange={(v) => setF("model", v)} /></Field>
              <Field label="Année"><InpText type="number" value={form.year} onChange={(v) => setF("year", v)} /></Field>
              <Field label="Couleur"><InpText type="text" value={form.color} onChange={(v) => setF("color", v)} /></Field>
              <Field label="Carburant">
                <select value={form.fuel_type} onChange={(e) => setF("fuel_type", e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }}>
                  {["essence", "diesel", "hybride", "électrique", "gpl"].map((f) => <option key={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="Transmission">
                <select value={form.transmission} onChange={(e) => setF("transmission", e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }}>
                  {["manuelle", "automatique"].map((f) => <option key={f}>{f}</option>)}
                </select>
              </Field>
              <Field label="VIN / Châssis"><InpText type="text" value={form.vin} onChange={(v) => setF("vin", v)} /></Field>
              <Field label="Kilométrage"><InpText type="number" value={form.mileage} onChange={(v) => setF("mileage", v)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assureur"><InpText type="text" value={form.insurance_company} onChange={(v) => setF("insurance_company", v)} /></Field>
              <Field label="N° Police"><InpText type="text" value={form.insurance_number} onChange={(v) => setF("insurance_number", v)} /></Field>
              <Field label="Expir. assurance"><InpText type="date" value={form.insurance_expiry} onChange={(v) => setF("insurance_expiry", v)} /></Field>
              <Field label="Expir. visite tech."><InpText type="date" value={form.visite_expiry} onChange={(v) => setF("visite_expiry", v)} /></Field>
            </div>
            <Field label="Chauffeur assigné">
              <select value={form.driver_id} onChange={(e) => setF("driver_id", e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }}>
                <option value="">— Aucun —</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.driver_id})</option>)}
              </select>
            </Field>
            <Field label="Notes"><InpText type="text" value={form.notes} onChange={(v) => setF("notes", v)} /></Field>
            <button onClick={saveVehicle} disabled={saving} className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{ background: saving ? "#2a2f3d" : "linear-gradient(135deg,#f5a623,#e8951a)", color: saving ? "var(--sk-t3)" : "#000" }}>
              {saving ? "Enregistrement..." : "✓ Enregistrer"}
            </button>
          </div>
        )}

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-3" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--sk-t4)" }}>Documents</div>
            <ExpiryBadge label="Assurance" dateStr={vehicle.insurance_expiry} />
            <ExpiryBadge label="Visite tech." dateStr={vehicle.visite_expiry} />
            {vehicle.insurance_company && <div className="text-[10px] mt-1" style={{ color: "var(--sk-t3)" }}>Assureur : {vehicle.insurance_company}</div>}
          </div>
          <div className="rounded-2xl p-3" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--sk-t4)" }}>Stats</div>
            <div className="text-xs" style={{ color: "var(--sk-t2)" }}>Kilométrage : <span className="text-white font-semibold">{xof(vehicle.mileage)} km</span></div>
            <div className="text-xs mt-1" style={{ color: "var(--sk-t2)" }}>Coût maint. total : <span className="text-white font-semibold">{xof(totalMaintCost)} XOF</span></div>
            {assignedDriver && <div className="text-xs mt-1" style={{ color: "var(--sk-t2)" }}>Chauffeur : <span className="text-white">{assignedDriver.full_name}</span></div>}
          </div>
        </div>

        {/* Maintenance */}
        <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: "var(--sk-t4)" }}>Historique maintenance</div>
            <button onClick={() => setShowMaintForm(!showMaintForm)} className="text-xs px-3 py-1 rounded-lg font-semibold" style={{ background: "rgba(245,166,35,.1)", color: "#f5a623", border: "1px solid rgba(245,166,35,.2)" }}>+ Ajouter</button>
          </div>

          {showMaintForm && (
            <div className="mb-4 p-3 rounded-xl space-y-2" style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d" }}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Type">
                  <select value={maintForm.type} onChange={(e) => setMaintForm((f) => ({ ...f, type: e.target.value }))} className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: "var(--sk-bg)", border: "1px solid #2a2f3d", color: "#fff" }}>
                    {Object.entries(MAINT_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Date"><InpText type="date" value={maintForm.date} onChange={(v) => setMaintForm((f) => ({ ...f, date: v }))} /></Field>
              </div>
              <Field label="Titre *"><InpText type="text" placeholder="ex: Vidange + filtres" value={maintForm.title} onChange={(v) => setMaintForm((f) => ({ ...f, title: v }))} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Coût (XOF)"><InpText type="number" value={maintForm.cost} onChange={(v) => setMaintForm((f) => ({ ...f, cost: v }))} /></Field>
                <Field label="Km au compteur"><InpText type="number" value={maintForm.mileage_at} onChange={(v) => setMaintForm((f) => ({ ...f, mileage_at: v }))} /></Field>
              </div>
              <Field label="Description"><InpText type="text" placeholder="Détails..." value={maintForm.description} onChange={(v) => setMaintForm((f) => ({ ...f, description: v }))} /></Field>
              <button onClick={saveMaint} disabled={savingMaint} className="w-full py-2 rounded-xl text-xs font-bold text-black" style={{ background: savingMaint ? "#2a2f3d" : "linear-gradient(135deg,#f5a623,#e8951a)" }}>
                {savingMaint ? "..." : "Enregistrer"}
              </button>
            </div>
          )}

          {maintenance.length === 0 && <div className="text-xs text-center py-3" style={{ color: "var(--sk-t4)" }}>Aucun historique</div>}
          <div className="space-y-2">
            {maintenance.map((m) => (
              <div key={m.id} className="rounded-xl px-3 py-2.5" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">{MAINT_TYPE_META[m.type] || m.type} — {m.title}</div>
                    {m.description && <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t3)" }}>{m.description}</div>}
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t4)" }}>{m.date} {m.mileage_at ? `· ${xof(m.mileage_at)} km` : ""}</div>
                  </div>
                  <div className="text-xs font-semibold flex-shrink-0 ml-2" style={{ color: m.cost > 0 ? "#f5a623" : "var(--sk-t4)" }}>
                    {m.cost > 0 ? `-${xof(m.cost)}` : "—"} XOF
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── VEHICLE LIST VIEW ──
  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Gestion de flotte</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--sk-t3)" }}>{vehicles.length} véhicule{vehicles.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => { setIsNew(true); setForm({ ...EMPTY_VEH }); setSelected("__new__"); setVehicle({}); setMaintenance([]); setShowForm(true); }}
          className="text-sm px-4 py-2 rounded-xl font-bold text-black"
          style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>
          + Ajouter
        </button>
      </div>

      {/* New vehicle form (inline) */}
      {selected === "__new__" && showForm && (
        <div className="rounded-2xl p-4 mb-4 space-y-3" style={{ background: "var(--sk-bg)", border: "1px solid rgba(245,166,35,.3)" }}>
          <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: "#f5a623" }}>Nouveau véhicule</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plaque *"><InpText type="text" value={form.plate} onChange={(v) => setF("plate", v)} /></Field>
            <Field label="Marque"><InpText type="text" value={form.make} onChange={(v) => setF("make", v)} /></Field>
            <Field label="Modèle"><InpText type="text" value={form.model} onChange={(v) => setF("model", v)} /></Field>
            <Field label="Année"><InpText type="number" value={form.year} onChange={(v) => setF("year", v)} /></Field>
            <Field label="Couleur"><InpText type="text" value={form.color} onChange={(v) => setF("color", v)} /></Field>
            <Field label="Carburant">
              <select value={form.fuel_type} onChange={(e) => setF("fuel_type", e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }}>
                {["essence", "diesel", "hybride", "électrique", "gpl"].map((f) => <option key={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="Expir. assurance"><InpText type="date" value={form.insurance_expiry} onChange={(v) => setF("insurance_expiry", v)} /></Field>
            <Field label="Expir. visite tech."><InpText type="date" value={form.visite_expiry} onChange={(v) => setF("visite_expiry", v)} /></Field>
          </div>
          <Field label="Chauffeur assigné">
            <select value={form.driver_id} onChange={(e) => setF("driver_id", e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }}>
              <option value="">— Aucun —</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.driver_id})</option>)}
            </select>
          </Field>
          <div className="flex gap-2">
            <button onClick={saveVehicle} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-black" style={{ background: saving ? "#2a2f3d" : "linear-gradient(135deg,#f5a623,#e8951a)" }}>
              {saving ? "..." : "Créer le véhicule"}
            </button>
            <button onClick={() => { setSelected(null); setShowForm(false); setIsNew(false); }} className="px-4 rounded-xl text-sm" style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {vehicles.length === 0 && !showForm && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🚗</div>
          <p className="text-white font-semibold mb-1">Aucun véhicule enregistré</p>
          <p className="text-sm" style={{ color: "var(--sk-t3)" }}>Ajoutez votre premier véhicule avec le bouton ci-dessus.</p>
        </div>
      )}

      <div className="space-y-2">
        {vehicles.map((v) => {
          const sm = VEHICLE_STATUS_META[v.status] || VEHICLE_STATUS_META.active;
          const insuranceDays = daysUntil(v.insurance_expiry);
          const visiteDays = daysUntil(v.visite_expiry);
          const hasAlert = (insuranceDays !== null && insuranceDays < 30) || (visiteDays !== null && visiteDays < 30);
          const driver = drivers.find((d) => d.id === v.driver_id);
          return (
            <button key={v.id} onClick={() => selectVehicle(v.id)}
              className="w-full rounded-xl px-4 py-3 flex items-center gap-3 transition-all text-left"
              style={{ background: "var(--sk-bg)", border: `1px solid ${hasAlert ? "rgba(245,166,35,.3)" : "var(--sk-surface)"}` }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: "var(--sk-surface)" }}>🚗</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{v.plate}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${sm.color}18`, color: sm.color }}>{sm.label}</span>
                  {hasAlert && <span className="text-[10px]" style={{ color: "#f5a623" }}>⚠️</span>}
                </div>
                <div className="text-xs" style={{ color: "var(--sk-t3)" }}>{v.make} {v.model} {v.year} {driver ? `· ${driver.full_name}` : ""}</div>
                <div className="flex gap-3 mt-0.5">
                  {v.insurance_expiry && <ExpiryBadge label="Ass." dateStr={v.insurance_expiry} />}
                  {v.visite_expiry && <ExpiryBadge label="Visite" dateStr={v.visite_expiry} />}
                </div>
              </div>
              <span className="text-xs" style={{ color: "var(--sk-t4)" }}>›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── KYC ADMIN TAB ───────────────────────────────────
const KYC_DOC_DEFS = [
  { type: "cni_recto",    label: "CNI Recto" },
  { type: "cni_verso",    label: "CNI Verso" },
  { type: "permis_recto", label: "Permis Recto" },
  { type: "permis_verso", label: "Permis Verso" },
  { type: "contrat",      label: "Contrat" },
  { type: "photo_profil", label: "Photo" },
];

const ONBOARDING_STATUS_COLORS: Record<string, string> = {
  incomplete: "var(--sk-t3)",
  pending:    "var(--sk-t3)",
  in_review:  "#3b82f6",
  approved:   "#22c55e",
  rejected:   "#ef4444",
};

const LEVEL_OPTS = [
  { value: "debutant",      label: "Débutant" },
  { value: "intermediaire", label: "Intermédiaire" },
  { value: "confirme",      label: "Confirmé" },
];

function KycAdminTab({ tenantId, filterDriverId = "" }: { tenantId: string; filterDriverId?: string }) {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [driverDocs, setDriverDocs] = useState<any[]>([]);
  const [driverProfile, setDriverProfile] = useState<any>(null);
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [level, setLevel] = useState("debutant");
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<Record<string, string>>({});
  const supabase = (createClient as any)();

  const loadDrivers = async () => {
    const { data } = await supabase.from("profiles").select("id,full_name,driver_id,driver_level,onboarding_status,onboarding_submitted,joined_at").eq("tenant_id", tenantId).eq("role", "driver").order("full_name");
    setDrivers(data || []);
  };

  const loadDriver = async (id: string) => {
    const [{ data: p }, { data: docs }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", id).single(),
      supabase.from("kyc_documents").select("*").eq("driver_id", id),
    ]);
    setDriverProfile(p);
    setDriverDocs(docs || []);
    setNotes(p?.onboarding_notes || "");
    setLevel(p?.driver_level || "debutant");
    setProfileForm({
      full_name: p?.full_name || "", address: p?.address || "", city: p?.city || "",
      birth_date: p?.birth_date || "", nationality: p?.nationality || "",
      license_number: p?.license_number || "", license_expiry: p?.license_expiry || "",
      years_experience: String(p?.years_experience ?? ""),
      emergency_name: p?.emergency_name || "", emergency_phone: p?.emergency_phone || "",
      emergency_relation: p?.emergency_relation || "", phone_number: p?.phone_number || "",
    });
    const urls: Record<string, string> = {};
    for (const doc of (docs || [])) {
      const { data: su } = await supabase.storage.from("kyc-documents").createSignedUrl(doc.file_path, 3600);
      if (su?.signedUrl) urls[doc.doc_type] = su.signedUrl;
    }
    setDocUrls(urls);
  };

  const uploadDoc = async (docType: string, file: File) => {
    if (!selected) return;
    setUploadingDoc(docType);
    try {
      const ext = file.name.split(".").pop();
      const path = `${selected}/${docType}_${Date.now()}.${ext}`;

      // Upload via server route (service role — no storage RLS needed)
      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", path);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");

      const existing = driverDocs.find((d) => d.doc_type === docType);
      if (existing) {
        const { error: updErr } = await supabase.from("kyc_documents").update({ file_path: path, file_name: file.name, file_size: file.size, status: "pending", uploaded_at: new Date().toISOString() }).eq("id", existing.id);
        if (updErr) throw new Error(`DB update: ${updErr.message}`);
      } else {
        const { error: insErr } = await supabase.from("kyc_documents").insert({ driver_id: selected, tenant_id: tenantId, doc_type: docType, file_path: path, file_name: file.name, file_size: file.size, status: "pending" });
        if (insErr) throw new Error(`DB insert: ${insErr.message}`);
      }
      await loadDriver(selected);
    } catch (err: any) {
      alert("Upload KYC échoué : " + err.message);
    } finally {
      setUploadingDoc(null);
    }
  };

  const saveProfile = async () => {
    if (!selected) return;
    setSaving(true);
    await supabase.from("profiles").update({
      ...profileForm,
      years_experience: profileForm.years_experience ? parseInt(profileForm.years_experience) : 0,
      updated_at: new Date().toISOString(),
    }).eq("id", selected);
    await loadDriver(selected);
    setEditingProfile(false);
    setSaving(false);
  };

  useEffect(() => { loadDrivers(); }, [tenantId]);

  // Filtre chauffeur global → auto-sélection du chauffeur
  useEffect(() => {
    if (filterDriverId) { setSelected(filterDriverId); loadDriver(filterDriverId); }
    else { setSelected(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDriverId]);

  const selectDriver = async (id: string) => {
    setSelected(id);
    setDocUrls({});
    await loadDriver(id);
  };

  const updateDocStatus = async (docId: string, status: "approved" | "rejected") => {
    await supabase.from("kyc_documents").update({ status, reviewed_at: new Date().toISOString() }).eq("id", docId);
    await loadDriver(selected!);
  };

  const setOnboardingStatus = async (status: string) => {
    setSaving(true);
    await supabase.from("profiles").update({ onboarding_status: status, onboarding_reviewed: new Date().toISOString(), onboarding_notes: notes, driver_level: level }).eq("id", selected);
    await loadDriver(selected!);
    await loadDrivers();
    setSaving(false);
  };

  const autoLevel = () => {
    if (!driverProfile) return;
    const trips = driverProfile.total_trips || 0;
    const joined = driverProfile.joined_at ? new Date(driverProfile.joined_at) : new Date();
    const months = Math.floor((Date.now() - joined.getTime()) / (1000 * 60 * 60 * 24 * 30));
    if (trips >= 500 || months >= 12) setLevel("confirme");
    else if (trips >= 100 || months >= 3) setLevel("intermediaire");
    else setLevel("debutant");
  };

  const statusBadge = (s: string) => (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: `${ONBOARDING_STATUS_COLORS[s] || "var(--sk-t3)"}18`, color: ONBOARDING_STATUS_COLORS[s] || "var(--sk-t3)" }}>
      {s === "approved" ? "Validé" : s === "rejected" ? "Rejeté" : s === "in_review" ? "En revue" : s === "incomplete" ? "Incomplet" : "Pending"}
    </span>
  );

  if (selected && driverProfile) {
    const completedDocs = KYC_DOC_DEFS.filter((d) => driverDocs.find((x) => x.doc_type === d.type));
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setSelected(null)} className="text-sm px-3 py-1.5 rounded-lg" style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>← Retour</button>
          <div>
            <div className="font-bold text-white">{driverProfile.full_name}</div>
            <div className="text-xs" style={{ color: "var(--sk-t3)" }}>{driverProfile.driver_id} · {completedDocs.length}/{KYC_DOC_DEFS.length} docs</div>
          </div>
          <div className="ml-auto">{statusBadge(driverProfile.onboarding_status || "incomplete")}</div>
        </div>

        {/* Personal info */}
        <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: "var(--sk-t4)" }}>Informations</div>
            <button onClick={() => setEditingProfile(!editingProfile)} className="text-xs px-3 py-1 rounded-lg font-semibold"
              style={{ background: editingProfile ? "rgba(245,166,35,.15)" : "var(--sk-surface)", color: editingProfile ? "#f5a623" : "var(--sk-t2)" }}>
              {editingProfile ? "Annuler" : "✏️ Modifier"}
            </button>
          </div>
          {editingProfile ? (
            <div className="space-y-2">
              {[
                ["Nom complet", "full_name", "text"], ["Téléphone", "phone_number", "text"],
                ["Adresse", "address", "text"], ["Ville", "city", "text"],
                ["Date naissance", "birth_date", "date"], ["Nationalité", "nationality", "text"],
                ["N° permis", "license_number", "text"], ["Expiration permis", "license_expiry", "date"],
                ["Années d'expérience", "years_experience", "number"],
                ["Contact urgence", "emergency_name", "text"], ["Tél urgence", "emergency_phone", "text"],
                ["Relation", "emergency_relation", "text"],
              ].map(([label, key, type]) => (
                <div key={key as string}>
                  <div className="text-[10px] mb-1" style={{ color: "var(--sk-t3)" }}>{label as string}</div>
                  <input type={type as string} value={profileForm[key as string] || ""} onChange={(e) => setProfileForm(p => ({ ...p, [key as string]: e.target.value }))}
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                    style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "var(--sk-t1)" }} />
                </div>
              ))}
              <button onClick={saveProfile} disabled={saving} className="w-full py-2.5 rounded-xl text-xs font-bold mt-2"
                style={{ background: "rgba(245,166,35,.15)", color: "#f5a623", border: "1px solid rgba(245,166,35,.3)" }}>
                {saving ? "Sauvegarde..." : "💾 Sauvegarder la fiche"}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {[["Adresse", driverProfile.address], ["Ville", driverProfile.city], ["Naissance", driverProfile.birth_date], ["Nationalité", driverProfile.nationality], ["Permis", driverProfile.license_number], ["Expiration", driverProfile.license_expiry], ["Expérience", driverProfile.years_experience != null ? `${driverProfile.years_experience} ans` : "—"], ["Contact urgence", driverProfile.emergency_name], ["Tél urgence", driverProfile.emergency_phone], ["Relation", driverProfile.emergency_relation]].map(([k, v]) => (
                <div key={k as string}><span style={{ color: "var(--sk-t3)" }}>{k} : </span><span className="text-white">{(v as string) || "—"}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>Documents KYC</div>
          <div className="space-y-3">
            {KYC_DOC_DEFS.map((def) => {
              const doc = driverDocs.find((d) => d.doc_type === def.type);
              const url = docUrls[def.type];
              const docStatusColor = doc?.status === "approved" ? "#22c55e" : doc?.status === "rejected" ? "#ef4444" : doc ? "#f5a623" : "#2a2f3d";
              return (
                <div key={def.type} className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: `1px solid ${docStatusColor}30` }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-white">{def.label}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {doc ? (
                        <>
                          <span className="text-[10px]" style={{ color: docStatusColor }}>{doc.status === "approved" ? "✓ Approuvé" : doc.status === "rejected" ? "✗ Rejeté" : "⏳ En attente"}</span>
                          {doc.status !== "approved" && <button onClick={() => updateDocStatus(doc.id, "approved")} className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{ background: "rgba(34,197,94,.1)", color: "#22c55e" }}>Approuver</button>}
                          {doc.status !== "rejected" && <button onClick={() => updateDocStatus(doc.id, "rejected")} className="text-[10px] px-2 py-0.5 rounded font-semibold" style={{ background: "rgba(239,68,68,.1)", color: "#ef4444" }}>Rejeter</button>}
                        </>
                      ) : (
                        <span className="text-[10px]" style={{ color: "var(--sk-t4)" }}>Non uploadé</span>
                      )}
                      <label className="text-[10px] px-2 py-0.5 rounded font-semibold cursor-pointer" style={{ background: "rgba(245,166,35,.1)", color: uploadingDoc === def.type ? "var(--sk-t3)" : "#f5a623" }}>
                        {uploadingDoc === def.type ? "⏳" : doc ? "🔄 Remplacer" : "📎 Uploader"}
                        <input type="file" accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,video/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(def.type, f); e.target.value = ""; }}
                          disabled={!!uploadingDoc} />
                      </label>
                    </div>
                  </div>
                  {url && (
                    url.toLowerCase().includes(".pdf") ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs underline" style={{ color: "#f5a623" }}>📄 Voir le PDF</a>
                    ) : (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt={def.label} className="w-full max-h-48 object-contain rounded-lg" style={{ background: "var(--sk-surface)" }} />
                      </a>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Decision */}
        <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>Décision & Niveau</div>
          <div className="space-y-3">
            <div>
              <div className="text-xs mb-1.5" style={{ color: "var(--sk-t2)" }}>Niveau chauffeur</div>
              <div className="flex gap-2">
                {LEVEL_OPTS.map((o) => (
                  <button key={o.value} onClick={() => setLevel(o.value)}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                    style={{ background: level === o.value ? "rgba(245,166,35,.15)" : "var(--sk-deep)", color: level === o.value ? "#f5a623" : "var(--sk-t3)", border: `1px solid ${level === o.value ? "rgba(245,166,35,.3)" : "#2a2f3d"}` }}>
                    {o.label}
                  </button>
                ))}
              </div>
              <button onClick={autoLevel} className="mt-2 text-[10px] w-full py-1 rounded-lg" style={{ background: "var(--sk-surface)", color: "var(--sk-t3)" }}>
                Auto-suggérer selon l'expérience
              </button>
            </div>
            <div>
              <div className="text-xs mb-1.5" style={{ color: "var(--sk-t2)" }}>Note / motif de rejet</div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optionnel — visible du chauffeur si rejeté"
                className="w-full rounded-xl px-3 py-2 text-xs resize-none outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid #2a2f3d", color: "#fff" }} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setOnboardingStatus("approved")} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
                style={{ background: "rgba(34,197,94,.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,.2)" }}>
                ✓ Valider le dossier
              </button>
              <button onClick={() => setOnboardingStatus("rejected")} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
                style={{ background: "rgba(239,68,68,.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,.2)" }}>
                ✗ Rejeter
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold text-white mb-1">KYC & Onboarding</h2>
      <p className="text-xs mb-4" style={{ color: "var(--sk-t3)" }}>Vérification des dossiers chauffeurs</p>
      {drivers.length === 0 && <div className="text-sm text-center py-8" style={{ color: "var(--sk-t4)" }}>Aucun chauffeur enregistré</div>}
      <div className="space-y-2">
        {drivers.map((d) => {
          const s = d.onboarding_status || "incomplete";
          const sc = ONBOARDING_STATUS_COLORS[s] || "var(--sk-t3)";
          return (
            <button key={d.id} onClick={() => selectDriver(d.id)} className="w-full rounded-xl px-4 py-3 flex items-center gap-3 transition-all text-left"
              style={{ background: "var(--sk-bg)", border: `1px solid ${sc}20` }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm text-black flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>
                {d.full_name?.[0] || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{d.full_name}</div>
                <div className="text-[10px]" style={{ color: "var(--sk-t3)" }}>{d.driver_id}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {statusBadge(s)}
                <span className="text-[10px]" style={{ color: "var(--sk-t4)" }}>›</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── REPORT LIST ─────────────────────────────────────
function ReportList({ reports, expenses, loading, emptyMsg, title, onRefresh }: {
  reports: any[]; expenses: any[]; loading: boolean; emptyMsg: string; title: string; onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"reports" | "expenses">("reports");
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)) + " XOF";

  const isRepos = (r: any) => typeof r.comment === "string" && r.comment.startsWith("[REPOS]");

  const statusBadge = (s: string) => {
    const map: Record<string, [string, string]> = {
      submitted: ["#f5a623", "rgba(245,166,35,.12)"],
      approved: ["#22c55e", "rgba(34,197,94,.12)"],
      rejected: ["#ef4444", "rgba(239,68,68,.12)"],
    };
    const [color, bg] = map[s] ?? ["var(--sk-t2)", "var(--sk-surface)"];
    const label = s === "submitted" ? "En attente" : s === "approved" ? "Validé" : s === "rejected" ? "Rejeté" : s;
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{label}</span>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        <div className="flex gap-2">
          {(["reports", "expenses"] as const).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className="text-sm px-4 py-1.5 rounded-lg font-semibold"
              style={{ background: activeTab === t ? "#f5a623" : "var(--sk-surface)", color: activeTab === t ? "#000" : "var(--sk-t3)" }}>
              {t === "reports" ? `📋 Rapports (${reports.length})` : `💸 Dépenses (${expenses.length})`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12">Chargement...</div>
      ) : activeTab === "reports" ? (
        reports.length === 0 ? (
          <div className="text-center text-gray-400 py-12">{emptyMsg}</div>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <div key={r.id} className="rounded-xl border cursor-pointer transition-all hover:border-yellow-500/40"
                style={{ background: isRepos(r) ? "rgba(99,102,241,.04)" : "var(--sk-bg)", border: `1px solid ${isRepos(r) ? "rgba(99,102,241,.25)" : "var(--sk-surface)"}` }}
                onClick={() => setSelected(r)}>
                <div className="flex items-center justify-between p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-white text-sm">{r.date}</div>
                      {isRepos(r) && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,.15)", color: "#818cf8" }}>
                          🛌 REPOS
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>
                      {isRepos(r)
                        ? (r.comment?.replace("[REPOS]", "").trim() || "Jour de repos") + " · " + r.driver_id?.slice(0, 8) + "..."
                        : `${r.yango_trip_count ?? 0} courses · ${r.driver_id?.slice(0, 8)}...`}
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    {!isRepos(r) && <div className="font-mono font-bold text-sm text-white">{xof(r.net_after_expenses)}</div>}
                    {statusBadge(r.status)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        expenses.length === 0 ? (
          <div className="text-center text-gray-400 py-12">Aucune dépense</div>
        ) : (
          <div className="space-y-3">
            {expenses.map((e) => (
              <div key={e.id} className="rounded-xl border cursor-pointer transition-all hover:border-yellow-500/40"
                style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}
                onClick={() => setSelectedExpense(e)}>
                <div className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-semibold text-white text-sm">{e.category}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>
                      {e._profile?.full_name || e._profile?.driver_id || e.driver_id?.slice(0, 8)} · 📅 {e.expense_date || e.created_at?.slice(0, 10)}
                    </div>
                    {e.description && <div className="text-xs mt-0.5" style={{ color: "var(--sk-t4)" }}>{e.description}</div>}
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <div className="font-mono font-bold text-sm" style={{ color: "#ef4444" }}>-{xof(e.amount)}</div>
                    {statusBadge(e.status || "submitted")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {selected && (
        <ReportModal report={selected} onClose={() => setSelected(null)} onRefresh={() => { onRefresh(); setSelected(null); }} />
      )}

      {selectedExpense && (
        <ExpenseModal expense={selectedExpense} onClose={() => setSelectedExpense(null)} onRefresh={onRefresh} />
      )}
    </div>
  );
}

// ─── EXPENSE MODAL ───────────────────────────────────
function ExpenseModal({ expense, onClose, onRefresh }: { expense: any; onClose: () => void; onRefresh: () => void }) {
  const [uploads, setUploads] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(expense.status || "submitted");
  const [editAmount, setEditAmount] = useState(String(expense.amount || ""));
  const [editDate, setEditDate] = useState(expense.expense_date || expense.created_at?.slice(0, 10) || "");
  const [editCategory, setEditCategory] = useState(expense.category || "");
  const [editDesc, setEditDesc] = useState(expense.description || "");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)) + " XOF";
  const expenseTypes = ["Carburant", "Péage", "Contrôle routier", "Entretien", "Lavage", "Amende", "Solde Yango", "Autre"];

  const saveEdit = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({
        amount: parseFloat(editAmount) || expense.amount,
        expense_date: editDate || null,
        category: editCategory,
        description: editDesc || null,
      }).eq("id", expense.id);
      if (error) throw error;
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (status: "approved" | "rejected") => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({ status }).eq("id", expense.id);
      if (error) throw error;
      // Log action (fire-and-forget — non-critical)
      void supabase.from("action_logs").insert({
        tenant_id: expense.tenant_id, actor_role: "admin",
        entity_type: "expense", entity_id: expense.id, action: status,
        metadata: { category: expense.category, amount: expense.amount },
      });
      setCurrentStatus(status);
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("uploads").select("*")
        .eq("driver_id", expense.driver_id)
        .eq("file_type", "expense")
        .order("created_at", { ascending: false });
      const enriched = (data || [])
        .filter((u: any) => u.ref_id === expense.id || u.file_path?.includes(expense.id))
        .map((u: any) => {
          const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(u.file_path);
          return { ...u, publicUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(u.file_name) };
        });
      setUploads(enriched);
    })();
  }, [expense.id, expense.driver_id]);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      const rawPath = `expense/${expense.driver_id}/${expense.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      fd.append("file", file);
      fd.append("path", rawPath);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");
      const supabase = createClient() as any;
      await supabase.from("uploads").insert({ driver_id: expense.driver_id, file_name: file.name, file_path: result.path, file_type: "expense", file_size: file.size });
      setUploads((p) => [...p, { file_name: file.name, publicUrl: result.signedUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name) }]);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setUploading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.75)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--sk-surface)" }}>
          <div>
            <div className="font-bold text-white">{expense.category}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--sk-t3)" }}>
              {expense.profiles?.full_name || expense.driver_id?.slice(0, 8)} · 📅 {expense.expense_date || expense.created_at?.slice(0, 10)}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {/* Editable fields */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--sk-t3)" }}>Catégorie</label>
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
                  {expenseTypes.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--sk-t3)" }}>Montant (XOF)</label>
                <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "#ef4444" }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--sk-t3)" }}>📅 Date déclarée</label>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "dark" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--sk-t4)" }}>🕐 Date soumission</label>
                <div className="rounded-xl px-3 py-2 text-sm font-mono" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t4)" }}>
                  {expense.created_at?.slice(0, 10)}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--sk-t3)" }}>Description</label>
              <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Détails..." className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }} />
            </div>
            <button onClick={saveEdit} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold"
              style={{ background: saving ? "var(--sk-surface)" : "rgba(59,130,246,.15)", border: "1px solid rgba(59,130,246,.3)", color: "#3b82f6" }}>
              {saving ? "..." : "💾 Enregistrer les modifications"}
            </button>
          </div>

          {/* Pièces jointes */}
          <div className="rounded-xl p-4" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>📎 Pièces jointes</div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => cameraRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ background: uploading ? "var(--sk-surface)" : "rgba(245,166,35,.08)", borderColor: "rgba(245,166,35,.25)", color: uploading ? "#374151" : "#f5a623" }}>
                {uploading ? "⏳" : "📷 Photo"}
              </button>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border-dashed border-2"
                style={{ background: "transparent", borderColor: "#2a2f3d", color: uploading ? "#f5a623" : "var(--sk-t3)" }}>
                {uploading ? "⏳ Upload..." : "📁 Fichier / Galerie"}
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { Array.from(e.target.files || []).forEach(uploadFile); e.target.value = ""; }} />
            <input ref={fileRef} type="file" accept="image/*,.pdf" multiple className="hidden"
              onChange={(e) => { Array.from(e.target.files || []).forEach(uploadFile); e.target.value = ""; }} />
            {uploads.filter((u: any) => u.isImg).length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {uploads.filter((u: any) => u.isImg).map((u: any, i: number) => (
                  <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer">
                    <img src={u.publicUrl} alt={u.file_name} className="w-full h-20 object-cover rounded-lg" style={{ border: "1px solid var(--sk-surface)" }} />
                  </a>
                ))}
              </div>
            )}
            {uploads.filter((u: any) => !u.isImg).map((u: any, i: number) => (
              <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs p-2 rounded-lg mb-1"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
                <span>📄</span><span className="truncate flex-1">{u.file_name}</span>
                <span style={{ color: "#f5a623" }}>Ouvrir →</span>
              </a>
            ))}
            {uploads.length === 0 && <div className="text-xs text-center py-1" style={{ color: "var(--sk-t4)" }}>Aucune pièce jointe</div>}
          </div>

          {/* Approve / Reject */}
          <div className="flex gap-3">
            {currentStatus !== "approved" ? (
              <>
                <button onClick={() => updateStatus("rejected")} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold"
                  style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#ef4444" }}>
                  ✕ Rejeter
                </button>
                <button onClick={() => updateStatus("approved")} disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold"
                  style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#000" }}>
                  {saving ? "..." : "✓ Valider"}
                </button>
              </>
            ) : (
              <div className="flex-1 py-3 rounded-xl text-sm font-bold text-center"
                style={{ background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "#22c55e" }}>
                ✓ Validée — <button onClick={() => updateStatus("rejected")} className="underline text-xs ml-1" style={{ color: "#ef4444" }}>Annuler</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── REPORT MODAL ─────────────────────────────────────
function ReportModal({ report, onClose, onRefresh }: { report: any; onClose: () => void; onRefresh: () => void }) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(report.comment || "");
  const [netEdit, setNetEdit] = useState(String(report.net_after_expenses || ""));
  const [yangoGrossEdit, setYangoGrossEdit] = useState(String(report.yango_gross || ""));
  const [yangoBonus, setYangoBonus] = useState(String(report.yango_bonus || ""));
  const [horsYangoEdit, setHorsYangoEdit] = useState(String(report.off_yango_revenue || ""));
  const [soldeEdit, setSoldeEdit] = useState(String(report.solde_yango || ""));
  const [dateEdit, setDateEdit] = useState(report.date || "");
  const [kmEdit, setKmEdit] = useState(String(report.end_odometer || ""));
  const [yangoTripsEdit, setYangoTripsEdit] = useState(String(report.yango_trip_count || ""));
  const [offYangoTripsEdit, setOffYangoTripsEdit] = useState(String(report.off_yango_trip_count || ""));
  const [serviceSuppEdit, setServiceSuppEdit] = useState(String(report.service_supplementaire || ""));
  const [uploads, setUploads] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)) + " XOF";

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("uploads").select("*").eq("driver_id", report.driver_id).order("created_at", { ascending: false });
      // Keep files linked to this report: either by ref_id or file_path (legacy path)
      const enriched = (data || [])
        .filter((u: any) => u.ref_id === report.id || u.file_path?.includes(report.id))
        .map((u: any) => {
        const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(u.file_path);
        return { ...u, publicUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(u.file_name) };
      });
      setUploads(enriched);
    })();
  }, [report.driver_id]);

  const saveFields = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const yg = parseFloat(yangoGrossEdit) || 0;
      const yb = parseFloat(yangoBonus) || 0;
      const hy = parseFloat(horsYangoEdit) || 0;
      const serviceSupp = parseFloat(serviceSuppEdit) || 0;
      // On garde les taux figés du rapport (fractions → %) et on recalcule via le moteur
      const calc = computeCommissions({
        brutYango: yg, bonusYango: yb, horsYango: hy,
        rates: { yangoPct: (report.commission_rate ?? 0.15) * 100, partnerPct: (report.partner_rate ?? 0.0075) * 100 },
        serviceSupplementaire: serviceSupp,
      });
      const { error } = await supabase.from("daily_reports").update({
        date: dateEdit || report.date,
        yango_gross: yg, yango_bonus: yb, off_yango_revenue: hy,
        gross_earnings: calc.base + hy, commission_amount: calc.commYango + calc.commPartner,
        service_supplementaire: serviceSupp,
        net_after_expenses: calc.netTotal,
        solde_yango: parseFloat(soldeEdit) || 0,
        end_odometer: kmEdit ? parseInt(kmEdit) : null,
        yango_trip_count: yangoTripsEdit ? parseInt(yangoTripsEdit) : null,
        off_yango_trip_count: offYangoTripsEdit ? parseInt(offYangoTripsEdit) : null,
        comment: note || null,
      }).eq("id", report.id);
      if (error) throw error;
      alert("Modifications enregistrées ✓");
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (status: "approved" | "rejected") => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("daily_reports").update({
        status,
        net_after_expenses: parseFloat(netEdit) || report.net_after_expenses,
        ...(note ? { comment: note } : {}),
      }).eq("id", report.id);
      if (error) throw error;
      // Log action (fire-and-forget — non-critical)
      void supabase.from("action_logs").insert({
        tenant_id: report.tenant_id, actor_role: "admin",
        entity_type: "daily_report", entity_id: report.id, action: status,
        metadata: { date: report.date, net: parseFloat(netEdit) || report.net_after_expenses },
      });
      // Notification push au chauffeur
      void fetch("/api/notifications/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: `report_${status}`, tenantId: report.tenant_id, driverId: report.driver_id, data: { date: report.date } }),
      });
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      const rawPath = `admin/reports/${report.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      fd.append("file", file);
      fd.append("path", rawPath);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");
      const supabase = createClient() as any;
      await supabase.from("uploads").insert({ driver_id: report.driver_id, file_name: file.name, file_path: result.path, file_type: "admin-report", file_size: file.size });
      setUploads((p) => [...p, { file_name: file.name, file_path: result.path, file_type: "admin-report", created_at: new Date().toISOString() }]);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setUploading(false); }
  };

  const rows = [
    ["Brut Yango", xof(report.yango_gross)],
    ["Bonus Yango", xof(report.yango_bonus)],
    ["Hors Yango", xof(report.off_yango_revenue)],
    ["💳 Solde wallet", xof(report.solde_yango)],
    ["Commission", `- ${xof(report.commission_amount)}`],
    ...(report.service_supplementaire > 0 ? [["Service supp.", `- ${xof(report.service_supplementaire)}`]] : []),
    ["Courses Yango", report.yango_trip_count ?? "—"],
    ["Courses hors", report.off_yango_trip_count ?? "—"],
    ["Km fin", report.end_odometer ? `${report.end_odometer} km` : "—"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.75)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--sk-surface)" }}>
          <div>
            <div className="font-bold text-white">Rapport — {report.date}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--sk-t3)" }}>Driver ID: {report.driver_id?.slice(0, 8)}...</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Details */}
          <div className="rounded-xl p-4" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
            {rows.map(([l, v]) => (
              <div key={l} className="flex justify-between py-1.5 text-sm" style={{ borderBottom: "1px solid var(--sk-surface)" }}>
                <span style={{ color: "var(--sk-t3)" }}>{l}</span>
                <span className="font-mono text-white">{v}</span>
              </div>
            ))}
            <div className="flex justify-between py-2 text-sm font-bold">
              <span className="text-white">NET TOTAL</span>
              <span className="font-mono" style={{ color: "#22c55e" }}>{xof(report.net_after_expenses)}</span>
            </div>
          </div>

          {report.comment && (
            <div className="text-sm rounded-xl px-4 py-3" style={{ background: "rgba(245,166,35,.05)", border: "1px solid rgba(245,166,35,.15)", color: "var(--sk-t2)" }}>
              💬 {report.comment}
            </div>
          )}

          {/* Editable fields — always available */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#f5a623" }}>✏️ Modifier le rapport</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Date</label>
                <input type="date" value={dateEdit} onChange={(e) => setDateEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "var(--sk-t1)", colorScheme: "dark" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Net calculé (auto)</label>
                <div className="w-full rounded-xl px-3 py-2 text-sm font-mono font-bold" style={{ background: "var(--sk-deep)", border: "1px solid rgba(34,197,94,.2)", color: "#22c55e" }}>
                  {(() => {
                    const yg = parseFloat(yangoGrossEdit) || 0;
                    const yb = parseFloat(yangoBonus) || 0;
                    const hy = parseFloat(horsYangoEdit) || 0;
                    const base = yg + yb;
                    const comm = base * (0.15 + 0.0075);
                    const net = base - comm + hy;
                    return new Intl.NumberFormat("fr-FR").format(Math.round(net)) + " XOF";
                  })()}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t4)" }}>Brut − 15% Yango − 0,75% part. + hors Yango</div>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Brut Yango</label>
                <input type="number" value={yangoGrossEdit} onChange={(e) => setYangoGrossEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "var(--sk-t1)" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Bonus Yango</label>
                <input type="number" value={yangoBonus} onChange={(e) => setYangoBonus(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "var(--sk-t1)" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Hors Yango</label>
                <input type="number" value={horsYangoEdit} onChange={(e) => setHorsYangoEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "#a855f7" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>💳 Solde wallet</label>
                <input type="number" value={soldeEdit} onChange={(e) => setSoldeEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "#f5a623" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>🚗 Km fin de journée</label>
                <input type="number" value={kmEdit} onChange={(e) => setKmEdit(e.target.value)}
                  placeholder="Ex: 145230"
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "#3b82f6" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Courses Yango</label>
                <input type="number" value={yangoTripsEdit} onChange={(e) => setYangoTripsEdit(e.target.value)}
                  placeholder="Nb de courses"
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "var(--sk-t1)" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Courses hors Yango</label>
                <input type="number" value={offYangoTripsEdit} onChange={(e) => setOffYangoTripsEdit(e.target.value)}
                  placeholder="Nb de courses"
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "#a855f7" }} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>➕ Service supplémentaire Yango</label>
              <input type="number" value={serviceSuppEdit} onChange={(e) => setServiceSuppEdit(e.target.value)}
                placeholder="Charge Yango add. (optionnel)"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "#ef4444" }} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--sk-t3)" }}>Note / commentaire</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="Commentaire, motif de rejet..."
                className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
                style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "var(--sk-t1)" }} />
            </div>
            <button onClick={saveFields} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold"
              style={{ background: "rgba(59,130,246,.15)", border: "1px solid rgba(59,130,246,.3)", color: "#3b82f6" }}>
              {saving ? "..." : "💾 Enregistrer les modifications"}
            </button>
          </div>

          {/* Attachments */}
          <div className="rounded-xl p-4" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>📎 Pièces jointes</div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => cameraRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ background: uploading ? "var(--sk-surface)" : "rgba(245,166,35,.08)", borderColor: "rgba(245,166,35,.25)", color: uploading ? "#374151" : "#f5a623" }}>
                {uploading ? "⏳" : "📷 Photo"}
              </button>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border-dashed border-2"
                style={{ background: "transparent", borderColor: "#2a2f3d", color: uploading ? "#f5a623" : "var(--sk-t3)" }}>
                {uploading ? "⏳ Upload..." : "📁 Fichier / Galerie"}
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { Array.from(e.target.files || []).forEach(uploadFile); e.target.value = ""; }} />
            <input ref={fileRef} type="file" accept="image/*,.pdf" multiple className="hidden"
              onChange={(e) => { Array.from(e.target.files || []).forEach(uploadFile); e.target.value = ""; }} />
            {/* Image grid */}
            {uploads.filter((u: any) => u.isImg).length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {uploads.filter((u: any) => u.isImg).map((u: any, i: number) => (
                  <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer">
                    <img src={u.publicUrl} alt={u.file_name} className="w-full h-20 object-cover rounded-lg"
                      style={{ border: "1px solid var(--sk-surface)" }} />
                  </a>
                ))}
              </div>
            )}
            {/* PDFs */}
            {uploads.filter((u: any) => !u.isImg).map((u: any, i: number) => (
              <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs p-2 rounded-lg mb-1"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
                <span>{u.file_type?.includes("admin") ? "👤" : "📄"}</span>
                <span className="truncate flex-1">{u.file_name}</span>
                <span style={{ color: "#f5a623" }}>Ouvrir →</span>
              </a>
            ))}
            {uploads.length === 0 && <div className="text-xs text-center py-2" style={{ color: "var(--sk-t4)" }}>Aucune pièce jointe</div>}
          </div>

          {/* Actions */}
          {report.status !== "approved" && (
            <div className="flex gap-3">
              <button onClick={() => updateStatus("rejected")} disabled={saving}
                className="flex-1 py-3 rounded-xl text-sm font-bold"
                style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#ef4444" }}>
                ✕ Rejeter
              </button>
              <button onClick={() => updateStatus("approved")} disabled={saving}
                className="flex-1 py-3 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#000" }}>
                {saving ? "..." : "✓ Approuver"}
              </button>
            </div>
          )}
          {report.status === "approved" && (
            <button onClick={() => updateStatus("rejected")} disabled={saving}
              className="w-full py-3 rounded-xl text-sm font-bold"
              style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "#ef4444" }}>
              Annuler la validation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DAILY TABLE ──────────────────────────────────────
function DailyTable({ data, periodFrom, periodTo }: { data: any[]; periodFrom: string; periodTo: string }) {
  const [filter, setFilter] = useState("");
  const xof = (n: number) => n > 0 ? new Intl.NumberFormat("fr-FR").format(Math.round(n)) : "—";
  const filtered = filter ? data.filter((d: any) => d.date === filter) : data;
  const tot = { brutYango: 0, horsYango: 0, netRecettes: 0, depenses: 0, netFinal: 0, km: 0, nbCourses: 0 };
  filtered.forEach((d: any) => {
    tot.brutYango += d.brutYango; tot.horsYango += d.horsYango; tot.netRecettes += d.netRecettes;
    tot.depenses += d.depenses; tot.netFinal += d.netFinal; tot.km += d.km; tot.nbCourses += d.nbCourses;
  });

  const cols = [
    { k: "date", label: "Date", fmt: (v: any) => v, color: () => "var(--sk-t1)" },
    { k: "brutYango", label: "Brut Yango", fmt: xof, color: () => "#f5a623" },
    { k: "horsYango", label: "Hors Yango", fmt: xof, color: () => "#a855f7" },
    { k: "netRecettes", label: "Net recettes", fmt: xof, color: () => "#3b82f6" },
    { k: "depenses", label: "Dépenses", fmt: (v: number) => v > 0 ? `- ${xof(v)}` : "—", color: () => "#ef4444" },
    { k: "netFinal", label: "NET FINAL", fmt: xof, color: (v: number) => v >= 0 ? "#22c55e" : "#ef4444" },
    { k: "km", label: "KM", fmt: (v: number) => v > 0 ? `${v} km` : "—", color: () => "var(--sk-t3)" },
    { k: "nbCourses", label: "Courses", fmt: (v: number) => v > 0 ? String(v) : "—", color: () => "var(--sk-t3)" },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--sk-surface)" }}>
        <h3 className="font-bold text-white text-sm">📅 Tableau journalier détaillé</h3>
        <div className="flex items-center gap-2">
          <input type="date" value={filter} onChange={(e) => setFilter(e.target.value)}
            min={periodFrom} max={periodTo}
            className="text-xs px-2 py-1 rounded-lg outline-none"
            style={{ background: "var(--sk-surface)", border: "1px solid #2a2f3d", color: "var(--sk-t1)", colorScheme: "dark" }} />
          {filter && <button onClick={() => setFilter("")} className="text-xs px-2 py-1 rounded" style={{ color: "#f5a623", background: "rgba(245,166,35,.1)" }}>✕ Tout afficher</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ fontSize: 11 }}>
          <thead>
            <tr style={{ background: "var(--sk-deep)", borderBottom: "1px solid var(--sk-surface)" }}>
              {cols.map((c) => (
                <th key={c.k} className="px-3 py-2 text-left font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "var(--sk-t4)" }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={cols.length} className="text-center py-8" style={{ color: "var(--sk-t4)" }}>Aucune donnée pour cette période</td></tr>
            )}
            {filtered.map((d: any, i: number) => (
              <tr key={d.date} style={{ borderBottom: "1px solid #0a0c10", background: i % 2 === 0 ? "var(--sk-bg)" : "var(--sk-deep)" }}>
                {cols.map((c) => (
                  <td key={c.k} className="px-3 py-2 font-mono whitespace-nowrap" style={{ color: c.color(d[c.k]) }}>
                    {c.fmt(d[c.k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--sk-surface)", borderTop: "2px solid #2a2f3d" }}>
              <td className="px-3 py-2.5 font-bold text-white">TOTAL ({filtered.length} j)</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#f5a623" }}>{xof(tot.brutYango)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#a855f7" }}>{xof(tot.horsYango)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#3b82f6" }}>{xof(tot.netRecettes)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#ef4444" }}>- {xof(tot.depenses)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: tot.netFinal >= 0 ? "#22c55e" : "#ef4444" }}>{xof(tot.netFinal)}</td>
              <td className="px-3 py-2.5 font-mono" style={{ color: "var(--sk-t3)" }}>{tot.km > 0 ? `${tot.km} km` : "—"}</td>
              <td className="px-3 py-2.5 font-mono" style={{ color: "var(--sk-t3)" }}>{tot.nbCourses > 0 ? tot.nbCourses : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── REMUNERATION DASHBOARD BLOCK ─────────────────────
// ─── DRIVER ALLOCATIONS BLOCK ─────────────────────────
// prorataFactor (0–1) : proratise la BASE FIXE pour un chauffeur entré en cours de mois.
// Les modèles proportionnels (percent/location) et la commission ne sont pas proratisés.
function calcDriverSalary(netDeclared: number, cfg: any, prorataFactor: number = 1): number {
  const model: string = cfg.model || "tiered";
  const pf = prorataFactor > 0 && prorataFactor <= 1 ? prorataFactor : 1;
  if (model === "fixed") return (cfg.base_amount || 0) * pf;
  if (model === "tiered") {
    const tiers: any[] = Array.isArray(cfg.salary_tiers) ? cfg.salary_tiers : [];
    const sorted = [...tiers].sort((a, b) => b.min_net - a.min_net);
    const tier = sorted.find((t) => netDeclared >= t.min_net) ?? sorted[sorted.length - 1];
    return (tier?.total_salary ?? cfg.base_amount ?? 0) * pf;
  }
  if (model === "percent") return netDeclared * (cfg.commission_rate || 0);
  if (model === "hybrid") {
    const base = (cfg.base_amount || 0) * pf;
    const bonus = cfg.bonus_threshold > 0 && netDeclared >= cfg.bonus_threshold ? (cfg.bonus_amount || 0) : 0;
    return base + bonus + netDeclared * (cfg.commission_rate || 0);
  }
  if (model === "location") return 0; // driver keeps their own net
  return 0;
}

function DriverAllocationsBlock({ allocations, cfg }: { allocations: any[]; cfg: any }) {
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)) + " XOF";
  const model: string = cfg.model || "tiered";
  const modelLabel: Record<string, string> = {
    fixed: "Salaire fixe", tiered: "Paliers CA net", percent: "% du CA",
    hybrid: "Fixe + bonus", location: "Loyer journalier",
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-sm uppercase tracking-widest font-semibold" style={{ color: "var(--sk-t3)" }}>
          Allocation par chauffeur — <span style={{ color: "#f5a623" }}>{modelLabel[model] ?? model}</span>
        </h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(245,166,35,.1)", color: "#f5a623" }}>
          approuvé + en attente
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {allocations.map((d) => {
          // Config effective : modèle & base du chauffeur si définis, sinon tenant
          const effCfg = { ...cfg, model: d.salary_model || cfg.model, base_amount: d.base_amount ?? cfg.base_amount };
          const dModel: string = effCfg.model;
          const salary = calcDriverSalary(d.netDeclared, effCfg, d.prorataFactor);
          const isProrated = d.prorataFactor != null && d.prorataFactor < 1;
          const hasPending = d.nbPending > 0;
          return (
            <div key={d.driver_id} className="rounded-2xl p-4 space-y-3"
              style={{ background: "var(--sk-bg)", border: `1px solid ${hasPending ? "rgba(245,166,35,.25)" : "var(--sk-surface)"}` }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm text-white">{d.name}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t4)" }}>
                    {d.nbApproved > 0 && <span className="text-green-500">✓ {d.nbApproved} validés</span>}
                    {d.nbPending > 0 && <span className="ml-1" style={{ color: "#f5a623" }}>⏳ {d.nbPending} en attente</span>}
                    {d.nbReports === 0 && <span style={{ color: "var(--sk-t4)" }}>Aucun rapport</span>}
                  </div>
                </div>
                {dModel === "tiered" && (() => {
                  const tiers: any[] = Array.isArray(cfg.salary_tiers) ? cfg.salary_tiers : [];
                  const sorted = [...tiers].sort((a, b) => b.min_net - a.min_net);
                  const tier = sorted.find((t) => d.netDeclared >= t.min_net) ?? sorted[sorted.length - 1];
                  return tier ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(59,130,246,.1)", color: "#3b82f6" }}>{tier.label}</span>
                  ) : null;
                })()}
                {d.salary_model && d.salary_model !== cfg.model && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,.12)", color: "#a855f7" }}>modèle perso</span>
                )}
              </div>
              <div className="space-y-1.5 text-xs" style={{ color: "var(--sk-t3)" }}>
                {d.netApproved > 0 && (
                  <div className="flex justify-between">
                    <span>Net approuvé</span>
                    <span className="font-mono" style={{ color: "#22c55e" }}>{xof(d.netApproved)}</span>
                  </div>
                )}
                {d.netPending > 0 && (
                  <div className="flex justify-between">
                    <span>Net en attente</span>
                    <span className="font-mono" style={{ color: "#f5a623" }}>{xof(d.netPending)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t" style={{ borderColor: "var(--sk-surface)" }}>
                  <span>Total déclaré</span>
                  <span className="font-mono font-bold text-white">{xof(d.netDeclared)}</span>
                </div>
              </div>
              {dModel !== "location" && (
                <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1 flex items-center justify-between" style={{ color: "var(--sk-t4)" }}>
                    <span>Allocation estimée</span>
                    {isProrated && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,.12)", color: "#a855f7" }}>
                        prorata {Math.round(d.prorataFactor * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="font-mono font-bold text-base" style={{ color: "#f5a623" }}>{xof(salary)}</div>
                  {isProrated && d.hire_date && (
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t4)" }}>
                      Entré le {new Date(d.hire_date).toLocaleDateString("fr-FR")}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RemunerationDashboardBlock({ kpis, cfg }: { kpis: any; cfg: any }) {
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)) + " XOF";
  const daysElapsed = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const model: string = cfg.model || "tiered";

  const modelLabel: Record<string, string> = {
    fixed: "Salaire fixe", tiered: "Paliers CA net", percent: "% du CA",
    hybrid: "Fixe + bonus", location: "Loyer journalier",
  };

  // Compute estimates per model
  let items: { label: string; value: string; color: string; sub?: string }[] = [];

  if (model === "fixed") {
    const masseSalariale = (cfg.base_amount || 0) * (kpis.totalDrivers || 1);
    items = [
      { label: "Salaire/driver", value: xof(cfg.base_amount), color: "#f5a623" },
      { label: "Masse salariale totale", value: xof(masseSalariale), color: "#ef4444", sub: `${kpis.totalDrivers} drivers` },
      { label: "CA net période", value: xof(kpis.totalBrut), color: "#22c55e" },
      { label: "Marge après salaires", value: xof(kpis.totalBrut - masseSalariale), color: kpis.totalBrut - masseSalariale >= 0 ? "#22c55e" : "#ef4444" },
    ];
  } else if (model === "tiered") {
    const tiers: any[] = Array.isArray(cfg.salary_tiers) ? cfg.salary_tiers : [];
    const sorted = [...tiers].sort((a, b) => b.min_net - a.min_net);
    const avgPerDriver = kpis.totalDrivers > 0 ? kpis.totalBrut / kpis.totalDrivers : 0;
    const estTier = sorted.find((t) => avgPerDriver >= t.min_net) ?? sorted[sorted.length - 1];
    const estSalaire = estTier?.total_salary ?? cfg.base_amount ?? 0;
    const masseSalariale = estSalaire * (kpis.totalDrivers || 1);
    items = [
      { label: "CA net moy/driver", value: xof(avgPerDriver), color: "#f5a623", sub: "Base estimation palier" },
      { label: "Palier estimé", value: estTier?.label ?? "—", color: "var(--sk-t2)", sub: `→ ${xof(estSalaire)}/driver` },
      { label: "Masse salariale estimée", value: xof(masseSalariale), color: "#ef4444", sub: `${kpis.totalDrivers} drivers` },
      { label: "Marge après salaires", value: xof(kpis.totalBrut - masseSalariale), color: kpis.totalBrut - masseSalariale >= 0 ? "#22c55e" : "#ef4444" },
    ];
  } else if (model === "percent") {
    const partDriver = kpis.totalBrut * (cfg.commission_rate || 0);
    const partOpe = kpis.totalBrut - partDriver;
    items = [
      { label: `Part drivers (${Math.round((cfg.commission_rate || 0) * 100)}%)`, value: xof(partDriver), color: "#ef4444" },
      { label: "Part opérateur", value: xof(partOpe), color: "#22c55e" },
      { label: "CA net période", value: xof(kpis.totalBrut), color: "#f5a623" },
      { label: "Taux opérateur", value: `${Math.round((1 - (cfg.commission_rate || 0)) * 100)}%`, color: "var(--sk-t2)" },
    ];
  } else if (model === "hybrid") {
    const avgPerDriver = kpis.totalDrivers > 0 ? kpis.totalBrut / kpis.totalDrivers : 0;
    const bonusDrivers = cfg.bonus_threshold > 0 && avgPerDriver >= cfg.bonus_threshold ? kpis.totalDrivers : 0;
    const masseSalariale = (cfg.base_amount || 0) * (kpis.totalDrivers || 1) + bonusDrivers * (cfg.bonus_amount || 0) + kpis.totalBrut * (cfg.commission_rate || 0);
    items = [
      { label: "Masse fixe", value: xof((cfg.base_amount || 0) * (kpis.totalDrivers || 1)), color: "#f5a623", sub: `${kpis.totalDrivers} × ${xof(cfg.base_amount)}` },
      { label: "Bonus estimés", value: xof(bonusDrivers * (cfg.bonus_amount || 0)), color: "#a855f7", sub: bonusDrivers > 0 ? `${bonusDrivers} drivers ont atteint le seuil` : `Seuil : ${xof(cfg.bonus_threshold)}` },
      { label: "Masse salariale totale", value: xof(masseSalariale), color: "#ef4444" },
      { label: "Marge après salaires", value: xof(kpis.totalBrut - masseSalariale), color: kpis.totalBrut - masseSalariale >= 0 ? "#22c55e" : "#ef4444" },
    ];
  } else if (model === "location") {
    const loyerParDriver = (cfg.daily_rent || 0) * daysElapsed;
    const loyerTotal = loyerParDriver * (kpis.totalDrivers || 1);
    const loyerMensuel = (cfg.daily_rent || 0) * daysInMonth * (kpis.totalDrivers || 1);
    items = [
      { label: `Loyer/jour/driver`, value: xof(cfg.daily_rent), color: "#f5a623" },
      { label: `Loyer collecté (${daysElapsed}j)`, value: xof(loyerTotal), color: "#22c55e", sub: `${kpis.totalDrivers} drivers` },
      { label: "Loyer mensuel projeté", value: xof(loyerMensuel), color: "#3b82f6", sub: `${daysInMonth}j × ${kpis.totalDrivers} drivers` },
      { label: "CA net drivers (après loyer)", value: xof(kpis.totalBrut - loyerTotal), color: "var(--sk-t2)", sub: "Géré par les drivers" },
    ];
  }

  return (
    <div>
      <h3 className="text-sm uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--sk-t3)" }}>
        Rémunération — <span style={{ color: "#f5a623" }}>{modelLabel[model] ?? model}</span>
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderLeft: `3px solid ${item.color}` }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--sk-t3)" }}>{item.label}</div>
            <div className="text-lg font-mono font-bold" style={{ color: item.color }}>{item.value}</div>
            {item.sub && <div className="text-[10px] mt-1" style={{ color: "var(--sk-t4)" }}>{item.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── INSIGHTS PANEL ───────────────────────────────────
function InsightsPanel({ kpis }: { kpis: any }) {
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));
  const insights: { icon: string; label: string; value: string; color: string }[] = [];

  if (kpis.avgBrutPerDay > 0) insights.push({ icon: "📈", label: "Net recettes moy/jour", value: xof(kpis.avgBrutPerDay) + " XOF", color: "#f5a623" });
  if (kpis.avgDepensesPerDay > 0) insights.push({ icon: "⛽", label: "Dépense moy/jour", value: xof(kpis.avgDepensesPerDay) + " XOF", color: "#ef4444" });
  if (kpis.avgNetPerDay !== 0) insights.push({ icon: "💰", label: "Net final moy/jour", value: xof(kpis.avgNetPerDay) + " XOF", color: kpis.avgNetPerDay > 0 ? "#22c55e" : "#ef4444" });
  if (kpis.avgKmPerDay > 0) insights.push({ icon: "🚗", label: "KM moy/jour", value: kpis.avgKmPerDay + " km", color: "#3b82f6" });
  if (kpis.avgSoldePerDay > 0) insights.push({ icon: "💳", label: "Solde wallet moy/jour", value: xof(kpis.avgSoldePerDay) + " XOF", color: "#a855f7" });
  if (kpis.totalFuelCost > 0) insights.push({ icon: "🛢️", label: "Carburant total période", value: xof(kpis.totalFuelCost) + " XOF", color: "#f97316" });
  if (kpis.monthMarginPercent !== 0) insights.push({ icon: "📊", label: "Marge nette période", value: kpis.monthMarginPercent.toFixed(1) + "%", color: kpis.monthMarginPercent > 0 ? "#22c55e" : "#ef4444" });
  if (kpis.totalDrivers > 0) insights.push({ icon: "👥", label: "Moy recette/chauffeur", value: xof(kpis.avgRevenuePerDriver) + " XOF", color: "#3b82f6" });

  if (insights.length === 0) return null;
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
      <h3 className="font-bold text-white text-sm mb-3">💡 Insights</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {insights.map((ins, i) => (
          <div key={i} className="rounded-lg p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-lg mb-1">{ins.icon}</div>
            <div className="text-xs mb-1" style={{ color: "var(--sk-t3)" }}>{ins.label}</div>
            <div className="text-sm font-bold font-mono" style={{ color: ins.color }}>{ins.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PAYMENTS TAB ─────────────────────────────────────
function PaymentsTab({ filterDriverId = "", tenantId }: { filterDriverId?: string; tenantId: string }) {
  const [payments, setPayments] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newPaymentId, setNewPaymentId] = useState<string | null>(null);
  const [newPaymentDriverId, setNewPaymentDriverId] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];
  const thisMonth = today.slice(0, 7) + "-01";
  const [form, setForm] = useState({ driver_id: "", amount: "", payment_date: today, salary_month: thisMonth, type: "salaire", notes: "" });
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));
  const paymentTypes = ["salaire", "acompte", "bonus", "autre"];

  useEffect(() => { load(); }, [tenantId, filterDriverId]);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ tenantId });
    if (filterDriverId) params.set("driverId", filterDriverId);
    const json = await fetch(`/api/admin/payments?${params}`).then((r) => r.json());
    setPayments(json.payments || []);
    setDrivers(json.profiles || []);
    if (json.profiles?.length && !form.driver_id) setForm((f) => ({ ...f, driver_id: json.profiles[0].id }));
    setLoading(false);
  };

  const save = async () => {
    if (!form.driver_id || !form.amount) { alert("Chauffeur et montant requis"); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("payments").insert({
        driver_id: form.driver_id,
        tenant_id: tenantId,
        amount: parseFloat(form.amount),
        payment_date: form.payment_date,
        salary_month: form.salary_month || null,
        type: form.type,
        notes: form.notes || null,
      });
      if (error) throw error;
      // Get the newly created payment id for file uploads
      const supabase2 = createClient() as any;
      const { data: newPay } = await supabase2.from("payments").select("id").eq("driver_id", form.driver_id).order("created_at", { ascending: false }).limit(1).single();
      setNewPaymentId(newPay?.id || null);
      setNewPaymentDriverId(form.driver_id);
      setForm((f) => ({ ...f, amount: "", notes: "" }));
      await load();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const deletePayment = async (id: string) => {
    if (!confirm("Supprimer ce paiement ?")) return;
    const supabase = createClient() as any;
    await supabase.from("payments").delete().eq("id", id);
    await load();
  };

  const typeBadge = (t: string) => {
    const map: Record<string, [string, string]> = {
      salaire: ["#22c55e", "rgba(34,197,94,.1)"],
      acompte: ["#f5a623", "rgba(245,166,35,.1)"],
      bonus: ["#3b82f6", "rgba(59,130,246,.1)"],
      autre: ["var(--sk-t2)", "var(--sk-surface)"],
    };
    const [color, bg] = map[t] ?? map.autre;
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize" style={{ color, background: bg }}>{t}</span>;
  };

  const filteredPayments = filterDriverId ? payments.filter((p) => p.driver_id === filterDriverId) : payments;

  // Group by driver for totals
  const totByDriver = filteredPayments.reduce((acc: any, p) => {
    const name = p.profiles?.full_name || p.driver_id;
    acc[name] = (acc[name] || 0) + (p.amount || 0);
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">💵 Paiements chauffeurs</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="text-sm px-4 py-2 rounded-xl font-semibold"
          style={{ background: showForm ? "var(--sk-surface)" : "linear-gradient(135deg,#f5a623,#e8951a)", color: showForm ? "var(--sk-t2)" : "#000" }}>
          {showForm ? "Annuler" : "+ Nouveau paiement"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <h3 className="text-sm font-bold text-white">Enregistrer un paiement</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Chauffeur *</label>
              <select value={form.driver_id} onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.driver_id})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none capitalize"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
                {paymentTypes.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Montant (XOF) *</label>
              <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="ex: 200 000" className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>📅 Date effective paiement</label>
              <input type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "dark" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#f5a623" }}>📆 Mois du salaire (à imputer)</label>
              <input type="month" value={form.salary_month?.slice(0, 7)} onChange={(e) => setForm((f) => ({ ...f, salary_month: e.target.value + "-01" }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid rgba(245,166,35,.4)", color: "#f5a623", colorScheme: "dark" }} />
              <p className="text-xs mt-1" style={{ color: "var(--sk-t4)" }}>Apparaît comme charge sur ce mois dans le dashboard</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Période couverte, détails..." rows={2}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
              style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }} />
          </div>
          <button onClick={save} disabled={saving}
            className="w-full py-3 rounded-xl text-sm font-bold"
            style={{ background: saving ? "var(--sk-surface)" : "linear-gradient(135deg,#f5a623,#e8951a)", color: saving ? "var(--sk-t3)" : "#000" }}>
            {saving ? "Enregistrement..." : "✓ Enregistrer le paiement"}
          </button>

          {/* Upload PJ après sauvegarde */}
          {newPaymentId && newPaymentDriverId && (
            <div className="mt-2 rounded-xl p-4" style={{ background: "rgba(34,197,94,.05)", border: "1px solid rgba(34,197,94,.2)" }}>
              <div className="text-xs font-semibold mb-2" style={{ color: "#22c55e" }}>✓ Paiement enregistré — ajoutez des pièces jointes</div>
              <PaymentUpload paymentId={newPaymentId} driverId={newPaymentDriverId} />
              <button onClick={() => { setNewPaymentId(null); setNewPaymentDriverId(null); setShowForm(false); }}
                className="mt-3 w-full py-2 rounded-xl text-xs" style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
                Fermer
              </button>
            </div>
          )}
        </div>
      )}

      {/* Totals by driver */}
      {Object.keys(totByDriver).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(totByDriver).map(([name, total]: [string, any]) => (
            <div key={name} className="rounded-xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderLeft: "3px solid #22c55e" }}>
              <div className="text-xs mb-1" style={{ color: "var(--sk-t3)" }}>{name}</div>
              <div className="font-mono font-bold text-sm" style={{ color: "#22c55e" }}>{xof(total)} XOF</div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t4)" }}>total payé</div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-12" style={{ color: "var(--sk-t4)" }}>Chargement...</div>
      ) : filteredPayments.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--sk-t4)" }}>Aucun paiement enregistré</div>
      ) : (
        <div className="space-y-2">
          {filteredPayments.map((p) => (
            <PaymentRow key={p.id} payment={p} onDelete={() => deletePayment(p.id)} typeBadge={typeBadge} xof={xof} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PAYMENT UPLOAD (reusable) ────────────────────────
function PaymentUpload({ paymentId, driverId }: { paymentId: string; driverId: string }) {
  const [uploads, setUploads] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient() as any;
    supabase.from("uploads").select("*").eq("driver_id", driverId).eq("file_type", "payment")
      .order("created_at", { ascending: false }).then(({ data }: any) => {
        const enriched = (data || []).filter((u: any) => u.file_path?.includes(paymentId)).map((u: any) => {
          const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(u.file_path);
          return { ...u, publicUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(u.file_name) };
        });
        setUploads(enriched);
      });
  }, [paymentId, driverId]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const supabase = createClient() as any;
      const path = `payment/${driverId}/${paymentId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await supabase.storage.from("kyc-documents").upload(path, file, { upsert: true });
      const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(path);
      await supabase.from("uploads").insert({ driver_id: driverId, file_name: file.name, file_path: path, file_type: "payment", file_size: file.size });
      setUploads((p) => [...p, { file_name: file.name, publicUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name) }]);
    } catch (err: any) { alert("Upload : " + err.message); }
    finally { setUploading(false); }
  };

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <button onClick={() => cameraRef.current?.click()} disabled={uploading}
          className="flex-1 py-2 rounded-xl text-xs border"
          style={{ background: uploading ? "var(--sk-surface)" : "rgba(245,166,35,.08)", borderColor: "rgba(245,166,35,.25)", color: uploading ? "#374151" : "#f5a623" }}>
          {uploading ? "⏳" : "📷 Photo"}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex-1 py-2 rounded-xl text-xs border-dashed border-2"
          style={{ background: "transparent", borderColor: "#2a2f3d", color: uploading ? "#f5a623" : "var(--sk-t3)" }}>
          {uploading ? "⏳ Upload..." : "📁 Fichier / Galerie"}
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { Array.from(e.target.files || []).forEach(upload); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,.pdf" multiple className="hidden"
        onChange={(e) => { Array.from(e.target.files || []).forEach(upload); e.target.value = ""; }} />
      {uploads.filter(u => u.isImg).length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-1">
          {uploads.filter(u => u.isImg).map((u, i) => (
            <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer">
              <img src={u.publicUrl} alt={u.file_name} className="w-full h-14 object-cover rounded-lg" style={{ border: "1px solid var(--sk-surface)" }} />
            </a>
          ))}
        </div>
      )}
      {uploads.filter(u => !u.isImg).map((u, i) => (
        <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs p-1.5 rounded-lg mb-1"
          style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
          <span>📄</span><span className="truncate flex-1">{u.file_name}</span>
          <span style={{ color: "#f5a623" }}>→</span>
        </a>
      ))}
    </div>
  );
}

// ─── PAYMENT ROW ──────────────────────────────────────
function PaymentRow({ payment: p, onDelete, typeBadge, xof }: { payment: any; onDelete: () => void; typeBadge: (t: string) => React.ReactNode; xof: (n: number) => string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">
            {p.profiles?.full_name || "—"}
            <span className="ml-2 text-xs" style={{ color: "var(--sk-t4)" }}>{p.profiles?.driver_id}</span>
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "var(--sk-t3)" }}>
            {p.salary_month && <span style={{ color: "#f5a623" }}>📆 Mois: {p.salary_month?.slice(0, 7)}</span>}
            <span>📅 Payé le: {p.payment_date}</span>
            {typeBadge(p.type)}
            {p.notes && <span className="truncate max-w-[200px]">{p.notes}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono font-bold" style={{ color: "#22c55e" }}>{xof(p.amount)} XOF</div>
          <button onClick={() => setOpen(!open)} className="text-xs px-2 py-1 rounded-lg"
            style={{ background: open ? "rgba(245,166,35,.1)" : "var(--sk-surface)", color: open ? "#f5a623" : "var(--sk-t3)" }}>
            📎
          </button>
          <button onClick={onDelete} className="text-xs" style={{ color: "var(--sk-t4)" }}>🗑</button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-3 border-t" style={{ borderColor: "var(--sk-surface)" }}>
          <PaymentUpload paymentId={p.id} driverId={p.driver_id} />
        </div>
      )}
    </div>
  );
}

// ─── AVANCES TAB ─────────────────────────────────────
function AvancesTab({ filterDriverId = "", tenantId }: { filterDriverId?: string; tenantId: string }) {
  const [advances, setAdvances] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ driver_id: "", amount: "", payment_date: today, notes: "" });
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

  useEffect(() => { load(); }, [tenantId, filterDriverId]);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ tenantId, type: "acompte" });
    if (filterDriverId) params.set("driverId", filterDriverId);
    const json = await fetch(`/api/admin/payments?${params}`).then((r) => r.json());
    setAdvances(json.payments || []);
    setDrivers(json.profiles || []);
    if (json.profiles?.length && !form.driver_id) setForm((f) => ({ ...f, driver_id: json.profiles[0].id }));
    setLoading(false);
  };

  const saveAdvance = async () => {
    if (!form.driver_id || !form.amount) { alert("Chauffeur et montant requis"); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("payments").insert({
        driver_id: form.driver_id,
        tenant_id: tenantId,
        amount: parseFloat(form.amount),
        payment_date: form.payment_date,
        type: "acompte",
        notes: form.notes || null,
        is_deducted: false,
      });
      if (error) throw error;
      setForm((f) => ({ ...f, amount: "", notes: "" }));
      setShowForm(false);
      await load();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const markDeducted = async (id: string) => {
    const supabase = createClient() as any;
    await supabase.from("payments").update({ is_deducted: true, deducted_at: today }).eq("id", id);
    await load();
  };

  const deleteAdvance = async (id: string) => {
    if (!confirm("Supprimer cette avance ?")) return;
    const supabase = createClient() as any;
    await supabase.from("payments").delete().eq("id", id);
    await load();
  };

  const filteredAdvances = filterDriverId ? advances.filter((a) => a.driver_id === filterDriverId) : advances;

  // Group by driver
  const byDriver = drivers
    .filter((d) => !filterDriverId || d.id === filterDriverId)
    .map((d) => {
    const dAdvs = filteredAdvances.filter((a) => a.driver_id === d.id);
    const pending = dAdvs.filter((a) => !a.is_deducted).reduce((s, a) => s + (a.amount || 0), 0);
    const deducted = dAdvs.filter((a) => a.is_deducted).reduce((s, a) => s + (a.amount || 0), 0);
    return { ...d, advances: dAdvs, pending, deducted };
  }).filter((d) => d.advances.length > 0);

  const totalPending = byDriver.reduce((s, d) => s + d.pending, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">💰 Avances sur salaire</h2>
          {totalPending > 0 && (
            <div className="text-sm mt-1" style={{ color: "#f5a623" }}>
              ⚠️ Total avances non déduites : <span className="font-mono font-bold">{xof(totalPending)} XOF</span>
            </div>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="text-sm px-4 py-2 rounded-xl font-semibold"
          style={{ background: showForm ? "var(--sk-surface)" : "linear-gradient(135deg,#f5a623,#e8951a)", color: showForm ? "var(--sk-t2)" : "#000" }}>
          {showForm ? "Annuler" : "+ Nouvelle avance"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <h3 className="text-sm font-bold text-white">Enregistrer une avance sur salaire</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Chauffeur *</label>
              <select value={form.driver_id} onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.driver_id})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Montant (XOF) *</label>
              <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="ex: 50 000"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Date</label>
              <input type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "dark" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Motif / Notes</label>
              <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="ex: avance loyer, urgence..."
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }} />
            </div>
          </div>
          <button onClick={saveAdvance} disabled={saving}
            className="w-full py-3 rounded-xl text-sm font-bold"
            style={{ background: saving ? "var(--sk-surface)" : "linear-gradient(135deg,#f5a623,#e8951a)", color: saving ? "var(--sk-t3)" : "#000" }}>
            {saving ? "Enregistrement..." : "✓ Enregistrer l'avance"}
          </button>
        </div>
      )}

      {/* Summary cards per driver */}
      {byDriver.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {byDriver.map((d) => (
            <div key={d.id} className="rounded-2xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderLeft: `3px solid ${d.pending > 0 ? "#f5a623" : "#22c55e"}` }}>
              <div className="font-semibold text-white text-sm mb-1">{d.full_name}</div>
              <div className="text-xs mb-3" style={{ color: "var(--sk-t4)" }}>{d.driver_id}</div>
              <div className="flex gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--sk-t3)" }}>En attente</div>
                  <div className="font-mono font-bold text-sm" style={{ color: d.pending > 0 ? "#f5a623" : "var(--sk-t4)" }}>
                    {xof(d.pending)} XOF
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "var(--sk-t3)" }}>Déduit</div>
                  <div className="font-mono font-bold text-sm" style={{ color: "#22c55e" }}>{xof(d.deducted)} XOF</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail list */}
      {loading ? (
        <div className="text-center py-12" style={{ color: "var(--sk-t4)" }}>Chargement...</div>
      ) : advances.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--sk-t4)" }}>Aucune avance enregistrée</div>
      ) : (
        <div className="space-y-2">
          {advances.map((a) => (
            <div key={a.id} className="rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
              <div>
                <div className="text-sm font-semibold text-white">
                  {a.profiles?.full_name || "—"}
                  <span className="ml-2 text-xs" style={{ color: "var(--sk-t4)" }}>{a.profiles?.driver_id}</span>
                </div>
                <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "var(--sk-t3)" }}>
                  <span>📅 {a.payment_date}</span>
                  {a.notes && <span className="truncate max-w-[200px]">{a.notes}</span>}
                  {a.is_deducted
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#22c55e", background: "rgba(34,197,94,.1)" }}>✓ Déduit {a.deducted_at || ""}</span>
                    : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#f5a623", background: "rgba(245,166,35,.1)" }}>⏳ En attente</span>
                  }
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="font-mono font-bold" style={{ color: a.is_deducted ? "var(--sk-t3)" : "#f5a623" }}>
                  {xof(a.amount)} XOF
                </div>
                {!a.is_deducted && (
                  <button onClick={() => markDeducted(a.id)}
                    className="text-[10px] px-2 py-1 rounded-lg font-semibold"
                    style={{ background: "rgba(34,197,94,.1)", color: "#22c55e" }}>
                    Marquer déduit
                  </button>
                )}
                <button onClick={() => deleteAdvance(a.id)} className="text-xs" style={{ color: "var(--sk-t4)" }}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CALENDRIER TAB ───────────────────────────────────
function CalendrierTab({ filterDriverId, allDrivers }: { filterDriverId: string; allDrivers: any[] }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [events, setEvents] = useState<any[]>([]); // daily_reports with [REPOS] or normal
  const [loading, setLoading] = useState(false);
  const [addModal, setAddModal] = useState<{ date: string } | null>(null);
  const [addDriver, setAddDriver] = useState("");
  const [addMotif, setAddMotif] = useState("");
  const [saving, setSaving] = useState(false);

  const monthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
  const monthStart = `${monthStr}-01`;
  const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
  const monthEnd = `${monthStr}-${String(lastDay).padStart(2, "0")}`;

  const load = async () => {
    setLoading(true);
    const supabase = createClient() as any;
    const { data } = await supabase.from("daily_reports")
      .select("id, driver_id, date, status, comment, gross_earnings, net_after_expenses")
      .gte("date", monthStart)
      .lte("date", monthEnd)
      .order("date");
    setEvents(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [monthStr]);

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  // Build calendar grid
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const startPad = (firstDow + 6) % 7; // Mon-first
  const days = Array.from({ length: lastDay }, (_, i) => i + 1);

  const drivers = filterDriverId ? allDrivers.filter(d => d.id === filterDriverId) : allDrivers;

  const eventsForDay = (day: number) => {
    const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
    return events.filter(e => e.date === dateStr && (!filterDriverId || e.driver_id === filterDriverId));
  };

  const driverName = (driverId: string) => {
    const d = allDrivers.find(d => d.id === driverId);
    return d ? d.full_name : driverId.slice(0, 6);
  };

  const addRepos = async () => {
    if (!addModal || !addDriver) return;
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { data: exists } = await supabase.from("daily_reports")
        .select("id").eq("driver_id", addDriver).eq("date", addModal.date).maybeSingle();
      if (exists) { alert("Un rapport existe déjà pour ce chauffeur à cette date."); setSaving(false); return; }
      await supabase.from("daily_reports").insert({
        driver_id: addDriver, date: addModal.date, status: "approved",
        comment: `[REPOS]${addMotif ? " " + addMotif : ""}`,
        gross_earnings: 0, yango_gross: 0, yango_bonus: 0, off_yango_revenue: 0,
        net_after_expenses: 0, commission_rate: 0, commission_amount: 0, expense_count: 0,
      });
      setAddModal(null); setAddMotif(""); setAddDriver("");
      await load();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const deleteEvent = async (id: string) => {
    if (!confirm("Supprimer cet événement ?")) return;
    const supabase = createClient() as any;
    await supabase.from("daily_reports").delete().eq("id", id);
    await load();
  };

  const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const DAYS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  const todayStr = today.toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-white">📅 Calendrier chauffeurs</h2>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>‹</button>
          <span className="text-sm font-bold text-white px-3">{MONTHS[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>›</button>
          <button onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold ml-1"
            style={{ background: "var(--sk-surface)", color: "var(--sk-t3)" }}>Aujourd'hui</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap text-xs">
        {[["#6366f1","Repos planifié"],["#22c55e","Travaillé"],["#f5a623","En attente"],["#ef4444","Rejeté"]].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: c }} /><span style={{ color: "var(--sk-t2)" }}>{l}</span></div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="text-center py-12" style={{ color: "var(--sk-t4)" }}>Chargement...</div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--sk-surface)" }}>
          {/* Day headers */}
          <div className="grid grid-cols-7" style={{ background: "var(--sk-bg)", borderBottom: "1px solid var(--sk-surface)" }}>
            {DAYS.map(d => (
              <div key={d} className="text-center py-2 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--sk-t4)" }}>{d}</div>
            ))}
          </div>
          {/* Weeks */}
          <div className="grid grid-cols-7" style={{ background: "var(--sk-deep)" }}>
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} style={{ borderRight: "1px solid var(--sk-bg)", borderBottom: "1px solid var(--sk-bg)", minHeight: 80 }} />
            ))}
            {days.map((day) => {
              const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
              const dayEvents = eventsForDay(day);
              const isToday = dateStr === todayStr;
              const isPast = dateStr < todayStr;
              const isFuture = dateStr > todayStr;
              return (
                <div key={day} onClick={() => { if (!isFuture || true) { setAddModal({ date: dateStr }); if (drivers.length === 1) setAddDriver(drivers[0].id); } }}
                  className="cursor-pointer transition-all hover:bg-opacity-80"
                  style={{ borderRight: "1px solid var(--sk-bg)", borderBottom: "1px solid var(--sk-bg)", minHeight: 80, padding: "6px", background: isToday ? "rgba(245,166,35,.05)" : "transparent" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold" style={{ color: isToday ? "#f5a623" : isPast ? "var(--sk-t4)" : "var(--sk-t2)",
                      background: isToday ? "rgba(245,166,35,.15)" : "transparent", borderRadius: 4, padding: "0 3px" }}>
                      {day}
                    </span>
                    {isFuture && <span className="text-[9px]" style={{ color: "#2a2f3d" }}>+</span>}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((e) => {
                      const isRepos = e.comment?.startsWith("[REPOS]");
                      const color = isRepos
                        ? (e.status === "approved" ? "#6366f1" : e.status === "rejected" ? "#ef4444" : "#a5b4fc")
                        : (e.status === "approved" ? "#22c55e" : e.status === "rejected" ? "#ef4444" : "#f5a623");
                      return (
                        <div key={e.id} onClick={(ev) => { ev.stopPropagation(); }}
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold truncate flex items-center justify-between group"
                          style={{ background: color + "20", color, border: `1px solid ${color}40` }}>
                          <span className="truncate">{isRepos ? "🛌" : "✓"} {driverName(e.driver_id)}</span>
                          <button onClick={(ev) => { ev.stopPropagation(); deleteEvent(e.id); }}
                            className="ml-1 opacity-0 group-hover:opacity-100 text-[9px] flex-shrink-0"
                            style={{ color: "#ef4444" }}>✕</button>
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && <div className="text-[9px]" style={{ color: "var(--sk-t4)" }}>+{dayEvents.length - 3} autres</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add repos modal */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,.75)" }} onClick={() => setAddModal(null)}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-bold text-white">📅 {addModal.date}</div>
              <button onClick={() => setAddModal(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Chauffeur</label>
              <select value={addDriver} onChange={(e) => setAddDriver(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
                <option value="">-- Sélectionner --</option>
                {allDrivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} {d.plate ? `· ${d.plate}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>Motif (optionnel)</label>
              <input type="text" value={addMotif} onChange={(e) => setAddMotif(e.target.value)}
                placeholder="Congé, maladie, entretien..." className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }} />
            </div>
            <button onClick={addRepos} disabled={saving || !addDriver}
              className="w-full py-3 rounded-xl text-sm font-bold"
              style={{ background: saving || !addDriver ? "var(--sk-surface)" : "linear-gradient(135deg,#6366f1,#4f46e5)",
                color: saving || !addDriver ? "var(--sk-t4)" : "#fff" }}>
              {saving ? "Enregistrement..." : "🛌 Planifier le repos"}
            </button>
          </div>
        </div>
      )}

      {/* Driver summary for the month */}
      {drivers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {drivers.map((d) => {
            const dEvents = events.filter(e => e.driver_id === d.id);
            const reposCount = dEvents.filter(e => e.comment?.startsWith("[REPOS]")).length;
            const travailCount = dEvents.filter(e => !e.comment?.startsWith("[REPOS]")).length;
            const totalNet = dEvents.filter(e => !e.comment?.startsWith("[REPOS]")).reduce((s, e) => s + (e.net_after_expenses || 0), 0);
            return (
              <div key={d.id} className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-black"
                    style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>{d.full_name[0]}</div>
                  <div>
                    <div className="text-sm font-bold text-white">{d.full_name}</div>
                    {d.plate && <div className="text-[10px] font-mono" style={{ color: "var(--sk-t4)" }}>{d.plate}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl py-2" style={{ background: "var(--sk-deep)" }}>
                    <div className="text-lg font-bold" style={{ color: "#22c55e" }}>{travailCount}</div>
                    <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>Jours travaillés</div>
                  </div>
                  <div className="rounded-xl py-2" style={{ background: "var(--sk-deep)" }}>
                    <div className="text-lg font-bold" style={{ color: "#6366f1" }}>{reposCount}</div>
                    <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>Repos</div>
                  </div>
                  <div className="rounded-xl py-2" style={{ background: "var(--sk-deep)" }}>
                    <div className="text-sm font-bold font-mono" style={{ color: "#f5a623" }}>{(totalNet / 1000).toFixed(0)}k</div>
                    <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>Net XOF</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── KPI CARD ─────────────────────────────────────────
// ─── ACTION LOGS TAB ──────────────────────────────────
function ActionLogsTab({ filterDriverId = "" }: { filterDriverId?: string }) {
  const [allLogs, setAllLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const [{ data: logsData }, { data: profs }] = await Promise.all([
        supabase.from("action_logs").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("profiles").select("id, full_name"),
      ]);
      const pm: Record<string, string> = {};
      (profs || []).forEach((p: any) => { pm[p.id] = p.full_name; });
      setProfiles(pm);
      setAllLogs(logsData || []);
      setLoading(false);
    })();
  }, []);

  const logs = filterDriverId
    ? allLogs.filter((l) => l.actor_id === filterDriverId || l.driver_id === filterDriverId)
    : allLogs;

  const actionLabel: Record<string, [string, string]> = {
    submitted: ["⏳", "#f5a623"],
    approved:  ["✅", "#22c55e"],
    rejected:  ["❌", "#ef4444"],
    edited:    ["✏️", "#3b82f6"],
  };

  const entityLabel: Record<string, string> = {
    daily_report: "Rapport",
    expense: "Dépense",
  };

  if (loading) return <div className="text-center py-16 text-sm" style={{ color: "var(--sk-t3)" }}>Chargement...</div>;

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-6">📋 Journal des actions</h2>
      {logs.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: "var(--sk-t3)" }}>Aucune action enregistrée</div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const [icon, color] = actionLabel[log.action] || ["•", "var(--sk-t3)"];
            return (
              <div key={log.id} className="flex items-start gap-3 rounded-xl px-4 py-3"
                style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                <span className="text-lg mt-0.5">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white"
                      style={{ color }}>
                      {log.action.charAt(0).toUpperCase() + log.action.slice(1)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
                      {entityLabel[log.entity_type] || log.entity_type}
                    </span>
                    <span className="text-xs" style={{ color: "var(--sk-t3)" }}>
                      par <span style={{ color: "var(--sk-t2)" }}>{log.actor_role === "driver" ? (profiles[log.actor_id] || "chauffeur") : "admin"}</span>
                    </span>
                  </div>
                  {log.metadata && (
                    <div className="text-xs mt-0.5" style={{ color: "var(--sk-t4)" }}>
                      {log.entity_type === "expense" && `${log.metadata.category} · ${new Intl.NumberFormat("fr-FR").format(log.metadata.amount)} XOF`}
                      {log.entity_type === "daily_report" && `Date ${log.metadata.date} · Net ${new Intl.NumberFormat("fr-FR").format(log.metadata.net)} XOF`}
                    </div>
                  )}
                </div>
                <div className="text-xs whitespace-nowrap" style={{ color: "var(--sk-t4)" }}>
                  {new Date(log.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── REMUNERATION SETTINGS TAB ───────────────────────
type RemuModel = "fixed" | "tiered" | "percent" | "hybrid" | "location";
interface SalaryTier { min_net: number; total_salary: number; label: string }
interface RemunCfg {
  model: RemuModel;
  base_amount: number;
  commission_rate: number;
  bonus_threshold: number;
  bonus_amount: number;
  comm_yango: number;
  comm_partner: number;
  salary_tiers: SalaryTier[];
  target_net: number;
  daily_rent: number;
}

const MODEL_LABELS: Record<RemuModel, string> = {
  fixed:    "Salaire fixe mensuel",
  tiered:   "Paliers selon CA net",
  percent:  "Pourcentage du CA",
  hybrid:   "Fixe + bonus seuil",
  location: "Loyer journalier (driver auto-géré)",
};

function RemunerationSettingsTab({ tenantId }: { tenantId: string }) {
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)) + " XOF";
  const [cfg, setCfg] = useState<RemunCfg>({
    model: "tiered", base_amount: 0, commission_rate: 0, bonus_threshold: 0, bonus_amount: 0,
    comm_yango: 15, comm_partner: 0.75, salary_tiers: [], target_net: 0, daily_rent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("remuneration_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (data) {
        setConfigId(data.id);
        setCfg({
          model: data.model || "tiered",
          base_amount: data.base_amount || 0,
          commission_rate: data.commission_rate || 0,
          bonus_threshold: data.bonus_threshold || 0,
          bonus_amount: data.bonus_amount || 0,
          comm_yango: data.comm_yango ?? 15,
          comm_partner: data.comm_partner ?? 0.75,
          salary_tiers: Array.isArray(data.salary_tiers) ? data.salary_tiers : [],
          target_net: data.target_net || 0,
          daily_rent: data.daily_rent || 0,
        });
      }
      setLoading(false);
    })();
  }, [tenantId]);

  const set = (k: keyof RemunCfg, v: any) => setCfg((c) => ({ ...c, [k]: v }));
  const setTier = (i: number, k: keyof SalaryTier, v: any) => {
    const tiers = [...cfg.salary_tiers];
    tiers[i] = { ...tiers[i], [k]: k === "label" ? v : parseFloat(v) || 0 };
    set("salary_tiers", tiers);
  };
  const addTier = () => set("salary_tiers", [...cfg.salary_tiers, { min_net: 0, total_salary: 0, label: `Palier ${cfg.salary_tiers.length + 1}` }]);
  const removeTier = (i: number) => set("salary_tiers", cfg.salary_tiers.filter((_, j) => j !== i));

  const save = async () => {
    setSaving(true);
    const supabase = createClient() as any;
    const payload = { ...cfg, tenant_id: tenantId, updated_at: new Date().toISOString() };
    const { error } = configId
      ? await supabase.from("remuneration_config").update(payload).eq("id", configId)
      : await supabase.from("remuneration_config").insert(payload);
    setSaving(false);
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    else alert("Erreur : " + error.message);
  };

  const inp = "w-full rounded-xl px-3 py-2 text-sm text-white font-mono";
  const inpStyle = { background: "var(--sk-deep)", border: "1px solid #2a2f3d", outline: "none" };
  const lbl = "text-xs uppercase tracking-wider font-semibold mb-1 block";

  if (loading) return <div className="py-20 text-center text-sm" style={{ color: "var(--sk-t4)" }}>Chargement...</div>;

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-white mb-1">💼 Rémunération</h2>
      <p className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>Configuration du modèle de paiement des chauffeurs pour ce tenant.</p>

      {/* Model selector */}
      <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <label className={lbl} style={{ color: "var(--sk-t4)" }}>Modèle de rémunération</label>
        <div className="grid grid-cols-1 gap-2 mt-2">
          {(Object.entries(MODEL_LABELS) as [RemuModel, string][]).map(([key, label]) => (
            <button key={key} onClick={() => set("model", key)}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all"
              style={{
                background: cfg.model === key ? "rgba(245,166,35,.1)" : "var(--sk-deep)",
                border: `1px solid ${cfg.model === key ? "rgba(245,166,35,.4)" : "var(--sk-surface)"}`,
              }}>
              <div className="w-3 h-3 rounded-full border-2 flex-shrink-0" style={{ borderColor: cfg.model === key ? "#f5a623" : "#2a2f3d", background: cfg.model === key ? "#f5a623" : "transparent" }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: cfg.model === key ? "#f5a623" : "var(--sk-t2)" }}>{label}</div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t4)" }}>
                  {key === "fixed"    && "Salaire fixe peu importe le CA. Idéal pour partenariats stables."}
                  {key === "tiered"   && "Grille de paliers : le salaire monte avec le CA net mensuel."}
                  {key === "percent"  && "Le chauffeur garde X% du CA net. Simple et proportionnel."}
                  {key === "hybrid"   && "Salaire fixe + bonus débloqué si un seuil CA est atteint."}
                  {key === "location" && "Le chauffeur paie un loyer/jour à l'opérateur. Gère lui-même ses charges et son salaire."}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Commissions (tous modèles) */}
      <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="text-xs uppercase tracking-wider font-semibold mb-4" style={{ color: "var(--sk-t4)" }}>Commissions plateformes</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl} style={{ color: "var(--sk-t3)" }}>Commission Yango (%)</label>
            <input type="number" value={cfg.comm_yango} onChange={(e) => set("comm_yango", parseFloat(e.target.value) || 0)}
              className={inp} style={inpStyle} step="0.1" />
            <div className="text-[10px] mt-1" style={{ color: "var(--sk-t4)" }}>Prélevée par Yango sur le brut</div>
          </div>
          <div>
            <label className={lbl} style={{ color: "var(--sk-t3)" }}>Commission Partenaire (%)</label>
            <input type="number" value={cfg.comm_partner} onChange={(e) => set("comm_partner", parseFloat(e.target.value) || 0)}
              className={inp} style={inpStyle} step="0.01" />
            <div className="text-[10px] mt-1" style={{ color: "var(--sk-t4)" }}>Prélevée en plus par l'opérateur</div>
          </div>
        </div>
      </div>

      {/* Fixed */}
      {cfg.model === "fixed" && (
        <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-4" style={{ color: "var(--sk-t4)" }}>Salaire fixe</div>
          <label className={lbl} style={{ color: "var(--sk-t3)" }}>Montant mensuel (XOF)</label>
          <input type="number" value={cfg.base_amount} onChange={(e) => set("base_amount", parseFloat(e.target.value) || 0)}
            className={inp} style={inpStyle} />
        </div>
      )}

      {/* Tiered */}
      {cfg.model === "tiered" && (
        <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--sk-t4)" }}>Grille de paliers</div>
            <button onClick={addTier} className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: "rgba(245,166,35,.1)", color: "#f5a623", border: "1px solid rgba(245,166,35,.2)" }}>
              + Ajouter palier
            </button>
          </div>
          <div className="text-[10px] mb-3 px-3 py-2 rounded-lg" style={{ background: "var(--sk-deep)", color: "var(--sk-t3)" }}>
            Le premier palier (CA min = 0) est le salaire de base. Les suivants se débloquent quand le CA net mensuel dépasse le seuil.
          </div>
          {cfg.salary_tiers.map((t, i) => (
            <div key={i} className="rounded-xl p-3 mb-2" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div>
                  <label className={lbl} style={{ color: "var(--sk-t4)" }}>Libellé</label>
                  <input value={t.label} onChange={(e) => setTier(i, "label", e.target.value)}
                    className={inp} style={inpStyle} />
                </div>
                <div>
                  <label className={lbl} style={{ color: "var(--sk-t4)" }}>CA min (XOF)</label>
                  <input type="number" value={t.min_net} onChange={(e) => setTier(i, "min_net", e.target.value)}
                    className={inp} style={inpStyle} />
                </div>
                <div>
                  <label className={lbl} style={{ color: "var(--sk-t4)" }}>Salaire (XOF)</label>
                  <input type="number" value={t.total_salary} onChange={(e) => setTier(i, "total_salary", e.target.value)}
                    className={inp} style={inpStyle} />
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--sk-t4)" }}>
                <span>≥ {xof(t.min_net)} → {xof(t.total_salary)}</span>
                {cfg.salary_tiers.length > 1 && (
                  <button onClick={() => removeTier(i)} className="text-red-500 hover:text-red-400">✕ Supprimer</button>
                )}
              </div>
            </div>
          ))}
          <div className="mt-3">
            <label className={lbl} style={{ color: "var(--sk-t3)" }}>Objectif CA net mensuel (XOF) <span style={{ color: "var(--sk-t4)" }}>— pour le Pilotage chauffeur</span></label>
            <input type="number" value={cfg.target_net} onChange={(e) => set("target_net", parseFloat(e.target.value) || 0)}
              className={inp} style={inpStyle} />
          </div>
        </div>
      )}

      {/* Percent */}
      {cfg.model === "percent" && (
        <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-4" style={{ color: "var(--sk-t4)" }}>Part du chauffeur</div>
          <label className={lbl} style={{ color: "var(--sk-t3)" }}>% du CA net reversé au chauffeur (0–1)</label>
          <input type="number" value={cfg.commission_rate} onChange={(e) => set("commission_rate", parseFloat(e.target.value) || 0)}
            className={inp} style={inpStyle} step="0.01" min="0" max="1" />
          <div className="text-[10px] mt-1" style={{ color: "var(--sk-t4)" }}>Ex : 0.60 = le chauffeur garde 60% du CA net</div>
        </div>
      )}

      {/* Hybrid */}
      {cfg.model === "hybrid" && (
        <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-4" style={{ color: "var(--sk-t4)" }}>Fixe + bonus</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl} style={{ color: "var(--sk-t3)" }}>Salaire fixe (XOF)</label>
              <input type="number" value={cfg.base_amount} onChange={(e) => set("base_amount", parseFloat(e.target.value) || 0)}
                className={inp} style={inpStyle} />
            </div>
            <div>
              <label className={lbl} style={{ color: "var(--sk-t3)" }}>Seuil CA pour bonus (XOF)</label>
              <input type="number" value={cfg.bonus_threshold} onChange={(e) => set("bonus_threshold", parseFloat(e.target.value) || 0)}
                className={inp} style={inpStyle} />
            </div>
            <div>
              <label className={lbl} style={{ color: "var(--sk-t3)" }}>Montant bonus (XOF)</label>
              <input type="number" value={cfg.bonus_amount} onChange={(e) => set("bonus_amount", parseFloat(e.target.value) || 0)}
                className={inp} style={inpStyle} />
            </div>
            <div>
              <label className={lbl} style={{ color: "var(--sk-t3)" }}>% commission (optionnel, 0–1)</label>
              <input type="number" value={cfg.commission_rate} onChange={(e) => set("commission_rate", parseFloat(e.target.value) || 0)}
                className={inp} style={inpStyle} step="0.01" />
            </div>
          </div>
        </div>
      )}

      {/* Location */}
      {cfg.model === "location" && (
        <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-4" style={{ color: "var(--sk-t4)" }}>Loyer journalier</div>
          <label className={lbl} style={{ color: "var(--sk-t3)" }}>Montant loyer/jour (XOF)</label>
          <input type="number" value={cfg.daily_rent} onChange={(e) => set("daily_rent", parseFloat(e.target.value) || 0)}
            className={inp} style={inpStyle} />
          <div className="text-[10px] mt-2 px-3 py-2 rounded-lg" style={{ background: "var(--sk-deep)", color: "var(--sk-t3)" }}>
            Le chauffeur paie ce montant chaque jour travaillé à l'opérateur. Il conserve le reste de ses recettes et gère lui-même son salaire, carburant et autres charges. Le Pilotage chauffeur affiche le loyer dû et le net après loyer.
          </div>
          <div className="mt-4">
            <label className={lbl} style={{ color: "var(--sk-t3)" }}>Objectif CA net mensuel (XOF) <span style={{ color: "var(--sk-t4)" }}>— optionnel, pour le Pilotage</span></label>
            <input type="number" value={cfg.target_net} onChange={(e) => set("target_net", parseFloat(e.target.value) || 0)}
              className={inp} style={inpStyle} />
          </div>
        </div>
      )}

      {/* Save */}
      <button onClick={save} disabled={saving}
        className="w-full py-3 rounded-xl font-semibold text-black transition-all"
        style={{ background: saved ? "#22c55e" : saving ? "#2a2f3d" : "#f5a623", color: saving ? "var(--sk-t3)" : "#000" }}>
        {saving ? "Enregistrement..." : saved ? "✓ Enregistré !" : "Enregistrer la configuration"}
      </button>
    </div>
  );
}

function KPICard({ label, value, color, sub, negative, big, hideWhenZero, showZeros }: {
  label: string; value: number; color: string; sub?: string; negative?: boolean; big?: boolean;
  hideWhenZero?: boolean; showZeros?: boolean;
}) {
  // Audit UI : les postes à zéro sont masqués par défaut (allègement du dashboard),
  // révélés par le lien « Afficher tout ». Trésorerie/Encaissements n'utilisent
  // jamais ce flag — un zéro y est une info critique.
  if (hideWhenZero && !showZeros && Math.round(value) === 0) return null;
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(Math.abs(n)));
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderLeft: `3px solid ${color}` }}>
      <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--sk-t3)" }}>{label}</div>
      <div className={`font-mono font-bold ${big ? "text-2xl" : "text-xl"}`} style={{ color }}>
        {negative ? "- " : ""}{xof(value)}
        <span className="text-xs ml-1" style={{ color: "var(--sk-t4)" }}>XOF</span>
      </div>
      {sub && <div className="text-xs mt-1" style={{ color: "var(--sk-t4)" }}>{sub}</div>}
    </div>
  );
}

// ── Audit UI — Hero bar : les 3 KPIs décisionnels, toujours visibles en tête
// de dashboard (lisibilité en 5 s). Affichage seul, données inchangées.
function HeroCard({ label, value, color, sub, primary }: {
  label: string; value: number; color: string; sub?: string; primary?: boolean;
}) {
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(Math.abs(n)));
  return (
    <div className="rounded-2xl p-5" style={{
      background: primary ? "linear-gradient(135deg, rgba(34,197,94,.06), var(--sk-bg) 60%)" : "var(--sk-bg)",
      border: `1px solid ${primary ? "rgba(34,197,94,.25)" : "var(--sk-surface)"}`,
      borderLeft: `3px solid ${color}`,
    }}>
      <div className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--sk-t2)" }}>{label}</div>
      <div className="font-mono font-bold" style={{ color, fontSize: "1.9rem", lineHeight: 1.15 }}>
        {value < 0 ? "- " : ""}{xof(value)}
        <span className="text-xs font-normal ml-1.5" style={{ color: "var(--sk-t3)" }}>XOF</span>
      </div>
      {sub && <div className="text-xs mt-1.5" style={{ color: "var(--sk-t3)" }}>{sub}</div>}
    </div>
  );
}

// ── Audit UI — Section repliable : allège le dashboard en repliant les détails
// par défaut, sans rien supprimer. État purement visuel (aucune donnée touchée).
function AccordionSection({ title, subtitle, defaultOpen, right, children }: {
  title: string; subtitle?: string; defaultOpen?: boolean; right?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#0b0e14", border: "1px solid var(--sk-surface)" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors"
        style={{ background: "transparent" }}>
        <div className="flex-1 min-w-0">
          <div className="text-sm uppercase tracking-widest font-semibold" style={{ color: "#9ca3af" }}>{title}</div>
          {subtitle && <div className="text-xs mt-0.5" style={{ color: "var(--sk-t4)" }}>{subtitle}</div>}
        </div>
        {right}
        <span className="text-xs flex-shrink-0 transition-transform" style={{ color: "var(--sk-t3)", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t" style={{ borderColor: "var(--sk-surface)" }}>{children}</div>}
    </div>
  );
}

// ── Audit UI — Squelette de chargement : reproduit la silhouette du dashboard
// (hero + graphe + accordéons) au lieu d'un texte « Chargement… », pour un ressenti premium.
function SkelBox({ h, className = "" }: { h: number; className?: string }) {
  return <div className={`rounded-xl animate-pulse ${className}`} style={{ height: h, background: "var(--sk-surface)", opacity: 0.55 }} />;
}
function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement du tableau de bord">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">
        <SkelBox h={104} /><SkelBox h={104} /><SkelBox h={104} />
      </div>
      <SkelBox h={320} />
      <SkelBox h={64} /><SkelBox h={64} /><SkelBox h={64} />
    </div>
  );
}

// ── Alertes opérationnelles : surface ce qui demande une action et n'est visible
// nulle part ailleurs (chauffeurs inactifs, rapports en attente trop longs). Lecture seule.
function AlertsPanel() {
  const [alerts, setAlerts] = useState<{ kind: string; severity: string; title: string; detail: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/alerts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.alerts && setAlerts(d.alerts))
      .catch(() => {});
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((a) => {
        const warn = a.severity === "warn";
        const color = warn ? "#f5a623" : "#60a5fa";
        const Icon = warn ? AlertTriangle : Info;
        return (
          <div key={a.kind} className="rounded-xl px-5 py-3 flex items-start gap-3"
            style={{ background: warn ? "rgba(245,166,35,.06)" : "rgba(96,165,250,.06)", border: `1px solid ${warn ? "rgba(245,166,35,.22)" : "rgba(96,165,250,.22)"}` }}>
            <Icon size={17} strokeWidth={2} style={{ color, flexShrink: 0, marginTop: 1 }} />
            <div className="min-w-0">
              <div className="text-sm font-semibold" style={{ color: "var(--sk-t1)" }}>{a.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--sk-t3)" }}>{a.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Relance chauffeurs : liste les chauffeurs actifs SANS rapport aujourd'hui et
// permet de leur envoyer un rappel (notification in-app + push best-effort).
function RemindBanner() {
  const [state, setState] = useState<{ count: number; drivers: { id: string; name: string }[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/remind-drivers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {});
  }, []);

  if (!state || state.count === 0) return null;

  const remind = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/admin/remind-drivers", { method: "POST" });
      const j = await res.json().catch(() => ({} as any));
      if (res.ok) setDone(j.reminded ?? 0);
    } finally { setSending(false); }
  };

  const names = state.drivers.map((d) => d.name).join(", ");
  return (
    <div className="rounded-xl px-5 py-3.5 flex items-center gap-4 flex-wrap"
      style={{ background: "rgba(245,166,35,.07)", border: "1px solid rgba(245,166,35,.25)" }}>
      <BellRing size={18} strokeWidth={2} style={{ color: "#f5a623", flexShrink: 0 }} />
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-semibold" style={{ color: "var(--sk-t1)" }}>
          {state.count} chauffeur{state.count > 1 ? "s" : ""} sans rapport aujourd'hui
        </div>
        <div className="text-xs mt-0.5 truncate" style={{ color: "var(--sk-t3)" }}>{names}</div>
      </div>
      {done != null ? (
        <span className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "#22c55e" }}>
          ✓ {done} relancé{done > 1 ? "s" : ""}
        </span>
      ) : (
        <button onClick={remind} disabled={sending}
          className="text-sm px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
          style={{ background: "#f5a623", color: "#000" }}>
          {sending ? "Envoi…" : "Relancer"}
        </button>
      )}
    </div>
  );
}

// ── Export comptable : télécharge un CSV (Excel FR, séparateur ';' + BOM) de la
// période affichée. Auth par cookie de session (même mécanisme que /api/admin/kpis).
function ExportMenu({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const download = async (resource: string) => {
    setBusy(resource); setErr(null);
    try {
      const res = await fetch(`/api/admin/export?resource=${resource}&dateFrom=${dateFrom}&dateTo=${dateTo}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any));
        setErr(j.error || "Export impossible.");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="(.+?)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = m ? m[1] : `${resource}.csv`; a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setErr("Erreur réseau pendant l'export.");
    } finally { setBusy(null); }
  };

  const items: [string, string][] = [
    ["reports", "Rapports journaliers"],
    ["expenses", "Dépenses"],
    ["payments", "Paiements / salaires"],
  ];

  return (
    <div className="relative">
      <button onClick={() => { setOpen((o) => !o); setErr(null); }}
        className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg font-semibold transition-colors"
        style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid var(--sk-border)" }}>
        <Download size={15} strokeWidth={2} /> Exporter
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 z-50 rounded-xl overflow-hidden min-w-[210px]"
          style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-border)", boxShadow: "0 12px 32px rgba(0,0,0,.45)" }}>
          {items.map(([r, label]) => (
            <button key={r} onClick={() => download(r)} disabled={!!busy}
              className="w-full text-left text-sm px-4 py-2.5 disabled:opacity-50"
              style={{ color: "var(--sk-t2)" }}>
              {busy === r ? "Préparation…" : label}
            </button>
          ))}
          {err && <div className="text-xs px-4 py-2 border-t" style={{ color: "#f87171", borderColor: "var(--sk-surface)" }}>{err}</div>}
          <div className="text-[10px] px-4 py-2 border-t" style={{ color: "var(--sk-t4)", borderColor: "var(--sk-surface)" }}>
            Période affichée · format Excel FR
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit UI — État vide : au lieu de faire disparaître les graphes en silence,
// on explique quoi faire pour que les données apparaissent.
function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="rounded-2xl flex flex-col items-center text-center px-6 py-14"
      style={{ background: "var(--sk-bg)", border: "1px dashed var(--sk-border)" }}>
      <div className="rounded-2xl p-3 mb-4" style={{ background: "var(--sk-surface)" }}>
        <Icon size={26} strokeWidth={1.8} style={{ color: "var(--sk-t3)" }} />
      </div>
      <div className="font-semibold text-sm" style={{ color: "var(--sk-t1)" }}>{title}</div>
      {hint && <div className="text-xs mt-1.5 max-w-sm" style={{ color: "var(--sk-t3)" }}>{hint}</div>}
    </div>
  );
}
