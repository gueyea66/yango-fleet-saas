"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { usePilotage, DEFAULT_PARAMS, xofFmt, type PilotageParams } from "@/lib/hooks/usePilotage";
import { useTenant } from "@/lib/tenant/context";
import { BrandLogo } from "@/components/brand/BrandShell";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";

const xof = (n: number) => xofFmt(n);
const pct = (n: number) => (n || 0).toFixed(1) + "%";
const CAT_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7","#f5a623","#8b92a8"];

// ── CARD ──────────────────────────────────────────────
function Card({ children, glow }: { children: React.ReactNode; glow?: string }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "#0d1117", border: `1px solid ${glow ? glow + "40" : "#1e2330"}`, boxShadow: glow ? `0 0 24px ${glow}10` : "none" }}>
      {children}
    </div>
  );
}

// ── SECTION HEADER ────────────────────────────────────
function SH({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-bold text-white">{title}</h2>
      {sub && <p className="text-xs mt-0.5" style={{ color: "#555e75" }}>{sub}</p>}
    </div>
  );
}

// ── TOOLTIP ───────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 text-xs" style={{ background: "#0d1117", border: "1px solid #1e2330", minWidth: 160 }}>
      <div className="font-semibold text-white mb-2">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-3 py-0.5">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono font-bold text-white">{xof(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function PilotagePage() {
  const { user, loading } = useAuth();
  const { settings } = useTenant();
  const router = useRouter();
  const [params, setParams] = useState<PilotageParams>(DEFAULT_PARAMS);
  const [showParams, setShowParams] = useState(false);
  const [section, setSection] = useState<string>("overview");

  // Tenant + driver/vehicle filter
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [allDrivers, setAllDrivers] = useState<any[]>([]);
  const [allVehicles, setAllVehicles] = useState<any[]>([]);
  const [filterDriverId, setFilterDriverId] = useState<string>("");
  const [filterVehicleId, setFilterVehicleId] = useState<string>("");

  // Resolve tenantId + load driver/vehicle lists once on mount
  useEffect(() => {
    if (!user) return;
    (async () => {
      const sb = createClient() as any;
      const { data: prof } = await sb.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      const tid = prof?.tenant_id || null;
      setTenantId(tid);
      if (!tid) return;
      const [{ data: drvs }, { data: vehs }] = await Promise.all([
        sb.from("profiles").select("id,full_name,driver_id").eq("role", "driver").eq("tenant_id", tid).order("full_name"),
        sb.from("vehicles").select("id,plate,driver_id").eq("tenant_id", tid),
      ]);
      setAllDrivers(drvs || []);
      setAllVehicles(vehs || []);
    })();
  }, [user]);

  // When a vehicle is selected, resolve its driver
  const effectiveDriverId = filterDriverId ||
    (filterVehicleId ? (allVehicles.find((v: any) => v.id === filterVehicleId)?.driver_id || "") : "");

  const data = usePilotage(params, tenantId, effectiveDriverId || null);

  if (!loading && !user) { router.push("/auth/login"); return null; }

  const sections = [
    ["overview", "📊 Vue d'ensemble"],
    ["ops", "📅 Opérationnel"],
    ["pnl", "📋 P&L détaillé"],
    ["cashflow", "💧 Cash Flow"],
    ["drivers", "🚗 Conducteurs"],
    ["simulation", "🔮 Simulation"],
    ["insights", "💡 Insights"],
  ];

   // Params panel reusable component
   const ParamsPanel = () => (
     <div className="space-y-4">
       <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#f5a623" }}>Paramètres du modèle</div>
       {([
         ["commYango",               "Comm. Yango",       "%"] as const,
         ["commPartner",             "Comm. Partenaire",  "%"] as const,
         ["workingDaysPerMonth",     "Jours / mois",      "j"] as const,
         ["targetMonthlyNet",        "Objectif net",      "XOF"] as const,
         ["maintenanceCostPerMonth", "Maintenance/véh",   "XOF"] as const,
         ["fuelDailyOverride",       "Override fuel/j",   "XOF"] as const,
         ["soldeDailyOverride",      "Override solde/j",  "XOF"] as const,
       ] as [keyof PilotageParams, string, string][]).map(([k, label, unit]) => (
         <div key={String(k)}>
           <label className="block text-[10px] mb-1 font-semibold" style={{ color: "#555e75" }}>{label}</label>
           <div className="flex items-center gap-1">
             <input type="number" value={(params as any)[k]}
               onChange={(e) => setParams((p) => ({ ...p, [k]: parseFloat(e.target.value) || 0 }))}
               className="flex-1 rounded-lg px-2 py-1.5 text-xs outline-none font-mono"
               style={{ background: "#080a0f", border: "1px solid #2a2f3d", color: "#f0f2f7" }} />
             <span className="text-[9px] flex-shrink-0" style={{ color: "#3d4560" }}>{unit}</span>
           </div>
         </div>
       ))}
       <div className="pt-3 border-t" style={{ borderColor: "#1e2330" }}>
         <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "#f5a623" }}>Paliers salaire</div>
         {params.salaryRules.map((rule, i) => (
           <div key={i} className="mb-2 rounded-lg p-2.5" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
             <div className="text-[9px] font-bold mb-1.5" style={{ color: "#f5a623" }}>Palier {i + 1}</div>
             <input type="text" value={rule.label} placeholder="Label"
               onChange={(e) => setParams((p) => ({ ...p, salaryRules: p.salaryRules.map((r, j) => j === i ? { ...r, label: e.target.value } : r) }))}
               className="w-full rounded px-1.5 py-1 text-[10px] outline-none mb-1"
               style={{ background: "#1e2330", border: "none", color: "#f0f2f7" }} />
             <input type="number" value={rule.min_net} placeholder="Net min"
               onChange={(e) => setParams((p) => ({ ...p, salaryRules: p.salaryRules.map((r, j) => j === i ? { ...r, min_net: parseFloat(e.target.value) || 0 } : r) }))}
               className="w-full rounded px-1.5 py-1 text-[10px] outline-none font-mono mb-1"
               style={{ background: "#1e2330", border: "none", color: "#8b92a8" }} />
             <input type="number" value={rule.total_salary} placeholder="Salaire"
               onChange={(e) => setParams((p) => ({ ...p, salaryRules: p.salaryRules.map((r, j) => j === i ? { ...r, total_salary: parseFloat(e.target.value) || 0 } : r) }))}
               className="w-full rounded px-1.5 py-1 text-[10px] outline-none font-mono font-bold"
               style={{ background: "#1e2330", border: "none", color: "#22c55e" }} />
           </div>
         ))}
       </div>
     </div>
   );

   return (
     <div className="min-h-screen flex" style={{ background: "#080a0f" }}>
       {/* SIDEBAR DESKTOP */}
       <aside className="hidden lg:flex flex-col fixed left-0 top-0 h-full z-50 overflow-y-auto"
         style={{ width: 240, background: "#0d1117", borderRight: "1px solid #1e2330" }}>
         <div className="px-4 py-4 border-b flex-shrink-0" style={{ borderColor: "#1e2330" }}>
           <button onClick={() => router.push("/admin")}
             className="flex items-center gap-2 text-xs mb-3 px-2 py-1.5 rounded-lg w-full text-left"
             style={{ background: "#1e2330", color: "#8b92a8" }}>← Retour Admin</button>
           <div className="flex items-center gap-2.5">
             <BrandLogo size={28} />
             <div>
               <div className="font-bold text-white text-sm">Pilotage</div>
               <div className="text-[9px]" style={{ color: "#3d4560" }}>{settings.operator_name || settings.app_name}</div>
             </div>
             {data.fetching && !data.loading && (
               <div className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#f5a623" }} />
             )}
           </div>
         </div>
         <nav className="px-3 py-3 space-y-0.5 flex-shrink-0">
           <div className="text-[9px] uppercase tracking-widest font-bold px-2 mb-2" style={{ color: "#3d4560" }}>Navigation</div>
           {sections.map(([id, label]) => (
             <button key={id} onClick={() => setSection(id)}
               className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
               style={{ background: section === id ? "rgba(245,166,35,.12)" : "transparent", color: section === id ? "#f5a623" : "#555e75", border: `1px solid ${section === id ? "rgba(245,166,35,.2)" : "transparent"}` }}>
               <span>{label.split(" ")[0]}</span><span>{label.split(" ").slice(1).join(" ")}</span>
             </button>
           ))}
         </nav>
         {/* Filter: driver / vehicle — style VUE bar */}
         {(allDrivers.length > 0 || allVehicles.length > 0) && (
           <div className="px-3 pb-3 flex-shrink-0 border-t pt-3" style={{ borderColor: "#1e2330" }}>
             <div className="text-[9px] uppercase tracking-widest font-bold px-1 mb-2" style={{ color: "#3d4560" }}>VUE</div>
             <div className="flex flex-col gap-1.5">
               <button onClick={() => { setFilterDriverId(""); setFilterVehicleId(""); }}
                 className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-semibold"
                 style={{ background: (!filterDriverId && !filterVehicleId) ? "#f5a623" : "#1e2330", color: (!filterDriverId && !filterVehicleId) ? "#000" : "#555e75" }}>
                 👥 Tous
               </button>
               {allDrivers.map((d: any) => (
                 <button key={d.id} onClick={() => { setFilterDriverId(filterDriverId === d.id ? "" : d.id); setFilterVehicleId(""); }}
                   className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-semibold"
                   style={{ background: filterDriverId === d.id ? "rgba(245,166,35,.15)" : "#1e2330", color: filterDriverId === d.id ? "#f5a623" : "#555e75", border: `1px solid ${filterDriverId === d.id ? "rgba(245,166,35,.35)" : "transparent"}` }}>
                   👤 {d.full_name || d.driver_id}
                   {allVehicles.find((v: any) => v.driver_id === d.id)?.plate && (
                     <span className="ml-1 text-[10px]" style={{ color: "#3d4560" }}>🚗 {allVehicles.find((v: any) => v.driver_id === d.id)?.plate}</span>
                   )}
                 </button>
               ))}
             </div>
           </div>
         )}
         <div className="px-3 pb-3 flex-shrink-0">
           <button onClick={data.refresh} className="w-full text-xs px-3 py-2 rounded-xl"
             style={{ background: "#1e2330", color: "#8b92a8", border: "1px solid #2a2f3d" }}>
             ↻ Actualiser les données
           </button>
         </div>
         <div className="border-t px-4 py-4 flex-1 overflow-y-auto" style={{ borderColor: "#1e2330" }}>
           <ParamsPanel />
         </div>
       </aside>

       {/* MOBILE TOP BAR */}
       <div className="lg:hidden fixed top-0 left-0 right-0 z-50"
         style={{ background: "rgba(13,17,23,.97)", borderBottom: "1px solid #1e2330", backdropFilter: "blur(12px)" }}>
         <div className="px-4 py-2.5 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <button onClick={() => router.push("/admin")} className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "#1e2330", color: "#8b92a8" }}>← Admin</button>
             <span className="font-bold text-white text-sm">Pilotage</span>
           </div>
           <div className="flex items-center gap-2">
             <button onClick={data.refresh} className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: "#1e2330", color: "#8b92a8" }}>↻</button>
             <button onClick={() => setShowParams(!showParams)} className="text-xs px-2.5 py-1.5 rounded-lg"
               style={{ background: showParams ? "rgba(245,166,35,.15)" : "#1e2330", color: showParams ? "#f5a623" : "#8b92a8" }}>
               Params
             </button>
           </div>
         </div>
         <div className="flex gap-1 px-3 pb-2 overflow-x-auto">
           {sections.map(([id, label]) => (
             <button key={id} onClick={() => setSection(id)}
               className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap"
               style={{ background: section === id ? "rgba(245,166,35,.12)" : "transparent", color: section === id ? "#f5a623" : "#555e75" }}>
               {label}
             </button>
           ))}
         </div>
         {/* Filtre VUE (chauffeur/véhicule) — présent sur desktop (sidebar), manquait sur mobile */}
         {allDrivers.length > 0 && (
           <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto">
             <button onClick={() => { setFilterDriverId(""); setFilterVehicleId(""); }}
               className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg font-semibold whitespace-nowrap"
               style={{ background: (!filterDriverId && !filterVehicleId) ? "#f5a623" : "#1e2330", color: (!filterDriverId && !filterVehicleId) ? "#000" : "#8b92a8" }}>
               👥 Tous
             </button>
             {allDrivers.map((d: any) => (
               <button key={d.id} onClick={() => { setFilterDriverId(filterDriverId === d.id ? "" : d.id); setFilterVehicleId(""); }}
                 className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg font-semibold whitespace-nowrap"
                 style={{ background: filterDriverId === d.id ? "rgba(245,166,35,.15)" : "#1e2330", color: filterDriverId === d.id ? "#f5a623" : "#8b92a8", border: `1px solid ${filterDriverId === d.id ? "rgba(245,166,35,.35)" : "transparent"}` }}>
                 👤 {d.full_name || d.driver_id}
                 {allVehicles.find((v: any) => v.driver_id === d.id)?.plate && (
                   <span className="ml-1 text-[10px]" style={{ color: "#555e75" }}>🚗 {allVehicles.find((v: any) => v.driver_id === d.id)?.plate}</span>
                 )}
               </button>
             ))}
           </div>
         )}
       </div>

       {/* MAIN CONTENT */}
       {/* min-w-0 : sans lui, un tableau large (nowrap) élargit toute la page sur mobile */}
       <main className="flex-1 min-w-0 min-h-screen lg:pl-[240px]">
         <div className="lg:hidden" style={{ height: allDrivers.length > 0 ? 126 : 88 }} />
         {showParams && (
           <div className="lg:hidden px-4 py-4 border-b" style={{ background: "#0d1117", borderColor: "#1e2330" }}>
             <ParamsPanel />
           </div>
         )}
         <div className="p-6 lg:p-8 w-full">
           {data.loading ? (
             <div className="flex flex-col items-center justify-center" style={{ minHeight: "60vh" }}>
               <div className="mb-4 animate-pulse"><BrandLogo size={64} /></div>
               <div className="text-sm font-semibold text-white mb-1">Calcul en cours...</div>
               <div className="text-xs" style={{ color: "#555e75" }}>Analyse des données historiques</div>
             </div>
           ) : (
             <>
               {section === "overview"   && <Overview data={data} params={params} />}
               {section === "ops"        && <OpsSection data={data} />}
               {section === "pnl"        && <PnLDetailed data={data} />}
               {section === "cashflow"   && <CashFlowSection data={data} params={params} />}
               {section === "drivers"    && <DriversSection data={data} params={params} />}
               {section === "simulation" && <SimulationSection data={data} params={params} />}
               {section === "insights"   && <InsightsSection data={data} />}
             </>
           )}
         </div>
       </main>
     </div>
   );
 }

