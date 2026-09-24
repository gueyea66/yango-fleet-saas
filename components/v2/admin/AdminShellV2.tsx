"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Inbox, Gauge, Car, Users, Wallet, History, Settings, LogOut, Moon, Sun, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandShell";
import NotificationBell from "@/components/NotificationBell";
import { CountBadge, FilterBar, Segmented, type FilterDriver } from "@/components/ui";
import { ADMIN_DESTINATIONS, destinationFor, entryTab, type AdminDestination } from "@/lib/v2/adminNav";
import type { FilterPeriod } from "@/lib/v2/filters";
import { initials } from "@/lib/v2/format";
import { useAdminShellData } from "./useAdminShellData";

const ICONS: Record<AdminDestination, LucideIcon> = {
  dash: LayoutDashboard, valid: Inbox, pilot: Gauge, fleet: Car, team: Users, fin: Wallet, hist: History, set: Settings,
};

export interface AdminShellFilters {
  period?: FilterPeriod;
  onPeriodChange?: (p: FilterPeriod) => void;
  range?: { from: string; to: string };
  drivers: FilterDriver[];
  driverId: string;
  onDriverChange: (id: string) => void;
}

/**
 * Coque gestionnaire v2 (Admin.dc.html + Admin Sidebar.dc.html) :
 * sidebar 224 px à 8 destinations, en-tête avec sous-onglets et FilterBar,
 * carte d'essai en bas de sidebar. Le contenu des onglets est celui de l'UI
 * actuelle, passé en enfant sans modification.
 */
