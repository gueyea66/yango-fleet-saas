"use client";

import { useState } from "react";
import { House, ClipboardList, Receipt, Gauge, UserRound } from "lucide-react";
import { BottomNav } from "@/components/ui";
import { BrandLogo } from "@/components/brand/BrandShell";
import NotificationBell from "@/components/NotificationBell";
import PushOnboarding from "@/components/PushOnboarding";
import type { Cfg, Profile } from "@/components/driver/shared";
import { useAiScan } from "@/components/driver/useAiScan";
import { bottomNavFor, type DriverNavTab, type DriverTab } from "@/lib/v2/driver";
import { initials } from "@/lib/v2/format";
import { HomeV2 } from "./HomeV2";
import { ReportV2 } from "./ReportV2";
import { ExpenseV2 } from "./ExpenseV2";
import { PilotageV2 } from "./PilotageV2";
import { CalendarV2 } from "./CalendarV2";
import { ProfilV2 } from "./ProfilV2";
import { ScreenBody } from "./parts";

const NAV = [
  { key: "home" as const, label: "Accueil", icon: House },
  { key: "report" as const, label: "Rapport", icon: ClipboardList },
  { key: "expense" as const, label: "Dépense", icon: Receipt },
  { key: "pilotage" as const, label: "Pilotage", icon: Gauge },
];

const noop = () => {};

/**
 * App chauffeur v2 (Driver.dc.html) — rendue par app/driver/page.tsx quand le
 * drapeau ui_v2 est allumé, après le chargement du profil (inchangé).
 * Le type d'onglet garde ses 7 valeurs ; la barre du bas n'en montre que 4.
 */
export default function DriverAppV2({ profile, cfg, onSignOut }: { profile: Profile; cfg: Cfg; onSignOut: () => void }) {
  const [tab, setTab] = useState<DriverTab>("home");
  // Sonde de l'extraction vision (GET) : adapte l'aide de l'Accueil.
  const { enabled: aiEnabled } = useAiScan("", noop);
  const nav = bottomNavFor(tab);

  const go = (t: DriverTab) => {
    setTab(t);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };

  let screen: React.ReactNode;
  switch (tab) {
    case "home":
      screen = (
        <>
          <header style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 64, padding: "10px 12px 10px 16px", background: "var(--sk-bg)", borderBottom: "1px solid var(--sk-surface)", flex: "none" }}>
            <BrandLogo size={32} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.full_name}</div>
            <div style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}><NotificationBell /></div>
            <button type="button" onClick={() => go("profil")} aria-label="Mon profil et documents" className="v2-focus"
              style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: "var(--sk-t2)", borderRadius: 22 }}>
              {profile.full_name ? (
                <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--sk-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "var(--sk-t2)" }}>{initials(profile.full_name)}</span>
              ) : <UserRound size={22} aria-hidden />}
            </button>
          </header>
          <ScreenBody>
            <HomeV2 profile={profile} cfg={cfg} aiEnabled={aiEnabled} onNav={go} />
          </ScreenBody>
        </>
      );
      break;
    case "report":
      screen = <ReportV2 profile={profile} cfg={cfg} onNav={go} />;
      break;
    case "expense":
      screen = <ExpenseV2 profile={profile} onNav={go} />;
      break;
    case "pilotage":
      screen = <PilotageV2 profile={profile} cfg={cfg} />;
      break;
    case "history":
      screen = <CalendarV2 profile={profile} onBack={() => go("home")} />;
      break;
    case "repos":
      screen = <CalendarV2 profile={profile} onBack={() => go("home")} startWithRepos />;
      break;
    case "profil":
      screen = <ProfilV2 profile={profile} onBack={() => go("home")} onSignOut={onSignOut} />;
      break;
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--sk-deep)", color: "var(--sk-t1)", display: "flex", justifyContent: "center" }}>
      <PushOnboarding role="driver" />
      <div style={{ width: "100%", maxWidth: 520, height: "100dvh", display: "flex", flexDirection: "column", background: "var(--sk-deep)", borderLeft: "1px solid var(--sk-bg)", borderRight: "1px solid var(--sk-bg)" }}>
        {/* key : chaque onglet repart de son état initial, comme l'UI actuelle */}
        <div key={tab} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{screen}</div>
        {nav.visible && <BottomNav<DriverNavTab> fixed={false} items={NAV} active={nav.active} onChange={go} />}
      </div>
    </div>
  );
}
