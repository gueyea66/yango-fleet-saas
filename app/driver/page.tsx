"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { CAT_AVANCE } from "@/lib/expenseCategories";
import { createClient } from "@/lib/supabase/client";
import { useTenant, applyTenantBrandingOverride } from "@/lib/tenant/context";
import { setPlatformLabel, platLabel, displayLabel } from "@/lib/tenant/platformLabel";
import { BrandLogo } from "@/components/brand/BrandShell";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import PushOnboarding from "@/components/PushOnboarding";
import { Home, ClipboardList, Wallet, BedDouble, History, Target, LogOut, Gauge, CheckCircle2, AlertTriangle, Paperclip, Car, ScanLine, UserRound, FileText, LifeBuoy, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DEFAULT_CFG, salaryLevel, xof, type Cfg, type Profile, type AiScanResult, AI_FIELD_LABELS } from "@/components/driver/shared";
import { useDriverHomeData } from "@/components/driver/useDriverHomeData";
import { useAiScan } from "@/components/driver/useAiScan";
import { useReportForm } from "@/components/driver/useReportForm";
import { useExpenseForm } from "@/components/driver/useExpenseForm";
import { useDriverProfil, KYC_DOCS } from "@/components/driver/useDriverProfil";
import { useReposForm } from "@/components/driver/useReposForm";
import { useDriverPilotageStats } from "@/components/driver/useDriverPilotageStats";
import { UploadBlock, ReportHistoryCard, ExpenseCard, DriverAvancesSection } from "@/components/driver/DriverCards";
import { useUiV2 } from "@/components/v2/useUiV2";
import DriverAppV2 from "@/components/v2/driver/DriverAppV2";

function calcReport(yangoGross: number, yangoBonus: number, offYango: number, cfg: Cfg) {
  const base = yangoGross + yangoBonus;
  const commY = base * (cfg.comm_yango / 100);
  const commP = base * (cfg.comm_partner / 100);
  const netY = base - commY - commP;
  return { base, commY, commP, netY, offYango, total: netY + offYango };
}

type Tab = "home" | "report" | "expense" | "history" | "profil" | "pilotage" | "repos";

