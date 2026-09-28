"use client";

// Mode simple — vue épurée pour propriétaires de véhicules non initiés.
// Couche ADDITIVE : aucun calcul propre, tout vient de useDashboardKPIs et des
// APIs existantes (calc.ts reste la source de vérité). Activé par
// tenant_settings.ui_mode = 'simple' (migration 037) ; la bascule « Mode
// avancé » rend l'UI complète historique sans rien perdre.

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Home, Gauge, Users, LogOut, Car, Plus } from "lucide-react";
import { displayLabel } from "@/lib/tenant/platformLabel";
import { isDriverActiveToday } from "@/lib/drivers";
import ThemeToggle from "@/components/ThemeToggle";
import TreemapDepenses from "@/components/TreemapDepenses";
import { useValidationQueue } from "@/components/ValidationQueue";

const SALARY_MODELS: { value: string; label: string }[] = [
  { value: "", label: "Config par défaut" },
  { value: "fixed", label: "Salaire fixe" },
  { value: "tiered", label: "Paliers (CA net)" },
  { value: "percent", label: "% du CA" },
  { value: "hybrid", label: "Fixe + bonus + %" },
  { value: "location", label: "Location / jour" },
];

const xof = (n: number) => Math.round(n || 0).toLocaleString("fr-FR");

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs uppercase tracking-widest font-bold mt-7 mb-2.5" style={{ color: "var(--sk-t3)" }}>{children}</h2>;
}

function KpiCard({ label, value, sub, color, big }: { label: string; value: string; sub?: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
      <div className="text-[11px] uppercase tracking-widest font-bold" style={{ color: "var(--sk-t3)" }}>{label}</div>
      <div className={`font-mono font-extrabold mt-1 ${big ? "text-3xl" : "text-xl"}`} style={{ color: color || "#fff" }}>{value}</div>
      {sub && <div className="text-[11.5px] mt-1" style={{ color: "var(--sk-t3)" }}>{sub}</div>}
    </div>
  );
}

type PeriodKey = "month" | "prev-month" | "7d";

function periodRange(key: PeriodKey): { from: string; to: string; label: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (key === "7d") {
    return { from: iso(new Date(Date.now() - 6 * 864e5)), to: iso(now), label: "7 derniers jours" };
  }
  if (key === "prev-month") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(first), to: iso(last), label: "Mois dernier" };
  }
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now), label: "Ce mois" };
}

interface Props {
  tenantId: string;
  appName: string;
  platformLabel?: string; // mot affiché à la place de « Yango » (migration 038)
  onSwitchToFull: () => void;
  onSignOut: () => void;
}

