"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/tenant/context";
import { BrandLogo } from "@/components/brand/BrandShell";
import NotificationBell from "@/components/NotificationBell";
import { resolveRates, computeCommissions } from "@/lib/calc";
import { Home, ClipboardList, Wallet, BedDouble, History, Target, LogOut, Gauge, CheckCircle2, AlertTriangle, Paperclip, Calendar, Car, HandCoins } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { RemunerationConfig } from "@/lib/tenant/types";

type Cfg = RemunerationConfig;

const DEFAULT_CFG: Cfg = {
  id: "", tenant_id: "",
  model: "tiered",
  base_amount: 200000,
  commission_rate: 0,
  bonus_threshold: 0,
  bonus_amount: 0,
  comm_yango: 15,
  comm_partner: 0.75,
  salary_tiers: [
    { min_net: 0,       total_salary: 200000, label: "Base" },
    { min_net: 1000000, total_salary: 230000, label: "Palier 1" },
    { min_net: 1150000, total_salary: 260000, label: "Palier 2" },
    { min_net: 1300000, total_salary: 300000, label: "Palier 3" },
  ],
  target_net: 1300000,
  daily_rent: 0,
};

function calcReport(yangoGross: number, yangoBonus: number, offYango: number, cfg: Cfg) {
  const base = yangoGross + yangoBonus;
  const commY = base * (cfg.comm_yango / 100);
  const commP = base * (cfg.comm_partner / 100);
  const netY = base - commY - commP;
  return { base, commY, commP, netY, offYango, total: netY + offYango };
}

function salaryLevel(net: number, cfg: Cfg) {
  const tiers = [...(cfg.salary_tiers || [])].sort((a, b) => b.min_net - a.min_net);
  return tiers.find((r) => net >= r.min_net) ?? tiers[tiers.length - 1] ?? { min_net: 0, total_salary: cfg.base_amount, label: "Base" };
}

function xof(n: number) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " XOF";
}

type Tab = "home" | "report" | "expense" | "history" | "profil" | "pilotage" | "repos";

interface Profile {
  id: string;
  driver_id: string;
  full_name: string;
  role: string;
  tenant_id: string;
}