export default function DriverApp() {
  const { user, loading, signOut } = useAuth();
  const { settings } = useTenant();
  const router = useRouter();
  const uiV2 = useUiV2(); // refonte UI v2 (drapeau tenant ou appareil)
  const [tab, setTab] = useState<Tab>("home");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Libellé plateforme (migration 038) : lu depuis le tenant du profil (RLS),
  // le branding par hostname n'étant pas fiable sur le domaine vercel.app.
  const [plat, setPlat] = useState<string>(settings.platform_label || "Yango");

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
          // Libellé plateforme du tenant (select * : tolère migration 038 absente)
          void supabase.from("tenant_settings").select("*").eq("tenant_id", data.tenant_id).maybeSingle()
            .then(({ data: ts }: any) => {
              if (ts?.platform_label) { setPlatformLabel(ts.platform_label); setPlat(ts.platform_label); }
              if (ts) applyTenantBrandingOverride({
                app_name: ts.app_name, logo_url: ts.logo_url, primary_color: ts.primary_color,
                skin: ts.skin, operator_name: ts.operator_name, currency: ts.currency,
                ui_v2: ts.ui_v2, // drapeau refonte UI v2 (migration 062)
              });
            });
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
          <div className="flex justify-center mb-4"><AlertTriangle size={40} strokeWidth={1.7} style={{ color: "var(--tenant-color)" }} /></div>
          <h2 className="text-lg font-semibold text-white mb-2">Compte non configuré</h2>
          <p className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>{profileError}</p>
          <button onClick={() => signOut()} className="text-sm px-4 py-2 rounded-lg"
            style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid var(--sk-border)" }}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if (!user || !profile) return null;

  if (uiV2) return <DriverAppV2 profile={profile} cfg={cfg} onSignOut={() => signOut()} />;

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
      <PushOnboarding role="driver" />

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
                background: tab === id ? "rgba(var(--tenant-color-rgb),.1)" : "transparent",
                color: tab === id ? "var(--tenant-color)" : "var(--sk-t3)",
                border: tab === id ? "1px solid rgba(var(--tenant-color-rgb),.2)" : "1px solid transparent",
              }}>
              <Icon size={18} strokeWidth={2} />
              <span>{label}</span>
            </button>
          ))}
          {/* Profil : destination secondaire, séparée des onglets de saisie */}
          <div className="pt-3 mt-3" style={{ borderTop: "1px solid var(--sk-surface)" }}>
            <button onClick={() => setTab("profil")}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: tab === "profil" ? "rgba(var(--tenant-color-rgb),.1)" : "transparent",
                color: tab === "profil" ? "var(--tenant-color)" : "var(--sk-t3)",
                border: tab === "profil" ? "1px solid rgba(var(--tenant-color-rgb),.2)" : "1px solid transparent",
              }}>
              <UserRound size={18} strokeWidth={2} />
              <span>Mon profil &amp; KYC</span>
            </button>
          </div>
        </nav>
        {/* Notifications + sign out */}
        <div className="p-4 border-t" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="flex justify-center items-center mb-2"><ThemeToggle /><NotificationBell /></div>
          <button onClick={() => signOut()}
            className="w-full text-xs py-2 rounded-lg transition-all"
            style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid var(--sk-border)" }}>
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
            {/* Accès profil & KYC : dans l'en-tête, la barre du bas compte déjà 6 onglets */}
            <button onClick={() => setTab("profil")} aria-label="Mon profil et documents"
              aria-current={tab === "profil" ? "page" : undefined}
              className="p-2 rounded-lg flex items-center justify-center"
              style={{
                background: tab === "profil" ? "rgba(var(--tenant-color-rgb),.12)" : "var(--sk-surface)",
                color: tab === "profil" ? "var(--tenant-color)" : "var(--sk-t2)",
                border: "1px solid var(--sk-border)",
              }}>
              <UserRound size={16} strokeWidth={2} />
            </button>
            <ThemeToggle />
            <NotificationBell />
            <button onClick={() => signOut()} aria-label="Se déconnecter"
              className="p-2 rounded-lg flex items-center justify-center"
              style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid var(--sk-border)" }}>
              <LogOut size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Desktop page title bar */}
        <div className="hidden md:flex items-center justify-between px-8 py-5 border-b shrink-0"
          style={{ borderColor: "var(--sk-surface)", background: "#0a0c10" }}>
          <div className="font-semibold text-white text-base">
            {tab === "profil" ? "Mon profil & KYC" : navItems.find(([id]) => id === tab)?.[2] ?? "Accueil"}
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
            style={{ color: tab === id ? "var(--tenant-color)" : "var(--sk-t4)" }}>
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
  const { monthNet, monthPending, todayStatus, pendingCount, rejectedCount } = useDriverHomeData(profile);

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl p-4" style={{
        background: todayStatus ? "rgba(34,197,94,.06)" : "rgba(var(--tenant-color-rgb),.06)",
        border: `1px solid ${todayStatus ? "rgba(34,197,94,.2)" : "rgba(var(--tenant-color-rgb),.2)"}`,
      }}>
        <div className="text-xs font-semibold mb-1" style={{ color: todayStatus ? "#22c55e" : "var(--tenant-color)" }}>
          {todayStatus ? "✓ Rapport soumis aujourd'hui" : "⚠ Aucun rapport aujourd'hui"}
        </div>
        <div className="text-sm" style={{ color: "var(--sk-t3)" }}>
          {todayStatus === "submitted" ? "En attente de validation" : todayStatus === "approved" ? "Validé ✓" : "Soumettez votre rapport en fin de journée"}
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="text-xs rounded-xl px-4 py-3" style={{ background: "rgba(var(--tenant-color-rgb),.07)", border: "1px solid rgba(var(--tenant-color-rgb),.15)", color: "#f5c842" }}>
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
          style={{ background: todayStatus ? "var(--sk-bg)" : "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))", color: todayStatus ? "var(--sk-t4)" : "#000", border: todayStatus ? "1px solid var(--sk-surface)" : "none" }}>
          <ClipboardList size={22} strokeWidth={2.2} />
          <span>{todayStatus ? "Rapport soumis" : "Faire le rapport"}</span>
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
            <div className="text-xs px-2 py-1 rounded-lg inline-block" style={{ background: "rgba(var(--tenant-color-rgb),.1)", color: "var(--tenant-color)" }}>
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
                    pour atteindre <span style={{ color: "var(--tenant-color)", fontWeight: 600 }}>{nextLevel.label}</span>
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
// ── Extraction vision (couche IA additive) ────────────────────────────────
// Le bloc ne se monte QUE si /api/ai/extract-declaration répond 200 à la
// sonde GET (kill-switch 3 étages). OFF → null : écran identique à avant.
// Le LLM lit les valeurs affichées ; calc.ts reste seul à calculer.
function confColor(c: number) { return c >= 0.85 ? "#22c55e" : c >= 0.6 ? "var(--tenant-color)" : "#ef4444"; }