export default function SimpleModeAdmin({ tenantId, appName, platformLabel, onSwitchToFull, onSignOut }: Props) {
  const plat = platformLabel || "Yango";
  const [tab, setTab] = useState<"accueil" | "pilotage" | "equipe">("accueil");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const period = periodRange(periodKey);
  // refreshTick force un rechargement des KPIs après une validation (paramètre
  // refreshKey dédié du hook — l'ancien hack ""/undefined ne survivait pas à la
  // multi-sélection chauffeurs).
  const [refreshTick, setRefreshTick] = useState(0);
  const kpis = useDashboardKPIs(period.from, period.to, tenantId, undefined, refreshTick);

  // ── Flux de validation complet (rapports + dépenses) : le mode simple doit
  //    se suffire à lui-même, sans passer par le mode avancé. Mêmes écritures
  //    que l'UI complète : statut + action_logs + notification push chauffeur.
  const { pending, pendingExp, driverNames, acting, reportAction, expenseAction } = useValidationQueue(tenantId, () => setRefreshTick((t) => t + 1));
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── Équipe : chauffeurs + véhicules ──
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [savingDriver, setSavingDriver] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamOk, setTeamOk] = useState<string | null>(null);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newDriver, setNewDriver] = useState({ driverId: "", fullName: "", password: "" });
  const [newVehicle, setNewVehicle] = useState({ plate: "", make: "", model: "" });
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(async () => {
    const supabase = createClient() as any;
    const [dRes, vRes] = await Promise.all([
      fetch("/api/admin/drivers").then((r) => (r.ok ? r.json() : { drivers: [] })).catch(() => ({ drivers: [] })),
      supabase.from("vehicles").select("id, plate, make, model, driver_id, mileage, status").eq("tenant_id", tenantId).order("plate"),
    ]);
    // Règle canonique lib/drivers : un contrat terminé sort aussi du mode simple.
    setDrivers((dRes.drivers || []).filter((d: any) => isDriverActiveToday(d)));
    setVehicles(vRes.data || []);
  }, [tenantId]);

  useEffect(() => { if (tab === "equipe") loadTeam(); }, [tab, loadTeam]);

  const flash = (ok: string | null, err: string | null) => {
    setTeamOk(ok); setTeamError(err);
    setTimeout(() => { setTeamOk(null); setTeamError(null); }, 4000);
  };

  // L'action update de /api/admin/drivers écrase TOUS les champs de rému —
  // on renvoie donc les valeurs existantes du chauffeur avec le nouveau modèle.
  const setDriverModel = async (d: any, salary_model: string) => {
    setSavingDriver(d.id);
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update", driverProfileId: d.id,
          comm_yango: d.comm_yango, comm_partner: d.comm_partner,
          hire_date: d.hire_date, contract_end_date: d.contract_end_date,
          solde_initial: d.solde_initial, base_amount: d.base_amount,
          account_type: d.account_type || "driver",
          salary_model,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erreur");
      await loadTeam();
      flash("Mode de rémunération enregistré", null);
    } catch (e: any) {
      flash(null, e.message);
    } finally {
      setSavingDriver(null);
    }
  };

  const assignVehicle = async (vehicleId: string, driverId: string) => {
    const supabase = createClient() as any;
    const { error } = await supabase.from("vehicles").update({ driver_id: driverId || null }).eq("id", vehicleId);
    if (error) flash(null, error.message);
    else { await loadTeam(); flash("Attribution enregistrée", null); }
  };

  const createDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriver.driverId || !newDriver.fullName || newDriver.password.length < 8) {
      flash(null, "ID, nom et mot de passe (8 caractères min.) requis"); return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create", driverId: newDriver.driverId.toUpperCase(),
          fullName: newDriver.fullName, password: newDriver.password,
          paymentFrequency: "monthly", accountType: "driver",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Erreur création");
      setNewDriver({ driverId: "", fullName: "", password: "" });
      setShowAddDriver(false);
      await loadTeam();
      flash("Chauffeur créé — donne-lui son ID et son mot de passe", null);
    } catch (err: any) {
      flash(null, err.message);
    } finally {
      setBusy(false);
    }
  };

  const createVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicle.plate) { flash(null, "Plaque requise"); return; }
    setBusy(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("vehicles").insert({
        tenant_id: tenantId, plate: newVehicle.plate.toUpperCase(),
        make: newVehicle.make, model: newVehicle.model,
        mileage: 0, status: "active",
      });
      if (error) throw new Error(error.message);
      setNewVehicle({ plate: "", make: "", model: "" });
      setShowAddVehicle(false);
      await loadTeam();
      flash("Véhicule ajouté", null);
    } catch (err: any) {
      flash(null, err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Dérivés d'affichage (lecture seule des KPIs — aucun recalcul métier) ──
  const totalKm = kpis.dailyRows.reduce((s, r) => s + (r.km || 0), 0);
  const nbDays = kpis.dailyRows.length || 1;
  const recettesBrutes = kpis.brutYango + kpis.horsYango;
  const coutKm = totalKm > 0 ? (kpis.soldeConsomme + kpis.carburantConsomme) / totalKm : 0;
  const amort = kpis.amortissement || 0;
  const netAffiche = amort > 0 ? kpis.netFinalApresAmort : kpis.netFinal;
  const margeAffichee = amort > 0 ? kpis.margeApresAmort : kpis.monthMarginPercent;
  // Net d'amortissement : un coût de revient au kilomètre qui ignore l'usure du
  // véhicule est l'indicateur le plus trompeur qu'on puisse donner.
  const netParKm = totalKm > 0 ? netAffiche / totalKm : 0;

  const inputCls = "w-full rounded-xl px-3 py-2.5 text-sm outline-none";
  const inputStyle: React.CSSProperties = { background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" };
  const chartTooltip = { backgroundColor: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderRadius: 8, fontSize: 12 };

  const NAV = [
    { id: "accueil" as const, label: "Accueil", Icon: Home },
    { id: "pilotage" as const, label: "Pilotage", Icon: Gauge },
    { id: "equipe" as const, label: "Équipe", Icon: Users },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: "var(--sk-deep)", color: "var(--sk-t1)" }}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b" style={{ background: "var(--sk-deep)", borderColor: "var(--sk-surface)" }}>
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl grid place-items-center font-extrabold text-[13px]" style={{ background: "var(--sk-accent, var(--tenant-color))", color: "#151007" }}>
            {appName.slice(0, 3).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[15px] truncate">{appName}</div>
            <div className="text-[11px]" style={{ color: "var(--sk-t3)" }}>{period.label} · montants en XOF</div>
          </div>
          <div className="flex gap-1.5">
            {(["month", "prev-month", "7d"] as PeriodKey[]).map((k) => (
              <button key={k} onClick={() => setPeriodKey(k)}
                className="text-[11px] px-2.5 py-1.5 rounded-full font-semibold"
                style={periodKey === k
                  ? { background: "var(--sk-accent, var(--tenant-color))", color: "#151007" }
                  : { background: "var(--sk-bg)", color: "var(--sk-t2)", border: "1px solid var(--sk-surface)" }}>
                {k === "month" ? "Mois" : k === "prev-month" ? "M-1" : "7 j"}
              </button>
            ))}
          </div>
          <ThemeToggle />
          <button onClick={onSignOut} title="Déconnexion" className="p-2 rounded-lg" style={{ color: "var(--sk-t3)" }}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4">
        {/* ══════════ ACCUEIL ══════════ */}
        {tab === "accueil" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              <div className="col-span-2 md:col-span-1">
                <KpiCard big label={amort > 0 ? "Résultat net" : "Net final"} value={`${netAffiche >= 0 ? "+" : ""}${xof(netAffiche)}`}
                  color={netAffiche >= 0 ? "#22c55e" : "#ef4444"}
                  sub={amort > 0
                    ? `${margeAffichee.toFixed(1)} % de marge · après amortissement −${xof(amort)}`
                    : `${margeAffichee.toFixed(1)} % de marge`} />
              </div>
              <KpiCard label="Recettes brutes" value={xof(recettesBrutes)} color="var(--tenant-color)" sub={`moy. ${xof(kpis.avgBrutPerDay)} / jour`} />
              <KpiCard label="Dépenses" value={`− ${xof(kpis.totalDepenses)}`} color="#ef4444" sub="carburant · solde · autres" />
            </div>

            {/* À valider — rapports + dépenses, détails dépliables, valider/rejeter */}
            <div className="rounded-2xl p-4 mt-3 border-l-4"
              style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderLeft: `4px solid ${pending.length + pendingExp.length > 0 ? "var(--tenant-color)" : "#22c55e"}` }}>
              <div className="text-[11px] uppercase tracking-widest font-bold mb-1" style={{ color: "var(--sk-t3)" }}>
                À valider {pending.length + pendingExp.length > 0 ? `(${pending.length + pendingExp.length})` : ""}
              </div>
              {pending.length + pendingExp.length === 0 && (
                <div className="text-sm py-1.5" style={{ color: "var(--sk-t2)" }}>Rien en attente — tout est validé ✓</div>
              )}

              {pending.map((r: any) => (
                <div key={r.id} className="border-t first:border-t-0" style={{ borderColor: "var(--sk-surface)" }}>
                  <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    className="w-full flex items-center gap-3 py-2.5 text-left">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{driverNames[r.driver_id] || "Chauffeur"} · {r.date}</div>
                      <div className="text-[11.5px] font-mono" style={{ color: "var(--sk-t3)" }}>
                        Brut {xof((r.yango_gross || 0) + (r.yango_bonus || 0) + (r.off_yango_revenue || 0))} · Net {xof(r.net_after_expenses || 0)}
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: "var(--sk-t3)", transform: expanded === r.id ? "rotate(180deg)" : "none" }}>▾</span>
                  </button>
                  {expanded === r.id && (
                    <div className="pb-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] font-mono rounded-xl p-3 mb-2.5"
                        style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                        {[
                          [`Brut ${plat}`, xof(r.yango_gross || 0)],
                          [`Bonus ${plat}`, xof(r.yango_bonus || 0)],
                          [`Hors ${plat}`, xof(r.off_yango_revenue || 0)],
                          ["Commission", `− ${xof(r.commission_amount || 0)}`],
                          ["Net", xof(r.net_after_expenses || 0)],
                          ["Solde wallet", xof(r.solde_yango || 0)],
                          ["Compteur", r.end_odometer ? `${xof(r.end_odometer)} km` : "—"],
                          ["Courses", String((r.yango_trip_count || 0) + (r.off_yango_trip_count || 0) || "—")],
                        ].map(([l, v]) => (
                          <div key={l as string} className="flex justify-between gap-2">
                            <span style={{ color: "var(--sk-t3)" }}>{l}</span>
                            <span className="text-white">{v}</span>
                          </div>
                        ))}
                        {r.comment && (
                          <div className="col-span-2 font-sans text-[11.5px] pt-1" style={{ color: "var(--sk-t2)" }}>💬 {r.comment}</div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => reportAction(r, "approved")} disabled={acting === r.id}
                          className="flex-1 text-xs px-3.5 py-2.5 rounded-xl font-bold"
                          style={{ background: "#22c55e", color: "#06130a", opacity: acting === r.id ? 0.6 : 1 }}>
                          {acting === r.id ? "…" : "✓ Valider"}
                        </button>
                        <button onClick={() => reportAction(r, "rejected")} disabled={acting === r.id}
                          className="text-xs px-3.5 py-2.5 rounded-xl font-bold"
                          style={{ background: "rgba(239,68,68,.14)", color: "#ef4444", border: "1px solid rgba(239,68,68,.3)", opacity: acting === r.id ? 0.6 : 1 }}>
                          ✗ Rejeter
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {pendingExp.map((e: any) => (
                <div key={e.id} className="border-t" style={{ borderColor: "var(--sk-surface)" }}>
                  <button onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                    className="w-full flex items-center gap-3 py-2.5 text-left">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">
                        Dépense · {displayLabel(e.category || "Autre")} · {driverNames[e.driver_id] || e._profile?.full_name || "Chauffeur"}
                      </div>
                      <div className="text-[11.5px] font-mono" style={{ color: "var(--sk-t3)" }}>
                        {xof(e.amount || 0)} · {e.expense_date || e.created_at?.slice(0, 10)}
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: "var(--sk-t3)", transform: expanded === e.id ? "rotate(180deg)" : "none" }}>▾</span>
                  </button>
                  {expanded === e.id && (
                    <div className="pb-3">
                      {e.description && (
                        <div className="text-[12px] rounded-xl p-3 mb-2.5" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t2)" }}>
                          {e.description}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => expenseAction(e, "approved")} disabled={acting === e.id}
                          className="flex-1 text-xs px-3.5 py-2.5 rounded-xl font-bold"
                          style={{ background: "#22c55e", color: "#06130a", opacity: acting === e.id ? 0.6 : 1 }}>
                          {acting === e.id ? "…" : "✓ Valider"}
                        </button>
                        <button onClick={() => expenseAction(e, "rejected")} disabled={acting === e.id}
                          className="text-xs px-3.5 py-2.5 rounded-xl font-bold"
                          style={{ background: "rgba(239,68,68,.14)", color: "#ef4444", border: "1px solid rgba(239,68,68,.3)", opacity: acting === e.id ? 0.6 : 1 }}>
                          ✗ Rejeter
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <SectionTitle>Recettes par jour</SectionTitle>
            <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
              {kpis.dailyRows.length === 0 ? (
                <p className="text-sm py-6 text-center" style={{ color: "var(--sk-t3)" }}>
                  Aucune activité sur la période — les chiffres apparaissent dès qu'une déclaration est validée.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={kpis.dailyRows} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sk-surface)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(d) => d.slice(5)} />
                    <YAxis stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                    <Tooltip contentStyle={chartTooltip} formatter={(v: any) => [Number(v).toLocaleString("fr-FR")]} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="brutYango" fill="#f5a623" name={`Brut ${plat}`} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="horsYango" fill="#a855f7" name={`Hors ${plat}`} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="netFinal" fill="#22c55e" name="Net final" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {kpis.expenseBreakdown.length > 0 && (
              <>
                <SectionTitle>Dépenses par catégorie</SectionTitle>
                <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                  {/* Même composant que le mode avancé : le propriétaire qui
                      passe d'un mode à l'autre doit lire le même graphique.
                      Le CA est celui affiché plus haut en recettes. */}
                  <TreemapDepenses
                    breakdown={kpis.expenseBreakdown}
                    ca={kpis.brutYango + kpis.horsYango}
                    hauteur={240}
                    label={displayLabel}
                    tooltipStyle={chartTooltip}
                  />
                </div>
              </>
            )}

            <SectionTitle>KPI opérationnels</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <KpiCard label="KM / jour" value={String(kpis.avgKmPerDay)} color="#3b82f6" sub={`${xof(totalKm)} km au total`} />
              <KpiCard label="Solde conso. / jour" value={xof(kpis.soldeConsomme / nbDays)} color="#f97316" sub={`${xof(kpis.soldeConsomme)} au total`} />
              <KpiCard label="Coût au km" value={xof(coutKm)} sub="carburant + solde" />
              <KpiCard label="Net moyen / jour" value={xof(kpis.avgNetPerDay)} color="#22c55e" sub={`sur ${nbDays} jours`} />
            </div>

            {kpis.dailyRows.length > 0 && (
              <>
                <SectionTitle>Récap journalier</SectionTitle>
                <div className="rounded-2xl overflow-x-auto" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                  <table className="w-full font-mono text-xs" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        {["Date", "Brut", "Hors-app", "Dépenses", "Net", "KM"].map((h, i) => (
                          <th key={h} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-bold ${i === 0 ? "text-left" : "text-right"}`}
                            style={{ color: "var(--sk-t3)", borderBottom: "1px solid var(--sk-surface)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.dailyRows.map((r) => (
                        <tr key={r.date}>
                          <td className="px-3 py-2 text-left" style={{ color: "var(--sk-t2)", borderBottom: "1px solid var(--sk-surface)" }}>{r.date.slice(5)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "var(--tenant-color)", borderBottom: "1px solid var(--sk-surface)" }}>{xof(r.brutYango)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "#a855f7", borderBottom: "1px solid var(--sk-surface)" }}>{xof(r.horsYango)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "#ef4444", borderBottom: "1px solid var(--sk-surface)" }}>−{xof(r.depenses)}</td>
                          <td className="px-3 py-2 text-right font-bold" style={{ color: r.netFinal >= 0 ? "#22c55e" : "#ef4444", borderBottom: "1px solid var(--sk-surface)" }}>{xof(r.netFinal)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: "var(--sk-t2)", borderBottom: "1px solid var(--sk-surface)" }}>{r.km || "—"}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "var(--sk-surface)" }}>
                        <td className="px-3 py-2.5 text-left font-bold">Total</td>
                        <td className="px-3 py-2.5 text-right font-bold" style={{ color: "var(--tenant-color)" }}>{xof(kpis.brutYango)}</td>
                        <td className="px-3 py-2.5 text-right font-bold" style={{ color: "#a855f7" }}>{xof(kpis.horsYango)}</td>
                        <td className="px-3 py-2.5 text-right font-bold" style={{ color: "#ef4444" }}>−{xof(kpis.totalDepenses)}</td>
                        <td className="px-3 py-2.5 text-right font-bold" style={{ color: netAffiche >= 0 ? "#22c55e" : "#ef4444" }}>{xof(netAffiche)}</td>
                        <td className="px-3 py-2.5 text-right font-bold">{xof(totalKm)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Bascule mode avancé */}
            <div className="rounded-2xl p-4 mt-7 flex items-center gap-3" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
              <div className="flex-1">
                <div className="text-sm font-bold">Mode avancé</div>
                <div className="text-[11.5px]" style={{ color: "var(--sk-t3)" }}>Historique, paiements, avances, KYC, journal, réglages…</div>
              </div>
              <button onClick={onSwitchToFull} className="text-xs px-4 py-2.5 rounded-xl font-bold"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid var(--sk-surface)" }}>
                Activer
              </button>
            </div>
          </>
        )}

        {/* ══════════ PILOTAGE ══════════ */}
        {tab === "pilotage" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              <div className="col-span-2 md:col-span-1">
                <KpiCard big label="KM parcourus" value={xof(totalKm)} color="#3b82f6" sub={`moy. ${kpis.avgKmPerDay} km / jour`} />
              </div>
              <KpiCard label="Coût / km" value={xof(coutKm)} sub="carburant + solde" />
              <KpiCard label="Net / km" value={xof(netParKm)} color={netParKm >= 0 ? "#22c55e" : "#ef4444"} sub="rentabilité kilométrique" />
            </div>

            <SectionTitle>KM par jour</SectionTitle>
            <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
              {totalKm === 0 ? (
                <p className="text-sm py-6 text-center" style={{ color: "var(--sk-t3)" }}>
                  Pas encore de kilométrage — il se calcule à partir des relevés compteur des déclarations validées.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={kpis.dailyRows.filter((r) => r.km > 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sk-surface)" vertical={false} />
                    <XAxis dataKey="date" stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} tickFormatter={(d) => d.slice(5)} />
                    <YAxis stroke="var(--sk-t3)" tick={{ fontSize: 10, fill: "var(--sk-t3)" }} />
                    <Tooltip contentStyle={chartTooltip} formatter={(v: any) => [v + " km", "KM"]} />
                    <Bar dataKey="km" fill="#3b82f6" name="KM / jour" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <SectionTitle>Par chauffeur</SectionTitle>
            <div className="rounded-2xl overflow-x-auto" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
              <table className="w-full font-mono text-xs" style={{ minWidth: 480 }}>
                <thead>
                  <tr>
                    {["Chauffeur", "Jours", "Net validé", "En attente"].map((h, i) => (
                      <th key={h} className={`px-3 py-2.5 text-[10px] uppercase tracking-wider font-bold ${i === 0 ? "text-left" : "text-right"}`}
                        style={{ color: "var(--sk-t3)", borderBottom: "1px solid var(--sk-surface)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kpis.driverAllocations.map((d) => (
                    <tr key={d.driver_id}>
                      <td className="px-3 py-2 text-left font-sans font-semibold" style={{ borderBottom: "1px solid var(--sk-surface)" }}>{d.name}</td>
                      <td className="px-3 py-2 text-right" style={{ color: "var(--sk-t2)", borderBottom: "1px solid var(--sk-surface)" }}>{d.nbApproved}</td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: "#22c55e", borderBottom: "1px solid var(--sk-surface)" }}>{xof(d.netApproved)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: "var(--tenant-color)", borderBottom: "1px solid var(--sk-surface)" }}>{d.nbPending > 0 ? `${xof(d.netPending)} (${d.nbPending})` : "—"}</td>
                    </tr>
                  ))}
                  {kpis.driverAllocations.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center font-sans" style={{ color: "var(--sk-t3)" }}>Aucune donnée chauffeur sur la période.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══════════ ÉQUIPE ══════════ */}
        {tab === "equipe" && (
          <>
            {(teamOk || teamError) && (
              <div className="rounded-xl px-4 py-3 mb-3 text-sm font-semibold"
                style={teamOk ? { background: "rgba(34,197,94,.12)", color: "#22c55e" } : { background: "rgba(239,68,68,.12)", color: "#ef4444" }}>
                {teamOk || teamError}
              </div>
            )}

            <SectionTitle>Chauffeurs</SectionTitle>
            <div className="space-y-2.5">
              {drivers.map((d: any) => {
                const veh = vehicles.find((v: any) => v.driver_id === d.id);
                return (
                  <div key={d.id} className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="w-10 h-10 rounded-full grid place-items-center font-bold text-sm flex-none"
                        style={{ background: "var(--sk-surface)", color: "var(--tenant-color)" }}>
                        {(d.full_name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("")}
                      </div>
                      <div className="flex-1 min-w-[130px]">
                        <div className="font-bold text-sm">{d.full_name}</div>
                        <div className="text-[11.5px]" style={{ color: "var(--sk-t3)" }}>
                          {d.driver_id}{veh ? ` · ${veh.make || ""} ${veh.model || ""} ${veh.plate}` : " · aucun véhicule"}
                        </div>
                      </div>
                      <select value={d.salary_model || ""} disabled={savingDriver === d.id}
                        onChange={(e) => setDriverModel(d, e.target.value)}
                        className="rounded-xl px-3 py-2 text-xs outline-none cursor-pointer" style={inputStyle}
                        aria-label={`Mode de rémunération de ${d.full_name}`}>
                        {SALARY_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
              {drivers.length === 0 && (
                <p className="text-sm py-4 text-center" style={{ color: "var(--sk-t3)" }}>Aucun chauffeur — ajoute le premier ci-dessous.</p>
              )}
            </div>

            {!showAddDriver ? (
              <button onClick={() => setShowAddDriver(true)}
                className="mt-3 text-xs px-4 py-2.5 rounded-xl font-bold inline-flex items-center gap-1.5"
                style={{ background: "var(--sk-accent, var(--tenant-color))", color: "#151007" }}>
                <Plus size={14} /> Ajouter un chauffeur
              </button>
            ) : (
              <form onSubmit={createDriver} className="rounded-2xl p-4 mt-3 space-y-3" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input value={newDriver.driverId} onChange={(e) => setNewDriver({ ...newDriver, driverId: e.target.value })}
                    placeholder="ID chauffeur (ex : MD01)" className={inputCls} style={inputStyle} />
                  <input value={newDriver.fullName} onChange={(e) => setNewDriver({ ...newDriver, fullName: e.target.value })}
                    placeholder="Nom complet" className={inputCls} style={inputStyle} />
                  <input type="password" value={newDriver.password} onChange={(e) => setNewDriver({ ...newDriver, password: e.target.value })}
                    placeholder="Mot de passe (8 min.)" className={inputCls} style={inputStyle} />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="text-xs px-4 py-2.5 rounded-xl font-bold" style={{ background: "#22c55e", color: "#06130a" }}>
                    {busy ? "…" : "Créer le chauffeur"}
                  </button>
                  <button type="button" onClick={() => setShowAddDriver(false)} className="text-xs px-4 py-2.5 rounded-xl font-semibold"
                    style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>Annuler</button>
                </div>
              </form>
            )}

            <SectionTitle>Véhicules</SectionTitle>
            <div className="space-y-2.5">
              {vehicles.map((v: any) => (
                <div key={v.id} className="rounded-2xl p-4 flex items-center gap-3 flex-wrap" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                  <div className="w-10 h-10 rounded-full grid place-items-center flex-none" style={{ background: "var(--sk-surface)", color: "#3b82f6" }}>
                    <Car size={18} />
                  </div>
                  <div className="flex-1 min-w-[130px]">
                    <div className="font-bold text-sm">{v.make} {v.model}</div>
                    <div className="text-[11.5px] font-mono" style={{ color: "var(--sk-t3)" }}>{v.plate}{v.mileage ? ` · ${xof(v.mileage)} km` : ""}</div>
                  </div>
                  <select value={v.driver_id || ""} onChange={(e) => assignVehicle(v.id, e.target.value)}
                    className="rounded-xl px-3 py-2 text-xs outline-none cursor-pointer" style={inputStyle}
                    aria-label={`Chauffeur attribué à ${v.plate}`}>
                    <option value="">— Aucun chauffeur —</option>
                    {drivers.map((d: any) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                </div>
              ))}
              {vehicles.length === 0 && (
                <p className="text-sm py-4 text-center" style={{ color: "var(--sk-t3)" }}>Aucun véhicule — ajoute le premier ci-dessous.</p>
              )}
            </div>

            {!showAddVehicle ? (
              <button onClick={() => setShowAddVehicle(true)}
                className="mt-3 text-xs px-4 py-2.5 rounded-xl font-bold inline-flex items-center gap-1.5"
                style={{ background: "var(--sk-accent, var(--tenant-color))", color: "#151007" }}>
                <Plus size={14} /> Ajouter un véhicule
              </button>
            ) : (
              <form onSubmit={createVehicle} className="rounded-2xl p-4 mt-3 space-y-3" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input value={newVehicle.plate} onChange={(e) => setNewVehicle({ ...newVehicle, plate: e.target.value })}
                    placeholder="Plaque (ex : DK-0000-AA)" className={inputCls} style={inputStyle} />
                  <input value={newVehicle.make} onChange={(e) => setNewVehicle({ ...newVehicle, make: e.target.value })}
                    placeholder="Marque" className={inputCls} style={inputStyle} />
                  <input value={newVehicle.model} onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })}
                    placeholder="Modèle" className={inputCls} style={inputStyle} />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="text-xs px-4 py-2.5 rounded-xl font-bold" style={{ background: "#22c55e", color: "#06130a" }}>
                    {busy ? "…" : "Ajouter le véhicule"}
                  </button>
                  <button type="button" onClick={() => setShowAddVehicle(false)} className="text-xs px-4 py-2.5 rounded-xl font-semibold"
                    style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>Annuler</button>
                </div>
              </form>
            )}
          </>
        )}
      </main>

      {/* ── Nav bas ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t" style={{ background: "var(--sk-deep)", borderColor: "var(--sk-surface)" }}>
        <div className="max-w-3xl mx-auto flex">
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => { setTab(id); window.scrollTo({ top: 0 }); }}
              className="flex-1 flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-bold"
              style={{ color: tab === id ? "var(--sk-accent, var(--tenant-color))" : "var(--sk-t3)" }}>
              <Icon size={20} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
