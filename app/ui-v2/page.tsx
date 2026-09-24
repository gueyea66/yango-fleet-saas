"use client";

import { useEffect, useState } from "react";
import { House, ClipboardList, Receipt, Gauge, ScanLine, BedDouble, History, Check } from "lucide-react";
import {
  Card, CardTitle, Overline, Stat, Segmented, ListRow, StatusDot, BottomNav, FilterBar,
  Badge, CalcBadge, AiBadge, CountBadge, Button,
} from "@/components/ui";
import { useUiV2 } from "@/components/v2/useUiV2";
import { formatAmount } from "@/lib/v2/format";
import { periodRange, type FilterPeriod } from "@/lib/v2/filters";
import DriverAppV2 from "@/components/v2/driver/DriverAppV2";
import { DEFAULT_CFG } from "@/components/driver/shared";
import AdminShellV2 from "@/components/v2/admin/AdminShellV2";

// Profil fictif : identifiants non-UUID → toute requête Supabase échoue côté
// base (aucune lecture ni écriture possible). Sert à relire la mise en page.
const DEMO_PROFILE = { id: "demo-chauffeur", driver_id: "DRV001", full_name: "Moussa Diop", role: "driver", tenant_id: "demo-tenant" };

/**
 * Planche des composants partagés de la refonte v2 (étape 0) — sert à la
 * relecture visuelle. Données fictives, aucune lecture/écriture.
 * Visible uniquement drapeau allumé (localStorage m3a-ui=v2 ou tenant ui_v2).
 */