function AiScanBlock({ date, disabled, onExtracted }: { date: string; disabled: boolean; onExtracted: (r: AiScanResult) => void }) {
  const { enabled, phase, message, result, scan } = useAiScan(date, onExtracted);

  if (!enabled) return null;

  return (
    <div className="rounded-2xl p-4 mb-1" style={{ background: "rgba(34,197,94,.04)", border: "1px solid rgba(34,197,94,.18)" }}>
      <div className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={{ color: "#22c55e" }}>
        <ScanLine size={13} strokeWidth={2} />Pré-remplissage par photo
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--sk-t3)" }}>
        {`Ajoute tes captures ${platLabel()} Pro et/ou une photo du compteur : les champs se remplissent seuls, tu vérifies et tu corriges si besoin.`}
      </div>
      <label className="block w-full py-2.5 rounded-xl text-xs font-bold text-center cursor-pointer"
        style={{ background: phase === "working" ? "rgba(34,197,94,.15)" : "linear-gradient(135deg,#22c55e,#16a34a)", color: phase === "working" ? "#22c55e" : "#04110a", opacity: disabled ? 0.5 : 1 }}>
        {phase === "working" ? "⏳ " + (message || "Lecture...") : "📸 Scanner mes captures (1 à 3 images)"}
        <input type="file" accept="image/*" multiple className="hidden" disabled={disabled || phase === "working"}
          onChange={(e) => { void scan(e.target.files); e.target.value = ""; }} />
      </label>
      {phase === "error" && (
        <div className="text-xs mt-2" style={{ color: "var(--tenant-color)" }}>⚠ {message}</div>
      )}
      {phase === "done" && result && (
        <div className="mt-3">
          <div className="text-xs mb-1.5" style={{ color: "var(--sk-t3)" }}>Valeurs lues — vérifie chaque champ avant de soumettre :</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(result.fields).filter(([, v]) => v !== null).map(([k, v]) => (
              <span key={k} className="text-xs px-2 py-1 rounded-lg font-mono" style={{ background: "var(--sk-deep)", border: `1px solid ${confColor(result.confidences[k] ?? 0)}44`, color: "var(--sk-t2)" }}>
                <span style={{ color: confColor(result.confidences[k] ?? 0) }}>●</span> {displayLabel(AI_FIELD_LABELS[k] ?? k)} : {Number(v).toLocaleString("fr-FR")}
              </span>
            ))}
          </div>
          {result.coherence_alerts?.length > 0 && result.coherence_alerts.map((a, i) => (
            <div key={i} className="text-xs mt-2 rounded-lg p-2" style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", color: "#f87171" }}>
              ⚠ {a.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportTab({ profile, onBack, cfg }: { profile: Profile; onBack: () => void; cfg: Cfg }) {
  const { today, form, todayReport, rejectedToday, submitted, saving, reportId, pendingFiles, setPendingFiles, n, set, addFiles, applyExtraction, rates, calc, modeReel, reel, canEdit, submit } = useReportForm(profile, cfg);

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
      <button onClick={onBack} className="w-full py-3 rounded-xl text-sm font-bold text-black" style={{ background: "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))" }}>Retour accueil</button>
    </div>
  );

  return (
    <div className="p-4">
      <BackHeader title="Rapport journalier" onBack={onBack} />
      {todayReport && <StatusBanner type="ok">Rapport déjà soumis · {todayReport.status === "submitted" ? "En attente" : "Validé ✓"}</StatusBanner>}
      {!todayReport && rejectedToday && (
        <div className="rounded-xl p-3 mb-2" style={{ background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)" }}>
          <div className="text-sm font-semibold" style={{ color: "#ef4444" }}>⚠ Un précédent rapport pour cette date a été rejeté</div>
          {rejectedToday.rejection_reason && (
            <div className="text-xs mt-1" style={{ color: "#f87171" }}>Motif : {rejectedToday.rejection_reason}</div>
          )}
          <div className="text-xs mt-1" style={{ color: "var(--sk-t2)" }}>Les champs sont pré-remplis avec cette ancienne saisie — corrigez et soumettez : ça crée un nouveau rapport, l'ancien reste consultable dans l'historique.</div>
        </div>
      )}
      <div className="space-y-4">
        {canEdit && <AiScanBlock date={form.date} disabled={saving} onExtracted={applyExtraction} />}
        <Field label="Date">
          {/* Toujours modifiable, même si la date actuelle a déjà un rapport actif —
              sinon impossible de choisir une autre date pour une nouvelle saisie. */}
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} max={today}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "inherit" as any }} />
          {!canEdit && <div className="text-[10px] mt-1" style={{ color: "var(--sk-t4)" }}>Un rapport est déjà actif pour cette date — changez la date pour en saisir un autre, ou consultez l'historique.</div>}
        </Field>
        <Field label="Compteur km fin de journée" icon={Gauge}><InpText type="number" placeholder="ex: 48900" value={form.end_odometer} onChange={(v) => set("end_odometer", v)} disabled={!canEdit} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Espèces (app ${platLabel()})`}><InpText type="number" placeholder="0" value={form.yango_cash} onChange={(v) => set("yango_cash", v)} disabled={!canEdit} /></Field>
          <Field label="Carte (si affiché)"><InpText type="number" placeholder="0" value={form.yango_card} onChange={(v) => set("yango_card", v)} disabled={!canEdit} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={form.yango_cash || form.yango_card ? `Brut ${platLabel()} (= espèces + carte)` : `Brut ${platLabel()} *`}>
            <InpText type="number" placeholder="0" value={form.yango_gross} onChange={(v) => set("yango_gross", v)} disabled={!canEdit || !!(form.yango_cash || form.yango_card)} />
          </Field>
          <Field label={`Bonus ${platLabel()}`}><InpText type="number" placeholder="0" value={form.yango_bonus} onChange={(v) => set("yango_bonus", v)} disabled={!canEdit} /></Field>
        </div>
        <Field label={`Hors ${platLabel()} (XOF)`}><InpText type="number" placeholder="0" value={form.off_yango_revenue} onChange={(v) => set("off_yango_revenue", v)} disabled={!canEdit} /></Field>
        <Field label={`Solde ${platLabel()} (wallet fin de journée)`} icon={Wallet}><InpText type="number" placeholder="ex: 15 000" value={form.solde_yango} onChange={(v) => set("solde_yango", v)} disabled={!canEdit} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Courses ${platLabel()}`}><InpText type="number" placeholder="0" value={form.yango_trip_count} onChange={(v) => set("yango_trip_count", v)} disabled={!canEdit} /></Field>
          <Field label="Courses hors"><InpText type="number" placeholder="0" value={form.off_yango_trip_count} onChange={(v) => set("off_yango_trip_count", v)} disabled={!canEdit} /></Field>
        </div>
        <Field label={`➕ Service supplémentaire ${platLabel()} (optionnel)`}><InpText type="number" placeholder="0" value={form.service_supplementaire} onChange={(v) => set("service_supplementaire", v)} disabled={!canEdit} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Comm. ${platLabel()} (lue dans l'app)`}><InpText type="number" placeholder="0" value={form.commission_yango_reelle} onChange={(v) => set("commission_yango_reelle", v)} disabled={!canEdit} /></Field>
          <Field label="Comm. partenaire (lue)"><InpText type="number" placeholder="0" value={form.commission_partenaire_reelle} onChange={(v) => set("commission_partenaire_reelle", v)} disabled={!canEdit} /></Field>
        </div>

        {modeReel ? (
          // MODE RÉEL — éléments lus dans l'app Yango, pris tels quels.
          // Aucune commission calculée : le net est la simple somme des éléments.
          <div className="rounded-2xl p-4" style={{ background: "rgba(34,197,94,.04)", border: "1px solid rgba(34,197,94,.15)" }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "#22c55e" }}>{`Éléments réels ${platLabel()}`}</div>
            {[
              ...(n(form.yango_cash) > 0 ? [["Espèces", n(form.yango_cash), false]] : []),
              ...(n(form.yango_card) > 0 ? [["Carte", n(form.yango_card), false]] : []),
              [`Brut ${platLabel()} (espèces + carte)`, reel.brutYango, false],
              ["Bonus", n(form.yango_bonus), false],
              [`Commission ${platLabel()} (app)`, n(form.commission_yango_reelle), true],
              ...(n(form.service_supplementaire) > 0 ? [["Services supplémentaires (app)", n(form.service_supplementaire), true]] : []),
              ["Comm. partenaire (app)", n(form.commission_partenaire_reelle), true],
              [`Net ${platLabel()}`, reel.netYango, false],
              ...(n(form.off_yango_revenue) > 0 ? [[`Hors ${platLabel()}`, n(form.off_yango_revenue), false]] : []),
              ...(n(form.solde_yango) > 0 ? [["Solde wallet", n(form.solde_yango), false]] : []),
            ].map(([l, v, neg]) => (
              <div key={String(l)} className="flex justify-between text-xs py-1.5" style={{ borderBottom: "1px solid rgba(34,197,94,.07)" }}>
                <span style={{ color: "var(--sk-t3)" }}>{l}</span>
                <span className="font-mono font-semibold" style={{ color: neg ? "#ef4444" : "var(--sk-t2)" }}>{neg ? "- " : ""}{xof(Math.abs(Number(v)))}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-bold pt-2">
              <span className="text-white">NET TOTAL</span>
              <span className="font-mono" style={{ color: "#22c55e" }}>{xof(reel.netTotal)}</span>
            </div>
          </div>
        ) : (n(form.yango_gross) > 0 || n(form.yango_bonus) > 0 || n(form.off_yango_revenue) > 0) && (
          <div className="rounded-2xl p-4" style={{ background: "rgba(var(--tenant-color-rgb),.04)", border: "1px solid rgba(var(--tenant-color-rgb),.15)" }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--tenant-color)" }}>Aperçu calcul</div>
            {[[`Base ${platLabel()}`, calc.base, false], [`Commission ${platLabel()} (${rates.yangoPct}%)`, calc.commYango, true], [`Comm. partenaire (${rates.partnerPct.toFixed(2)}%)`, calc.commPartner, true], ...(calc.serviceSupp > 0 ? [["Service supplémentaire", calc.serviceSupp, true]] : []), [`Net ${platLabel()}`, calc.netYango, false], [`Hors ${platLabel()}`, n(form.off_yango_revenue), false], ...(n(form.solde_yango) > 0 ? [["Solde wallet", n(form.solde_yango), false]] : [])].map(([l, v, neg]) => (
              <div key={String(l)} className="flex justify-between text-xs py-1.5" style={{ borderBottom: "1px solid rgba(var(--tenant-color-rgb),.07)" }}>
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
                style={{ background: "rgba(var(--tenant-color-rgb),.08)", border: "1px solid rgba(var(--tenant-color-rgb),.25)", color: "var(--tenant-color)" }}>
                📷 Photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-center cursor-pointer"
                style={{ background: "transparent", border: "1px solid var(--sk-border)", color: "var(--sk-t3)" }}>
                📁 Fichier
                <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
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

// ─── EXPENSE ─────────────────────────────────────────
function ExpenseTab({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const { today, form, setForm, submitted, setSubmitted, expenseId, setExpenseId, saving, pendingFiles, setPendingFiles, set, expenseTypes, advanceTo, setAdvanceTo, targets, addFiles, submit } = useExpenseForm(profile);

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
        <button onClick={() => { setForm({ expense_date: today, type: "Carburant", amount: "", odometer: "", fuel_liters: "", comment: "" }); setAdvanceTo(""); setSubmitted(false); setExpenseId(null); }}
          className="flex-1 py-2.5 text-sm rounded-xl" style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid var(--sk-border)" }}>Nouvelle dépense</button>
        <button onClick={onBack} className="flex-1 py-2.5 text-sm rounded-xl font-bold text-black" style={{ background: "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))" }}>Accueil</button>
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
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "inherit" as any }} />
        </Field>
        <Field label="Type">
          <select value={form.type} onChange={(e) => set("type", e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
            {expenseTypes.map((t) => <option key={t} value={t}>{displayLabel(t)}</option>)}
          </select>
        </Field>
        {form.type === CAT_AVANCE && (
          <Field label="Remis à (chauffeur)">
            <select value={advanceTo} onChange={(e) => setAdvanceTo(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}>
              <option value="">— Non affecté (autre sortie) —</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
            <p className="text-[11px] mt-1" style={{ color: "var(--sk-t4)" }}>
              Une avance est neutre pour le résultat : la charge réelle sera celle que le chauffeur déclare avec ses preuves.
            </p>
          </Field>
        )}
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
              style={{ background: "rgba(var(--tenant-color-rgb),.08)", border: "1px solid rgba(var(--tenant-color-rgb),.25)", color: "var(--tenant-color)" }}>
              📷 Photo
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-center cursor-pointer"
              style={{ background: "transparent", border: "1px solid var(--sk-border)", color: "var(--sk-t3)" }}>
              📁 Fichier
              <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
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
        supabase.from("daily_reports").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).order("date", { ascending: false }).limit(30),
        supabase.from("expenses").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).order("expense_date", { ascending: false, nullsFirst: false }).limit(30),
      ]);
      setReports(r || []);
      setExpenses(e || []);
      setLoading(false);
    })();
  }, [profile.id]);

  const badge = (status: string) => {
    const map: Record<string, [string, string]> = { approved: ["#22c55e", "rgba(34,197,94,.1)"], rejected: ["#ef4444", "rgba(239,68,68,.1)"] };
    const [color, bg] = map[status] ?? ["var(--tenant-color)", "rgba(var(--tenant-color-rgb),.1)"];
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{status === "approved" ? "Validé" : status === "rejected" ? "Rejeté" : "En attente"}</span>;
  };

  return (
    <div className="p-4">
      <BackHeader title="Historique" onBack={onBack} />
      <div className="flex gap-2 mb-4">
        {(["reports", "expenses"] as const).map((id) => (
          <button key={id} onClick={() => setSubTab(id)} className="flex-1 py-2 text-xs font-semibold rounded-xl transition-all"
            style={{ background: subTab === id ? "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))" : "var(--sk-bg)", color: subTab === id ? "#000" : "var(--sk-t4)", border: subTab === id ? "none" : "1px solid var(--sk-surface)" }}>
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
              supabase.from("daily_reports").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).order("date", { ascending: false }).limit(30).then(({ data }: any) => { if (data) setReports(data); });
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

function ProfilTab({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const { fullProfile, infoForm, savingInfo, infoSaved, vehicle, kycDocs, uploading, submitting, setInfo, saveInfo, uploadDoc, submitDossier, requiredDocs, completedRequired, status, statusInfo, levelInfo, canSubmit } = useDriverProfil(profile);

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--sk-t4)" }}><UserRound size={13} strokeWidth={2} />Informations personnelles</div>
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
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--sk-t4)" }}><LifeBuoy size={13} strokeWidth={2} />Contact d'urgence</div>
          <div className="space-y-3">
            <Field label="Nom"><InpText type="text" placeholder="Prénom Nom" value={infoForm.emergency_name} onChange={(v) => setInfo("emergency_name", v)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Téléphone"><InpText type="tel" placeholder="+221 77 XXX XX XX" value={infoForm.emergency_phone} onChange={(v) => setInfo("emergency_phone", v)} /></Field>
              <Field label="Relation"><InpText type="text" placeholder="Conjoint, parent..." value={infoForm.emergency_relation} onChange={(v) => setInfo("emergency_relation", v)} /></Field>
            </div>
          </div>
        </div>
        <button onClick={saveInfo} disabled={savingInfo} className="w-full mt-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: infoSaved ? "rgba(34,197,94,.1)" : "rgba(var(--tenant-color-rgb),.1)", color: infoSaved ? "#22c55e" : "var(--tenant-color)", border: `1px solid ${infoSaved ? "rgba(34,197,94,.2)" : "rgba(var(--tenant-color-rgb),.2)"}` }}>
          {infoSaved ? "✓ Enregistré" : savingInfo ? "..." : "Enregistrer les infos"}
        </button>
      </div>

      {/* Documents KYC */}
      <div className="rounded-2xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold" style={{ color: "var(--sk-t4)" }}><FileText size={13} strokeWidth={2} />Documents requis</div>
          <div className="text-xs font-semibold" style={{ color: completedRequired === requiredDocs.length ? "#22c55e" : "var(--tenant-color)" }}>
            {completedRequired}/{requiredDocs.length} complétés
          </div>
        </div>
        <div className="text-[10px] mb-4" style={{ color: "var(--sk-t4)" }}>Photo ou PDF · Max 10 Mo par fichier</div>
        <div className="space-y-2">
          {KYC_DOCS.map((doc) => {
            const uploaded = kycDocs[doc.type];
            const isUploading = uploading === doc.type;
            const docStatus = uploaded?.status || null;
            const statusColor = docStatus === "approved" ? "#22c55e" : docStatus === "rejected" ? "#ef4444" : uploaded ? "var(--tenant-color)" : "var(--sk-border)";
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
                  style={{ background: "rgba(var(--tenant-color-rgb),.1)", color: isUploading ? "var(--sk-t3)" : "var(--tenant-color)", border: "1px solid rgba(var(--tenant-color-rgb),.15)" }}>
                  {isUploading ? "..." : uploaded ? "Remplacer" : "Uploader"}
                </button>
                <input type="file" accept="image/*,.pdf" className="hidden"
                  ref={(el) => { fileRefs.current[doc.type] = el; }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f, doc.type); }} />
              </div>
            );
          })}
        </div>
        {canSubmit && (
          <button onClick={submitDossier} disabled={submitting}
            className="w-full mt-4 py-3 rounded-xl font-bold transition-all"
            style={{ background: submitting ? "var(--sk-border)" : "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))", color: submitting ? "var(--sk-t3)" : "#000" }}>
            {submitting ? "Envoi en cours..." : "Soumettre mon dossier pour vérification"}
          </button>
        )}
        {status === "in_review" && <div className="mt-4 flex items-center justify-center gap-1.5 text-xs" style={{ color: "#3b82f6" }}><Clock size={14} strokeWidth={2} />Dossier en cours de vérification par l'équipe</div>}
        {status === "approved" && <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold" style={{ color: "#22c55e" }}><CheckCircle2 size={14} strokeWidth={2} />Dossier validé — Bienvenue !</div>}
      </div>

      {/* Véhicule — lecture seule : le registre de flotte et le taux de
          commission partenaire (qui entre dans le calcul de la paie) sont
          gérés par le gestionnaire, pas par le chauffeur. */}
      <div className="rounded-2xl p-5" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--sk-t4)" }}><Car size={13} strokeWidth={2} />Véhicule assigné</div>
        {vehicle ? (
          <div className="grid grid-cols-2 gap-3">
            {([["Plaque", vehicle.plate], ["Marque", vehicle.make], ["Modèle", vehicle.model], ["Année", vehicle.year]] as [string, string | number | null][]).map(([l, v]) => (
              <div key={l}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--sk-t4)" }}>{l}</div>
                <div className="text-sm font-semibold text-white">{v || "—"}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm" style={{ color: "var(--sk-t3)" }}>Aucun véhicule ne vous est encore attribué. Votre gestionnaire l'assigne depuis la flotte.</div>
        )}
        <div className="text-[11px] mt-3" style={{ color: "var(--sk-t4)" }}>Une information est fausse ? Signalez-la à votre gestionnaire.</div>
      </div>

      <DriverAvancesSection driverId={profile.id} />
    </div>
  );
}

// ─── REPOS TAB ───────────────────────────────────────
function ReposTab({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const { date, setDate, motif, setMotif, saving, submitted, existing, submit } = useReposForm(profile);

  if (submitted) return (
    <div className="p-6 pt-16 text-center">
      <div className="flex justify-center mb-4"><CheckCircle2 size={48} strokeWidth={1.8} style={{ color: "#22c55e" }} /></div>
      <div className="text-lg font-semibold text-white mb-2">Jour de repos déclaré</div>
      <div className="text-sm mb-6" style={{ color: "var(--sk-t3)" }}>En attente de validation admin</div>
      <button onClick={onBack} className="px-6 py-2.5 rounded-xl text-sm font-bold text-black" style={{ background: "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))" }}>
        Retour accueil
      </button>
    </div>
  );

  const statusColor = (s: string) => s === "approved" ? "#22c55e" : s === "rejected" ? "#ef4444" : "var(--tenant-color)";
  const statusLabel = (s: string) => s === "approved" ? "✓ Validé" : s === "rejected" ? "✗ Refusé" : "⏳ En attente";

  return (
    <div className="p-4">
      <BackHeader title="Déclarer un jour de repos" icon={BedDouble} onBack={onBack} />
      <div className="space-y-4">
        <div className="rounded-2xl p-4" style={{ background: "rgba(var(--tenant-color-rgb),.04)", border: "1px solid rgba(var(--tenant-color-rgb),.15)" }}>
          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "var(--tenant-color)" }}>Information</div>
          <div className="text-xs" style={{ color: "var(--sk-t2)" }}>
            La déclaration de repos permet à l'admin de tracer les jours non travaillés. Elle sera soumise à validation et n'impacte pas vos revenus.
          </div>
        </div>

        <Field label="Date du repos (passé ou futur)">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", colorScheme: "inherit" as any }} />
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
  const { stats, loading, RULES, TARGET } = useDriverPilotageStats(profile, cfg);

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-sm" style={{ color: "var(--sk-t4)" }}>Calcul en cours...</p></div>;
  if (!stats) return null;

  const paceOk = stats.dailyAvg >= stats.needed * 0.85;
  const projPct = Math.min(100, (stats.projectedNet / TARGET) * 100);
  const mtdPct = Math.min(100, (stats.mtdNet / TARGET) * 100);

  return (
    <div className="p-4 pb-6">
      <BackHeader title="Mon Pilotage" icon={Target} onBack={onBack} />

      {/* Main KPI */}
      <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderLeft: "3px solid var(--tenant-color)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--sk-t4)" }}>Projection fin de mois</div>
          <div className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(34,197,94,.1)", color: "#22c55e" }}>
            {stats.avgDailyWalletBurn != null ? "Base consommation réelle" : "NET après commissions"}
          </div>
        </div>
        <div className="text-3xl font-bold font-mono mb-1 mt-2" style={{ color: "var(--tenant-color)" }}>
          {cfg.model === "location" ? xof(stats.projectedNet - stats.rentProjected) : xof(stats.projectedNet)}
          <span className="text-sm font-normal ml-1" style={{ color: "var(--sk-t3)" }}>XOF</span>
        </div>
        <div className="text-[10px] mb-2" style={{ color: "var(--sk-t4)" }}>
          {cfg.model === "location"
            ? `= CA projeté − loyer mensuel (${cfg.daily_rent.toLocaleString("fr-FR")}/j × ${stats.daysInMonth}j)`
            : `= Brut ${platLabel()} − comm. ${platLabel()} (${cfg.comm_yango}%) − comm. partenaire (${cfg.comm_partner}%)`}
        </div>
        {cfg.model === "tiered" && (
          <div className="text-sm" style={{ color: "var(--sk-t3)" }}>Palier projeté : <span className="font-bold" style={{ color: "var(--tenant-color)" }}>{stats.tier.label}</span> → salaire <span className="font-mono font-bold" style={{ color: "#22c55e" }}>{xof(stats.tier.total_salary)}</span></div>
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
          <span style={{ color: "var(--sk-t4)" }}>Objectif: {xof(TARGET)}</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden mb-2" style={{ background: "var(--sk-surface)" }}>
          <div className="h-full rounded-full relative transition-all" style={{ width: `${mtdPct}%`, background: "linear-gradient(90deg,var(--tenant-color),#22c55e)" }}>
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
                <div className="text-sm font-mono font-bold" style={{ color: "var(--tenant-color)" }}>{Math.round(stats.avgKmPerDay)} km</div>
                <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>sur {stats.kmDataPoints} jours consécutifs</div>
              </div>
            )}
            {stats.avgDailyWalletBurn != null && (
              <div className="rounded-xl p-3" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>Commissions/jour</div>
                <div className="text-sm font-mono font-bold" style={{ color: "#ef4444" }}>{xof(Math.round(stats.avgDailyWalletBurn))}</div>
                <div className="text-[10px]" style={{ color: "var(--sk-t4)" }}>{`${platLabel()} + partenaire + frais`}</div>
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
            Rythme insuffisant. Il vous faut <strong>{xof(stats.needed - stats.dailyAvg)}/j de plus</strong> pour atteindre l'objectif.
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
              { label: `Loyer/jour`, value: xof(cfg.daily_rent), color: "var(--tenant-color)" },
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
            <div className="h-full rounded-full" style={{ width: `${stats.progress}%`, background: "var(--tenant-color)" }} />
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
                  <div className="w-2 h-2 rounded-full" style={{ background: isActive ? "#22c55e" : isProjected ? "var(--tenant-color)" : "var(--sk-border)" }} />
                  <span className="text-xs" style={{ color: isActive ? "#22c55e" : isProjected ? "var(--tenant-color)" : "var(--sk-t3)" }}>
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
          <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>CA net MTD : {xof(stats.mtdNet)} → votre part : <span style={{ color: "var(--tenant-color)" }}>{xof(stats.mtdNet * cfg.commission_rate)}</span></div>
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
                { label: bonusUnlocked ? "Bonus ✓ débloqué" : bonusProjected ? "Bonus ✓ projeté fin de mois" : `Bonus (seuil : ${xof(cfg.bonus_threshold)})`, value: xof(cfg.bonus_amount), color: bonusUnlocked ? "#22c55e" : bonusProjected ? "var(--tenant-color)" : "var(--sk-t4)" },
                ...(cfg.commission_rate > 0 ? [{ label: `Commission (${Math.round(cfg.commission_rate * 100)}%)`, value: xof(stats.projectedNet * cfg.commission_rate), color: "var(--tenant-color)" }] : []),
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
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (stats.mtdNet / cfg.bonus_threshold) * 100)}%`, background: "var(--tenant-color)" }} />
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
        {Icon && <Icon size={18} strokeWidth={2} style={{ color: "var(--tenant-color)" }} />}
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
      onFocus={(e) => { if (!disabled) e.currentTarget.style.borderColor = "var(--tenant-color)"; }}
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
      onFocus={(e) => { if (!disabled) e.currentTarget.style.borderColor = "var(--tenant-color)"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--sk-surface)"; }}
    />
  );
}

function BtnPrimary({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all"
      style={{ background: disabled ? "var(--sk-surface)" : "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))", color: disabled ? "var(--sk-t3)" : "#000", boxShadow: disabled ? "none" : "0 4px 20px rgba(var(--tenant-color-rgb),.2)" }}>
      {children}
    </button>
  );
}