export default function AdminShellV2({
  tab, onTab, appName, operatorName, userName, tenantId, filters, sessionError, onSignOut, onReconnect, advancedBack, headerRight, children,
}: {
  tab: string;
  onTab: (t: string) => void;
  appName: string;
  operatorName?: string | null;
  userName: string;
  tenantId: string | null;
  filters: AdminShellFilters;
  sessionError: string | null;
  onSignOut: () => void;
  onReconnect: () => void;
  advancedBack?: () => void;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const dest = destinationFor(tab);
  const { trial, pending } = useAdminShellData(tenantId, tab);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- préférence d'appareil lue après montage
      if (localStorage.getItem("m3a-theme") === "light") setTheme("light");
    } catch { /* sombre */ }
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("m3a-theme", next); } catch { /* best-effort */ }
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  };

  const open = (d: (typeof ADMIN_DESTINATIONS)[number]) => {
    const e = entryTab(d);
    if (e.route) router.push(e.route);
    else onTab(e.tab);
  };
  const openSub = (t: string) => {
    const s = dest.subTabs.find((x) => x.tab === t);
    if (s?.route) router.push(s.route);
    else onTab(t);
  };

  const trialVisible = trial && trial.status.state === "warning";
  const f = dest.filter;
  const showFilters = (f.period || f.dates || f.driver) && filters.drivers.length > 0;

  const navItem = (d: (typeof ADMIN_DESTINATIONS)[number]) => {
    const Icon = ICONS[d.key];
    const active = d.key === dest.key;
    return (
      <button key={d.key} type="button" onClick={() => open(d)} aria-current={active ? "page" : undefined} className="v2-focus"
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", height: d.secondary ? 34 : 38, padding: "0 10px",
          borderRadius: 9, border: "none", cursor: "pointer", fontSize: d.secondary ? 13 : 14, textAlign: "left",
          background: active ? "var(--v2-select-bg)" : "transparent",
          color: active ? "var(--tenant-color)" : d.secondary ? "var(--sk-t2)" : "var(--v2-nav-inactive)",
        }}>
        <Icon size={d.secondary ? 16 : 17} aria-hidden style={{ flex: "none" }} />
        <span style={{ flex: 1 }}>{d.label}</span>
        {d.key === "valid" && pending != null && <CountBadge count={pending} />}
      </button>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--sk-deep)", color: "var(--sk-t1)" }}>
      {/* ── Sidebar desktop ── */}
      <aside className="hidden lg:flex" style={{ position: "fixed", inset: "0 auto 0 0", width: 224, zIndex: 50, flexDirection: "column", background: "var(--sk-bg)", borderRight: "1px solid var(--sk-surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 16px 16px" }}>
          <BrandLogo size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{appName}</div>
            <div style={{ fontSize: 11, color: "var(--sk-t2)" }}>{operatorName || "M3A Solution"}</div>
          </div>
        </div>
        <nav aria-label="Navigation gestionnaire" style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 10px" }}>
            {ADMIN_DESTINATIONS.filter((d) => !d.secondary).map(navItem)}
          </div>
          <div style={{ height: 1, background: "var(--sk-surface)", margin: "8px 16px" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 10px" }}>
            {ADMIN_DESTINATIONS.filter((d) => d.secondary).map(navItem)}
            {advancedBack && (
              <button type="button" onClick={advancedBack} className="v2-focus"
                style={{ height: 34, padding: "0 10px", marginTop: 6, borderRadius: 9, border: "1px dashed var(--sk-surface)", background: "none", color: "var(--sk-t2)", fontSize: 13, textAlign: "left", cursor: "pointer" }}>
                ← Revenir au mode simple
              </button>
            )}
          </div>
        </nav>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {trialVisible && trial.status.state === "warning" && (
            <div style={{
              display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 10,
              background: trial.status.daysLeft <= 3 ? "var(--v2-wait-bg)" : "rgba(34,197,94,.08)",
              border: `1px solid ${trial.status.daysLeft <= 3 ? "var(--v2-wait-bd)" : "rgba(34,197,94,.22)"}`,
            }}>
              <span style={{ fontSize: 12, color: trial.status.daysLeft <= 3 ? "var(--v2-warning-ink)" : "var(--fleet-positive)", whiteSpace: "nowrap" }}>
                Accès · {trial.status.daysLeft} jour{trial.status.daysLeft > 1 ? "s" : ""} restant{trial.status.daysLeft > 1 ? "s" : ""}
              </span>
              <a href="/paiement" className="v2-btn v2-btn-fill v2-focus"
                style={{ height: 32, borderRadius: 8, background: "var(--v2-validate)", color: "var(--v2-validate-ink)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
                Renouveler
              </a>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px" }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--sk-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "var(--sk-t2)", flex: "none" }}>{initials(userName)}</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</div>
            <NotificationBell />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"} className="v2-focus"
              style={{ flex: "none", width: 34, height: 32, borderRadius: 8, border: "1px solid var(--sk-surface)", background: "none", color: "var(--sk-t2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
            </button>
            <button type="button" onClick={onSignOut} className="v2-focus"
              style={{ flex: 1, height: 32, borderRadius: 8, border: "1px solid var(--sk-surface)", background: "none", color: "var(--v2-negative-ink)", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <LogOut size={14} aria-hidden />Déconnexion
            </button>
          </div>
        </div>
      </aside>

      {/* ── Barre mobile ── */}
      <div className="lg:hidden" style={{ position: "sticky", top: 0, zIndex: 50, background: "var(--sk-bg)", borderBottom: "1px solid var(--sk-surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px 8px 16px" }}>
          <BrandLogo size={28} />
          <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{appName}</span>
          <NotificationBell />
          <button type="button" onClick={onSignOut} aria-label="Déconnexion" className="v2-focus" style={{ width: 44, height: 44, background: "none", border: "none", color: "var(--sk-t2)", cursor: "pointer" }}><LogOut size={18} aria-hidden /></button>
        </div>
        <nav aria-label="Navigation gestionnaire" style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none" }}>
          {ADMIN_DESTINATIONS.map((d) => {
            const Icon = ICONS[d.key];
            const active = d.key === dest.key;
            return (
              <button key={d.key} type="button" onClick={() => open(d)} aria-current={active ? "page" : undefined}
                style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, height: 44, padding: "0 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap",
                  color: active ? "var(--tenant-color)" : "var(--sk-t2)", boxShadow: active ? "inset 0 -2px 0 var(--tenant-color)" : undefined }}>
                <Icon size={16} aria-hidden />{d.label}
                {d.key === "valid" && pending != null && <CountBadge count={pending} />}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Contenu ── */}
      <main className="lg:pl-[224px]" style={{ minWidth: 0 }}>
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 18 }} className="max-lg:p-4!">
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.01em", margin: 0, flex: "1 1 auto" }}>{dest.label}</h1>
            {showFilters && (
              <FilterBar
                period={f.period ? filters.period : undefined}
                onPeriodChange={f.period ? filters.onPeriodChange : undefined}
                periodOptions={["mois", "annee"]}
                range={f.period || f.dates ? filters.range : undefined}
                drivers={f.driver ? filters.drivers : undefined}
                driverId={filters.driverId}
                onDriverChange={f.driver ? filters.onDriverChange : undefined}
              />
            )}
            {headerRight}
          </div>
          {dest.subTabs.length > 1 && !dest.menu && (
            <Segmented options={dest.subTabs.map((s) => ({ key: s.tab, label: s.label }))} value={tab} onChange={openSub} ariaLabel={`Sections — ${dest.label}`} style={{ alignSelf: "flex-start" }} />
          )}
          {sessionError && (
            <div role="alert" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, background: "var(--v2-neg-bg)", border: "1px solid var(--v2-neg-bd)" }}>
              <TriangleAlert size={18} aria-hidden style={{ color: "var(--v2-negative-ink)", flex: "none" }} />
              <div style={{ flex: 1, fontSize: 13 }}>
                <b style={{ color: "var(--v2-negative-ink)" }}>{sessionError}</b>
                <div style={{ color: "var(--sk-t2)", marginTop: 2 }}>Vos données sont intactes — reconnectez-vous pour y accéder.</div>
              </div>
              <button type="button" onClick={onReconnect} className="v2-btn v2-btn-fill v2-focus"
                style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "none", background: "var(--fleet-negative)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Se reconnecter
              </button>
            </div>
          )}
          {dest.menu ? (
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]" style={{ gap: 20, alignItems: "start" }}>
              <nav aria-label={`Sections — ${dest.label}`} style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6, borderRadius: 12, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
                {dest.subTabs.map((s) => {
                  const on = s.tab === tab;
                  return (
                    <button key={s.tab} type="button" onClick={() => openSub(s.tab)} aria-current={on ? "page" : undefined} className="v2-focus"
                      style={{ height: 36, padding: "0 12px", borderRadius: 8, border: "none", textAlign: "left", cursor: "pointer", fontSize: 14,
                        background: on ? "var(--sk-surface)" : "transparent", color: on ? "var(--sk-t1)" : "var(--sk-t2)", fontWeight: on ? 600 : 400 }}>
                      {s.label}
                    </button>
                  );
                })}
              </nav>
              <div style={{ minWidth: 0 }}>{children}</div>
            </div>
          ) : (
            <div style={{ minWidth: 0 }}>{children}</div>
          )}
        </div>
      </main>
    </div>
  );
}