export default function DriverApp() {
  const { user, loading, signOut } = useAuth();
  const { settings } = useTenant();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("home");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/auth/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (user) loadProfile();
  }, [user]);

  const loadProfile = async () => {
    try {
      const supabase = createClient() as any;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();
      if (error || !data) {
        setProfileError("Profil introuvable. Contactez l'administrateur.");
      } else {
        setProfile(data);
        // Load remuneration config for this tenant
        if (data.tenant_id) {
          const { data: remun } = await supabase
            .from("remuneration_config")
            .select("*")
            .eq("tenant_id", data.tenant_id)
            .maybeSingle();
          if (remun) {
            setCfg({
              ...DEFAULT_CFG,
              ...remun,
              salary_tiers: Array.isArray(remun.salary_tiers) ? remun.salary_tiers : DEFAULT_CFG.salary_tiers,
            });
          }
        }
      }
    } catch {
      setProfileError("Erreur de chargement du profil.");
    } finally {
      setLoadingProfile(false);
    }
  };

  if (loading || loadingProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--sk-deep)" }}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex justify-center"><BrandLogo size={40} /></div>
          <p className="text-sm" style={{ color: "var(--sk-t3)" }}>Chargement...</p>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ background: "var(--sk-deep)" }}>
        <div className="text-center max-w-sm">
          <div className="flex justify-center mb-4"><AlertTriangle size={40} strokeWidth={1.7} style={{ color: "#f5a623" }} /></div>
          <h2 className="text-lg font-semibold text-white mb-2">Compte non configuré</h2>
          <p className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>{profileError}</p>
          <button onClick={() => signOut()} className="text-sm px-4 py-2 rounded-lg"
            style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid #2a2f3d" }}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if (!user || !profile) return null;

  const navItems: [Tab, LucideIcon, string][] = [
    ["home",    Home,          "Accueil"],
    ["report",  ClipboardList, "Rapport"],
    ["expense", Wallet,        "Dépense"],
    ["repos",   BedDouble,     "Repos"],
    ["history", History,       "Historique"],
    ["pilotage",Target,        "Pilotage"],
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ background: "var(--sk-deep)" }}>

      {/* ── DESKTOP SIDEBAR ── (hidden on mobile) */}
      <aside className="hidden md:flex flex-col sticky top-0 h-screen z-40 shrink-0"
        style={{ width: 220, background: "var(--sk-bg)", borderRight: "1px solid var(--sk-surface)" }}>
        {/* Logo / user */}
        <div className="px-5 py-6 border-b" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="flex items-center gap-3 mb-4">
            <BrandLogo size={36} />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--sk-t4)" }}>{settings.app_name}</div>
              <div className="font-semibold text-sm text-white truncate max-w-[120px]">{profile.full_name}</div>
            </div>
          </div>
          <div className="text-xs px-2 py-1 rounded-md font-mono" style={{ background: "var(--sk-surface)", color: "var(--sk-t3)" }}>
            ID : {profile.driver_id || "—"}
          </div>
        </div>
        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map(([id, Icon, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: tab === id ? "rgba(245,166,35,.1)" : "transparent",
                color: tab === id ? "#f5a623" : "var(--sk-t3)",
                border: tab === id ? "1px solid rgba(245,166,35,.2)" : "1px solid transparent",
              }}>
              <Icon size={18} strokeWidth={2} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {/* Notifications + sign out */}
        <div className="p-4 border-t" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="flex justify-center mb-2"><NotificationBell /></div>
          <button onClick={() => signOut()}
            className="w-full text-xs py-2 rounded-lg transition-all"
            style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid #2a2f3d" }}>
            Se déconnecter →
          </button>
        </div>
      </aside>

      {/* ── MAIN COLUMN ── */}
      <div className="flex-1 flex flex-col min-h-screen md:min-h-0">

        {/* Mobile header (hidden on desktop) */}
        <div className="md:hidden px-5 py-4 flex items-center justify-between sticky top-0 z-50"
          style={{ background: "var(--sk-bg)", borderBottom: "1px solid var(--sk-surface)" }}>
          <div className="flex items-center gap-2.5">
            <BrandLogo size={28} />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--sk-t4)" }}>{settings.app_name}</div>
              <div className="font-semibold text-sm text-white">{profile.full_name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button onClick={() => signOut()} aria-label="Se déconnecter"
              className="p-2 rounded-lg flex items-center justify-center"
              style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid #2a2f3d" }}>
              <LogOut size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Desktop page title bar */}
        <div className="hidden md:flex items-center justify-between px-8 py-5 border-b shrink-0"
          style={{ borderColor: "var(--sk-surface)", background: "#0a0c10" }}>
          <div className="font-semibold text-white text-base">
            {navItems.find(([id]) => id === tab)?.[2] ?? "Accueil"}
          </div>
          <div className="text-xs" style={{ color: "#374151" }}>
            {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <div className="md:max-w-3xl md:mx-auto md:px-0">
            {tab === "home"     && <HomeTab    profile={profile} onNav={setTab} cfg={cfg} />}
            {tab === "report"   && <ReportTab  profile={profile} onBack={() => setTab("home")} cfg={cfg} />}
            {tab === "expense"  && <ExpenseTab profile={profile} onBack={() => setTab("home")} />}
            {tab === "history"  && <HistoryTab profile={profile} onBack={() => setTab("home")} cfg={cfg} />}
            {tab === "profil"   && <ProfilTab  profile={profile} onBack={() => setTab("home")} />}
            {tab === "pilotage" && <DriverPilotageTab profile={profile} onBack={() => setTab("home")} cfg={cfg} />}
            {tab === "repos"    && <ReposTab   profile={profile} onBack={() => setTab("home")} />}
          </div>
        </div>
      </div>

      {/* ── MOBILE BOTTOM NAV ── (hidden on desktop) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 flex z-50"
        style={{ background: "var(--sk-bg)", borderTop: "1px solid var(--sk-surface)" }}>
        {navItems.map(([id, Icon, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 py-2.5 flex flex-col items-center gap-1"
            style={{ color: tab === id ? "#f5a623" : "var(--sk-t4)" }}>
            <Icon size={20} strokeWidth={tab === id ? 2.4 : 2} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── HOME ────────────────────────────────────────────
function HomeTab({ profile, onNav, cfg }: { profile: Profile; onNav: (t: Tab) => void; cfg: Cfg }) {
  const [monthNet, setMonthNet] = useState(0);
  const [monthPending, setMonthPending] = useState(0);
  const [todayStatus, setTodayStatus] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const today = new Date().toISOString().split("T")[0];
      const monthStart = today.slice(0, 7) + "-01";

      const [{ data: m }, { data: mp }, { data: t }, { data: p }, { data: rej }] = await Promise.all([
        supabase.from("daily_reports").select("net_after_expenses").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).gte("date", monthStart).in("status", ["approved", "submitted"]),
        supabase.from("daily_reports").select("net_after_expenses").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).gte("date", monthStart).eq("status", "approved"),
        supabase.from("daily_reports").select("status").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("date", today).maybeSingle(),
        supabase.from("daily_reports").select("id").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("status", "submitted"),
        supabase.from("daily_reports").select("id, date").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("status", "rejected"),
      ]);
      setMonthNet((m || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0));
      setMonthPending((mp || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0)); // approved only
      setTodayStatus(t?.status ?? null);
      setPendingCount(p?.length ?? 0);
      setRejectedCount((rej || []).length);
    })();
  }, [profile.id]);

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl p-4" style={{
        background: todayStatus ? "rgba(34,197,94,.06)" : "rgba(245,166,35,.06)",
        border: `1px solid ${todayStatus ? "rgba(34,197,94,.2)" : "rgba(245,166,35,.2)"}`,
      }}>
        <div className="text-xs font-semibold mb-1" style={{ color: todayStatus ? "#22c55e" : "#f5a623" }}>
          {todayStatus ? "✓ Rapport soumis aujourd'hui" : "⚠ Aucun rapport aujourd'hui"}
        </div>
        <div className="text-sm" style={{ color: "var(--sk-t3)" }}>
          {todayStatus === "submitted" ? "En attente de validation" : todayStatus === "approved" ? "Validé ✓" : todayStatus === "rejected" ? "Rejeté ✗" : "Soumettez votre rapport en fin de journée"}
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="text-xs rounded-xl px-4 py-3" style={{ background: "rgba(245,166,35,.07)", border: "1px solid rgba(245,166,35,.15)", color: "#f5c842" }}>
          📬 {pendingCount} rapport(s) en attente de validation
        </div>
      )}

      {rejectedCount > 0 && (
        <button onClick={() => onNav("history")} className="w-full text-left rounded-xl px-4 py-3"
          style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)", color: "#ef4444" }}>
          <span className="font-semibold text-sm">⚠ {rejectedCount} rapport(s) rejeté(s)</span>
          <span className="block text-xs mt-0.5" style={{ color: "#f87171" }}>Voir l'historique → resoumettre ou archiver</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onNav("report")} className="rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-xs font-semibold transition-all"
          style={{ background: todayStatus && todayStatus !== "rejected" ? "var(--sk-bg)" : "linear-gradient(135deg,#f5a623,#e8951a)", color: todayStatus && todayStatus !== "rejected" ? "var(--sk-t4)" : "#000", border: todayStatus && todayStatus !== "rejected" ? "1px solid var(--sk-surface)" : "none" }}>
          <ClipboardList size={22} strokeWidth={2.2} />
          <span>{todayStatus && todayStatus !== "rejected" ? "Rapport soumis" : "Faire le rapport"}</span>
        </button>
        <button onClick={() => onNav("expense")} className="rounded-2xl p-4 flex flex-col items-center justify-center gap-2 text-xs font-semibold"
          style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", color: "var(--sk-t2)" }}>
          <Wallet size={22} strokeWidth={2.2} />
          <span>Ajouter dépense</span>
        </button>
      </div>

      <div className="rounded-2xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>Mois en cours</div>
        <div className="text-3xl font-bold text-white font-mono mb-1">{xof(monthNet)}</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {monthPending > 0 && (
            <div className="text-xs px-2 py-1 rounded-lg inline-block" style={{ background: "rgba(34,197,94,.08)", color: "#22c55e" }}>
              ✓ {xof(monthPending)} validé
            </div>
          )}
          {monthNet - monthPending > 0 && (
            <div className="text-xs px-2 py-1 rounded-lg inline-block" style={{ background: "rgba(245,166,35,.1)", color: "#f5a623" }}>
              ⏳ {xof(monthNet - monthPending)} en attente
            </div>
          )}
        </div>

        {/* Affichage adaptatif selon le modèle de rémunération */}
        {(cfg.model === "tiered") && (() => {
          const level = salaryLevel(monthNet, cfg);
          const nextLevel = cfg.salary_tiers.find((r) => r.min_net > monthNet && r.total_salary > level.total_salary);
          const progress = nextLevel ? Math.min(100, ((monthNet - level.min_net) / (nextLevel.min_net - level.min_net)) * 100) : 100;
          return (
            <>
              <div className="text-xs mb-2" style={{ color: "var(--sk-t4)" }}>Net déclaré · {level.label} → {xof(level.total_salary)}</div>
              {nextLevel ? (
                <>
                  {/* Audit UI : hiérarchie « Il vous manque » — plus de soustraction mentale */}
                  <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Il vous manque</div>
                  <div className="font-mono font-bold" style={{ color: "#facc15", fontSize: "1.5rem", lineHeight: 1.2, margin: "1px 0 2px" }}>
                    {xof(nextLevel.min_net - monthNet)}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 12 }}>
                    pour atteindre <span style={{ color: "#f5a623", fontWeight: 600 }}>{nextLevel.label}</span>
                  </div>
                  <div style={{ color: "#22c55e", fontSize: 12, marginBottom: 8 }}>salaire : {xof(nextLevel.total_salary)}/mois</div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--sk-surface)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: "#4ade80" }} />
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>{Math.round(progress)}% atteint</div>
                </>
              ) : (
                <div className="text-xs font-semibold" style={{ color: "#22c55e" }}>🎉 Palier max atteint · Salaire : {xof(level.total_salary)}</div>
              )}
            </>
          );
        })()}

        {cfg.model === "fixed" && (
          <div className="text-xs" style={{ color: "var(--sk-t4)" }}>
            Salaire fixe mensuel : <span className="font-bold" style={{ color: "#22c55e" }}>{xof(cfg.base_amount)}</span>
          </div>
        )}

        {cfg.model === "percent" && (
          <div className="text-xs" style={{ color: "var(--sk-t4)" }}>
            Votre part ({Math.round(cfg.commission_rate * 100)}%) : <span className="font-bold" style={{ color: "#22c55e" }}>{xof(monthNet * cfg.commission_rate)}</span>
          </div>
        )}

        {cfg.model === "hybrid" && (() => {
          const bonus = monthNet >= cfg.bonus_threshold && cfg.bonus_threshold > 0 ? cfg.bonus_amount : 0;
          return (
            <div className="text-xs space-y-1" style={{ color: "var(--sk-t4)" }}>
              <div>Fixe : <span className="text-white">{xof(cfg.base_amount)}</span></div>
              {cfg.bonus_threshold > 0 && (
                <div>Bonus {monthNet >= cfg.bonus_threshold ? "✓" : `(atteint à ${xof(cfg.bonus_threshold)})`} : <span style={{ color: bonus > 0 ? "#22c55e" : "var(--sk-t3)" }}>{xof(cfg.bonus_amount)}</span></div>
              )}
            </div>
          );
        })()}

        {cfg.model === "location" && (() => {
          const daysElapsed = new Date().getDate();
          const rentDue = cfg.daily_rent * daysElapsed;
          const netAfterRent = Math.max(0, monthNet - rentDue);
          return (
            <div className="text-xs space-y-1 mt-1" style={{ color: "var(--sk-t4)" }}>
              <div>Loyer dû ({daysElapsed}j × {xof(cfg.daily_rent)}/j) : <span style={{ color: "#ef4444" }}>{xof(rentDue)}</span></div>
              <div>Net après loyer : <span className="font-bold" style={{ color: netAfterRent > 0 ? "#22c55e" : "#ef4444" }}>{xof(netAfterRent)}</span></div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── REPORT ──────────────────────────────────────────
function ReportTab({ profile, onBack, cfg }: { profile: Profile; onBack: () => void; cfg: Cfg }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ date: today, end_odometer: "", yango_gross: "", yango_bonus: "", off_yango_revenue: "", solde_yango: "", yango_trip_count: "", off_yango_trip_count: "", service_supplementaire: "", comment: "" });
  const [todayReport, setTodayReport] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehicle, setVehicle] = useState<any>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const n = (s: string) => parseFloat(s) || 0;
  const addFiles = (files: FileList | null) => { if (files) setPendingFiles((prev) => [...prev, ...Array.from(files)]); };

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const [{ data: rep }, { data: veh }] = await Promise.all([
        supabase.from("daily_reports").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("date", today).maybeSingle(),
        supabase.from("vehicles").select("id,plate,partner_rate,yango_rate").eq("driver_id", profile.id).maybeSingle(),
      ]);
      if (rep) {
        setTodayReport(rep);
        // Pré-remplir le formulaire si rapport rejeté → permet modification avant resoumission
        if (rep.status === "rejected") {
          setForm({
            date: rep.date || today,
            end_odometer: rep.end_odometer ? String(rep.end_odometer) : "",
            yango_gross: rep.yango_gross ? String(rep.yango_gross) : "",
            yango_bonus: rep.yango_bonus ? String(rep.yango_bonus) : "",
            off_yango_revenue: rep.off_yango_revenue ? String(rep.off_yango_revenue) : "",
            solde_yango: rep.solde_yango ? String(rep.solde_yango) : "",
            yango_trip_count: rep.yango_trip_count ? String(rep.yango_trip_count) : "",
            off_yango_trip_count: rep.off_yango_trip_count ? String(rep.off_yango_trip_count) : "",
            service_supplementaire: rep.service_supplementaire ? String(rep.service_supplementaire) : "",
            comment: rep.comment || "",
          });
        }
      }
      if (veh) setVehicle(veh);
    })();
  }, [profile.id, today]);

  // Taux résolus : chauffeur → véhicule → tenant (tous en %)
  const rates = resolveRates(
    { yangoPct: (profile as any).comm_yango, partnerPct: (profile as any).comm_partner },
    { yangoPct: vehicle?.yango_rate != null ? vehicle.yango_rate * 100 : null,
      partnerPct: vehicle?.partner_rate != null ? vehicle.partner_rate * 100 : null },
    { yangoPct: cfg.comm_yango, partnerPct: cfg.comm_partner },
  );
  const calc = computeCommissions({
    brutYango: n(form.yango_gross), bonusYango: n(form.yango_bonus),
    horsYango: n(form.off_yango_revenue), rates,
    serviceSupplementaire: n(form.service_supplementaire),
  });
  const canEdit = !todayReport || todayReport.status === "rejected";

  const submit = async () => {
    if (!form.yango_gross && !form.off_yango_revenue) { alert("Renseignez au moins un montant (Yango ou Hors Yango)"); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const payload = {
        end_odometer: n(form.end_odometer),
        gross_earnings: calc.base + n(form.off_yango_revenue),
        yango_gross: n(form.yango_gross),
        yango_bonus: n(form.yango_bonus),
        off_yango_revenue: n(form.off_yango_revenue),
        solde_yango: form.solde_yango ? n(form.solde_yango) : null,
        yango_trip_count: form.yango_trip_count ? n(form.yango_trip_count) : null,
        off_yango_trip_count: form.off_yango_trip_count ? n(form.off_yango_trip_count) : null,
        commission_rate: rates.yangoPct / 100,
        commission_amount: calc.commYango + calc.commPartner,
        partner_rate: rates.partnerPct / 100,
        service_supplementaire: n(form.service_supplementaire),
        net_after_expenses: calc.netTotal,
        vehicle_id: vehicle?.id ?? null,
        expense_count: 0,
        status: "submitted",
        comment: form.comment || null,
      };
      // UPDATE si rapport rejeté existant, INSERT sinon
      let newReport: any, error: any;
      if (todayReport?.id) {
        ({ data: newReport, error } = await supabase.from("daily_reports")
          .update({ ...payload, rejection_reason: null })
          .eq("id", todayReport.id)
          .select("id").single());
      } else {
        ({ data: newReport, error } = await supabase.from("daily_reports")
          .insert({ driver_id: profile.id, tenant_id: profile.tenant_id, date: form.date, source: "saas", ...payload })
          .select("id").single());
      }
      if (error) throw error;
      if (newReport?.id) {
        setReportId(newReport.id);
        // Upload pending files via API (service role)
        for (const file of pendingFiles) {
          const ext = file.name.split(".").pop();
          const path = `${profile.id}/report_${newReport.id}_${Date.now()}.${ext}`;
          const fd = new FormData(); fd.append("file", file); fd.append("path", path);
          const up = await fetch("/api/kyc-upload", { method: "POST", body: fd });
          const upRes = await up.json().catch(() => ({}));
          // L'API force le préfixe tenantId : on stocke le chemin réel retourné
          await supabase.from("uploads").insert({ driver_id: profile.id, tenant_id: profile.tenant_id, file_name: file.name, file_path: upRes.path || path, file_type: "report", file_size: file.size, ref_id: newReport.id });
        }
        void supabase.from("action_logs").insert({
          tenant_id: profile.tenant_id, actor_id: profile.id, actor_role: "driver",
          entity_type: "daily_report", entity_id: newReport.id, action: "submitted",
          metadata: { date: form.date, net: calc.netTotal },
        });
      }
      setSubmitted(true);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  if (submitted) return (
    <div className="p-4">
      <div className="text-center pt-10 pb-6">
        <div className="flex justify-center mb-4"><CheckCircle2 size={48} strokeWidth={1.8} style={{ color: "#22c55e" }} /></div>
        <div className="text-lg font-semibold text-white mb-2">Rapport soumis !</div>
        <div className="text-sm mb-4" style={{ color: "var(--sk-t3)" }}>En attente de validation</div>
      </div>
      {reportId && (
        <div className="mb-6">
          <UploadBlock driverId={profile.id} refId={reportId} refType="report" label="Ajouter photos / documents" />
        </div>
      )}
      <button onClick={onBack} className="w-full py-3 rounded-xl text-sm font-bold text-black" style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>Retour accueil</button>
    </div>
  );

  return (
    <div className="p-4">
      <BackHeader title="Rapport journalier" onBack={onBack} />
      {todayReport && todayReport.status !== "rejected" && <StatusBanner type="ok">Rapport déjà soumis · {todayReport.status === "submitted" ? "En attente" : "Validé ✓"}</StatusBanner>}
      {todayReport?.status === "rejected" && (
        <div className="rounded-xl p-3 mb-2" style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)" }}>
          <div className="text-sm font-semibold" style={{ color: "#ef4444" }}>⚠ Rapport rejeté</div>
          {todayReport.rejection_reason && (
            <div className="text-xs mt-1" style={{ color: "#f87171" }}>Motif : {todayReport.rejection_reason}</div>
          )}
          <div className="text-xs mt-1" style={{ color: "#9ca3af" }}>Modifiez les champs si nécessaire puis resoumettre.</div>
        </div>
      )}
      <div className="space-y-4">
        <Field label="Date">
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} disabled={!canEdit} max={today}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "dark", opacity: !canEdit ? 0.5 : 1 }} />
        </Field>
        <Field label="Compteur km fin de journée" icon={Gauge}><InpText type="number" placeholder="ex: 48900" value={form.end_odometer} onChange={(v) => set("end_odometer", v)} disabled={!canEdit} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Brut Yango *"><InpText type="number" placeholder="0" value={form.yango_gross} onChange={(v) => set("yango_gross", v)} disabled={!canEdit} /></Field>
          <Field label="Bonus Yango"><InpText type="number" placeholder="0" value={form.yango_bonus} onChange={(v) => set("yango_bonus", v)} disabled={!canEdit} /></Field>
        </div>
        <Field label="Hors Yango (XOF)"><InpText type="number" placeholder="0" value={form.off_yango_revenue} onChange={(v) => set("off_yango_revenue", v)} disabled={!canEdit} /></Field>
        <Field label="Solde Yango (wallet fin de journée)" icon={Wallet}><InpText type="number" placeholder="ex: 15 000" value={form.solde_yango} onChange={(v) => set("solde_yango", v)} disabled={!canEdit} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Courses Yango"><InpText type="number" placeholder="0" value={form.yango_trip_count} onChange={(v) => set("yango_trip_count", v)} disabled={!canEdit} /></Field>
          <Field label="Courses hors"><InpText type="number" placeholder="0" value={form.off_yango_trip_count} onChange={(v) => set("off_yango_trip_count", v)} disabled={!canEdit} /></Field>
        </div>
        <Field label="➕ Service supplémentaire Yango (optionnel)"><InpText type="number" placeholder="0" value={form.service_supplementaire} onChange={(v) => set("service_supplementaire", v)} disabled={!canEdit} /></Field>

        {(n(form.yango_gross) > 0 || n(form.yango_bonus) > 0 || n(form.off_yango_revenue) > 0) && (
          <div className="rounded-2xl p-4" style={{ background: "rgba(245,166,35,.04)", border: "1px solid rgba(245,166,35,.15)" }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "#f5a623" }}>Aperçu calcul</div>
            {[["Base Yango", calc.base, false], [`Commission Yango (${rates.yangoPct}%)`, calc.commYango, true], [`Comm. partenaire (${rates.partnerPct.toFixed(2)}%)`, calc.commPartner, true], ...(calc.serviceSupp > 0 ? [["Service supplémentaire", calc.serviceSupp, true]] : []), ["Net Yango", calc.netYango, false], ["Hors Yango", n(form.off_yango_revenue), false], ...(n(form.solde_yango) > 0 ? [["Solde wallet", n(form.solde_yango), false]] : [])].map(([l, v, neg]) => (
              <div key={String(l)} className="flex justify-between text-xs py-1.5" style={{ borderBottom: "1px solid rgba(245,166,35,.07)" }}>
                <span style={{ color: "var(--sk-t3)" }}>{l}</span>
                <span className="font-mono font-semibold" style={{ color: neg ? "#ef4444" : "var(--sk-t2)" }}>{neg ? "- " : ""}{xof(Math.abs(Number(v)))}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-bold pt-2">
              <span className="text-white">NET TOTAL</span>
              <span className="font-mono" style={{ color: "#22c55e" }}>{xof(calc.netTotal)}</span>
            </div>
          </div>
        )}

        <Field label="Commentaire"><InpTextarea placeholder="Optionnel..." value={form.comment} onChange={(v) => set("comment", v)} disabled={!canEdit} /></Field>

        {canEdit && (
          <div style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", borderRadius: 16, padding: 16 }}>
            <div className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color: "var(--sk-t2)" }}><Paperclip size={13} strokeWidth={2} />Pièces jointes (optionnel)</div>
            {pendingFiles.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs" style={{ color: "var(--sk-t2)" }}>
                    <span>📄</span><span className="flex-1 truncate">{f.name}</span>
                    <button onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <label className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-center cursor-pointer"
                style={{ background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.25)", color: "#f5a623" }}>
                📷 Photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
              <label className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-center cursor-pointer"
                style={{ background: "transparent", border: "1px solid #2a2f3d", color: "var(--sk-t3)" }}>
                📁 Fichier
                <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,video/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
            </div>
          </div>
        )}

        {canEdit && (
          <BtnPrimary onClick={submit} disabled={saving}>
            {saving ? "Envoi en cours..." : pendingFiles.length > 0 ? `Soumettre + ${pendingFiles.length} fichier${pendingFiles.length > 1 ? "s" : ""} →` : "Soumettre le rapport →"}
          </BtnPrimary>
        )}
      </div>
    </div>
  );
}