// ── OVERVIEW ──────────────────────────────────────────
function Overview({ data, params }: { data: ReturnType<typeof usePilotage>; params: PilotageParams }) {
  const p = data.currentProjection;
  const past = data.historicalPnL.filter((h) => !h.isProjection);
  const avgPastMargin = past.length > 0 ? past.reduce((s, m) => s + m.margin, 0) / past.length : 0;

  const bigCards = [
    { icon: "📈", label: "CA projeté (mois)", value: xof(p?.revenue ?? 0), unit: "XOF", sub: `Moy/j: ${xof(data.avgDailyMetrics.revenue)}`, color: "#f5a623" },
    { icon: "💸", label: "Charges projetées", value: xof((p?.totalExpenses ?? 0) + (p?.salaries ?? 0) + (p?.maintenance ?? 0)), unit: "XOF", sub: `Exp + salaires + maintenance`, color: "#ef4444" },
    { icon: "💰", label: "EBITDA projeté", value: xof(p?.ebitda ?? 0), unit: "XOF", sub: `Marge: ${pct(p?.margin ?? 0)}`, color: (p?.ebitda ?? 0) >= 0 ? "#22c55e" : "#ef4444" },
    { icon: "📆", label: "Projection Trimestre", value: xof(data.quarterProjection.revenue), unit: "XOF", sub: `EBITDA: ${xof(data.quarterProjection.ebitda)}`, color: "#3b82f6" },
    { icon: "🗓️", label: "Projection Annuelle", value: xof(data.yearProjection.revenue), unit: "XOF", sub: `EBITDA: ${xof(data.yearProjection.ebitda)}`, color: "#a855f7" },
    { icon: "📊", label: "Marge moy. historique", value: pct(avgPastMargin), unit: "", sub: `Sur ${past.length} mois`, color: avgPastMargin > 0 ? "#22c55e" : "#ef4444" },
    { icon: "⛽", label: "Coût carburant / jour", value: xof(data.avgDailyMetrics.fuel), unit: "XOF", sub: data.avgDailyMetrics.fuelPricePerLiter > 0 ? `≈ ${xof(data.avgDailyMetrics.fuelPricePerLiter)} XOF/L · ${data.avgDailyMetrics.totalLiters.toFixed(0)}L total` : "Déclarez les litres pour + de précision", color: "#f97316" },
  ];

  const chartData = [...data.historicalPnL, ...(p ? [{ ...p, label: p.label }] : [])];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {bigCards.map((c, i) => (
          <Card key={i} glow={c.color}>
            <div className="text-2xl mb-2">{c.icon}</div>
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "#555e75" }}>{c.label}</div>
            <div className="text-2xl font-mono font-bold" style={{ color: c.color }}>{c.value}
              {c.unit && <span className="text-xs font-normal ml-1" style={{ color: "#3d4560" }}>{c.unit}</span>}
            </div>
            <div className="text-[10px] mt-1" style={{ color: "#3d4560" }}>{c.sub}</div>
          </Card>
        ))}
      </div>

      {/* Main trend chart */}
      {chartData.length > 1 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-bold text-white">Tendance 6 mois — CA · Charges · EBITDA</div>
              <div className="text-xs" style={{ color: "#555e75" }}>Historique réel + projection mois en cours (★)</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} barGap={3}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e2330" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#555e75" }} />
              <YAxis tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(v) => (v / 1000000).toFixed(1) + "M"} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="revenue" name="CA net" fill="#f5a623" radius={[3,3,0,0]} opacity={0.9} />
              <Bar dataKey="totalExpenses" name="Dépenses" fill="#ef4444" radius={[3,3,0,0]} opacity={0.8} />
              <Bar dataKey="salaries" name="Salaires" fill="#f97316" radius={[3,3,0,0]} opacity={0.8} />
              <Bar dataKey="maintenance" name="Maintenance" fill="#8b92a8" radius={[3,3,0,0]} opacity={0.8} />
              <Bar dataKey="ebitda" name="EBITDA" fill="#22c55e" radius={[3,3,0,0]} opacity={0.9} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Fuel calculation breakdown */}
      <div className="rounded-xl px-4 py-3 text-xs" style={{ background: "rgba(249,115,22,.05)", border: "1px solid rgba(249,115,22,.2)" }}>
        <div className="font-bold mb-2" style={{ color: "#f97316" }}>⛽ Détail calcul carburant projeté</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Déclarations carburant", value: `${data.avgDailyMetrics.fuelNbDeclarations} entrées` },
            { label: "Total déclaré", value: `${xof(data.avgDailyMetrics.fuelTotalDeclared)} XOF` },
            { label: "Jours actifs (base)", value: `${data.avgDailyMetrics.fuelActiveDays} j` },
            { label: "Moy calculée/j", value: `${xof(data.avgDailyMetrics.fuelRawDailyAvg)} XOF/j`, warn: data.avgDailyMetrics.fuelNbDeclarations < 5 },
          ].map((r, i) => (
            <div key={i}>
              <div style={{ color: "#555e75" }}>{r.label}</div>
              <div className="font-mono font-bold" style={{ color: (r as any).warn ? "#f5a623" : "#f0f2f7" }}>{r.value}</div>
            </div>
          ))}
        </div>
        {data.avgDailyMetrics.fuelNbDeclarations < 5 && (
          <div className="mt-2 pt-2 border-t" style={{ borderColor: "rgba(249,115,22,.2)", color: "#f97316" }}>
            ⚠️ Moins de 5 déclarations — la moyenne peut être faussée par un plein exceptionnel. <strong>Utilisez le champ Override dans ⚙️ Paramètres</strong> pour forcer votre budget journalier réel (ex: 13 000 XOF/j).
          </div>
        )}
        {params.fuelDailyOverride > 0 && (
          <div className="mt-2 pt-2 border-t" style={{ borderColor: "rgba(249,115,22,.2)", color: "#22c55e" }}>
            ✓ Override actif : <strong>{xof(params.fuelDailyOverride)} XOF/j</strong> × {data.cashFlow[0]?.revenue > 0 ? "30 j" : "—"} → projection basée sur votre budget réel.
          </div>
        )}
        {data.avgDailyMetrics.fuelPricePerLiter > 0 && (
          <div className="mt-1" style={{ color: "#555e75" }}>
            Prix/litre moyen déclaré : <strong style={{ color: "#f0f2f7" }}>{xof(data.avgDailyMetrics.fuelPricePerLiter)} XOF/L</strong> · {data.avgDailyMetrics.totalLiters.toFixed(1)}L total déclarés
          </div>
        )}
      </div>

      {/* Alerts */}
      {data.insights.filter((i) => i.type === "warning").map((ins, i) => (
        <div key={i} className="rounded-xl px-4 py-3 flex items-start gap-3"
          style={{ background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.2)" }}>
          <span>🚨</span>
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: "#f87171" }}>{ins.title}</div>
            <div className="text-xs mt-0.5" style={{ color: "#8b92a8" }}>{ins.body}</div>
          </div>
          {ins.value && <div className="font-mono font-bold text-sm" style={{ color: "#ef4444" }}>{ins.value}</div>}
        </div>
      ))}
    </div>
  );
}

