"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/context";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
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

export default function AdminPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("dashboard");
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<DailyReport>>({});
  const [loadingReports, setLoadingReports] = useState(false);

  // Driver / vehicle filter (global, shared across tabs)
  const [filterDriverId, setFilterDriverId] = useState("");
  const [allDrivers, setAllDrivers] = useState<any[]>([]); // { id, full_name, driver_id, plate }

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const [{ data: profs }, { data: vehs }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, driver_id").eq("role", "driver").order("full_name"),
        supabase.from("vehicles").select("driver_id, plate"),
      ]);
      const plateMap = Object.fromEntries((vehs || []).map((v: any) => [v.driver_id, v.plate]));
      setAllDrivers((profs || []).map((p: any) => ({ ...p, plate: plateMap[p.id] || null })));
    })();
  }, []);

  // Date filter for dashboard
  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonths, setFilterMonths] = useState<number[]>([now.getMonth() + 1]);
  const periodFrom = `${filterYear}-${String(Math.min(...filterMonths)).padStart(2, "0")}-01`;
  const lastMonth = Math.max(...filterMonths);
  const lastDay = new Date(filterYear, lastMonth, 0).getDate();
  const periodTo = `${filterYear}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const kpis = useDashboardKPIs(periodFrom, periodTo);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user && (tab === "history" || tab === "pending")) {
      loadReports();
    }
  }, [user, tab]);

  const loadReports = async () => {
    setLoadingReports(true);
    try {
      const supabase = createClient() as any;
      const [{ data: rData }, { data: eData }] = await Promise.all([
        supabase.from("daily_reports").select("*").order("date", { ascending: false }).limit(200),
        supabase.from("expenses").select("*").order("expense_date", { ascending: false, nullsFirst: false }).limit(200),
      ]);
      setReports(rData || []);
      // Enrich expenses with driver name from profiles
      const expList = eData || [];
      if (expList.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name, driver_id");
        const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
        setExpenses(expList.map((e: any) => ({ ...e, _profile: profileMap[e.driver_id] })));
      } else {
        setExpenses([]);
      }
    } catch (err) {
      console.error("Error loading:", err);
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

  const tabs = [
    ["dashboard", "📊 Dashboard"],
    ["pending", "⏳ Soumissions"],
    ["history", "📜 Historique"],
    ["calendrier", "📅 Calendrier"],
    ["payments", "💵 Paiements"],
    ["pilotage", "🎯 Pilotage"],
    ["vehicles", "🔧 Véhicules"],
    ["avances", "💰 Avances"],
    ["drivers", "🚗 Conducteurs"],
    ["settings", "⚙️ Paramètres"],
  ];

  return (
    <div className="min-h-screen flex" style={{ background: "#080a0f" }}>

      {/* ── SIDEBAR DESKTOP (lg+) ── */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 h-full z-50"
        style={{ width: 220, background: "#0d1117", borderRight: "1px solid #1e2330" }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b" style={{ borderColor: "#1e2330" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-black text-sm"
              style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>Y</div>
            <div>
              <div className="font-bold text-white text-sm">Yango Fleet</div>
              <div className="text-[10px]" style={{ color: "#3d4560" }}>Powered by M3A Solution</div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2.5"
              style={{
                background: tab === id ? "rgba(245,166,35,.12)" : "transparent",
                color: tab === id ? "#f5a623" : "#555e75",
                border: `1px solid ${tab === id ? "rgba(245,166,35,.2)" : "transparent"}`,
              }}>
              <span className="text-base leading-none">{label.split(" ")[0]}</span>
              <span>{label.split(" ").slice(1).join(" ")}</span>
            </button>
          ))}
        </nav>

        {/* User + logout */}
        <div className="px-3 py-4 border-t" style={{ borderColor: "#1e2330" }}>
          <div className="px-3 py-2 rounded-xl" style={{ background: "#1e2330" }}>
            <div className="text-xs font-semibold text-white mb-0.5">Abdoulaye G.</div>
            <div className="text-[10px]" style={{ color: "#3d4560" }}>Administrateur</div>
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
        style={{ background: "rgba(13,17,23,.97)", borderBottom: "1px solid #1e2330", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-black text-xs"
            style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>Y</div>
          <span className="font-bold text-white text-sm">Yango Fleet</span>
        </div>
        <button onClick={() => signOut()} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "#1e2330", color: "#8b92a8" }}>
          Déconnexion
        </button>
      </div>

      {/* ── MOBILE NAV TABS ── */}
      <div className="lg:hidden fixed top-12 left-0 right-0 z-40 flex gap-0.5 overflow-x-auto px-2 py-1.5"
        style={{ background: "#0d1117", borderBottom: "1px solid #1e2330" }}>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap"
            style={{ background: tab === id ? "rgba(245,166,35,.12)" : "transparent", color: tab === id ? "#f5a623" : "#555e75" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 min-h-screen" style={{ marginLeft: 0 }}>
        <div className="lg:hidden" style={{ height: 88 }} /> {/* mobile header offset */}
        <div className="lg:pl-[220px]">
        <div className="p-6 lg:p-10 w-full max-w-none" style={{ background: "#080a0f", minHeight: "100vh" }}>

        {/* ── DRIVER / VEHICLE FILTER BAR ── */}
        {["pending", "history", "calendrier", "payments", "avances", "dashboard"].includes(tab) && allDrivers.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#3d4560" }}>Filtrer :</span>
            <button onClick={() => setFilterDriverId("")}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
              style={{ background: !filterDriverId ? "#f5a623" : "#1e2330", color: !filterDriverId ? "#000" : "#555e75" }}>
              Tous
            </button>
            {allDrivers.map((d) => (
              <button key={d.id} onClick={() => setFilterDriverId(filterDriverId === d.id ? "" : d.id)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5"
                style={{ background: filterDriverId === d.id ? "rgba(245,166,35,.15)" : "#1e2330",
                  color: filterDriverId === d.id ? "#f5a623" : "#555e75",
                  border: `1px solid ${filterDriverId === d.id ? "rgba(245,166,35,.35)" : "transparent"}` }}>
                <span>👤 {d.full_name}</span>
                {d.plate && <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: "#080a0f", color: "#8b92a8", fontSize: 10 }}>🚗 {d.plate}</span>}
              </button>
            ))}
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
                        style={{ background: active ? "#f5a623" : "#1e2330", color: active ? "#000" : "#555e75" }}>
                        {m}
                      </button>
                    );
                  })}
                  <button onClick={() => setFilterMonths([1,2,3,4,5,6,7,8,9,10,11,12])}
                    className="text-xs px-2 py-1 rounded-lg font-semibold"
                    style={{ background: filterMonths.length === 12 ? "#f5a623" : "#1e2330", color: filterMonths.length === 12 ? "#000" : "#555e75" }}>
                    Année
                  </button>
                </div>
                <span className="text-xs" style={{ color: "#555e75" }}>{periodFrom} → {periodTo}</span>
              </div>
            </div>

            {kpis.loading ? (
              <div className="text-center text-gray-400 py-12">Chargement des données...</div>
            ) : (
              <>
                {/* ── PÉRIODE SÉLECTIONNÉE ── */}
                <div>
                  <h3 className="text-sm uppercase text-gray-400 tracking-widest font-semibold mb-4">
                    Période — Recettes vs Charges
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
                    <KPICard label="Brut Yango" value={kpis.brutYango} color="#f5a623" sub={`Moy/jour: ${kpis.avgBrutPerDay.toLocaleString("fr-FR")} XOF`} />
                    <KPICard label="Net Yango" value={kpis.netYango} color="#3b82f6" sub="Après commission" />
                    <KPICard label="Hors Yango" value={kpis.horsYango} color="#a855f7" sub="Recettes off-platform" />
                    <KPICard label="Total Recettes (net)" value={kpis.totalBrut} color="#22c55e" sub={`Moy/jour: ${kpis.avgNetPerDay.toLocaleString("fr-FR")} XOF`} />
                    <KPICard label="Total Dépenses" value={kpis.totalDepenses} color="#ef4444" negative sub={`Moy/jour: ${kpis.avgDepensesPerDay.toLocaleString("fr-FR")} XOF`} />
                    <KPICard label="NET FINAL" value={kpis.netFinal} color={kpis.netFinal >= 0 ? "#22c55e" : "#ef4444"} big sub={`${kpis.monthMarginPercent.toFixed(1)}% de marge`} />
                  </div>
                </div>

                {/* ── AUJOURD'HUI ── */}
                <div>
                  <h3 className="text-sm uppercase text-gray-400 tracking-widest font-semibold mb-4">
                    Aujourd'hui</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800 border-l-4 border-yellow-500 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Revenus
                      </div>
                      <div className="text-2xl font-bold text-white font-mono mt-2">
                        {kpis.todayRevenue.toLocaleString("fr-FR")}
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
                        {kpis.todayExpenses.toLocaleString("fr-FR")}
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
                        {kpis.todayNetMargin.toLocaleString("fr-FR")}
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
                </div>

                {/* Week KPIs */}
                <div>
                  <h3 className="text-sm uppercase text-gray-400 tracking-widest font-semibold mb-4">
                    7 derniers jours
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Revenus
                      </div>
                      <div className="text-2xl font-bold text-yellow-400 font-mono mt-2">
                        {kpis.weekRevenue.toLocaleString("fr-FR")} XOF
                      </div>
                      <div className="text-xs text-gray-400 mt-2">
                        Moy/jour: {kpis.weekAvgDailyRevenue.toLocaleString("fr-FR")} XOF
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Dépenses
                      </div>
                      <div className="text-2xl font-bold text-red-400 font-mono mt-2">
                        {kpis.weekExpenses.toLocaleString("fr-FR")} XOF
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
                        {kpis.weekNetMargin.toLocaleString("fr-FR")} XOF
                      </div>
                    </div>
                  </div>
                </div>

                {/* Period KPIs */}
                <div>
                  <h3 className="text-sm uppercase text-gray-400 tracking-widest font-semibold mb-4">
                    Période sélectionnée ({periodFrom} → {periodTo})
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Revenus totaux
                      </div>
                      <div className="text-2xl font-bold text-yellow-400 font-mono mt-2">
                        {kpis.monthRevenue.toLocaleString("fr-FR")} XOF
                      </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                        Dépenses totales
                      </div>
                      <div className="text-2xl font-bold text-red-400 font-mono mt-2">
                        {kpis.monthExpenses.toLocaleString("fr-FR")} XOF
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
                        {kpis.avgRevenuePerDriver.toLocaleString("fr-FR")} XOF
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── CHARTS ── */}
                <div className="space-y-6">

                  {/* Chart 1 : Recettes par jour */}
                  {kpis.dailyRows.length > 0 && (
                    <div className="rounded-xl p-5" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
                      <h3 className="text-sm font-bold text-white mb-4">📊 Recettes par jour — Brut Yango · Hors Yango · Net final</h3>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={kpis.dailyRows} barGap={2}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                          <XAxis dataKey="date" stroke="#555e75" tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(d) => d.slice(5)} />
                          <YAxis stroke="#555e75" tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                          <Tooltip contentStyle={{ backgroundColor: "#0d1117", border: "1px solid #1e2330", borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any) => [Number(v).toLocaleString("fr-FR") + " XOF"]} />
                          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                          <Bar dataKey="brutYango" fill="#f5a623" name="Brut Yango" radius={[3,3,0,0]} />
                          <Bar dataKey="horsYango" fill="#a855f7" name="Hors Yango" radius={[3,3,0,0]} />
                          <Bar dataKey="netFinal" fill="#22c55e" name="Net final" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Chart 2 : Dépenses par jour par type */}
                  {kpis.dailyExpByCategory.length > 0 && kpis.expenseBreakdown.length > 0 && (
                    <div className="rounded-xl p-5" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
                      <h3 className="text-sm font-bold text-white mb-4">⛽ Dépenses par jour — par catégorie</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={kpis.dailyExpByCategory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                          <XAxis dataKey="date" stroke="#555e75" tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(d) => d.slice(5)} />
                          <YAxis stroke="#555e75" tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                          <Tooltip contentStyle={{ backgroundColor: "#0d1117", border: "1px solid #1e2330", borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any) => [Number(v).toLocaleString("fr-FR") + " XOF"]} />
                          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                          {kpis.expenseBreakdown.map((cat, i) => (
                            <Bar key={cat.type} dataKey={cat.type} stackId="a"
                              fill={["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7"][i % 6]}
                              name={cat.type} radius={i === kpis.expenseBreakdown.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Chart 3 : KM par jour */}
                    {kpis.dailyRows.some((r) => r.km > 0) && (
                      <div className="rounded-xl p-5" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
                        <h3 className="text-sm font-bold text-white mb-1">🚗 KM parcourus / jour</h3>
                        <p className="text-xs mb-4" style={{ color: "#555e75" }}>Calculé depuis les relevés kilométriques fin de journée. Moy: {kpis.avgKmPerDay} km/j</p>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart data={kpis.dailyRows.filter((r) => r.km > 0)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                            <XAxis dataKey="date" stroke="#555e75" tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(d) => d.slice(5)} />
                            <YAxis stroke="#555e75" tick={{ fontSize: 10, fill: "#555e75" }} />
                            <Tooltip contentStyle={{ backgroundColor: "#0d1117", border: "1px solid #1e2330", borderRadius: 8, fontSize: 12 }}
                              formatter={(v: any) => [v + " km", "KM"]} />
                            <Bar dataKey="km" fill="#3b82f6" name="KM / jour" radius={[3,3,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Chart 4 : Répartition dépenses (pie) */}
                    {kpis.expenseBreakdown.length > 0 && (
                      <div className="rounded-xl p-5" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
                        <h3 className="text-sm font-bold text-white mb-4">🥧 Répartition dépenses</h3>
                        <div className="flex items-center gap-4">
                          <ResponsiveContainer width="50%" height={160}>
                            <PieChart>
                              <Pie data={kpis.expenseBreakdown} dataKey="amount" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
                                {kpis.expenseBreakdown.map((_, i) => (
                                  <Cell key={i} fill={["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7"][i % 6]} />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={{ backgroundColor: "#0d1117", border: "1px solid #1e2330", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: any) => [Number(v).toLocaleString("fr-FR") + " XOF"]} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="flex-1 space-y-2">
                            {kpis.expenseBreakdown.map((cat, i) => (
                              <div key={cat.type} className="flex items-center gap-2 text-xs">
                                <div className="w-3 h-3 rounded-sm flex-shrink-0"
                                  style={{ background: ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7"][i % 6] }} />
                                <span className="flex-1" style={{ color: "#8b92a8" }}>{cat.type}</span>
                                <span className="font-mono font-bold text-white">{cat.percent.toFixed(0)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Daily breakdown table */}
                {kpis.dailyRows.length > 0 && (
                  <DailyTable data={kpis.dailyRows} periodFrom={periodFrom} periodTo={periodTo} />
                )}

                {/* Insights */}
                <InsightsPanel kpis={kpis} />
              </>
            )}
          </div>
        )}

        {tab === "pending" && (
          <ReportList
            reports={reports.filter((r) => r.status === "submitted" && (!filterDriverId || r.driver_id === filterDriverId))}
            expenses={expenses.filter((e) => (e.status || "submitted") === "submitted" && (!filterDriverId || e.driver_id === filterDriverId))}
            loading={loadingReports}
            emptyMsg="Aucune soumission en attente"
            title="Soumissions en attente"
            onRefresh={loadReports}
          />
        )}

        {tab === "history" && (
          <ReportList
            reports={reports.filter((r) => !filterDriverId || r.driver_id === filterDriverId)}
            expenses={expenses.filter((e) => !filterDriverId || e.driver_id === filterDriverId)}
            loading={loadingReports}
            emptyMsg="Aucun rapport"
            title="Tous les rapports"
            onRefresh={loadReports}
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
                          {report.net_after_expenses.toLocaleString("fr-FR")} XOF
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

        {tab === "vehicles" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Analytics Véhicules</h2>
              <button
                onClick={() => router.push("/admin/vehicles")}
                className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-4 py-2 rounded"
              >
                Voir les stats détaillées →
              </button>
            </div>
            <p className="text-gray-400">
              Consommation, dépenses, marge nette et autres métriques pour chaque véhicule.
            </p>
          </div>
        )}

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
        {tab === "payments" && <PaymentsTab filterDriverId={filterDriverId} />}
        {tab === "avances" && <AvancesTab filterDriverId={filterDriverId} />}
        {tab === "pilotage" && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🎯</div>
            <p className="text-white font-semibold mb-2">Module Pilotage</p>
            <p className="text-sm mb-4" style={{ color: "#555e75" }}>Projections, P&L, simulation de flotte et insights avancés.</p>
            <a href="/admin/pilotage" className="inline-block px-6 py-3 rounded-xl text-sm font-bold text-black"
              style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>
              Ouvrir le module Pilotage →
            </a>
          </div>
        )}

        {tab === "settings" && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6">Paramètres</h2>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md">
              <div className="mb-6">
                <label className="text-xs uppercase text-gray-400 tracking-widest font-semibold block mb-2">
                  Commission Yango (%)
                </label>
                <input
                  type="number"
                  defaultValue="15"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white"
                />
              </div>
              <div className="mb-6">
                <label className="text-xs uppercase text-gray-400 tracking-widest font-semibold block mb-2">
                  Commission Partenaire (%)
                </label>
                <input
                  type="number"
                  defaultValue="0.75"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white"
                />
              </div>
              <button className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold py-3 rounded">
                Enregistrer les paramètres
              </button>
            </div>
          </div>
        )}
        </div>{/* end max-w-none */}
        </div>{/* end lg:pl-[220px] */}
      </main>
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
    const [color, bg] = map[s] ?? ["#8b92a8", "#1e2330"];
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
              style={{ background: activeTab === t ? "#f5a623" : "#1e2330", color: activeTab === t ? "#000" : "#555e75" }}>
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
                style={{ background: isRepos(r) ? "rgba(99,102,241,.04)" : "#0d1117", border: `1px solid ${isRepos(r) ? "rgba(99,102,241,.25)" : "#1e2330"}` }}
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
                    <div className="text-xs mt-1" style={{ color: "#555e75" }}>
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
                style={{ background: "#0d1117", border: "1px solid #1e2330" }}
                onClick={() => setSelectedExpense(e)}>
                <div className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-semibold text-white text-sm">{e.category}</div>
                    <div className="text-xs mt-1" style={{ color: "#555e75" }}>
                      {e._profile?.full_name || e._profile?.driver_id || e.driver_id?.slice(0, 8)} · 📅 {e.expense_date || e.created_at?.slice(0, 10)}
                    </div>
                    {e.description && <div className="text-xs mt-0.5" style={{ color: "#3d4560" }}>{e.description}</div>}
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
        .filter((u: any) => u.file_path?.includes(expense.id))
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
      const supabase = createClient() as any;
      const path = `expense/${expense.driver_id}/${expense.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await supabase.storage.from("kyc-documents").upload(path, file, { upsert: true });
      const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(path);
      await supabase.from("uploads").insert({ driver_id: expense.driver_id, file_name: file.name, file_path: path, file_type: "expense", file_size: file.size });
      setUploads((p) => [...p, { file_name: file.name, publicUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name) }]);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setUploading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.75)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "#1e2330" }}>
          <div>
            <div className="font-bold text-white">{expense.category}</div>
            <div className="text-xs mt-0.5" style={{ color: "#555e75" }}>
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
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#555e75" }}>Catégorie</label>
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}>
                  {expenseTypes.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#555e75" }}>Montant (XOF)</label>
                <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#ef4444" }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#555e75" }}>📅 Date déclarée</label>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7", colorScheme: "dark" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#3d4560" }}>🕐 Date soumission</label>
                <div className="rounded-xl px-3 py-2 text-sm font-mono" style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#3d4560" }}>
                  {expense.created_at?.slice(0, 10)}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#555e75" }}>Description</label>
              <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Détails..." className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
            </div>
            <button onClick={saveEdit} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold"
              style={{ background: saving ? "#1e2330" : "rgba(59,130,246,.15)", border: "1px solid rgba(59,130,246,.3)", color: "#3b82f6" }}>
              {saving ? "..." : "💾 Enregistrer les modifications"}
            </button>
          </div>

          {/* Pièces jointes */}
          <div className="rounded-xl p-4" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "#3d4560" }}>📎 Pièces jointes</div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => cameraRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ background: uploading ? "#1e2330" : "rgba(245,166,35,.08)", borderColor: "rgba(245,166,35,.25)", color: uploading ? "#374151" : "#f5a623" }}>
                {uploading ? "⏳" : "📷 Photo"}
              </button>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border-dashed border-2"
                style={{ background: "transparent", borderColor: "#2a2f3d", color: uploading ? "#f5a623" : "#555e75" }}>
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
                    <img src={u.publicUrl} alt={u.file_name} className="w-full h-20 object-cover rounded-lg" style={{ border: "1px solid #1e2330" }} />
                  </a>
                ))}
              </div>
            )}
            {uploads.filter((u: any) => !u.isImg).map((u: any, i: number) => (
              <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs p-2 rounded-lg mb-1"
                style={{ background: "#1e2330", color: "#8b92a8" }}>
                <span>📄</span><span className="truncate flex-1">{u.file_name}</span>
                <span style={{ color: "#f5a623" }}>Ouvrir →</span>
              </a>
            ))}
            {uploads.length === 0 && <div className="text-xs text-center py-1" style={{ color: "#3d4560" }}>Aucune pièce jointe</div>}
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
  const [uploads, setUploads] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0)) + " XOF";

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("uploads").select("*").eq("driver_id", report.driver_id).order("created_at", { ascending: false });
      // Only keep files that belong to this report (path contains report.id)
      const enriched = (data || [])
        .filter((u: any) => u.file_path?.includes(report.id))
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
      const commYango = report.commission_rate || 0.15;    // 15% Yango
      const commPartner = 0.0075;                           // 0.75% partenaire
      const base = yg + yb;
      const comm = base * (commYango + commPartner);       // total commissions
      const net = (base - comm) + hy;                      // net après TOUTES commissions
      const { error } = await supabase.from("daily_reports").update({
        date: dateEdit || report.date,
        yango_gross: yg, yango_bonus: yb, off_yango_revenue: hy,
        gross_earnings: base + hy, commission_amount: comm,
        net_after_expenses: net,   // toujours calculé, jamais saisi manuellement
        solde_yango: parseFloat(soldeEdit) || 0,
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
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const supabase = createClient() as any;
      const path = `admin/reports/${report.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("kyc-documents").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(path);
      await supabase.from("uploads").insert({ driver_id: report.driver_id, file_name: file.name, file_path: path, file_type: "admin-report", file_size: file.size });
      setUploads((p) => [...p, { file_name: file.name, file_path: path, file_type: "admin-report", created_at: new Date().toISOString() }]);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setUploading(false); }
  };

  const rows = [
    ["Brut Yango", xof(report.yango_gross)],
    ["Bonus Yango", xof(report.yango_bonus)],
    ["Hors Yango", xof(report.off_yango_revenue)],
    ["💳 Solde wallet", xof(report.solde_yango)],
    ["Commission", `- ${xof(report.commission_amount)}`],
    ["Courses Yango", report.yango_trip_count ?? "—"],
    ["Courses hors", report.off_yango_trip_count ?? "—"],
    ["Km fin", report.end_odometer ? `${report.end_odometer} km` : "—"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-8 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.75)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "#1e2330" }}>
          <div>
            <div className="font-bold text-white">Rapport — {report.date}</div>
            <div className="text-xs mt-0.5" style={{ color: "#555e75" }}>Driver ID: {report.driver_id?.slice(0, 8)}...</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Details */}
          <div className="rounded-xl p-4" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
            {rows.map(([l, v]) => (
              <div key={l} className="flex justify-between py-1.5 text-sm" style={{ borderBottom: "1px solid #1e2330" }}>
                <span style={{ color: "#555e75" }}>{l}</span>
                <span className="font-mono text-white">{v}</span>
              </div>
            ))}
            <div className="flex justify-between py-2 text-sm font-bold">
              <span className="text-white">NET TOTAL</span>
              <span className="font-mono" style={{ color: "#22c55e" }}>{xof(report.net_after_expenses)}</span>
            </div>
          </div>

          {report.comment && (
            <div className="text-sm rounded-xl px-4 py-3" style={{ background: "rgba(245,166,35,.05)", border: "1px solid rgba(245,166,35,.15)", color: "#8b92a8" }}>
              💬 {report.comment}
            </div>
          )}

          {/* Editable fields — always available */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#f5a623" }}>✏️ Modifier le rapport</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "#555e75" }}>Date</label>
                <input type="date" value={dateEdit} onChange={(e) => setDateEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#1e2330", border: "1px solid #2a2f3d", color: "#f0f2f7", colorScheme: "dark" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#555e75" }}>Net calculé (auto)</label>
                <div className="w-full rounded-xl px-3 py-2 text-sm font-mono font-bold" style={{ background: "#080a0f", border: "1px solid rgba(34,197,94,.2)", color: "#22c55e" }}>
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
                <div className="text-[10px] mt-0.5" style={{ color: "#3d4560" }}>Brut − 15% Yango − 0,75% part. + hors Yango</div>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#555e75" }}>Brut Yango</label>
                <input type="number" value={yangoGrossEdit} onChange={(e) => setYangoGrossEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#1e2330", border: "1px solid #2a2f3d", color: "#f0f2f7" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#555e75" }}>Bonus Yango</label>
                <input type="number" value={yangoBonus} onChange={(e) => setYangoBonus(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#1e2330", border: "1px solid #2a2f3d", color: "#f0f2f7" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#555e75" }}>Hors Yango</label>
                <input type="number" value={horsYangoEdit} onChange={(e) => setHorsYangoEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#1e2330", border: "1px solid #2a2f3d", color: "#a855f7" }} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "#555e75" }}>💳 Solde wallet</label>
                <input type="number" value={soldeEdit} onChange={(e) => setSoldeEdit(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: "#1e2330", border: "1px solid #2a2f3d", color: "#f5a623" }} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "#555e75" }}>Note / commentaire</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="Commentaire, motif de rejet..."
                className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
                style={{ background: "#1e2330", border: "1px solid #2a2f3d", color: "#f0f2f7" }} />
            </div>
            <button onClick={saveFields} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-bold"
              style={{ background: "rgba(59,130,246,.15)", border: "1px solid rgba(59,130,246,.3)", color: "#3b82f6" }}>
              {saving ? "..." : "💾 Enregistrer les modifications"}
            </button>
          </div>

          {/* Attachments */}
          <div className="rounded-xl p-4" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "#3d4560" }}>📎 Pièces jointes</div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => cameraRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ background: uploading ? "#1e2330" : "rgba(245,166,35,.08)", borderColor: "rgba(245,166,35,.25)", color: uploading ? "#374151" : "#f5a623" }}>
                {uploading ? "⏳" : "📷 Photo"}
              </button>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex-1 py-2.5 rounded-xl text-sm border-dashed border-2"
                style={{ background: "transparent", borderColor: "#2a2f3d", color: uploading ? "#f5a623" : "#555e75" }}>
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
                      style={{ border: "1px solid #1e2330" }} />
                  </a>
                ))}
              </div>
            )}
            {/* PDFs */}
            {uploads.filter((u: any) => !u.isImg).map((u: any, i: number) => (
              <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs p-2 rounded-lg mb-1"
                style={{ background: "#1e2330", color: "#8b92a8" }}>
                <span>{u.file_type?.includes("admin") ? "👤" : "📄"}</span>
                <span className="truncate flex-1">{u.file_name}</span>
                <span style={{ color: "#f5a623" }}>Ouvrir →</span>
              </a>
            ))}
            {uploads.length === 0 && <div className="text-xs text-center py-2" style={{ color: "#3d4560" }}>Aucune pièce jointe</div>}
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
    { k: "date", label: "Date", fmt: (v: any) => v, color: () => "#f0f2f7" },
    { k: "brutYango", label: "Brut Yango", fmt: xof, color: () => "#f5a623" },
    { k: "horsYango", label: "Hors Yango", fmt: xof, color: () => "#a855f7" },
    { k: "netRecettes", label: "Net recettes", fmt: xof, color: () => "#3b82f6" },
    { k: "depenses", label: "Dépenses", fmt: (v: number) => v > 0 ? `- ${xof(v)}` : "—", color: () => "#ef4444" },
    { k: "netFinal", label: "NET FINAL", fmt: xof, color: (v: number) => v >= 0 ? "#22c55e" : "#ef4444" },
    { k: "km", label: "KM", fmt: (v: number) => v > 0 ? `${v} km` : "—", color: () => "#555e75" },
    { k: "nbCourses", label: "Courses", fmt: (v: number) => v > 0 ? String(v) : "—", color: () => "#555e75" },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#1e2330" }}>
        <h3 className="font-bold text-white text-sm">📅 Tableau journalier détaillé</h3>
        <div className="flex items-center gap-2">
          <input type="date" value={filter} onChange={(e) => setFilter(e.target.value)}
            min={periodFrom} max={periodTo}
            className="text-xs px-2 py-1 rounded-lg outline-none"
            style={{ background: "#1e2330", border: "1px solid #2a2f3d", color: "#f0f2f7", colorScheme: "dark" }} />
          {filter && <button onClick={() => setFilter("")} className="text-xs px-2 py-1 rounded" style={{ color: "#f5a623", background: "rgba(245,166,35,.1)" }}>✕ Tout afficher</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" style={{ fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#080a0f", borderBottom: "1px solid #1e2330" }}>
              {cols.map((c) => (
                <th key={c.k} className="px-3 py-2 text-left font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#3d4560" }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={cols.length} className="text-center py-8" style={{ color: "#3d4560" }}>Aucune donnée pour cette période</td></tr>
            )}
            {filtered.map((d: any, i: number) => (
              <tr key={d.date} style={{ borderBottom: "1px solid #0a0c10", background: i % 2 === 0 ? "#0d1117" : "#080a0f" }}>
                {cols.map((c) => (
                  <td key={c.k} className="px-3 py-2 font-mono whitespace-nowrap" style={{ color: c.color(d[c.k]) }}>
                    {c.fmt(d[c.k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#1e2330", borderTop: "2px solid #2a2f3d" }}>
              <td className="px-3 py-2.5 font-bold text-white">TOTAL ({filtered.length} j)</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#f5a623" }}>{xof(tot.brutYango)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#a855f7" }}>{xof(tot.horsYango)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#3b82f6" }}>{xof(tot.netRecettes)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: "#ef4444" }}>- {xof(tot.depenses)}</td>
              <td className="px-3 py-2.5 font-mono font-bold" style={{ color: tot.netFinal >= 0 ? "#22c55e" : "#ef4444" }}>{xof(tot.netFinal)}</td>
              <td className="px-3 py-2.5 font-mono" style={{ color: "#555e75" }}>{tot.km > 0 ? `${tot.km} km` : "—"}</td>
              <td className="px-3 py-2.5 font-mono" style={{ color: "#555e75" }}>{tot.nbCourses > 0 ? tot.nbCourses : "—"}</td>
            </tr>
          </tfoot>
        </table>
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
    <div className="rounded-xl p-4" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
      <h3 className="font-bold text-white text-sm mb-3">💡 Insights</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {insights.map((ins, i) => (
          <div key={i} className="rounded-lg p-3" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
            <div className="text-lg mb-1">{ins.icon}</div>
            <div className="text-xs mb-1" style={{ color: "#555e75" }}>{ins.label}</div>
            <div className="text-sm font-bold font-mono" style={{ color: ins.color }}>{ins.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PAYMENTS TAB ─────────────────────────────────────
function PaymentsTab({ filterDriverId = "" }: { filterDriverId?: string }) {
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

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const supabase = createClient() as any;
    const [{ data: pays }, { data: drvs }] = await Promise.all([
      supabase.from("payments").select("*, profiles(full_name, driver_id)").order("payment_date", { ascending: false }).limit(100),
      supabase.from("profiles").select("id, full_name, driver_id").eq("role", "driver").order("full_name"),
    ]);
    setPayments(pays || []);
    setDrivers(drvs || []);
    if (drvs?.length && !form.driver_id) setForm((f) => ({ ...f, driver_id: drvs[0].id }));
    setLoading(false);
  };

  const save = async () => {
    if (!form.driver_id || !form.amount) { alert("Chauffeur et montant requis"); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("payments").insert({
        driver_id: form.driver_id,
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
      autre: ["#8b92a8", "#1e2330"],
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
          style={{ background: showForm ? "#1e2330" : "linear-gradient(135deg,#f5a623,#e8951a)", color: showForm ? "#8b92a8" : "#000" }}>
          {showForm ? "Annuler" : "+ Nouveau paiement"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-2xl p-6 space-y-4" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
          <h3 className="text-sm font-bold text-white">Enregistrer un paiement</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Chauffeur *</label>
              <select value={form.driver_id} onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.driver_id})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none capitalize"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}>
                {paymentTypes.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Montant (XOF) *</label>
              <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="ex: 200 000" className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>📅 Date effective paiement</label>
              <input type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7", colorScheme: "dark" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#f5a623" }}>📆 Mois du salaire (à imputer)</label>
              <input type="month" value={form.salary_month?.slice(0, 7)} onChange={(e) => setForm((f) => ({ ...f, salary_month: e.target.value + "-01" }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid rgba(245,166,35,.4)", color: "#f5a623", colorScheme: "dark" }} />
              <p className="text-xs mt-1" style={{ color: "#3d4560" }}>Apparaît comme charge sur ce mois dans le dashboard</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Période couverte, détails..." rows={2}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
              style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
          </div>
          <button onClick={save} disabled={saving}
            className="w-full py-3 rounded-xl text-sm font-bold"
            style={{ background: saving ? "#1e2330" : "linear-gradient(135deg,#f5a623,#e8951a)", color: saving ? "#555e75" : "#000" }}>
            {saving ? "Enregistrement..." : "✓ Enregistrer le paiement"}
          </button>

          {/* Upload PJ après sauvegarde */}
          {newPaymentId && newPaymentDriverId && (
            <div className="mt-2 rounded-xl p-4" style={{ background: "rgba(34,197,94,.05)", border: "1px solid rgba(34,197,94,.2)" }}>
              <div className="text-xs font-semibold mb-2" style={{ color: "#22c55e" }}>✓ Paiement enregistré — ajoutez des pièces jointes</div>
              <PaymentUpload paymentId={newPaymentId} driverId={newPaymentDriverId} />
              <button onClick={() => { setNewPaymentId(null); setNewPaymentDriverId(null); setShowForm(false); }}
                className="mt-3 w-full py-2 rounded-xl text-xs" style={{ background: "#1e2330", color: "#8b92a8" }}>
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
            <div key={name} className="rounded-xl p-4" style={{ background: "#0d1117", border: "1px solid #1e2330", borderLeft: "3px solid #22c55e" }}>
              <div className="text-xs mb-1" style={{ color: "#555e75" }}>{name}</div>
              <div className="font-mono font-bold text-sm" style={{ color: "#22c55e" }}>{xof(total)} XOF</div>
              <div className="text-[10px] mt-0.5" style={{ color: "#3d4560" }}>total payé</div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-12" style={{ color: "#3d4560" }}>Chargement...</div>
      ) : filteredPayments.length === 0 ? (
        <div className="text-center py-12" style={{ color: "#3d4560" }}>Aucun paiement enregistré</div>
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
          style={{ background: uploading ? "#1e2330" : "rgba(245,166,35,.08)", borderColor: "rgba(245,166,35,.25)", color: uploading ? "#374151" : "#f5a623" }}>
          {uploading ? "⏳" : "📷 Photo"}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex-1 py-2 rounded-xl text-xs border-dashed border-2"
          style={{ background: "transparent", borderColor: "#2a2f3d", color: uploading ? "#f5a623" : "#555e75" }}>
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
              <img src={u.publicUrl} alt={u.file_name} className="w-full h-14 object-cover rounded-lg" style={{ border: "1px solid #1e2330" }} />
            </a>
          ))}
        </div>
      )}
      {uploads.filter(u => !u.isImg).map((u, i) => (
        <a key={i} href={u.publicUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs p-1.5 rounded-lg mb-1"
          style={{ background: "#1e2330", color: "#8b92a8" }}>
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
    <div className="rounded-xl" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">
            {p.profiles?.full_name || "—"}
            <span className="ml-2 text-xs" style={{ color: "#3d4560" }}>{p.profiles?.driver_id}</span>
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "#555e75" }}>
            {p.salary_month && <span style={{ color: "#f5a623" }}>📆 Mois: {p.salary_month?.slice(0, 7)}</span>}
            <span>📅 Payé le: {p.payment_date}</span>
            {typeBadge(p.type)}
            {p.notes && <span className="truncate max-w-[200px]">{p.notes}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="font-mono font-bold" style={{ color: "#22c55e" }}>{xof(p.amount)} XOF</div>
          <button onClick={() => setOpen(!open)} className="text-xs px-2 py-1 rounded-lg"
            style={{ background: open ? "rgba(245,166,35,.1)" : "#1e2330", color: open ? "#f5a623" : "#555e75" }}>
            📎
          </button>
          <button onClick={onDelete} className="text-xs" style={{ color: "#3d4560" }}>🗑</button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-3 border-t" style={{ borderColor: "#1e2330" }}>
          <PaymentUpload paymentId={p.id} driverId={p.driver_id} />
        </div>
      )}
    </div>
  );
}

// ─── AVANCES TAB ─────────────────────────────────────
function AvancesTab({ filterDriverId = "" }: { filterDriverId?: string }) {
  const [advances, setAdvances] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ driver_id: "", amount: "", payment_date: today, notes: "" });
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const supabase = createClient() as any;
    const [{ data: advs }, { data: drvs }] = await Promise.all([
      supabase.from("payments")
        .select("*, profiles(full_name, driver_id)")
        .eq("type", "acompte")
        .order("payment_date", { ascending: false })
        .limit(200),
      supabase.from("profiles").select("id, full_name, driver_id").eq("role", "driver").order("full_name"),
    ]);
    setAdvances(advs || []);
    setDrivers(drvs || []);
    if (drvs?.length && !form.driver_id) setForm((f) => ({ ...f, driver_id: drvs[0].id }));
    setLoading(false);
  };

  const saveAdvance = async () => {
    if (!form.driver_id || !form.amount) { alert("Chauffeur et montant requis"); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("payments").insert({
        driver_id: form.driver_id,
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
          style={{ background: showForm ? "#1e2330" : "linear-gradient(135deg,#f5a623,#e8951a)", color: showForm ? "#8b92a8" : "#000" }}>
          {showForm ? "Annuler" : "+ Nouvelle avance"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-2xl p-6 space-y-4" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
          <h3 className="text-sm font-bold text-white">Enregistrer une avance sur salaire</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Chauffeur *</label>
              <select value={form.driver_id} onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.driver_id})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Montant (XOF) *</label>
              <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="ex: 50 000"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Date</label>
              <input type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7", colorScheme: "dark" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Motif / Notes</label>
              <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="ex: avance loyer, urgence..."
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
            </div>
          </div>
          <button onClick={saveAdvance} disabled={saving}
            className="w-full py-3 rounded-xl text-sm font-bold"
            style={{ background: saving ? "#1e2330" : "linear-gradient(135deg,#f5a623,#e8951a)", color: saving ? "#555e75" : "#000" }}>
            {saving ? "Enregistrement..." : "✓ Enregistrer l'avance"}
          </button>
        </div>
      )}

      {/* Summary cards per driver */}
      {byDriver.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {byDriver.map((d) => (
            <div key={d.id} className="rounded-2xl p-5" style={{ background: "#0d1117", border: "1px solid #1e2330", borderLeft: `3px solid ${d.pending > 0 ? "#f5a623" : "#22c55e"}` }}>
              <div className="font-semibold text-white text-sm mb-1">{d.full_name}</div>
              <div className="text-xs mb-3" style={{ color: "#3d4560" }}>{d.driver_id}</div>
              <div className="flex gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "#555e75" }}>En attente</div>
                  <div className="font-mono font-bold text-sm" style={{ color: d.pending > 0 ? "#f5a623" : "#3d4560" }}>
                    {xof(d.pending)} XOF
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "#555e75" }}>Déduit</div>
                  <div className="font-mono font-bold text-sm" style={{ color: "#22c55e" }}>{xof(d.deducted)} XOF</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail list */}
      {loading ? (
        <div className="text-center py-12" style={{ color: "#3d4560" }}>Chargement...</div>
      ) : advances.length === 0 ? (
        <div className="text-center py-12" style={{ color: "#3d4560" }}>Aucune avance enregistrée</div>
      ) : (
        <div className="space-y-2">
          {advances.map((a) => (
            <div key={a.id} className="rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
              <div>
                <div className="text-sm font-semibold text-white">
                  {a.profiles?.full_name || "—"}
                  <span className="ml-2 text-xs" style={{ color: "#3d4560" }}>{a.profiles?.driver_id}</span>
                </div>
                <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "#555e75" }}>
                  <span>📅 {a.payment_date}</span>
                  {a.notes && <span className="truncate max-w-[200px]">{a.notes}</span>}
                  {a.is_deducted
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#22c55e", background: "rgba(34,197,94,.1)" }}>✓ Déduit {a.deducted_at || ""}</span>
                    : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: "#f5a623", background: "rgba(245,166,35,.1)" }}>⏳ En attente</span>
                  }
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="font-mono font-bold" style={{ color: a.is_deducted ? "#555e75" : "#f5a623" }}>
                  {xof(a.amount)} XOF
                </div>
                {!a.is_deducted && (
                  <button onClick={() => markDeducted(a.id)}
                    className="text-[10px] px-2 py-1 rounded-lg font-semibold"
                    style={{ background: "rgba(34,197,94,.1)", color: "#22c55e" }}>
                    Marquer déduit
                  </button>
                )}
                <button onClick={() => deleteAdvance(a.id)} className="text-xs" style={{ color: "#3d4560" }}>🗑</button>
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
            style={{ background: "#1e2330", color: "#8b92a8" }}>‹</button>
          <span className="text-sm font-bold text-white px-3">{MONTHS[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{ background: "#1e2330", color: "#8b92a8" }}>›</button>
          <button onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold ml-1"
            style={{ background: "#1e2330", color: "#555e75" }}>Aujourd'hui</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap text-xs">
        {[["#6366f1","Repos planifié"],["#22c55e","Travaillé"],["#f5a623","En attente"],["#ef4444","Rejeté"]].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: c }} /><span style={{ color: "#8b92a8" }}>{l}</span></div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="text-center py-12" style={{ color: "#3d4560" }}>Chargement...</div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #1e2330" }}>
          {/* Day headers */}
          <div className="grid grid-cols-7" style={{ background: "#0d1117", borderBottom: "1px solid #1e2330" }}>
            {DAYS.map(d => (
              <div key={d} className="text-center py-2 text-xs font-bold uppercase tracking-widest" style={{ color: "#3d4560" }}>{d}</div>
            ))}
          </div>
          {/* Weeks */}
          <div className="grid grid-cols-7" style={{ background: "#080a0f" }}>
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} style={{ borderRight: "1px solid #0d1117", borderBottom: "1px solid #0d1117", minHeight: 80 }} />
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
                  style={{ borderRight: "1px solid #0d1117", borderBottom: "1px solid #0d1117", minHeight: 80, padding: "6px", background: isToday ? "rgba(245,166,35,.05)" : "transparent" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold" style={{ color: isToday ? "#f5a623" : isPast ? "#3d4560" : "#8b92a8",
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
                    {dayEvents.length > 3 && <div className="text-[9px]" style={{ color: "#3d4560" }}>+{dayEvents.length - 3} autres</div>}
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
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: "#0d1117", border: "1px solid #1e2330" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-bold text-white">📅 {addModal.date}</div>
              <button onClick={() => setAddModal(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Chauffeur</label>
              <select value={addDriver} onChange={(e) => setAddDriver(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}>
                <option value="">-- Sélectionner --</option>
                {allDrivers.map((d) => <option key={d.id} value={d.id}>{d.full_name} {d.plate ? `· ${d.plate}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>Motif (optionnel)</label>
              <input type="text" value={addMotif} onChange={(e) => setAddMotif(e.target.value)}
                placeholder="Congé, maladie, entretien..." className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
            </div>
            <button onClick={addRepos} disabled={saving || !addDriver}
              className="w-full py-3 rounded-xl text-sm font-bold"
              style={{ background: saving || !addDriver ? "#1e2330" : "linear-gradient(135deg,#6366f1,#4f46e5)",
                color: saving || !addDriver ? "#3d4560" : "#fff" }}>
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
              <div key={d.id} className="rounded-2xl p-4" style={{ background: "#0d1117", border: "1px solid #1e2330" }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-black"
                    style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>{d.full_name[0]}</div>
                  <div>
                    <div className="text-sm font-bold text-white">{d.full_name}</div>
                    {d.plate && <div className="text-[10px] font-mono" style={{ color: "#3d4560" }}>{d.plate}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl py-2" style={{ background: "#080a0f" }}>
                    <div className="text-lg font-bold" style={{ color: "#22c55e" }}>{travailCount}</div>
                    <div className="text-[10px]" style={{ color: "#3d4560" }}>Jours travaillés</div>
                  </div>
                  <div className="rounded-xl py-2" style={{ background: "#080a0f" }}>
                    <div className="text-lg font-bold" style={{ color: "#6366f1" }}>{reposCount}</div>
                    <div className="text-[10px]" style={{ color: "#3d4560" }}>Repos</div>
                  </div>
                  <div className="rounded-xl py-2" style={{ background: "#080a0f" }}>
                    <div className="text-sm font-bold font-mono" style={{ color: "#f5a623" }}>{(totalNet / 1000).toFixed(0)}k</div>
                    <div className="text-[10px]" style={{ color: "#3d4560" }}>Net XOF</div>
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
function KPICard({ label, value, color, sub, negative, big }: {
  label: string; value: number; color: string; sub?: string; negative?: boolean; big?: boolean;
}) {
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(Math.abs(n)));
  return (
    <div className="rounded-xl p-4" style={{ background: "#0d1117", border: "1px solid #1e2330", borderLeft: `3px solid ${color}` }}>
      <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "#555e75" }}>{label}</div>
      <div className={`font-mono font-bold ${big ? "text-2xl" : "text-xl"}`} style={{ color }}>
        {negative ? "- " : ""}{xof(value)}
        <span className="text-xs ml-1" style={{ color: "#3d4560" }}>XOF</span>
      </div>
      {sub && <div className="text-xs mt-1" style={{ color: "#3d4560" }}>{sub}</div>}
    </div>
  );
}