export default function UiV2Showcase() {
  const uiV2 = useUiV2();
  const [period, setPeriod] = useState<FilterPeriod>("mois");
  const [range, setRange] = useState(() => periodRange("mois", new Date()));
  const [driverId, setDriverId] = useState("");
  const [tab, setTab] = useState<"home" | "report" | "expense" | "pilotage">("home");
  const drivers = [
    { id: "d1", label: "Moussa Diop" },
    { id: "d2", label: "Awa Ndiaye" },
    { id: "d3", label: "Ibrahima Fall" },
  ];

  const [screen, setScreen] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture de l'URL après montage
    setScreen(new URLSearchParams(window.location.search).get("ecran"));
  }, []);

  if (uiV2 && screen === "chauffeur") {
    return <DriverAppV2 profile={DEMO_PROFILE} cfg={DEFAULT_CFG} onSignOut={() => {}} />;
  }

  if (uiV2 && screen === "admin") {
    return <AdminShellDemo />;
  }

  if (!uiV2) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--sk-deep)", color: "var(--sk-t2)", fontSize: 14 }}>
        Aperçu indisponible.
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--sk-deep)", color: "var(--sk-t1)", padding: "24px 28px 96px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <Overline>Refonte UI v2 · étape 0</Overline>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.01em", margin: "4px 0 0" }}>Composants partagés</h1>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Overline>FilterBar</Overline>
        <FilterBar
          period={period}
          onPeriodChange={(p) => { setPeriod(p); setRange(periodRange(p, new Date())); }}
          range={range}
          onRangeChange={setRange}
          drivers={drivers}
          driverId={driverId}
          onDriverChange={setDriverId}
        />
        <FilterBar range={range} onRangeChange={setRange} drivers={drivers} driverId="d1" onDriverChange={setDriverId} />
        <div style={{ maxWidth: 396 }}>
          <FilterBar variant="chips" drivers={drivers} driverId={driverId} onDriverChange={setDriverId} />
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Card><Stat label="Net final" value={formatAmount(1284500)} unit="XOF" tone="positive" size="hero" sub="+12 % vs août · marge 38 %" /></Card>
        <Card><Stat label="Total recettes" value={formatAmount(3372000)} unit="XOF" size="lg" /></Card>
        <Card><Stat label="Trésorerie nette" value={formatAmount(946000)} unit="XOF" size="lg" badge={<CalcBadge />} /></Card>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <Segmented options={[{ key: "simple", label: "Simple" }, { key: "avance", label: "Avancé" }]} value="simple" onChange={() => {}} />
        <Badge tone="wait">à vérifier</Badge>
        <Badge tone="ok">Validé</Badge>
        <Badge tone="neg">Rejeté</Badge>
        <Badge tone="brand">NOUVEAU</Badge>
        <AiBadge />
        <CalcBadge />
        <CountBadge count={5} />
        <StatusDot tone="ok" label="Signal récent" />
        <StatusDot tone="accent" label="Signal ancien" />
        <StatusDot tone="idle" label="Sans boîtier" />
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Button icon={Check} variant="validate">Valider et suivant</Button>
        <Button variant="danger">Rejeter</Button>
        <Button variant="outline">Exporter CSV</Button>
        <Button size="sm">Renouveler</Button>
        <Button disabled>Indique un montant</Button>
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <div style={{ width: "min(396px, 100%)", border: "1px solid var(--sk-surface)", borderRadius: 18, overflow: "hidden", background: "var(--sk-deep)" }}>
          <div style={{ padding: "24px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Mardi 23 septembre</div>
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.01em", marginTop: 2 }}>Bonsoir Moussa</div>
            </div>
            <Card mobile style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StatusDot tone="wait" />
                <div style={{ fontSize: 15, fontWeight: 600 }}>Ton rapport du jour n&apos;est pas encore envoyé</div>
              </div>
              <Button size="xl" icon={ScanLine} block>Faire mon rapport</Button>
            </Card>
            <Card mobile padding="20px 16px">
              <Overline>Il vous manque</Overline>
              <div className="v2-num" style={{ fontSize: 28, fontWeight: 600, color: "var(--fleet-accent)", letterSpacing: "-.02em" }}>
                {formatAmount(412500)} <span style={{ fontSize: 14, color: "var(--v2-muted)" }}>XOF</span>
              </div>
            </Card>
            <Card mobile flush>
              <ListRow icon={Receipt} label="Ajouter une dépense" chevron onClick={() => {}} />
              <ListRow icon={BedDouble} label="Repos" chevron onClick={() => {}} />
              <ListRow icon={History} label="Historique" chevron divider={false} onClick={() => {}} />
            </Card>
          </div>
          <BottomNav
            fixed={false}
            active={tab}
            onChange={setTab}
            items={[
              { key: "home", label: "Accueil", icon: House },
              { key: "report", label: "Rapport", icon: ClipboardList },
              { key: "expense", label: "Dépense", icon: Receipt },
              { key: "pilotage", label: "Pilotage", icon: Gauge },
            ]}
          />
        </div>
        <Card style={{ width: "min(360px, 100%)" }} flush>
          <div style={{ padding: "14px 16px" }}><CardTitle style={{ marginBottom: 0 }} right={<Badge tone="wait">3</Badge>}>À valider</CardTitle></div>
          <ListRow label="Moussa Diop" sub="Rapport · 23/09" selected trailing={<span className="v2-num" style={{ fontSize: 14 }}>{formatAmount(46019)}</span>} onClick={() => {}} />
          <ListRow label="Awa Ndiaye" sub="Dépense · Carburant" trailing={<span className="v2-num" style={{ fontSize: 14 }}>{formatAmount(8000)}</span>} onClick={() => {}} />
          <ListRow label="Ibrahima Fall" sub="Rapport · 22/09" tone="wait" divider={false} trailing={<Badge tone="wait">à vérifier</Badge>} />
        </Card>
      </section>
    </main>
  );
}

/** Coque gestionnaire avec contenu fictif (tenant non-UUID : aucune donnée). */
function AdminShellDemo() {
  const [tab, setTab] = useState("dashboard");
  const [period, setPeriod] = useState<FilterPeriod>("mois");
  const [driverId, setDriverId] = useState("");
  const range = periodRange(period, new Date());
  return (
    <AdminShellV2
      tab={tab} onTab={setTab} appName="M3A Fleet Manager" operatorName="M3A Group" userName="Abdou · Admin" tenantId="demo-tenant"
      sessionError={null} onSignOut={() => {}} onReconnect={() => {}}
      filters={{
        period, onPeriodChange: setPeriod, range,
        drivers: [{ id: "d1", label: "Moussa Diop" }, { id: "d2", label: "Awa Ndiaye" }], driverId, onDriverChange: setDriverId,
      }}
    >
      <Card style={{ minHeight: 320, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--v2-muted)", fontSize: 14 }}>
        Contenu actuel de l&apos;onglet « {tab} » (inchangé à cette étape)
      </Card>
    </AdminShellV2>
  );
}