// ─── UPLOAD BLOCK (reusable) ─────────────────────────
function UploadBlock({ driverId, refId, refType, label = "Photos / Reçus" }: { driverId: string; refId: string | null; refType: string; label?: string }) {
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<{ name: string; url: string; isImg: boolean }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load existing files from DB when refId is available
  useEffect(() => {
    if (!refId) return;
    setLoadingFiles(true);
    const supabase = createClient() as any;
    supabase.from("uploads").select("file_name,file_path,file_type,ref_id")
      .eq("driver_id", driverId)
      .eq("file_type", refType)
      .then(({ data }: any) => {
        if (data?.length) {
          const mapped = data
            // Match by ref_id (new) OR by path containing refId (legacy)
            .filter((f: any) => f.ref_id === refId || f.file_path?.includes(refId))
            .map((f: any) => {
              const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(f.file_path);
              const isImg = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(f.file_name);
              return { name: f.file_name, url: publicUrl, isImg };
            });
          setFiles(mapped);
        }
        setLoadingFiles(false);
      });
  }, [refId, driverId, refType]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const supabase = createClient() as any;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${refType}/${driverId}/${refId || "pending"}/${Date.now()}-${safeName}`;

      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", path);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");

      await supabase.from("uploads").insert({ driver_id: driverId, file_name: file.name, file_path: result.path || path, file_type: refType, file_size: file.size, ...(refId ? { ref_id: refId } : {}) });
      const isImg = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name);
      setFiles((p) => [...p, { name: file.name, url: result.signedUrl || result.publicUrl, isImg }]);
    } catch (err: any) { alert("Upload échoué : " + err.message); }
    finally { setUploading(false); }
  };

  const cameraRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}><Paperclip size={12} strokeWidth={2} />{label}</div>
      <div className="flex gap-2 mb-3">
        <button onClick={() => cameraRef.current?.click()} disabled={uploading}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: uploading ? "var(--sk-surface)" : "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.25)", color: uploading ? "#374151" : "#f5a623" }}>
          {uploading ? "⏳ Upload..." : "📷 Photo"}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium border-dashed border-2 transition-all"
          style={{ background: "transparent", borderColor: uploading ? "#f5a623" : "#2a2f3d", color: uploading ? "#f5a623" : "var(--sk-t3)" }}>
          {uploading ? "⏳" : "📁 Fichier / Galerie"}
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { Array.from(e.target.files || []).forEach(upload); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,video/*" multiple className="hidden"
        onChange={(e) => { Array.from(e.target.files || []).forEach(upload); e.target.value = ""; }} />
      {loadingFiles && <div className="text-xs text-center py-2" style={{ color: "var(--sk-t4)" }}>Chargement...</div>}
      {files.length > 0 && (
        <div className="space-y-2">
          {/* Image thumbnails grid */}
          {files.filter(f => f.isImg).length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {files.filter(f => f.isImg).map((f, i) => (
                <a key={i} href={f.url} target="_blank" rel="noopener noreferrer">
                  <img src={f.url} alt={f.name} className="w-full h-20 object-cover rounded-lg"
                    style={{ border: "1px solid var(--sk-surface)" }} />
                </a>
              ))}
            </div>
          )}
          {/* PDF / other files */}
          {files.filter(f => !f.isImg).map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs p-2 rounded-lg"
              style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
              <span>📄</span><span className="truncate flex-1">{f.name}</span><span style={{ color: "#f5a623" }}>Ouvrir →</span>
            </a>
          ))}
        </div>
      )}
      {!loadingFiles && files.length === 0 && refId && (
        <div className="text-xs text-center py-1" style={{ color: "var(--sk-t4)" }}>Aucune pièce jointe</div>
      )}
    </div>
  );
}

// ─── EXPENSE ─────────────────────────────────────────
function ExpenseTab({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ expense_date: today, type: "Carburant", amount: "", odometer: "", fuel_liters: "", comment: "" });
  const [submitted, setSubmitted] = useState(false);
  const [expenseId, setExpenseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const expenseTypes = ["Carburant", "Péage", "Contrôle routier", "Entretien", "Lavage", "Amende", "Solde Yango", "Autre"];

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const submit = async () => {
    if (!form.amount) { alert("Le montant est requis"); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { data, error } = await supabase.from("expenses").insert({
        driver_id: profile.id, tenant_id: profile.tenant_id, category: form.type, amount: parseFloat(form.amount),
        expense_date: form.expense_date, status: "submitted", source: "saas",
        description: [form.odometer ? `KM: ${form.odometer}` : null, form.fuel_liters ? `${form.fuel_liters}L` : null, form.comment || null].filter(Boolean).join(" · ") || null,
      }).select().single();
      if (error) throw error;
      const expId = data?.id || null;
      setExpenseId(expId);
      // Upload pending files via API (service role)
      if (expId && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const ext = file.name.split(".").pop();
          const path = `${profile.id}/expense_${expId}_${Date.now()}.${ext}`;
          const fd = new FormData(); fd.append("file", file); fd.append("path", path);
          const up = await fetch("/api/kyc-upload", { method: "POST", body: fd });
          const upRes = await up.json().catch(() => ({}));
          await supabase.from("uploads").insert({ driver_id: profile.id, tenant_id: profile.tenant_id, file_name: file.name, file_path: upRes.path || path, file_type: "expense", file_size: file.size, ref_id: expId });
        }
      }
      if (expId) {
        void supabase.from("action_logs").insert({
          tenant_id: profile.tenant_id, actor_id: profile.id, actor_role: "driver",
          entity_type: "expense", entity_id: expId, action: "submitted",
          metadata: { category: form.type, amount: parseFloat(form.amount) },
        });
      }
      setSubmitted(true);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  if (submitted) return (
    <div className="p-4">
      <div className="text-center pt-8 pb-6">
        <div className="flex justify-center mb-3"><CheckCircle2 size={48} strokeWidth={1.8} style={{ color: "#22c55e" }} /></div>
        <div className="text-lg font-semibold text-white mb-1">Dépense soumise</div>
        <div className="text-sm" style={{ color: "var(--sk-t3)" }}>Ajoutez des photos si besoin</div>
      </div>
      <div className="mb-6">
        <UploadBlock driverId={profile.id} refId={expenseId} refType="expense" />
      </div>
      <div className="flex gap-3">
        <button onClick={() => { setForm({ expense_date: today, type: "Carburant", amount: "", odometer: "", fuel_liters: "", comment: "" }); setSubmitted(false); setExpenseId(null); }}
          className="flex-1 py-2.5 text-sm rounded-xl" style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid #2a2f3d" }}>Nouvelle dépense</button>
        <button onClick={onBack} className="flex-1 py-2.5 text-sm rounded-xl font-bold text-black" style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>Accueil</button>
      </div>
    </div>
  );

  return (
    <div className="p-4">
      <BackHeader title="Nouvelle dépense" onBack={onBack} />
      <div className="space-y-4">
        <Field label="Date">
          <input type="date" value={form.expense_date} onChange={(e) => set("expense_date", e.target.value)} max={today}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "dark" }} />
        </Field>
        <Field label="Type">
          <select value={form.type} onChange={(e) => set("type", e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
            {expenseTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Montant (XOF) *"><InpText type="number" placeholder="ex: 8 000" value={form.amount} onChange={(v) => set("amount", v)} /></Field>
        {form.type === "Carburant" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kilométrage"><InpText type="number" placeholder="ex: 48500" value={form.odometer} onChange={(v) => set("odometer", v)} /></Field>
            <Field label="Litres"><InpText type="number" placeholder="ex: 12" value={form.fuel_liters} onChange={(v) => set("fuel_liters", v)} /></Field>
          </div>
        )}
        <Field label="Note"><InpTextarea placeholder="Optionnel..." value={form.comment} onChange={(v) => set("comment", v)} /></Field>

        {/* Justificatifs */}
        <div style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", borderRadius: 16, padding: 16 }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold mb-3" style={{ color: "var(--sk-t2)" }}><Paperclip size={13} strokeWidth={2} />Justificatif (reçu, photo…)</div>
          {pendingFiles.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {pendingFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs" style={{ color: "var(--sk-t2)" }}>
                  <span>📄</span><span className="flex-1 truncate">{f.name}</span>
                  <button onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <label className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-center cursor-pointer"
              style={{ background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.25)", color: "#f5a623" }}>
              📷 Photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </label>
            <label className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-center cursor-pointer"
              style={{ background: "transparent", border: "1px solid #2a2f3d", color: "var(--sk-t3)" }}>
              📁 Fichier
              <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,video/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </label>
          </div>
        </div>

        <BtnPrimary onClick={submit} disabled={saving}>
          {saving ? "Envoi en cours..." : pendingFiles.length > 0 ? `Soumettre + ${pendingFiles.length} fichier${pendingFiles.length > 1 ? "s" : ""} →` : "Soumettre →"}
        </BtnPrimary>
      </div>
    </div>
  );
}

// ─── HISTORY ─────────────────────────────────────────
function HistoryTab({ profile, onBack, cfg }: { profile: Profile; onBack: () => void; cfg: Cfg }) {
  const [subTab, setSubTab] = useState<"reports" | "expenses">("reports");
  const [reports, setReports] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const [{ data: r }, { data: e }] = await Promise.all([
        supabase.from("daily_reports").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).or("source.eq.saas,source.is.null").order("date", { ascending: false }).limit(30),
        supabase.from("expenses").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).or("source.eq.saas,source.is.null").order("expense_date", { ascending: false, nullsFirst: false }).limit(30),
      ]);
      setReports(r || []);
      setExpenses(e || []);
      setLoading(false);
    })();
  }, [profile.id]);

  const badge = (status: string) => {
    const map: Record<string, [string, string]> = { approved: ["#22c55e", "rgba(34,197,94,.1)"], rejected: ["#ef4444", "rgba(239,68,68,.1)"] };
    const [color, bg] = map[status] ?? ["#f5a623", "rgba(245,166,35,.1)"];
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{status === "approved" ? "Validé" : status === "rejected" ? "Rejeté" : "En attente"}</span>;
  };

  return (
    <div className="p-4">
      <BackHeader title="Historique" onBack={onBack} />
      <div className="flex gap-2 mb-4">
        {(["reports", "expenses"] as const).map((id) => (
          <button key={id} onClick={() => setSubTab(id)} className="flex-1 py-2 text-xs font-semibold rounded-xl transition-all"
            style={{ background: subTab === id ? "linear-gradient(135deg,#f5a623,#e8951a)" : "var(--sk-bg)", color: subTab === id ? "#000" : "var(--sk-t4)", border: subTab === id ? "none" : "1px solid var(--sk-surface)" }}>
            {id === "reports" ? "Rapports" : "Dépenses"}
          </button>
        ))}
      </div>
      {loading ? <div className="text-center py-12 text-sm" style={{ color: "var(--sk-t4)" }}>Chargement...</div> : subTab === "reports" ? (
        <div className="space-y-3">
          {reports.length === 0 && (
            <div className="flex flex-col items-center text-center py-14 gap-2" style={{ color: "var(--sk-t4)" }}>
              <ClipboardList size={30} strokeWidth={1.6} />
              <span className="text-sm">Aucun rapport pour l'instant</span>
              <span className="text-xs" style={{ color: "var(--sk-t4)" }}>Vos rapports soumis apparaîtront ici.</span>
            </div>
          )}
          {reports.map((r) => (
            <ReportHistoryCard key={r.id} report={r} profile={profile} onRefresh={() => {
              const supabase = createClient() as any;
              supabase.from("daily_reports").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).or("source.eq.saas,source.is.null").order("date", { ascending: false }).limit(30).then(({ data }: any) => { if (data) setReports(data); });
            }} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.length === 0 && (
            <div className="flex flex-col items-center text-center py-14 gap-2" style={{ color: "var(--sk-t4)" }}>
              <Wallet size={30} strokeWidth={1.6} />
              <span className="text-sm">Aucune dépense pour l'instant</span>
              <span className="text-xs" style={{ color: "var(--sk-t4)" }}>Vos dépenses ajoutées apparaîtront ici.</span>
            </div>
          )}
          {expenses.map((e) => (
            <ExpenseCard key={e.id} expense={e} driverId={profile.id} profile={profile} onRefresh={() => {
              const supabase = createClient() as any;
              supabase.from("expenses").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).order("expense_date", { ascending: false, nullsFirst: false }).limit(30).then(({ data }: any) => { if (data) setExpenses(data); });
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── REPORT HISTORY CARD (with full edit on rejected) ─────────
function ReportHistoryCard({ report, profile, onRefresh }: { report: any; profile: Profile; onRefresh: () => void }) {
  const [open, setOpen] = useState(report.status === "rejected");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const s = (v: any) => (v != null && v !== 0 ? String(v) : "");
  const [editForm, setEditForm] = useState({
    end_odometer: s(report.end_odometer),
    yango_gross: s(report.yango_gross),
    yango_bonus: s(report.yango_bonus),
    off_yango_revenue: s(report.off_yango_revenue),
    solde_yango: s(report.solde_yango),
    yango_trip_count: s(report.yango_trip_count),
    off_yango_trip_count: s(report.off_yango_trip_count),
    comment: report.comment || "",
  });
  const set = (k: string, v: string) => setEditForm((f) => ({ ...f, [k]: v }));
  const n = (v: string) => parseFloat(v) || 0;

  const saveAndResubmit = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("daily_reports").update({
        end_odometer: n(editForm.end_odometer),
        yango_gross: n(editForm.yango_gross),
        yango_bonus: n(editForm.yango_bonus),
        off_yango_revenue: n(editForm.off_yango_revenue),
        solde_yango: n(editForm.solde_yango) || null,
        yango_trip_count: n(editForm.yango_trip_count) || null,
        off_yango_trip_count: n(editForm.off_yango_trip_count) || null,
        comment: editForm.comment || null,
        gross_earnings: n(editForm.yango_gross) + n(editForm.off_yango_revenue),
        status: "submitted",
        rejection_reason: null,
      }).eq("id", report.id);
      if (error) throw error;
      void supabase.from("action_logs").insert({
        tenant_id: profile.tenant_id, actor_id: profile.id, actor_role: "driver",
        entity_type: "daily_report", entity_id: report.id, action: "submitted",
        metadata: { date: report.date, resubmission: true },
      });
      setEditing(false);
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const archive = async () => {
    if (!confirm("Archiver ce rapport rejeté ?")) return;
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("daily_reports").update({ status: "archived" }).eq("id", report.id);
      if (error) throw error;
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const badge = (status: string) => {
    const map: Record<string, [string, string]> = { approved: ["#22c55e", "rgba(34,197,94,.1)"], rejected: ["#ef4444", "rgba(239,68,68,.1)"] };
    const [color, bg] = map[status] ?? ["#f5a623", "rgba(245,166,35,.1)"];
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{status === "approved" ? "Validé" : status === "rejected" ? "Rejeté" : "En attente"}</span>;
  };

  const inputStyle = { background: "var(--sk-bg)", border: "1px solid #2a2f3d", color: "var(--sk-t1)", borderRadius: 10, padding: "8px 12px", width: "100%", fontSize: 13, outline: "none" };

  return (
    <div className="rounded-2xl" style={{ background: "var(--sk-bg)", border: `1px solid ${report.status === "rejected" ? "rgba(239,68,68,.3)" : "var(--sk-surface)"}` }}>
      <div className="flex items-start justify-between p-4 cursor-pointer" onClick={() => { setOpen(!open); setEditing(false); }}>
        <div>
          <div className="font-semibold text-sm text-white">{report.date}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--sk-t4)" }}>
            {[report.yango_trip_count ? `${report.yango_trip_count} courses` : null, report.end_odometer ? `${report.end_odometer} km` : null].filter(Boolean).join(" · ") || "—"}
          </div>
          {report.solde_yango > 0 && <div className="flex items-center gap-1 text-xs mt-1" style={{ color: "#f5a623" }}><Wallet size={11} strokeWidth={2} />{xof(report.solde_yango)}</div>}
        </div>
        <div className="text-right">
          <div className="font-mono font-bold text-sm text-white">{xof(report.net_after_expenses ?? 0)}</div>
          <div className="mt-1">{badge(report.status)}</div>
          <span className="text-[10px]" style={{ color: "var(--sk-t4)" }}>{open ? "▲" : "▼ détails"}</span>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--sk-surface)" }}>

          {/* Motif de rejet */}
          {report.status === "rejected" && (
            <div className="pt-3 rounded-xl p-3" style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.2)" }}>
              <div className="text-xs font-semibold" style={{ color: "#ef4444" }}>⚠ Rapport rejeté</div>
              {report.rejection_reason && <div className="text-xs mt-1" style={{ color: "#f87171" }}>Motif : {report.rejection_reason}</div>}
            </div>
          )}

          {/* Mode lecture */}
          {!editing && (
            <div className="pt-2 space-y-1 text-xs" style={{ color: "var(--sk-t3)" }}>
              {[
                ["Km fin de journée", report.end_odometer ? `${report.end_odometer} km` : null],
                ["Brut Yango", report.yango_gross ? xof(report.yango_gross) : null],
                ["Bonus Yango", report.yango_bonus ? xof(report.yango_bonus) : null],
                ["Hors Yango", report.off_yango_revenue ? xof(report.off_yango_revenue) : null],
                ["Solde wallet", report.solde_yango ? xof(report.solde_yango) : null],
                ["Courses Yango", report.yango_trip_count],
                ["Courses hors", report.off_yango_trip_count],
                ["Net total", report.net_after_expenses ? xof(report.net_after_expenses) : null],
              ].map(([l, v]) => v != null ? (
                <div key={String(l)} className="flex justify-between">
                  <span>{l}</span>
                  <span className="font-mono" style={{ color: "var(--sk-t1)" }}>{String(v)}</span>
                </div>
              ) : null)}
              {report.comment && <div className="mt-1 italic" style={{ color: "var(--sk-t4)" }}>"{report.comment}"</div>}
            </div>
          )}

          {/* Mode édition (rapport rejeté uniquement) */}
          {editing && report.status === "rejected" && (
            <div className="pt-2 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Km fin journée", "end_odometer"],
                  ["Brut Yango", "yango_gross"],
                  ["Bonus Yango", "yango_bonus"],
                  ["Hors Yango", "off_yango_revenue"],
                  ["Solde wallet", "solde_yango"],
                  ["Courses Yango", "yango_trip_count"],
                  ["Courses hors", "off_yango_trip_count"],
                ].map(([label, key]) => (
                  <div key={key}>
                    <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>{label}</div>
                    <input type="number" value={editForm[key as keyof typeof editForm]}
                      onChange={(e) => set(key, e.target.value)}
                      style={inputStyle} />
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>Commentaire</div>
                <textarea value={editForm.comment} onChange={(e) => set("comment", e.target.value)} rows={2}
                  style={{ ...inputStyle, resize: "none" }} />
              </div>
            </div>
          )}

          <UploadBlock driverId={profile.id} refId={report.id} refType="report" label="Pièces jointes" />

          {/* Actions */}
          {report.status === "rejected" && !editing && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(true)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "var(--sk-surface)", color: "#f5a623", border: "1px solid rgba(245,166,35,.3)" }}>
                ✏️ Modifier
              </button>
              <button onClick={saveAndResubmit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)", color: "#000" }}>
                {saving ? "..." : "🔁 Resoumettre"}
              </button>
              <button onClick={archive} disabled={saving}
                className="py-2.5 px-3 rounded-xl text-sm"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t3)", border: "1px solid #2a2f3d" }}>
                Archiver
              </button>
            </div>
          )}
          {report.status === "rejected" && editing && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(false)}
                className="py-2.5 px-4 rounded-xl text-sm"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid #2a2f3d" }}>
                Annuler
              </button>
              <button onClick={saveAndResubmit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)", color: "#000" }}>
                {saving ? "..." : "💾 Sauvegarder & resoumettre"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EXPENSE CARD (history with upload + status) ─────
function ExpenseCard({ expense, driverId, profile, onRefresh }: { expense: any; driverId: string; profile: any; onRefresh: () => void }) {
  const [open, setOpen] = useState(expense.status === "rejected");
  const [saving, setSaving] = useState(false);

  const statusBadge = (status: string) => {
    const map: Record<string, [string, string]> = {
      approved: ["#22c55e", "rgba(34,197,94,.1)"],
      rejected: ["#ef4444", "rgba(239,68,68,.1)"],
    };
    const [color, bg] = map[status] ?? ["#f5a623", "rgba(245,166,35,.1)"];
    const label = status === "approved" ? "Validée" : status === "rejected" ? "Rejetée" : "En attente";
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{label}</span>;
  };

  const resubmit = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({ status: "submitted" }).eq("id", expense.id);
      if (error) throw error;
      void supabase.from("action_logs").insert({
        tenant_id: profile.tenant_id, actor_id: profile.id, actor_role: "driver",
        entity_type: "expense", entity_id: expense.id, action: "submitted",
        metadata: { category: expense.category, amount: expense.amount, resubmission: true },
      });
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const archive = async () => {
    if (!confirm("Archiver cette dépense rejetée ?")) return;
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({ status: "archived" }).eq("id", expense.id);
      if (error) throw error;
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-2xl" style={{
      background: "var(--sk-bg)",
      border: `1px solid ${expense.status === "rejected" ? "rgba(239,68,68,.3)" : expense.status === "approved" ? "rgba(34,197,94,.15)" : "var(--sk-surface)"}`,
    }}>
      <div className="flex items-start justify-between p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-sm text-white">{expense.category}</div>
            {statusBadge(expense.status || "submitted")}
          </div>
          <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: "var(--sk-t4)" }}>
            <Calendar size={11} strokeWidth={2} />{expense.expense_date || expense.created_at?.slice(0, 10)}
          </div>
          {expense.description && <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>{expense.description}</div>}
          {expense.status === "rejected" && (
            <div className="text-xs mt-1 font-semibold" style={{ color: "#ef4444" }}>
              ⚠ Rejetée — action requise
            </div>
          )}
        </div>
        <div className="text-right ml-3 flex-shrink-0">
          <div className="font-mono font-bold text-sm" style={{ color: "#ef4444" }}>-{xof(expense.amount || 0)}</div>
          <button onClick={() => setOpen(!open)} className="text-[10px] mt-1 px-2 py-0.5 rounded-full transition-all"
            style={{ background: open ? "rgba(245,166,35,.15)" : "var(--sk-surface)", color: open ? "#f5a623" : "var(--sk-t3)" }}>
            {open ? "Fermer ▲" : "Détails ▾"}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 border-t space-y-3" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="pt-3">
            <UploadBlock driverId={driverId} refId={expense.id} refType="expense" label="Ajouter / voir photos" />
          </div>
          {expense.status === "rejected" && (
            <div className="flex gap-2">
              <button onClick={resubmit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)", color: "#000" }}>
                {saving ? "..." : "🔁 Resoumettre"}
              </button>
              <button onClick={archive} disabled={saving}
                className="py-2.5 px-4 rounded-xl text-sm"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t3)", border: "1px solid #2a2f3d" }}>
                Archiver
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PROFIL / KYC ────────────────────────────────────
const KYC_DOCS = [
  { type: "cni_recto",    label: "CNI — Recto",     required: true },
  { type: "cni_verso",    label: "CNI — Verso",     required: true },
  { type: "permis_recto", label: "Permis — Recto",  required: true },
  { type: "permis_verso", label: "Permis — Verso",  required: true },
  { type: "contrat",      label: "Contrat signé",   required: true },
  { type: "photo_profil", label: "Photo de profil", required: false },
];

const LEVEL_LABELS: Record<string, { label: string; color: string }> = {
  debutant:      { label: "Débutant",      color: "#f5a623" },
  intermediaire: { label: "Intermédiaire", color: "#3b82f6" },
  confirme:      { label: "Confirmé",      color: "#22c55e" },
};

const ONBOARDING_LABELS: Record<string, { label: string; color: string }> = {
  incomplete: { label: "Dossier incomplet",            color: "var(--sk-t3)" },
  pending:    { label: "En attente de soumission",     color: "#f5a623" },
  in_review:  { label: "En cours de vérification",    color: "#3b82f6" },
  approved:   { label: "✓ Dossier validé",             color: "#22c55e" },
  rejected:   { label: "✗ Dossier rejeté",             color: "#ef4444" },
};

function ProfilTab({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const [fullProfile, setFullProfile] = useState<any>(null);
  const [infoForm, setInfoForm] = useState({ address: "", city: "", birth_date: "", nationality: "", license_number: "", license_expiry: "", emergency_name: "", emergency_phone: "", emergency_relation: "", years_experience: "0" });
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);

  const [vehicle, setVehicle] = useState<any>(null);
  const [vehicleForm, setVehicleForm] = useState({ plate: "", make: "", model: "", year: "", partner_rate: "0.75" });
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [vehicleSaved, setVehicleSaved] = useState(false);

  const [kycDocs, setKycDocs] = useState<Record<string, any>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadData = async () => {
    const supabase = createClient() as any;
    const [{ data: p }, { data: v }, { data: docs }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", profile.id).single(),
      supabase.from("vehicles").select("*").eq("driver_id", profile.id).maybeSingle(),
      supabase.from("kyc_documents").select("*").eq("driver_id", profile.id),
    ]);
    if (p) {
      setFullProfile(p);
      setInfoForm({ address: p.address || "", city: p.city || "", birth_date: p.birth_date || "", nationality: p.nationality || "", license_number: p.license_number || "", license_expiry: p.license_expiry || "", emergency_name: p.emergency_name || "", emergency_phone: p.emergency_phone || "", emergency_relation: p.emergency_relation || "", years_experience: String(p.years_experience ?? 0) });
    }
    if (v) { setVehicle(v); setVehicleForm({ plate: v.plate || "", make: v.make || "", model: v.model || "", year: v.year ? String(v.year) : "", partner_rate: v.partner_rate != null ? String(v.partner_rate * 100) : "0.75" }); }
    const docMap: Record<string, any> = {};
    (docs || []).forEach((d: any) => { docMap[d.doc_type] = d; });
    setKycDocs(docMap);
  };

  useEffect(() => { loadData(); }, [profile.id]);

  const setInfo = (k: string, v: string) => setInfoForm((f) => ({ ...f, [k]: v }));

  const saveInfo = async () => {
    setSavingInfo(true);
    const supabase = createClient() as any;
    await supabase.from("profiles").update({ address: infoForm.address, city: infoForm.city, birth_date: infoForm.birth_date || null, nationality: infoForm.nationality, license_number: infoForm.license_number, license_expiry: infoForm.license_expiry || null, emergency_name: infoForm.emergency_name, emergency_phone: infoForm.emergency_phone, emergency_relation: infoForm.emergency_relation, years_experience: parseInt(infoForm.years_experience) || 0 }).eq("id", profile.id);
    setSavingInfo(false);
    setInfoSaved(true);
    setTimeout(() => setInfoSaved(false), 2000);
    await loadData();
  };

  const saveVehicle = async () => {
    if (!vehicleForm.plate) { alert("Plaque d'immatriculation requise"); return; }
    setSavingVehicle(true);
    const supabase = createClient() as any;
    const payload = { driver_id: profile.id, tenant_id: profile.tenant_id, plate: vehicleForm.plate, make: vehicleForm.make, model: vehicleForm.model, year: vehicleForm.year ? parseInt(vehicleForm.year) : null, partner_rate: parseFloat(vehicleForm.partner_rate || "0.75") / 100 };
    if (vehicle) await supabase.from("vehicles").update(payload).eq("id", vehicle.id);
    else { const { data } = await supabase.from("vehicles").insert(payload).select().single(); setVehicle(data); }
    setSavingVehicle(false);
    setVehicleSaved(true);
    setTimeout(() => setVehicleSaved(false), 2000);
  };

  const uploadDoc = async (file: File, docType: string) => {
    setUploading(docType);
    try {
      const supabase = createClient() as any;
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${profile.tenant_id}/${profile.id}/${docType}.${ext}`;

      // Upload via server route (service role — no storage RLS needed)
      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", path);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");

      const existing = kycDocs[docType];
      if (existing) {
        await supabase.from("kyc_documents").update({ file_path: path, file_name: file.name, file_size: file.size, status: "pending", uploaded_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("kyc_documents").insert({ driver_id: profile.id, tenant_id: profile.tenant_id, doc_type: docType, file_path: path, file_name: file.name, file_size: file.size, status: "pending" });
      }
      await loadData();
    } catch (err: any) { alert("Erreur upload : " + err.message); }
    finally { setUploading(null); }
  };

  const submitDossier = async () => {
    setSubmitting(true);
    const supabase = createClient() as any;
    await supabase.from("profiles").update({ onboarding_status: "in_review", onboarding_submitted: new Date().toISOString() }).eq("id", profile.id);
    await loadData();
    setSubmitting(false);
  };

  const requiredDocs = KYC_DOCS.filter((d) => d.required);
  const completedRequired = requiredDocs.filter((d) => kycDocs[d.type]).length;
  const allRequiredDone = completedRequired === requiredDocs.length;
  const status = fullProfile?.onboarding_status || "incomplete";
  const level = fullProfile?.driver_level || "debutant";
  const statusInfo = ONBOARDING_LABELS[status] ?? ONBOARDING_LABELS.incomplete;
  const levelInfo = LEVEL_LABELS[level] ?? LEVEL_LABELS.debutant;
  const canSubmit = allRequiredDone && (status === "incomplete" || status === "pending" || status === "rejected");

  return (
    <div className="p-4 space-y-4">
      <BackHeader title="Mon profil & KYC" onBack={onBack} />

      {/* Status banner */}
      <div className="rounded-2xl px-4 py-3 flex items-center justify-between" style={{ background: "var(--sk-bg)", border: `1px solid ${statusInfo.color}30` }}>
        <div>
          <div className="text-xs font-semibold" style={{ color: statusInfo.color }}>{statusInfo.label}</div>
          {fullProfile?.onboarding_notes && status === "rejected" && (
            <div className="text-xs mt-1" style={{ color: "#ef4444" }}>Note : {fullProfile.onboarding_notes}</div>
          )}
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: `${levelInfo.color}18`, color: levelInfo.color }}>
          {levelInfo.label}
        </span>
      </div>

      {/* Infos personnelles */}
      <div className="rounded-2xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="text-xs uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--sk-t4)" }}>👤 Informations personnelles</div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de naissance"><InpText type="date" value={infoForm.birth_date} onChange={(v) => setInfo("birth_date", v)} /></Field>
            <Field label="Nationalité"><InpText type="text" placeholder="Sénégalaise" value={infoForm.nationality} onChange={(v) => setInfo("nationality", v)} /></Field>
          </div>
          <Field label="Adresse"><InpText type="text" placeholder="Rue, quartier" value={infoForm.address} onChange={(v) => setInfo("address", v)} /></Field>
          <Field label="Ville"><InpText type="text" placeholder="Dakar" value={infoForm.city} onChange={(v) => setInfo("city", v)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="N° Permis"><InpText type="text" placeholder="DK-XXXXX" value={infoForm.license_number} onChange={(v) => setInfo("license_number", v)} /></Field>
            <Field label="Expiration permis"><InpText type="date" value={infoForm.license_expiry} onChange={(v) => setInfo("license_expiry", v)} /></Field>
          </div>
          <Field label="Années d'expérience"><InpText type="number" placeholder="0" value={infoForm.years_experience} onChange={(v) => setInfo("years_experience", v)} /></Field>
        </div>
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>🆘 Contact d'urgence</div>
          <div className="space-y-3">
            <Field label="Nom"><InpText type="text" placeholder="Prénom Nom" value={infoForm.emergency_name} onChange={(v) => setInfo("emergency_name", v)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Téléphone"><InpText type="tel" placeholder="+221 77 XXX XX XX" value={infoForm.emergency_phone} onChange={(v) => setInfo("emergency_phone", v)} /></Field>
              <Field label="Relation"><InpText type="text" placeholder="Conjoint, parent..." value={infoForm.emergency_relation} onChange={(v) => setInfo("emergency_relation", v)} /></Field>
            </div>
          </div>
        </div>
        <button onClick={saveInfo} disabled={savingInfo} className="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: infoSaved ? "rgba(34,197,94,.1)" : "rgba(245,166,35,.1)", color: infoSaved ? "#22c55e" : "#f5a623", border: `1px solid ${infoSaved ? "rgba(34,197,94,.2)" : "rgba(245,166,35,.2)"}` }}>
          {infoSaved ? "✓ Enregistré" : savingInfo ? "..." : "Enregistrer les infos"}
        </button>
      </div>

      {/* Documents KYC */}
      <div className="rounded-2xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs uppercase tracking-widest font-semibold" style={{ color: "var(--sk-t4)" }}>📄 Documents requis</div>
          <div className="text-xs font-semibold" style={{ color: completedRequired === requiredDocs.length ? "#22c55e" : "#f5a623" }}>
            {completedRequired}/{requiredDocs.length} complétés
          </div>
        </div>
        <div className="text-[10px] mb-4" style={{ color: "var(--sk-t4)" }}>Photo ou PDF · Max 10 Mo par fichier</div>
        <div className="space-y-2">
          {KYC_DOCS.map((doc) => {
            const uploaded = kycDocs[doc.type];
            const isUploading = uploading === doc.type;
            const docStatus = uploaded?.status || null;
            const statusColor = docStatus === "approved" ? "#22c55e" : docStatus === "rejected" ? "#ef4444" : uploaded ? "#f5a623" : "#2a2f3d";
            return (
              <div key={doc.type} className="rounded-xl px-3 py-2.5 flex items-center justify-between gap-2"
                style={{ background: "var(--sk-deep)", border: `1px solid ${statusColor}40` }}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {doc.label} {doc.required && <span style={{ color: "#ef4444" }}>*</span>}
                    </div>
                    {uploaded && <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>{uploaded.file_name} · {docStatus === "approved" ? "✓ Validé" : docStatus === "rejected" ? "✗ Rejeté" : "En attente"}</div>}
                  </div>
                </div>
                <button onClick={() => fileRefs.current[doc.type]?.click()} disabled={isUploading}
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
                  style={{ background: "rgba(245,166,35,.1)", color: isUploading ? "var(--sk-t3)" : "#f5a623", border: "1px solid rgba(245,166,35,.15)" }}>
                  {isUploading ? "..." : uploaded ? "Remplacer" : "Uploader"}
                </button>
                <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,video/*" className="hidden"
                  ref={(el) => { fileRefs.current[doc.type] = el; }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f, doc.type); }} />
              </div>
            );
          })}
        </div>
        {canSubmit && (
          <button onClick={submitDossier} disabled={submitting}
            className="w-full mt-4 py-3 rounded-xl font-bold transition-all"
            style={{ background: submitting ? "#2a2f3d" : "linear-gradient(135deg,#f5a623,#e8951a)", color: submitting ? "var(--sk-t3)" : "#000" }}>
            {submitting ? "Envoi en cours..." : "📤 Soumettre mon dossier pour vérification"}
          </button>
        )}
        {status === "in_review" && <div className="mt-4 text-center text-xs" style={{ color: "#3b82f6" }}>🔍 Dossier en cours de vérification par l'équipe</div>}
        {status === "approved" && <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold" style={{ color: "#22c55e" }}><CheckCircle2 size={14} strokeWidth={2} />Dossier validé — Bienvenue !</div>}
      </div>

      {/* Véhicule */}
      <div className="rounded-2xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--sk-t4)" }}><Car size={13} strokeWidth={2} />Véhicule assigné</div>
        <div className="space-y-3">
          <Field label="Plaque *"><InpText type="text" placeholder="ex: DK-1234-AA" value={vehicleForm.plate} onChange={(v) => setVehicleForm((f) => ({ ...f, plate: v }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marque"><InpText type="text" placeholder="Toyota" value={vehicleForm.make} onChange={(v) => setVehicleForm((f) => ({ ...f, make: v }))} /></Field>
            <Field label="Modèle"><InpText type="text" placeholder="Corolla" value={vehicleForm.model} onChange={(v) => setVehicleForm((f) => ({ ...f, model: v }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Année"><InpText type="number" placeholder="2020" value={vehicleForm.year} onChange={(v) => setVehicleForm((f) => ({ ...f, year: v }))} /></Field>
            <Field label="Comm. partenaire (%)"><InpText type="number" placeholder="0.75" value={vehicleForm.partner_rate} onChange={(v) => setVehicleForm((f) => ({ ...f, partner_rate: v }))} /></Field>
          </div>
          <button onClick={saveVehicle} disabled={savingVehicle} className="w-full py-3 rounded-xl text-sm font-bold transition-all"
            style={{ background: vehicleSaved ? "rgba(34,197,94,.1)" : "linear-gradient(135deg,#f5a623,#e8951a)", color: vehicleSaved ? "#22c55e" : "#000", border: vehicleSaved ? "1px solid rgba(34,197,94,.3)" : "none" }}>
            {vehicleSaved ? "✓ Enregistré" : savingVehicle ? "..." : vehicle ? "Mettre à jour" : "Enregistrer le véhicule"}
          </button>
        </div>
      </div>

      <DriverAvancesSection driverId={profile.id} />
    </div>
  );
}

// ─── AVANCES SECTION (driver view) ───────────────────
function DriverAvancesSection({ driverId }: { driverId: string }) {
  const [advances, setAdvances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("payments")
        .select("id,amount,payment_date,notes,is_deducted,deducted_at")
        .eq("driver_id", driverId)
        .eq("type", "acompte")
        .order("payment_date", { ascending: false })
        .limit(20);
      setAdvances(data || []);
      setLoading(false);
    })();
  }, [driverId]);

  const pending = advances.filter((a) => !a.is_deducted).reduce((s, a) => s + (a.amount || 0), 0);

  if (!loading && advances.length === 0) return null;

  return (
    <div className="rounded-2xl p-5 mt-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5 font-semibold text-white text-sm"><HandCoins size={15} strokeWidth={2} style={{ color: "#f5a623" }} />Avances sur salaire</div>
        {pending > 0 && (
          <div className="text-xs font-mono font-bold px-3 py-1 rounded-full"
            style={{ background: "rgba(245,166,35,.1)", color: "#f5a623" }}>
            {xof(pending)} XOF à déduire
          </div>
        )}
      </div>
      {loading ? (
        <div className="text-xs text-center py-4" style={{ color: "var(--sk-t4)" }}>Chargement...</div>
      ) : (
        <div className="space-y-2">
          {advances.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl px-3 py-2.5"
              style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
              <div>
                <div className="text-xs font-semibold text-white">{a.payment_date}</div>
                {a.notes && <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t3)" }}>{a.notes}</div>}
              </div>
              <div className="flex items-center gap-2">
                <div className="font-mono text-sm font-bold" style={{ color: a.is_deducted ? "var(--sk-t4)" : "#f5a623" }}>
                  {xof(a.amount)} XOF
                </div>
                {a.is_deducted
                  ? <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "#22c55e", background: "rgba(34,197,94,.1)" }}>✓ Déduit</span>
                  : <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "#f5a623", background: "rgba(245,166,35,.1)" }}>En attente</span>
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── REPOS TAB ───────────────────────────────────────
function ReposTab({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [motif, setMotif] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [existing, setExisting] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      // Show past month + 2 months ahead for planning
      const from = new Date(); from.setMonth(from.getMonth() - 1);
      const to = new Date(); to.setMonth(to.getMonth() + 2);
      const { data } = await supabase.from("daily_reports")
        .select("date,status,comment")
        .eq("driver_id", profile.id)
        .eq("tenant_id", profile.tenant_id)
        .gte("date", from.toISOString().slice(0, 10))
        .lte("date", to.toISOString().slice(0, 10))
        .like("comment", "[REPOS]%")
        .order("date", { ascending: true });
      setExisting(data || []);
    })();
  }, [profile.id, today, submitted]);

  const submit = async () => {
    if (!date) return;
    setSaving(true);
    try {
      const supabase = createClient() as any;
      // Check if already declared for this date
      const { data: exists } = await supabase.from("daily_reports")
        .select("id").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("date", date).maybeSingle();
      if (exists) { alert("Un rapport existe déjà pour cette date."); setSaving(false); return; }
      const { error } = await supabase.from("daily_reports").insert({
        driver_id: profile.id,
        tenant_id: profile.tenant_id,
        date,
        source: "saas",
        status: "submitted",
        comment: `[REPOS]${motif ? " " + motif.trim() : ""}`,
        gross_earnings: 0,
        yango_gross: 0,
        yango_bonus: 0,
        off_yango_revenue: 0,
        net_after_expenses: 0,
        commission_rate: 0,
        commission_amount: 0,
        expense_count: 0,
      });
      if (error) throw error;
      setSubmitted(true);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  if (submitted) return (
    <div className="p-6 pt-16 text-center">
      <div className="flex justify-center mb-4"><CheckCircle2 size={48} strokeWidth={1.8} style={{ color: "#22c55e" }} /></div>
      <div className="text-lg font-semibold text-white mb-2">Jour de repos déclaré</div>
      <div className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>En attente de validation admin</div>
      <button onClick={onBack} className="px-6 py-2.5 rounded-xl text-sm font-bold text-black" style={{ background: "linear-gradient(135deg,#f5a623,#e8951a)" }}>
        Retour accueil
      </button>
    </div>
  );

  const statusColor = (s: string) => s === "approved" ? "#22c55e" : s === "rejected" ? "#ef4444" : "#f5a623";
  const statusLabel = (s: string) => s === "approved" ? "✓ Validé" : s === "rejected" ? "✗ Refusé" : "⏳ En attente";

  return (
    <div className="p-4">
      <BackHeader title="Déclarer un jour de repos" icon={BedDouble} onBack={onBack} />
      <div className="space-y-4">
        <div className="rounded-2xl p-4" style={{ background: "rgba(245,166,35,.04)", border: "1px solid rgba(245,166,35,.15)" }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#f5a623" }}>Information</div>
          <div className="text-xs" style={{ color: "var(--sk-t2)" }}>
            La déclaration de repos permet à l'admin de tracer les jours non travaillés. Elle sera soumise à validation et n'impacte pas vos revenus.
          </div>
        </div>

        <Field label="Date du repos (passé ou futur)">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "dark" }} />
        </Field>

        <Field label="Motif (optionnel)">
          <InpTextarea
            placeholder="Ex: Congé personnel, maladie, entretien véhicule..."
            value={motif}
            onChange={setMotif}
            disabled={false}
          />
        </Field>

        <BtnPrimary onClick={submit} disabled={saving || !date}>
          {saving ? "Envoi..." : "Soumettre le jour de repos →"}
        </BtnPrimary>

        {/* Historique repos du mois */}
        {existing.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--sk-surface)" }}>
            <div className="px-4 py-3 text-xs font-bold uppercase tracking-wider" style={{ background: "var(--sk-bg)", color: "var(--sk-t3)" }}>
              Repos déclarés / planifiés (mois précédent → +2 mois)
            </div>
            {existing.map((r) => (
              <div key={r.date} className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--sk-bg)", background: "var(--sk-deep)" }}>
                <div>
                  <div className="text-sm text-white font-mono">{r.date}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--sk-t3)" }}>
                    {r.comment?.replace("[REPOS]", "").trim() || "Pas de motif"}
                  </div>
                </div>
                <div className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: statusColor(r.status) + "20", color: statusColor(r.status) }}>
                  {statusLabel(r.status)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DRIVER PILOTAGE TAB ─────────────────────────────
function DriverPilotageTab({ profile, onBack, cfg }: { profile: Profile; onBack: () => void; cfg: Cfg }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Derive RULES and TARGET from cfg — no hardcoding
  const RULES = cfg.salary_tiers.length > 0 ? cfg.salary_tiers : DEFAULT_CFG.salary_tiers;
  const TARGET = cfg.target_net > 0 ? cfg.target_net : (RULES[RULES.length - 1]?.min_net ?? 1300000);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const curMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      const start = `${curMonth}-01`;
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const daysElapsed = today.getDate();
      const daysRemaining = daysInMonth - daysElapsed;

      // Fetch MTD reports with all fields needed for accurate projections
      const [{ data: reps }, { data: fuelExps }] = await Promise.all([
        supabase.from("daily_reports")
          .select("date,net_after_expenses,yango_gross,yango_bonus,off_yango_revenue,solde_yango,end_odometer,commission_amount,service_supplementaire")
          .eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).or("source.eq.saas,source.is.null")
          .gte("date", start).lte("date", todayStr).neq("status", "rejected")
          .order("date", { ascending: true }),
        supabase.from("expenses")
          .select("amount,fuel_liters,description,expense_date")
          .eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
          .eq("category", "Carburant").eq("status", "approved")
          .gte("expense_date", start),
      ]);

      const sortedReps = (reps || []).filter((r: any) => r.end_odometer > 0 || r.solde_yango != null);
      const mtdDays = new Set((reps || []).map((r: any) => r.date)).size || 1;

      // ── Revenue per working day (unaffected by lump expenses) ──
      const grossPerDay = (reps || []).map((r: any) =>
        (r.yango_gross || 0) + (r.yango_bonus || 0) + (r.off_yango_revenue || 0)
      );
      const avgDailyGross = grossPerDay.length > 0
        ? grossPerDay.reduce((s: number, v: number) => s + v, 0) / grossPerDay.length
        : 0;

      // ── Km/day from odometer deltas ──
      const kmDeltas: number[] = [];
      for (let i = 1; i < sortedReps.length; i++) {
        const prev = sortedReps[i - 1].end_odometer;
        const curr = sortedReps[i].end_odometer;
        if (prev > 0 && curr > 0 && curr > prev) {
          const delta = curr - prev;
          if (delta > 0 && delta < 800) kmDeltas.push(delta); // sanity: <800km/day
        }
      }
      const avgKmPerDay = kmDeltas.length > 0
        ? kmDeltas.reduce((s, v) => s + v, 0) / kmDeltas.length
        : null;

      // ── Solde consommé (« burnt ») par jour = commissions réellement déclarées :
      // commission Yango + partenaire (= commission_amount) + frais supplémentaires.
      // Aligné sur le « solde consommé » du dashboard admin (mesure la plus juste,
      // remplace l'ancien delta de wallet solde_yango).
      const dailyBurns = (reps || [])
        .map((r: any) => (r.commission_amount || 0) + (r.service_supplementaire || 0))
        .filter((b: number) => b > 0);
      const avgDailyWalletBurn = dailyBurns.length > 0
        ? dailyBurns.reduce((s: number, v: number) => s + v, 0) / dailyBurns.length
        : null;

      // ── Price per liter from approved fuel declarations ──
      // Prefer dedicated column, fallback to parsing description ("12L")
      let totalFuelAmount = 0, totalFuelLiters = 0;
      for (const e of (fuelExps || [])) {
        let liters = e.fuel_liters;
        if (!liters && e.description) {
          const m = String(e.description).match(/(\d+(?:\.\d+)?)\s*[Ll]/);
          if (m) liters = parseFloat(m[1]);
        }
        if (liters && liters > 0 && e.amount > 0) {
          totalFuelAmount += e.amount;
          totalFuelLiters += liters;
        }
      }
      const avgPricePerLiter = totalFuelLiters > 0 ? totalFuelAmount / totalFuelLiters : null;
      const avgFuelCostPerKm = (avgPricePerLiter && avgKmPerDay && totalFuelLiters > 0)
        ? totalFuelAmount / (kmDeltas.reduce((s, v) => s + v, 0) || avgKmPerDay)
        : null;

      // ── Projected daily net ──
      // Revenue: smoothed daily gross average
      // Expenses: wallet burn (real consumption) if available, else fallback to net_after_expenses diff
      const projDailyNet = avgDailyGross - (avgDailyWalletBurn ?? 0);

      // MTD net = sum of approved net_after_expenses (actual realized)
      const mtdNet = (reps || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0);

      // Projection from today forward uses smoothed daily net
      const projectedNet = mtdNet + projDailyNet * daysRemaining;
      const dailyAvg = mtdNet / mtdDays; // realized avg (for display)
      const needed = (TARGET - mtdNet) / Math.max(daysRemaining, 1);

      const tier = [...RULES].sort((a, b) => b.min_net - a.min_net).find((r) => projectedNet >= r.min_net) ?? RULES[0];
      const curTier = [...RULES].sort((a, b) => b.min_net - a.min_net).find((r) => mtdNet >= r.min_net) ?? RULES[0];
      const nextTier = [...RULES].sort((a, b) => a.min_net - b.min_net).find((r) => r.min_net > mtdNet);
      const progress = nextTier ? Math.min(100, ((mtdNet - curTier.min_net) / (nextTier.min_net - curTier.min_net)) * 100) : 100;

      // Last month for comparison
      const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevStart = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-01`;
      const prevEnd = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-${new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0).getDate()}`;
      const { data: prevReps } = await supabase.from("daily_reports").select("net_after_expenses,date")
        .eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).or("source.eq.saas,source.is.null")
        .gte("date", prevStart).lte("date", prevEnd).neq("status", "rejected");
      const prevNet = (prevReps || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0);
      const prevDays = new Set((prevReps || []).map((r: any) => r.date)).size || 1;
      const prevDailyAvg = prevNet / prevDays;

      // Location model: net après loyer
      const rentDue = cfg.model === "location" ? cfg.daily_rent * daysElapsed : 0;
      const netAfterRent = cfg.model === "location" ? Math.max(0, mtdNet - rentDue) : 0;
      const rentProjected = cfg.model === "location" ? cfg.daily_rent * daysInMonth : 0;

      setStats({
        mtdNet, mtdDays, dailyAvg, projDailyNet, projectedNet, needed,
        tier, curTier, nextTier, progress, daysElapsed, daysRemaining, daysInMonth,
        prevNet, prevDailyAvg, rentDue, netAfterRent, rentProjected,
        // Consommation metrics
        avgKmPerDay, avgDailyWalletBurn, avgPricePerLiter, avgFuelCostPerKm,
        avgDailyGross, fuelDataPoints: totalFuelLiters > 0 ? (fuelExps || []).length : 0,
        kmDataPoints: kmDeltas.length,
      });
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, cfg.model, cfg.daily_rent, cfg.target_net]);

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm" style={{ color: "var(--sk-t4)" }}>Calcul en cours...</p></div>;
  if (!stats) return null;

  const paceOk = stats.dailyAvg >= stats.needed * 0.85;
  const projPct = Math.min(100, (stats.projectedNet / TARGET) * 100);
  const mtdPct = Math.min(100, (stats.mtdNet / TARGET) * 100);

  return (
    <div className="p-4 pb-6">
      <BackHeader title="Mon Pilotage" icon={Target} onBack={onBack} />

      {/* Main KPI */}
      <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderLeft: "3px solid #f5a623" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--sk-t4)" }}>Projection fin de mois</div>
          <div className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(34,197,94,.1)", color: "#22c55e" }}>
            {stats.avgDailyWalletBurn != null ? "Base consommation réelle" : "NET après commissions"}
          </div>
        </div>
        <div className="text-3xl font-bold font-mono mb-1 mt-2" style={{ color: "#f5a623" }}>
          {cfg.model === "location" ? xof(stats.projectedNet - stats.rentProjected) : xof(stats.projectedNet)}
          <span className="text-sm font-normal ml-1" style={{ color: "var(--sk-t3)" }}>XOF</span>
        </div>
        <div className="text-[10px] mb-2" style={{ color: "var(--sk-t4)" }}>
          {cfg.model === "location"
            ? `= CA projeté − loyer mensuel (${cfg.daily_rent.toLocaleString("fr-FR")} XOF/j × ${stats.daysInMonth}j)`
            : `= Brut Yango − comm. Yango (${cfg.comm_yango}%) − comm. partenaire (${cfg.comm_partner}%)`}
        </div>
        {cfg.model === "tiered" && (
          <div className="text-sm" style={{ color: "var(--sk-t3)" }}>Palier projeté : <span className="font-bold" style={{ color: "#f5a623" }}>{stats.tier.label}</span> → salaire <span className="font-mono font-bold" style={{ color: "#22c55e" }}>{xof(stats.tier.total_salary)}</span></div>
        )}
        {cfg.model === "fixed" && (
          <div className="text-sm" style={{ color: "var(--sk-t3)" }}>Salaire fixe : <span className="font-mono font-bold" style={{ color: "#22c55e" }}>{xof(cfg.base_amount)}</span></div>
        )}
        {cfg.model === "location" && (
          <div className="text-sm" style={{ color: "var(--sk-t3)" }}>
            Loyer projeté ce mois : <span className="font-mono font-bold" style={{ color: "#ef4444" }}>{xof(stats.rentProjected)}</span>
          </div>
        )}
        {cfg.model === "percent" && (
          <div className="text-sm" style={{ color: "var(--sk-t3)" }}>
            Votre part ({Math.round(cfg.commission_rate * 100)}%) : <span className="font-mono font-bold" style={{ color: "#22c55e" }}>{xof(stats.projectedNet * cfg.commission_rate)}</span>
          </div>
        )}
      </div>

      {/* Progress to target */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="flex justify-between text-xs mb-2">
          <span style={{ color: "var(--sk-t3)" }}>MTD: <span className="font-mono font-bold text-white">{xof(stats.mtdNet)}</span></span>
          <span style={{ color: "var(--sk-t4)" }}>Objectif: {xof(TARGET)} XOF</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden mb-2" style={{ background: "var(--sk-surface)" }}>
          <div className="h-full rounded-full relative transition-all" style={{ width: `${mtdPct}%`, background: "linear-gradient(90deg,#f5a623,#22c55e)" }}>
            <div className="absolute right-0 top-0 h-full w-0.5 bg-white opacity-50" />
          </div>
        </div>
        <div className="text-xs" style={{ color: "var(--sk-t4)" }}>
          {mtdPct.toFixed(0)}% atteint · J{stats.daysElapsed}/{stats.daysInMonth} · {stats.daysRemaining}j restants
        </div>
      </div>

      {/* Pace KPIs */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: "Moy/jour réelle", value: xof(stats.dailyAvg), unit: "XOF/j", color: paceOk ? "#22c55e" : "#ef4444" },
          { label: "Moy/jour nécessaire", value: xof(stats.needed), unit: "XOF/j", color: "var(--sk-t3)" },
          { label: "Mois dernier (moy)", value: xof(stats.prevDailyAvg), unit: "XOF/j", color: "var(--sk-t2)" },
          { label: "Écart vs nécessaire", value: stats.dailyAvg >= stats.needed ? "+" + xof(stats.dailyAvg - stats.needed) : "-" + xof(stats.needed - stats.dailyAvg), unit: "XOF/j", color: stats.dailyAvg >= stats.needed ? "#22c55e" : "#ef4444" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>{k.label}</div>
            <div className="text-sm font-mono font-bold" style={{ color: k.color }}>{k.value}</div>
            <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>{k.unit}</div>
          </div>
        ))}
      </div>

      {/* Consommation réelle — métriques issues des deltas */}
      {(stats.avgKmPerDay || stats.avgPricePerLiter || stats.avgDailyWalletBurn) && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>
            Consommation réelle (base projection)
          </div>
          <div className="grid grid-cols-2 gap-3">
            {stats.avgKmPerDay != null && (
              <div className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>Km/jour moy.</div>
                <div className="text-sm font-mono font-bold" style={{ color: "#f5a623" }}>{Math.round(stats.avgKmPerDay)} km</div>
                <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>sur {stats.kmDataPoints} jours consécutifs</div>
              </div>
            )}
            {stats.avgDailyWalletBurn != null && (
              <div className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>Commissions/jour</div>
                <div className="text-sm font-mono font-bold" style={{ color: "#ef4444" }}>{xof(Math.round(stats.avgDailyWalletBurn))}</div>
                <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>Yango + partenaire + frais</div>
              </div>
            )}
            {stats.avgPricePerLiter != null && (
              <div className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>Prix moyen/litre</div>
                <div className="text-sm font-mono font-bold" style={{ color: "var(--sk-t2)" }}>{xof(Math.round(stats.avgPricePerLiter))}/L</div>
                <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>{stats.fuelDataPoints} déclarations</div>
              </div>
            )}
            {stats.avgDailyGross > 0 && (
              <div className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>CA brut/jour lissé</div>
                <div className="text-sm font-mono font-bold" style={{ color: "#22c55e" }}>{xof(Math.round(stats.avgDailyGross))}</div>
                <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>avant commissions</div>
              </div>
            )}
          </div>
          {stats.avgDailyWalletBurn != null && (
            <div className="mt-3 text-[10px] rounded-lg px-3 py-2" style={{ background: "#0a0c10", color: "var(--sk-t3)" }}>
              Projection nette/jour = {xof(Math.round(stats.avgDailyGross))} CA − {xof(Math.round(stats.avgDailyWalletBurn))} commissions = <span style={{ color: stats.projDailyNet >= 0 ? "#22c55e" : "#ef4444" }}>{xof(Math.round(stats.projDailyNet))}/j</span>
            </div>
          )}
        </div>
      )}

      {/* Alert */}
      {!paceOk && (
        <div className="rounded-xl p-3 mb-4 flex items-start gap-2"
          style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.2)" }}>
          <span>🚨</span>
          <div className="text-xs" style={{ color: "#f87171" }}>
            Rythme insuffisant. Il vous faut <strong>{xof(stats.needed - stats.dailyAvg)} XOF/j de plus</strong> pour atteindre l'objectif.
            {cfg.model === "tiered" && stats.tier && ` Projection actuelle : ${stats.tier.label} (${xof(stats.tier.total_salary)}).`}
            {cfg.model === "location" && ` Loyer mensuel : ${xof(stats.rentProjected)}.`}
          </div>
        </div>
      )}

      {/* Location model: loyer dashboard */}
      {cfg.model === "location" && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>Loyer opérateur</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: `Loyer/jour`, value: xof(cfg.daily_rent), color: "#f5a623" },
              { label: `Jours travaillés (MTD)`, value: `${stats.mtdDays}j`, color: "var(--sk-t2)" },
              { label: `Loyer dû (${stats.daysElapsed}j)`, value: xof(stats.rentDue), color: "#ef4444" },
              { label: `Net après loyer`, value: xof(stats.netAfterRent), color: stats.netAfterRent > 0 ? "#22c55e" : "#ef4444" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>{k.label}</div>
                <div className="text-sm font-mono font-bold" style={{ color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next tier progress (tiered only) */}
      {cfg.model === "tiered" && stats.nextTier && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--sk-t3)" }}>Progression vers {stats.nextTier.label}</div>
          <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: "var(--sk-surface)" }}>
            <div className="h-full rounded-full" style={{ width: `${stats.progress}%`, background: "#f5a623" }} />
          </div>
          <div className="text-xs" style={{ color: "var(--sk-t4)" }}>
            {xof(stats.nextTier.min_net - stats.mtdNet)} pour atteindre {stats.nextTier.label} → salaire {xof(stats.nextTier.total_salary)}
          </div>
        </div>
      )}

      {/* Grille salaires (tiered only) */}
      {cfg.model === "tiered" && RULES.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>Grille salaires</div>
          {RULES.map((r, i) => {
            const isActive = r.label === stats.curTier?.label;
            const isProjected = r.label === stats.tier?.label && !isActive;
            return (
              <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: i < RULES.length - 1 ? "1px solid #0a0c10" : "none" }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: isActive ? "#22c55e" : isProjected ? "#f5a623" : "#2a2f3d" }} />
                  <span className="text-xs" style={{ color: isActive ? "#22c55e" : isProjected ? "#f5a623" : "var(--sk-t3)" }}>
                    {r.label} {isActive && "← actuel"} {isProjected && "← projeté"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono font-bold" style={{ color: isActive || isProjected ? "var(--sk-t1)" : "var(--sk-t4)" }}>{xof(r.total_salary)}</span>
                  <span className="text-[10px] ml-1" style={{ color: "var(--sk-t4)" }}>≥ {xof(r.min_net)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Résumé modèle fixe */}
      {cfg.model === "fixed" && (
        <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--sk-t4)" }}>Rémunération</div>
          <div className="text-sm text-white">Salaire fixe mensuel : <span className="font-mono font-bold" style={{ color: "#22c55e" }}>{xof(cfg.base_amount)}</span></div>
          <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>Indépendant du CA — versé chaque mois.</div>
        </div>
      )}

      {/* Résumé modèle percent */}
      {cfg.model === "percent" && (
        <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
          <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--sk-t4)" }}>Votre part</div>
          <div className="text-sm text-white">{Math.round(cfg.commission_rate * 100)}% du CA net</div>
          <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>CA net MTD : {xof(stats.mtdNet)} → votre part : <span style={{ color: "#f5a623" }}>{xof(stats.mtdNet * cfg.commission_rate)}</span></div>
        </div>
      )}

      {/* Résumé modèle hybrid */}
      {cfg.model === "hybrid" && (() => {
        const bonusUnlocked = cfg.bonus_threshold > 0 && stats.mtdNet >= cfg.bonus_threshold;
        const bonusProjected = cfg.bonus_threshold > 0 && stats.projectedNet >= cfg.bonus_threshold;
        const salaireMTD = cfg.base_amount + (bonusUnlocked ? cfg.bonus_amount : 0) + (cfg.commission_rate > 0 ? stats.mtdNet * cfg.commission_rate : 0);
        const salaireProj = cfg.base_amount + (bonusProjected ? cfg.bonus_amount : 0) + (cfg.commission_rate > 0 ? stats.projectedNet * cfg.commission_rate : 0);
        return (
          <div className="rounded-2xl p-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
            <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}>Rémunération projetée</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Salaire fixe", value: xof(cfg.base_amount), color: "var(--sk-t2)" },
                { label: bonusUnlocked ? "Bonus ✓ débloqué" : bonusProjected ? "Bonus ✓ projeté fin de mois" : `Bonus (seuil : ${xof(cfg.bonus_threshold)})`, value: xof(cfg.bonus_amount), color: bonusUnlocked ? "#22c55e" : bonusProjected ? "#f5a623" : "var(--sk-t4)" },
                ...(cfg.commission_rate > 0 ? [{ label: `Commission (${Math.round(cfg.commission_rate * 100)}%)`, value: xof(stats.projectedNet * cfg.commission_rate), color: "#f5a623" }] : []),
                { label: "Total projeté", value: xof(salaireProj), color: "var(--sk-t1)" },
              ].map((k) => (
                <div key={k.label} className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                  <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>{k.label}</div>
                  <div className="text-sm font-mono font-bold" style={{ color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
            {cfg.bonus_threshold > 0 && !bonusUnlocked && (
              <div className="mt-3">
                <div className="text-xs mb-1" style={{ color: "var(--sk-t3)" }}>
                  Progression vers le bonus ({xof(cfg.bonus_threshold - stats.mtdNet)} restants)
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--sk-surface)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (stats.mtdNet / cfg.bonus_threshold) * 100)}%`, background: "#f5a623" }} />
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── SHARED COMPONENTS ───────────────────────────────
function BackHeader({ title, icon: Icon, onBack }: { title: string; icon?: LucideIcon; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--sk-t3)", fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
      <h2 className="flex items-center gap-2 text-base font-semibold text-white">
        {Icon && <Icon size={18} strokeWidth={2} style={{ color: "#f5a623" }} />}
        {title}
      </h2>
    </div>
  );
}

function StatusBanner({ type, children }: { type: "ok" | "err"; children: React.ReactNode }) {
  const ok = type === "ok";
  return (
    <div className="rounded-xl px-4 py-3 mb-4 text-sm"
      style={{ background: ok ? "rgba(34,197,94,.07)" : "rgba(239,68,68,.07)", border: `1px solid ${ok ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)"}`, color: ok ? "#4ade80" : "#f87171" }}>
      {children}
    </div>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>
        {Icon && <Icon size={13} strokeWidth={2} />}
        {label}
      </label>
      {children}
    </div>
  );
}

function InpText({ type, placeholder, value, onChange, disabled }: { type: string; placeholder?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input type={type} placeholder={placeholder} value={value} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
      style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", opacity: disabled ? 0.5 : 1 }}
      onFocus={(e) => { if (!disabled) e.currentTarget.style.borderColor = "#f5a623"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--sk-surface)"; }}
    />
  );
}

function InpTextarea({ placeholder, value, onChange, disabled }: { placeholder?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <textarea placeholder={placeholder} value={value} disabled={disabled} rows={2}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none transition-all"
      style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", opacity: disabled ? 0.5 : 1 }}
      onFocus={(e) => { if (!disabled) e.currentTarget.style.borderColor = "#f5a623"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--sk-surface)"; }}
    />
  );
}

function BtnPrimary({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all"
      style={{ background: disabled ? "var(--sk-surface)" : "linear-gradient(135deg,#f5a623,#e8951a)", color: disabled ? "var(--sk-t3)" : "#000", boxShadow: disabled ? "none" : "0 4px 20px rgba(245,166,35,.2)" }}>
      {children}
    </button>
  );
}