// ── P&L DETAILED ──────────────────────────────────────
function PnLDetailed({ data }: { data: ReturnType<typeof usePilotage> }) {
  const all = [...data.historicalPnL, ...(data.currentProjection ? [data.currentProjection] : [])];
  const allCats = [...new Set(data.globalExpBreakdown.map((e) => e.category))];

  return (
    <div className="space-y-6">
      {/* P&L Table */}
      <Card>
        <SH title="Compte de Résultat — Détaillé par mois" sub="Données réelles + projection (★ italique)" />
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #2a2f3d" }}>
                <th className="py-2 pr-4 text-left font-semibold" style={{ color: "#555e75", minWidth: 180 }}>Ligne</th>
                {all.map((m) => (
                  <th key={m.month} className="py-2 px-3 text-right font-semibold whitespace-nowrap"
                    style={{ color: m.isProjection ? "#f5a623" : "#f0f2f7" }}>
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Revenue */}
              <PnLRow label="📈 Chiffre d'affaires net" values={all.map((m) => m.revenue)} color="#f5a623" bold />
              {/* Expense categories */}
              {allCats.map((cat, ci) => (
                <PnLRow key={cat} label={`  ${cat}`} color={CAT_COLORS[ci % CAT_COLORS.length]}
                  values={all.map((m) => -(m.expensesByCategory.find((e) => e.category === cat)?.amount ?? 0))} />
              ))}
              <PnLRow label="Sous-total dépenses" values={all.map((m) => -m.totalExpenses)} color="#ef4444" sub />
              <PnLRow label="💵 Salaires chauffeurs" values={all.map((m) => -m.salaries)} color="#f97316" />
              <PnLRow label="🔧 Maintenance véhicules" values={all.map((m) => -m.maintenance)} color="#8b92a8" />
              {/* EBITDA */}
              <tr style={{ borderTop: "2px solid #2a2f3d", background: "#1e2330" }}>
                <td className="py-2.5 pr-4 font-bold text-white">💰 EBITDA</td>
                {all.map((m) => (
                  <td key={m.month} className="py-2.5 px-3 text-right font-mono font-bold"
                    style={{ color: m.ebitda >= 0 ? "#22c55e" : "#ef4444", fontStyle: m.isProjection ? "italic" : "normal" }}>
                    {xof(m.ebitda)}
                  </td>
                ))}
              </tr>
              <PnLRow label="Marge EBITDA %" values={all.map((m) => m.margin)} color="#22c55e" isPct />
              <PnLRow label="Moy/jour" values={all.map((m) => m.dailyAvg)} color="#8b92a8" small />
            </tbody>
          </table>
        </div>
      </Card>

      {/* Expense breakdown pie + bar */}
      {data.globalExpBreakdown.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <SH title="Répartition globale des dépenses" sub="Cumul de la période" />
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="45%" height={180}>
                <PieChart>
                  <Pie data={data.globalExpBreakdown} dataKey="amount" cx="50%" cy="50%" outerRadius={75} innerRadius={40}>
                    {data.globalExpBreakdown.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [xof(Number(v)) + " XOF"]} contentStyle={{ background: "#0d1117", border: "1px solid #1e2330", borderRadius: 8, fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {data.globalExpBreakdown.map((e, i) => (
                  <div key={e.category} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
                    <span className="flex-1 truncate" style={{ color: "#8b92a8" }}>{e.category}</span>
                    <span className="font-mono font-bold text-white">{pct(e.pct)}</span>
                    <span className="font-mono text-xs" style={{ color: "#3d4560" }}>{xof(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Projections landing cards */}
          <Card>
            <SH title="Landing Mois · Trimestre · Année" sub="Basé sur la tendance actuelle" />
            <div className="space-y-3">
              {[
                { label: "Fin de mois", rev: data.currentProjection?.revenue ?? 0, ebitda: data.currentProjection?.ebitda ?? 0, margin: data.currentProjection?.margin ?? 0, color: "#f5a623" },
                { label: "Fin de trimestre", rev: data.quarterProjection.revenue, ebitda: data.quarterProjection.ebitda, margin: data.quarterProjection.marginPct, color: "#3b82f6" },
                { label: "Fin d'année", rev: data.yearProjection.revenue, ebitda: data.yearProjection.ebitda, margin: data.yearProjection.marginPct, color: "#a855f7" },
              ].map((p) => (
                <div key={p.label} className="rounded-xl p-3 flex items-center justify-between" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: p.color }}>{p.label}</div>
                    <div className="text-sm font-mono font-bold text-white">{xof(p.rev)} <span className="text-xs font-normal" style={{ color: "#3d4560" }}>XOF</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs" style={{ color: "#3d4560" }}>EBITDA</div>
                    <div className="text-sm font-mono font-bold" style={{ color: p.ebitda >= 0 ? "#22c55e" : "#ef4444" }}>{xof(p.ebitda)}</div>
                    <div className="text-[10px]" style={{ color: "#3d4560" }}>Marge: {pct(p.margin)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function PnLRow({ label, values, color, bold, sub, small, isPct, isNeg }: { label: string; values: number[]; color: string; bold?: boolean; sub?: boolean; small?: boolean; isPct?: boolean; isNeg?: boolean }) {
  const all = usePilotage.length; // unused, just for context
  return (
    <tr style={{ borderBottom: "1px solid #0d1117" }}>
      <td className={`py-1.5 pr-4 ${bold ? "font-bold text-white" : sub ? "font-semibold" : ""}`}
        style={{ color: bold ? "#f0f2f7" : sub ? "#ef4444" : small ? "#555e75" : color, paddingLeft: label.startsWith("  ") ? 16 : 0, fontSize: small ? 10 : 11 }}>
        {label.trim()}
      </td>
      {values.map((v, i) => (
        <td key={i} className="py-1.5 px-3 text-right font-mono"
          style={{ color: isPct ? (v >= 0 ? "#22c55e" : "#ef4444") : v < 0 ? "#ef4444" : color, fontWeight: bold ? 700 : 400, fontSize: small ? 10 : 11 }}>
          {isPct ? pct(v) : (v < 0 ? `- ${xof(Math.abs(v))}` : xof(Math.abs(v)))}
        </td>
      ))}
    </tr>
  );
}

// ── CASH FLOW ─────────────────────────────────────────
function CashFlowSection({ data, params }: { data: ReturnType<typeof usePilotage>; params: PilotageParams }) {
  const months = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  return (
    <div className="space-y-6">
      <SH title="💧 Cash Flow Prévisionnel — 3 mois" sub="Breakdown complet par catégorie · Projection basée sur les moyennes historiques" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.cashFlow.map((cf, i) => {
          const rows = [
            { label: "CA net", value: cf.revenue, color: "#f5a623", positive: true },
            { label: `⛽ Carburant (~${params.fuelPctOfRevenue}%)`, value: cf.fuel, color: "#ef4444" },
            { label: `💳 Solde Yango (~${params.soldePctOfRevenue}%)`, value: cf.solde, color: "#f97316" },
            { label: "📦 Autres dépenses", value: cf.other, color: "#8b92a8" },
            { label: "🔧 Maintenance", value: cf.maintenance, color: "#555e75" },
            { label: "💵 Salaires", value: cf.salaries, color: "#f97316" },
          ];
          return (
            <Card key={i} glow={i === 0 ? "#f5a623" : undefined}>
              <div className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: i === 0 ? "#f5a623" : "#555e75" }}>
                {i === 0 ? "🎯 " : ""}{cf.label} {cf.isProjection && "(proj.)"}
              </div>
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: "1px solid #080a0f" }}>
                  <span style={{ color: "#555e75" }}>{r.label}</span>
                  <span className="font-mono font-semibold" style={{ color: r.positive ? r.color : "#ef4444" }}>
                    {r.positive ? "" : "- "}{xof(r.value)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between pt-2.5 text-sm font-bold">
                <span className="text-white">Net Cash Flow</span>
                <span className="font-mono" style={{ color: cf.net >= 0 ? "#22c55e" : "#ef4444" }}>{xof(cf.net)} XOF</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "#1e2330" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (cf.net / cf.revenue) * 100))}%`, background: cf.net >= 0 ? "linear-gradient(90deg,#22c55e,#16a34a)" : "#ef4444" }} />
              </div>
              <div className="text-[10px] mt-1 text-right" style={{ color: "#3d4560" }}>
                {cf.revenue > 0 ? pct((cf.net / cf.revenue) * 100) : "—"} marge nette
              </div>
            </Card>
          );
        })}
      </div>

      {/* Chart */}
      <Card>
        <div className="text-sm font-bold text-white mb-4">Comparaison Cash Flow — 3 mois</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.cashFlow.map((cf) => ({ name: cf.label, Carburant: cf.fuel, Solde: cf.solde, Maintenance: cf.maintenance, Salaires: cf.salaries, Autres: cf.other, "Net Cash": cf.net, CA: cf.revenue }))}>
            <CartesianGrid strokeDasharray="2 4" stroke="#1e2330" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#555e75" }} />
            <YAxis tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="CA" fill="#f5a623" name="CA net" radius={[3,3,0,0]} />
            <Bar dataKey="Carburant" fill="#ef4444" radius={[3,3,0,0]} />
            <Bar dataKey="Salaires" fill="#f97316" radius={[3,3,0,0]} />
            <Bar dataKey="Maintenance" fill="#8b92a8" radius={[3,3,0,0]} />
            <Bar dataKey="Net Cash" fill="#22c55e" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ── DRIVERS ───────────────────────────────────────────
function DriversSection({ data, params }: { data: ReturnType<typeof usePilotage>; params: PilotageParams }) {
  if (!data.drivers.length) return <div className="text-center py-20" style={{ color: "#3d4560" }}>Aucune donnée conducteur ce mois.</div>;

  return (
    <div className="space-y-6">
      <SH title="🚗 Pilotage Conducteurs" sub="Tous les montants en NET après commissions Yango (15%) + Partenaire (0,75%) · Rapports validés uniquement" />
      {data.drivers.map((d) => {
        const mtdPct = params.targetMonthlyNet > 0 ? Math.min(100, (d.mtdNet / params.targetMonthlyNet) * 100) : 0;
        const projPct = params.targetMonthlyNet > 0 ? Math.min(100, (d.projectedMonthNet / params.targetMonthlyNet) * 100) : 0;
        const paceOk = !d.paceAlert;
        const prevDelta = d.prevDailyAvg > 0 ? ((d.dailyAvg - d.prevDailyAvg) / d.prevDailyAvg) * 100 : 0;

        return (
          <Card key={d.driverId} glow={d.paceAlert ? "#ef4444" : "#22c55e"}>
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black text-black"
                  style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>{d.name[0]}</div>
                <div>
                  <div className="font-bold text-white">{d.name}</div>
                  <div className="text-xs" style={{ color: "#3d4560" }}>ID: {d.driverId} · J{d.daysElapsed}/{d.daysInMonth} · {d.daysRemaining}j restants</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs" style={{ color: "#555e75" }}>Palier projeté</div>
                <div className="font-bold" style={{ color: "#f5a623" }}>{d.projectedTier}</div>
                <div className="font-mono font-bold text-sm" style={{ color: "#22c55e" }}>{xof(d.projectedSalary)} XOF</div>
              </div>
            </div>

            {/* MTD vs Projection double bar */}
            <div className="space-y-2 mb-5">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: "#555e75" }}>MTD net: <span className="font-mono font-bold text-white">{xof(d.mtdNet)}</span></span>
                  <span style={{ color: "#3d4560" }}>Objectif net: {xof(params.targetMonthlyNet)}</span>
                </div>
                <div className="h-3 rounded-full overflow-hidden relative" style={{ background: "#1e2330" }}>
                  <div className="h-full rounded-full" style={{ width: `${mtdPct}%`, background: "linear-gradient(90deg,#f5a623,#fbbf24)" }} />
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "#555e75" }}>Réalisé: {mtdPct.toFixed(0)}% · <span style={{ color: "#3d4560" }}>net après comm. Yango+partenaire</span></div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: "#555e75" }}>Projection nette: <span className="font-mono font-bold" style={{ color: "#f5a623" }}>{xof(d.projectedMonthNet)}</span></span>
                </div>
                <div className="h-3 rounded-full overflow-hidden" style={{ background: "#1e2330" }}>
                  <div className="h-full rounded-full" style={{ width: `${projPct}%`, background: projPct >= 100 ? "linear-gradient(90deg,#22c55e,#16a34a)" : "linear-gradient(90deg,#f5a623aa,#f5a623)" }} />
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "#555e75" }}>Landing: {projPct.toFixed(0)}% de l'objectif</div>
              </div>
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { label: "Moy/jour réelle", value: xof(d.dailyAvg) + " XOF", sub: prevDelta !== 0 ? `${prevDelta >= 0 ? "+" : ""}${prevDelta.toFixed(0)}% vs mois préc.` : "", color: paceOk ? "#22c55e" : "#ef4444" },
                { label: "Moy/jour nécessaire", value: xof(d.neededDailyAvg) + " XOF", sub: "pour atteindre objectif", color: "#555e75" },
                { label: "Reste à faire", value: xof(Math.max(0, params.targetMonthlyNet - d.mtdNet)) + " XOF", sub: `en ${d.daysRemaining}j (${xof(d.neededDailyAvg)}/j)`, color: "#8b92a8" },
                { label: "Salaire projeté", value: xof(d.projectedSalary) + " XOF", sub: d.projectedTier, color: "#f5a623" },
              ].map((k) => (
                <div key={k.label} className="rounded-xl p-3" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
                  <div className="text-[10px] mb-1" style={{ color: "#3d4560" }}>{k.label}</div>
                  <div className="text-xs font-mono font-bold" style={{ color: k.color }}>{k.value}</div>
                  {k.sub && <div className="text-[10px] mt-0.5" style={{ color: "#3d4560" }}>{k.sub}</div>}
                </div>
              ))}
            </div>

            {/* Salary tiers ladder */}
            <div className="rounded-xl p-4" style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
              <div className="text-[10px] uppercase tracking-wider font-bold mb-3" style={{ color: "#3d4560" }}>Grille paliers — Position & Projection</div>
              <div className="space-y-2">
                {params.salaryRules.map((r, i) => {
                  const isReached = d.mtdNet >= r.min_net;
                  const isProjected = d.projectedMonthNet >= r.min_net && !isReached;
                  const notReachable = d.projectedMonthNet < r.min_net;
                  const tierPct = r.min_net > 0 ? Math.min(100, (d.projectedMonthNet / r.min_net) * 100) : 100;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ background: isReached ? "#22c55e" : isProjected ? "#f5a623" : "#1e2330", color: isReached || isProjected ? "#000" : "#555e75" }}>
                        {isReached ? "✓" : isProjected ? "★" : i + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between text-xs mb-0.5">
                          <span style={{ color: isReached ? "#22c55e" : isProjected ? "#f5a623" : "#555e75" }}>{r.label} — {xof(r.total_salary)} XOF</span>
                          <span style={{ color: "#3d4560" }}>≥ {xof(r.min_net)}</span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1e2330" }}>
                          <div className="h-full rounded-full" style={{ width: `${tierPct}%`, background: isReached ? "#22c55e" : isProjected ? "#f5a623" : "#3d4560" }} />
                        </div>
                        {notReachable && r.min_net > 0 && (
                          <div className="text-[10px] mt-0.5" style={{ color: "#3d4560" }}>
                            Manque: {xof(r.min_net - d.projectedMonthNet)} XOF (+{xof((r.min_net - d.projectedMonthNet) / Math.max(d.daysRemaining, 1))}/j)
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Alert */}
            {d.paceAlert && (
              <div className="mt-3 rounded-xl px-3 py-2.5 flex items-start gap-2"
                style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.2)" }}>
                <span>🚨</span>
                <div className="text-xs" style={{ color: "#f87171" }}>
                  Rythme insuffisant de <strong>{xof(d.neededDailyAvg - d.dailyAvg)} XOF/j</strong>. Sans ajustement, landing à <strong>{d.projectedTier}</strong> ({xof(d.projectedSalary)} XOF salaire).
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── SIMULATION ────────────────────────────────────────
function SimulationSection({ data, params }: { data: ReturnType<typeof usePilotage>; params: PilotageParams }) {
  return (
    <div className="space-y-6">
      <SH title="🔮 Simulation Flotte" sub={`Impact de l'ajout de véhicules · Maintenance ${xofFmt(params.maintenanceCostPerMonth)} XOF/véhicule/mois incluse · Salaires ajustés par palier`} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.vehicleSimulations.map((sim, i) => (
          <Card key={i} glow={i === 0 ? "#1e2330" : i === 1 ? "#f5a623" : "#22c55e"}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "#555e75" }}>{i === 0 ? "Situation actuelle" : `Scénario +${i} véhicule${i > 1 ? "s" : ""}`}</div>
                <div className="text-2xl font-bold text-white">{sim.nVehicles} <span className="text-sm font-normal" style={{ color: "#555e75" }}>véh.</span></div>
              </div>
              <div className="text-right">
                {i > 0 && <div className="text-xs font-semibold mb-0.5" style={{ color: sim.deltaEbitda > 0 ? "#22c55e" : "#ef4444" }}>
                  {sim.deltaEbitda > 0 ? "+" : ""}{xof(sim.deltaEbitda)} XOF EBITDA
                </div>}
                <div className="text-lg font-bold" style={{ color: sim.marginPct >= 0 ? "#22c55e" : "#ef4444" }}>{pct(sim.marginPct)}</div>
                <div className="text-[10px]" style={{ color: "#3d4560" }}>marge</div>
              </div>
            </div>
            {[
              { l: "CA mensuel projeté", v: sim.revenue, c: "#f5a623" },
              { l: "Dépenses opé.", v: -sim.expenses, c: "#ef4444" },
              { l: "Maintenance", v: -sim.maintenance, c: "#8b92a8" },
              { l: "Salaires", v: -sim.salaries, c: "#f97316" },
              { l: "EBITDA mensuel", v: sim.ebitda, c: sim.ebitda >= 0 ? "#22c55e" : "#ef4444" },
            ].map((r) => (
              <div key={r.l} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: "1px solid #0d1117" }}>
                <span style={{ color: "#555e75" }}>{r.l}</span>
                <span className="font-mono font-bold" style={{ color: r.v >= 0 ? r.c : "#ef4444" }}>
                  {r.v < 0 ? `- ${xof(Math.abs(r.v))}` : xof(r.v)} XOF
                </span>
              </div>
            ))}
          </Card>
        ))}
      </div>

      {/* Line chart */}
      <Card>
        <div className="text-sm font-bold text-white mb-4">Courbes de projection — CA · EBITDA en fonction de la flotte</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.vehicleSimulations.map((s) => ({ véhicules: s.nVehicles, CA: s.revenue, EBITDA: s.ebitda, Salaires: s.salaries, Maintenance: s.maintenance }))}>
            <CartesianGrid strokeDasharray="2 4" stroke="#1e2330" />
            <XAxis dataKey="véhicules" tick={{ fontSize: 11, fill: "#555e75" }} />
            <YAxis tick={{ fontSize: 10, fill: "#555e75" }} tickFormatter={(v) => (v / 1000000).toFixed(1) + "M"} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="CA" stroke="#f5a623" strokeWidth={2} dot={{ fill: "#f5a623", r: 4 }} />
            <Line type="monotone" dataKey="EBITDA" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 4 }} />
            <Line type="monotone" dataKey="Salaires" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
            <Line type="monotone" dataKey="Maintenance" stroke="#8b92a8" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ── OPÉRATIONNEL ──────────────────────────────────────
type OpsFilter = "all" | "weekday" | "weekend" | number; // number = weekdayNum 0-6
type SortKey = "date" | "net" | "courses" | "km" | "fare" | "solde" | "fuel";

function OpsSection({ data }: { data: ReturnType<typeof usePilotage> }) {
  const [filter, setFilter] = useState<OpsFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [chartMetric, setChartMetric] = useState<"net" | "courses" | "km" | "fare">("net");
  const ops = data.dailyOps;

  // Filtering
  const filtered = ops.filter((d) => {
    if (filter === "all") return true;
    if (filter === "weekday") return d.weekdayNum >= 1 && d.weekdayNum <= 5;
    if (filter === "weekend") return d.weekdayNum === 0 || d.weekdayNum === 6;
    return d.weekdayNum === filter;
  });

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    let av = 0, bv = 0;
    if (sortKey === "date") { av = a.date < b.date ? -1 : 1; return sortAsc ? av : -av; }
    if (sortKey === "net") { av = a.net; bv = b.net; }
    if (sortKey === "courses") { av = a.courses; bv = b.courses; }
    if (sortKey === "km") { av = a.km; bv = b.km; }
    if (sortKey === "fare") { av = a.avgFare; bv = b.avgFare; }
    if (sortKey === "solde") { av = a.solde; bv = b.solde; }
    if (sortKey === "fuel") { av = a.fuel; bv = b.fuel; }
    return sortAsc ? av - bv : bv - av;
  });

  const hasCourses = ops.some((d) => d.courses > 0);
  const hasKm = ops.some((d) => d.km > 0);
  const hasFare = ops.some((d) => d.avgFare > 0);

  // Stats on filtered set
  const fLen = filtered.length || 1;
  const fNetAvg = filtered.reduce((s, d) => s + d.net, 0) / fLen;
  const fCoursesAvg = filtered.reduce((s, d) => s + d.courses, 0) / fLen;
  const fKmAvg = filtered.reduce((s, d) => s + d.km, 0) / fLen;
  const fFareAvg = filtered.filter((d) => d.avgFare > 0).length > 0
    ? filtered.filter((d) => d.avgFare > 0).reduce((s, d) => s + d.avgFare, 0) / filtered.filter((d) => d.avgFare > 0).length : 0;
  const fSoldeAvg = filtered.reduce((s, d) => s + d.solde, 0) / fLen;
  const fFuelAvg = filtered.reduce((s, d) => s + d.fuel, 0) / fLen;
  const globalNetAvg = ops.length > 0 ? ops.reduce((s, d) => s + d.net, 0) / ops.length : 0;

  // Cost per km
  const costPerKm = fKmAvg > 0 ? (fFuelAvg + fSoldeAvg) / fKmAvg : 0;
  const revenuePerKm = fKmAvg > 0 ? fNetAvg / fKmAvg : 0;

  // Weekday heatmap data (Mon→Sun)
  const wdOrder = [1, 2, 3, 4, 5, 6, 0];
  const wdLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const wdStats = data.weekdayStats;
  const maxWdNet = Math.max(...wdStats.map((s) => s.avgNet), 1);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(false); }
  };
  const sortArrow = (k: SortKey) => sortKey === k ? (sortAsc ? " ↑" : " ↓") : "";

  // Chart data (last 30)
  const chartData = [...filtered].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const chartAvg = chartData.reduce((s, d) => s + (d as any)[chartMetric === "fare" ? "avgFare" : chartMetric], 0) / (chartData.length || 1);

  return (
    <div className="space-y-6">
      {/* ── HEADER KPIs ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: "💰", label: "Net moyen / jour", value: xof(data.avgDailyMetrics.revenue), sub: `${ops.length} jours enregistrés`, color: "#f5a623" },
          { icon: "🚗", label: "Courses / jour", value: hasCourses ? data.avgDailyMetrics.avgCourses.toFixed(1) : "—", sub: hasFare ? `Prix moy: ${xof(data.avgDailyMetrics.avgFare)} XOF` : "Déclarez via rapport", color: "#22c55e" },
          { icon: "📍", label: "KM / jour", value: hasKm ? data.avgDailyMetrics.avgKm.toFixed(0) + " km" : "—", sub: hasKm && revenuePerKm > 0 ? `${xof(revenuePerKm)} XOF/km` : "Renseignez l'odomètre", color: "#8b92a8" },
          { icon: "⛽", label: "Carburant / jour", value: xof(data.avgDailyMetrics.fuelRawDailyAvg), sub: data.avgDailyMetrics.fuelPricePerLiter > 0 ? `${xof(data.avgDailyMetrics.fuelPricePerLiter)} XOF/L · ${data.avgDailyMetrics.totalLiters.toFixed(0)}L` : "Ajoutez les litres en description", color: "#f97316" },
          { icon: "💳", label: "Solde Yango / jour", value: xof(data.avgDailyMetrics.solde), sub: "Wallet moyen déclaré", color: "#3b82f6" },
          { icon: "🎯", label: "Prix moyen course", value: hasFare ? xof(data.avgDailyMetrics.avgFare) + " XOF" : "—", sub: "Brut Yango ÷ nb courses", color: "#a855f7" },
          { icon: "🔧", label: "Coût / km", value: hasKm && costPerKm > 0 ? xof(costPerKm) + " XOF" : "—", sub: "(Fuel + Solde) ÷ KM", color: "#ef4444" },
          { icon: "📊", label: "Taux net / brut", value: data.avgDailyMetrics.revenue > 0 ? ((data.avgDailyMetrics.net / data.avgDailyMetrics.revenue) * 100).toFixed(0) + "%" : "—", sub: "Net après dépenses ÷ brut", color: "#22c55e" },
        ].map((k, i) => (
          <div key={i} className="rounded-xl p-4" style={{ background: "#0d1117", border: `1px solid ${k.value !== "—" ? k.color + "25" : "#1e2330"}` }}>
            <div className="flex items-center gap-2 mb-2">
              <span>{k.icon}</span>
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "#555e75" }}>{k.label}</span>
            </div>
            <div className="text-lg font-mono font-bold" style={{ color: k.value !== "—" ? k.color : "#3d4560" }}>{k.value}</div>
            <div className="text-[10px] mt-1" style={{ color: "#3d4560" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── HEATMAP JOURS SEMAINE ─── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-bold text-white">🗓️ Heatmap performance · Jour de la semaine</div>
            <div className="text-xs mt-0.5" style={{ color: "#555e75" }}>Moyenne sur les 3 derniers mois — meilleurs jours en orange</div>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {wdOrder.map((wdNum, i) => {
            const s = wdStats.find((w) => wdOrder[wdLabels.indexOf(w.shortDay)] === wdNum || w.shortDay === wdLabels[i]);
            // fallback: find by shortDay label
            const stat = data.weekdayStats.find((w) => w.shortDay === wdLabels[i]);
            const intensity = stat && maxWdNet > 0 ? stat.avgNet / maxWdNet : 0;
            const isActive = filter === wdNum;
            const isWeekend = wdNum === 0 || wdNum === 6;
            return (
              <button key={wdNum} onClick={() => setFilter(filter === wdNum ? "all" : wdNum)}
                className="rounded-xl p-2 text-center transition-all"
                style={{
                  background: isActive ? "rgba(245,166,35,.2)" : intensity > 0.7 ? "rgba(245,166,35,.15)" : intensity > 0.4 ? "rgba(245,166,35,.07)" : "#0d1117",
                  border: `1px solid ${isActive ? "#f5a623" : intensity > 0.5 ? "rgba(245,166,35,.2)" : "#1e2330"}`,
                  cursor: "pointer",
                }}>
                <div className="text-[10px] font-bold mb-1" style={{ color: isActive ? "#f5a623" : isWeekend ? "#f5a623aa" : "#555e75" }}>{wdLabels[i]}</div>
                <div className="text-xs font-mono font-bold" style={{ color: isActive ? "#f5a623" : intensity > 0.5 ? "#f0f2f7" : "#3d4560" }}>
                  {stat && stat.count > 0 ? (stat.avgNet / 1000).toFixed(0) + "k" : "—"}
                </div>
                {stat && stat.count > 0 && (
                  <div className="mt-1.5 h-1 rounded-full" style={{ background: "#1e2330" }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.round(intensity * 100)}%`, background: `rgba(245,166,35,${0.3 + intensity * 0.7})` }} />
                  </div>
                )}
                {stat && stat.avgCourses > 0 && (
                  <div className="text-[9px] mt-1" style={{ color: "#3d4560" }}>{stat.avgCourses.toFixed(0)} crs</div>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-3 text-[10px]" style={{ color: "#3d4560" }}>
          <span>Cliquez sur un jour pour filtrer</span>
          <span>·</span>
          <button onClick={() => setFilter("weekday")} className="hover:text-white" style={{ color: filter === "weekday" ? "#f5a623" : "#3d4560" }}>Semaine</button>
          <span>·</span>
          <button onClick={() => setFilter("weekend")} className="hover:text-white" style={{ color: filter === "weekend" ? "#f5a623" : "#3d4560" }}>Week-end</button>
          <span>·</span>
          <button onClick={() => setFilter("all")} className="hover:text-white" style={{ color: filter === "all" ? "#f5a623" : "#3d4560" }}>Tous</button>
        </div>
      </Card>

      {/* ── GRAPHIQUE PRINCIPAL ─── */}
      {filtered.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-bold text-white">
                {filter === "all" ? "Tous les jours" : filter === "weekday" ? "Semaine uniquement" : filter === "weekend" ? "Week-end uniquement" : `${wdLabels[wdOrder.indexOf(filter as number)]} uniquement`}
                {" — "}{filtered.length} jours · moy: <span style={{ color: "#f5a623" }}>{xof(fNetAvg)}</span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: "#555e75" }}>30 derniers jours filtrés · barre verte = au-dessus de la moyenne globale</div>
            </div>
            {/* Metric selector */}
            <div className="flex gap-1">
              {[["net","CA net"],["courses","Courses"],["km","KM"],["fare","Prix moy."]].map(([k, l]) => (
                <button key={k} onClick={() => setChartMetric(k as any)}
                  className="text-[10px] px-2 py-1 rounded-lg"
                  style={{ background: chartMetric === k ? "rgba(245,166,35,.15)" : "#1e2330", color: chartMetric === k ? "#f5a623" : "#555e75", border: `1px solid ${chartMetric === k ? "rgba(245,166,35,.3)" : "transparent"}` }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barSize={chartData.length > 20 ? 8 : 14} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#1e2330" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#555e75" }} />
              <YAxis tick={{ fontSize: 9, fill: "#555e75" }} tickFormatter={(v) => chartMetric === "net" || chartMetric === "fare" ? (v / 1000).toFixed(0) + "k" : String(Math.round(v))} width={36} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = chartData.find((r) => r.label === label);
                const val = d ? (chartMetric === "fare" ? d.avgFare : (d as any)[chartMetric]) : 0;
                return (
                  <div className="rounded-xl p-3 text-xs" style={{ background: "#0d1117", border: "1px solid #1e2330", minWidth: 170 }}>
                    <div className="font-bold text-white mb-2">{d?.date} <span style={{ color: d?.weekdayNum === 0 || d?.weekdayNum === 6 ? "#f5a623" : "#555e75" }}>({d?.weekday})</span></div>
                    <div className="flex justify-between gap-3 py-0.5">
                      <span style={{ color: "#f5a623" }}>{chartMetric === "net" ? "CA net" : chartMetric === "courses" ? "Courses" : chartMetric === "km" ? "KM" : "Prix moy."}</span>
                      <span className="font-mono font-bold text-white">{chartMetric === "net" || chartMetric === "fare" ? xof(val) + " XOF" : String(Math.round(val))}</span>
                    </div>
                    {d && d.courses > 0 && <div className="mt-1.5 pt-1.5 border-t text-[10px]" style={{ borderColor: "#1e2330", color: "#555e75" }}>🚗 {d.courses} courses · {d.avgFare > 0 ? xof(d.avgFare) + " moy." : ""}</div>}
                    {d && d.km > 0 && <div className="text-[10px]" style={{ color: "#555e75" }}>📍 {d.km} km · {d.fuel > 0 && d.km > 0 ? xof(d.fuel / d.km) + " XOF/km" : ""}</div>}
                    {d && (d.solde > 0 || d.fuel > 0) && <div className="text-[10px]" style={{ color: "#555e75" }}>💳 {xof(d.solde)} · ⛽ {xof(d.fuel)}</div>}
                    <div className="text-[10px] mt-1" style={{ color: val >= globalNetAvg ? "#22c55e" : "#ef4444" }}>
                      {chartMetric === "net" && (val >= globalNetAvg ? `▲ +${xof(val - globalNetAvg)} vs moy.` : `▼ -${xof(globalNetAvg - val)} vs moy.`)}
                    </div>
                  </div>
                );
              }} />
              <Bar dataKey={chartMetric === "fare" ? "avgFare" : chartMetric} name="Valeur" radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => {
                  const val = chartMetric === "fare" ? d.avgFare : (d as any)[chartMetric];
                  const avg = chartMetric === "net" ? globalNetAvg : chartAvg;
                  return <Cell key={i} fill={val >= avg ? "#22c55e" : "#ef4444"} opacity={0.85} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── TABLEAU JOURNAL ─── */}
      {sorted.length > 0 ? (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-bold text-white">📋 Journal quotidien</div>
              <div className="text-xs mt-0.5" style={{ color: "#555e75" }}>{sorted.length} jours · cliquer entête = trier</div>
            </div>
            {filter !== "all" && (
              <button onClick={() => setFilter("all")} className="text-[10px] px-3 py-1.5 rounded-lg" style={{ background: "rgba(245,166,35,.1)", color: "#f5a623", border: "1px solid rgba(245,166,35,.2)" }}>
                ✕ Retirer le filtre
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #1e2330" }}>
                  {[
                    ["date","Date",true],["date","Jour",false],["net","CA net",true],
                    ...(hasCourses ? [["courses","Courses",true]] : []),
                    ...(hasFare ? [["fare","Prix moy.",true]] : []),
                    ...(hasKm ? [["km","KM",true]] : []),
                    ["solde","Solde",true],["fuel","Carburant",true],
                  ].map(([k, h, sortable]) => (
                    <th key={String(h)} onClick={() => sortable && toggleSort(k as SortKey)}
                      className={`py-2 px-3 text-left font-semibold whitespace-nowrap select-none ${sortable ? "cursor-pointer hover:text-white" : ""}`}
                      style={{ color: sortKey === k ? "#f5a623" : "#555e75" }}>
                      {h}{sortable ? sortArrow(k as SortKey) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 50).map((d, i) => {
                  const aboveAvg = d.net >= globalNetAvg;
                  return (
                    <tr key={d.date} style={{ borderBottom: "1px solid #0d1117", background: i % 2 === 0 ? "transparent" : "rgba(30,35,48,.25)" }}>
                      <td className="py-2 px-3 font-mono text-white">{d.date}</td>
                      <td className="py-2 px-3 font-semibold" style={{ color: d.weekdayNum === 0 || d.weekdayNum === 6 ? "#f5a623" : "#555e75" }}>
                        {d.weekday}
                        {(d.weekdayNum === 0 || d.weekdayNum === 6) && <span className="ml-1 text-[9px]">WE</span>}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold" style={{ color: aboveAvg ? "#22c55e" : "#ef4444" }}>{xof(d.net)}</span>
                          <span className="text-[9px]" style={{ color: aboveAvg ? "#22c55e55" : "#ef444455" }}>{aboveAvg ? "▲" : "▼"}</span>
                        </div>
                      </td>
                      {hasCourses && <td className="py-2 px-3 text-center font-mono" style={{ color: d.courses > 0 ? "#22c55e" : "#3d4560" }}>{d.courses > 0 ? d.courses : "—"}</td>}
                      {hasFare && <td className="py-2 px-3 font-mono" style={{ color: d.avgFare > 0 ? "#a855f7" : "#3d4560" }}>{d.avgFare > 0 ? xof(d.avgFare) : "—"}</td>}
                      {hasKm && <td className="py-2 px-3 font-mono" style={{ color: d.km > 0 ? "#8b92a8" : "#3d4560" }}>{d.km > 0 ? d.km + " km" : "—"}</td>}
                      <td className="py-2 px-3 font-mono" style={{ color: d.solde > 0 ? "#3b82f6" : "#3d4560" }}>{d.solde > 0 ? xof(d.solde) : "—"}</td>
                      <td className="py-2 px-3 font-mono" style={{ color: d.fuel > 0 ? "#f97316" : "#3d4560" }}>{d.fuel > 0 ? xof(d.fuel) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #1e2330", background: "rgba(245,166,35,.04)" }}>
                  <td colSpan={2} className="py-2.5 px-3 font-bold text-white text-xs">Moy. ({filter === "all" ? "tous" : filter === "weekday" ? "semaine" : filter === "weekend" ? "WE" : wdLabels[wdOrder.indexOf(filter as number)]})</td>
                  <td className="py-2.5 px-3 font-mono font-bold" style={{ color: "#f5a623" }}>{xof(fNetAvg)}</td>
                  {hasCourses && <td className="py-2.5 px-3 text-center font-mono font-bold" style={{ color: "#22c55e" }}>{fCoursesAvg.toFixed(1)}</td>}
                  {hasFare && <td className="py-2.5 px-3 font-mono font-bold" style={{ color: "#a855f7" }}>{fFareAvg > 0 ? xof(fFareAvg) : "—"}</td>}
                  {hasKm && <td className="py-2.5 px-3 font-mono font-bold" style={{ color: "#8b92a8" }}>{fKmAvg > 0 ? fKmAvg.toFixed(0) + " km" : "—"}</td>}
                  <td className="py-2.5 px-3 font-mono font-bold" style={{ color: "#3b82f6" }}>{xof(fSoldeAvg)}</td>
                  <td className="py-2.5 px-3 font-mono font-bold" style={{ color: "#f97316" }}>{xof(fFuelAvg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ) : (
        <div className="text-center py-20" style={{ color: "#3d4560" }}>
          <div className="text-4xl mb-3">📅</div>
          <div className="text-sm text-white">Aucune donnée pour ce filtre.</div>
          <button onClick={() => setFilter("all")} className="mt-3 text-xs px-4 py-2 rounded-xl" style={{ background: "rgba(245,166,35,.1)", color: "#f5a623" }}>Voir tous les jours</button>
        </div>
      )}
    </div>
  );
}

// ── INSIGHTS ──────────────────────────────────────────
function InsightsSection({ data }: { data: ReturnType<typeof usePilotage> }) {
  const cfg: Record<string, { icon: string; color: string; bg: string; border: string; label: string }> = {
    warning: { icon: "🚨", color: "#ef4444", bg: "rgba(239,68,68,.06)", border: "rgba(239,68,68,.2)", label: "Alerte" },
    opportunity: { icon: "💡", color: "#22c55e", bg: "rgba(34,197,94,.06)", border: "rgba(34,197,94,.2)", label: "Opportunité" },
    tip: { icon: "🎯", color: "#3b82f6", bg: "rgba(59,130,246,.06)", border: "rgba(59,130,246,.2)", label: "Conseil" },
  };
  return (
    <div className="space-y-4">
      <SH title="💡 Insights & Recommandations" sub="Générés automatiquement sur la base de vos données réelles." />
      {data.insights.map((ins, i) => {
        const c = cfg[ins.type];
        return (
          <div key={i} className="rounded-2xl p-5 flex items-start gap-4"
            style={{ background: c.bg, border: `1px solid ${c.border}` }}>
            <span className="text-2xl flex-shrink-0 mt-0.5">{c.icon}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: c.color + "20", color: c.color }}>{c.label}</span>
                <span className="text-sm font-bold text-white">{ins.title}</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "#8b92a8" }}>{ins.body}</p>
            </div>
            {ins.value && <div className="font-mono font-bold text-sm flex-shrink-0" style={{ color: c.color }}>{ins.value}</div>}
          </div>
        );
      })}
    </div>
  );
}
