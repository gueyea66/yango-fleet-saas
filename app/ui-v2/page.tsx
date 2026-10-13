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
import { defaultPeriod, type AdminPeriod } from "@/lib/v2/periodFilter";
import DriverAppV2 from "@/components/v2/driver/DriverAppV2";
import { DEFAULT_CFG } from "@/components/driver/shared";
import AdminShellV2 from "@/components/v2/admin/AdminShellV2";
import { DashboardV2, DashViewToggle, useDashView } from "@/components/v2/admin/DashboardV2";
import { PendingV2 } from "@/components/v2/admin/PendingV2";
import { FinanceKpisV2, HistoryV2, TeamV2 } from "@/components/v2/admin/SectionsV2";
import { VehiclesSignalV2 } from "@/components/v2/admin/VehiclesSignalV2";
import { TendancesV2 } from "@/components/v2/admin/TendancesV2";
import { SaisieOperateurV2 } from "@/components/v2/admin/OperateurV2";
import { computeTrends, lastBuckets } from "@/lib/analytics/trends";
import type { SegmentFilter } from "@/lib/analytics/segment";
import { FLEET_SEG_OPTS } from "@/lib/v2/fleetScope";
import { RendementV2, type RendementPayload } from "@/components/v2/admin/RendementV2";
import { calculerRendement, type OrderRow } from "@/lib/analytics/rendement";
import { DeclarationsV2, type FiltreDeclarations } from "@/components/v2/admin/DeclarationsV2";
import { suiviDeclarations, cleCourses, type RapportLigne, type DepenseLigne } from "@/lib/analytics/declarations";

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

  if (uiV2 && screen === "rendement") {
    return <RendementDemo />;
  }

  if (uiV2 && screen === "declarations") {
    return <DeclarationsDemo />;
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

/**
 * Commandes fictives, tirées d'un générateur à graine fixe : deux pics de tarif,
 * un dimanche plus fluide, un chauffeur du soir. Sert à relire l'écran
 * Rendement sans base ; aucun nom ni chiffre réel.
 */
function commandesFictives(): OrderRow[] {
  let g = 20261013;
  const alea = () => ((g = (g * 1664525 + 1013904223) >>> 0) / 4294967296);
  const zones = [["GY", "Grand Yoff", 12, 1.05], ["ME", "Medina", 11, 1.12], ["NG", "Ngor-Almadies", 18, 0.92],
    ["SC", "Sacre Coeur", 13, 1.06], ["OKM", "Ouakam", 16, 0.9], ["HB", "Hann-Bel Air", 15, 1.0], ["LIB", "Sicap Liberte", 13, 1.04]] as const;
  const chauffeurs = [["c1", "Moussa Diop", 7, 17], ["c2", "Awa Ndiaye", 9, 20], ["c3", "Ibrahima Fall", 13, 23], ["c4", "Fatou Sarr", 6, 15]] as const;
  const out: OrderRow[] = [];
  const debut = Date.UTC(2026, 6, 6);
  for (let j = 0; j < 98; j++) {
    const js = j % 7;
    for (const [id, nom, h0, h1] of chauffeurs) {
      if (alea() < (js === 6 ? 0.55 : 0.12)) continue; // repos, plus fréquent le dimanche
      let t = debut + j * 86400000 + h0 * 3600000 + alea() * 1800000;
      const fin = debut + j * 86400000 + h1 * 3600000;
      while (t < fin) {
        const h = new Date(t).getUTCHours();
        const [code, commune, vBase, prime] = zones[Math.floor(alea() * zones.length)];
        const arrivee = zones[Math.floor(alea() * zones.length)];
        const pointe = h === 7 ? 1.1 : h >= 17 && h <= 18 ? 1.12 : h < 6 || h > 21 ? 0.86 : 0.97;
        const vitesse = vBase * (js === 6 ? 1.25 : h >= 17 && h <= 19 ? 0.72 : h < 7 ? 1.3 : 1);
        const km = 1.5 + alea() * 8, min = (km / vitesse) * 60;
        const base = { order_id: `f${out.length}`, yango_driver_id: id, driver_name: nom, plate: `AA10${id.slice(1)}SJ`,
          address_from: `Rue ${code}-${Math.ceil(alea() * 90)}, ${commune}, Dakar, Département de Dakar`,
          address_to: `Rue ${arrivee[0]}-${Math.ceil(alea() * 90)}, ${arrivee[1]}, Dakar, Département de Dakar`, service_class: "Éco" };
        if (alea() < 0.2) {
          out.push({ ...base, status: "Annulé", cancel_reason: "Course annulée par le client", started_at: new Date(t).toISOString(), ended_at: null, distance_m: null, tarif: null, commission: null });
          t += 240000;
          continue;
        }
        const tarif = Math.round((340 + 183 * km + 18 * min) * pointe * prime / 100) * 100;
        out.push({ ...base, status: "Terminé", cancel_reason: null, started_at: new Date(t).toISOString(), ended_at: new Date(t + min * 60000).toISOString(), distance_m: km * 1000, tarif, commission: -tarif * 0.15 });
        // de temps en temps, un long silence au milieu de la journée
        t += min * 60000 + (alea() < 0.045 ? (70 + alea() * 110) * 60000 : (2 + alea() * 7) * 60000);
      }
    }
  }
  return out;
}

/** Écran Déclarations hors connexion : quatorze jours fictifs, avec chaque type de manque. */
function DeclarationsDemo() {
  const [filtre, setFiltre] = useState<FiltreDeclarations>({ jours: 14, du: null, au: null, actifsSeulement: true, segment: "all" });
  const jours = 31;
  const data = (() => {
    let g = 77;
    const alea = () => ((g = (g * 1664525 + 1013904223) >>> 0) / 4294967296);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const jour = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const chauffeurs = [
      { id: "c1", full_name: "Moussa Diop", yango_driver_id: "y1", plate: "AA101SJ" },
      { id: "c2", full_name: "Awa Ndiaye", yango_driver_id: "y2", plate: "AA102SJ" },
      { id: "c3", full_name: "Ibrahima Fall", yango_driver_id: "y3", plate: "AA103SJ" },
      { id: "c4", full_name: "Fatou Sarr", yango_driver_id: "y4", plate: "AA104SJ", hire_date: jour(8) },
      { id: "c5", full_name: "Cheikh Ba", yango_driver_id: "y5", plate: "AA105SJ" },
      { id: "c6", full_name: "Omar Sy", yango_driver_id: "y6", plate: "AA106SJ", contract_end_date: jour(4) },
    ];
    const rapports: RapportLigne[] = [], depenses: DepenseLigne[] = [];
    const courses = new Map<string, number>();
    for (const c of chauffeurs) {
      const serieux = c.id === "c1" ? 1 : c.id === "c3" ? 0.6 : 0.88;
      for (let n = jours - 1; n >= 1; n--) {
        const d = jour(n), tirage = alea();
        if (tirage < 0.12) { rapports.push({ driver_id: c.id, date: d, status: "approved", comment: "[REPOS]", yango_gross: 0 }); if (c.id === "c5" && n === 3) courses.set(cleCourses(c.yango_driver_id, d), 11); continue; }
        courses.set(cleCourses(c.yango_driver_id, d), 14 + Math.floor(alea() * 8));
        if (alea() > serieux) continue; // rien déclaré alors que Yango a tourné
        if (c.id === "c2" && n === 5) { rapports.push({ driver_id: c.id, date: d, status: "approved", yango_gross: 0 }); courses.delete(cleCourses(c.yango_driver_id, d)); continue; }
        rapports.push({ driver_id: c.id, date: d, status: n <= 2 && alea() < 0.5 ? "submitted" : "approved", yango_gross: 28000 + Math.round(alea() * 14000), yango_trip_count: 18 });
        if (alea() < (c.id === "c5" ? 0.3 : 0.7)) depenses.push({ driver_id: c.id, category: "Carburant", amount: 8000, status: "approved", expense_date: d });
      }
    }
    const du = filtre.du ?? jour(filtre.jours - 1), au = filtre.au ?? aujourdhui;
    // fictif : les deux derniers chauffeurs roulent sur des véhicules externes
    const externe = new Set(["c4", "c5"]);
    const retenus = chauffeurs.filter((c) => filtre.segment === "all" || (filtre.segment === "partenaire") === externe.has(c.id));
    return { fenetre: filtre.du ? 0 : filtre.jours, actifsSeulement: filtre.actifsSeulement, segment: filtre.segment, mixte: true,
      ...suiviDeclarations({ chauffeurs: retenus, rapports, depenses, courses, du, au, aujourdhui, actifsSeulement: filtre.actifsSeulement }) };
  })();
  return (
    <main style={{ minHeight: "100vh", background: "var(--sk-deep)", padding: "28px 24px 80px" }}>
      <DeclarationsV2 data={data} filtre={filtre} onFiltre={setFiltre} loading={false} error={null} onRecharger={() => {}} />
    </main>
  );
}

/** Écran Rendement hors connexion : données du poste si présentes, sinon fictives. */
function RendementDemo() {
  const [data, setData] = useState<RendementPayload | null>(null);
  const [jours, setJours] = useState(90);
  useEffect(() => {
    let vivant = true;
    // Fichier local non versionné, produit par __tests__/local : absent partout ailleurs.
    fetch("/demo-rendement.local.json").then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => calculerRendement(commandesFictives()))
      .then((r) => { if (vivant) setData({ ...r, fenetre: 90 }); });
    return () => { vivant = false; };
  }, []);
  return (
    <main style={{ minHeight: "100vh", background: "var(--sk-deep)", padding: "28px 24px 80px" }}>
      <RendementV2 data={data} jours={jours} onJours={setJours} loading={false} error={null} />
    </main>
  );
}

/** Coque gestionnaire avec contenu fictif (tenant non-UUID : aucune donnée). */
function AdminShellDemo() {
  const [tab, setTab] = useState("dashboard");
  const [demoSeg, setDemoSeg] = useState<SegmentFilter>("all");
  const [demoHors, setDemoHors] = useState(true);
  const [period, setPeriod] = useState<AdminPeriod>(() => defaultPeriod(new Date()));
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [view, setView] = useDashView();
  return (
    <AdminShellV2
      tab={tab} onTab={setTab} appName="M3A Fleet Manager" operatorName="M3A Group" userName="Abdou · Admin" tenantId="demo-tenant"
      sessionError={null} onSignOut={() => {}} onReconnect={() => {}}
      headerRight={tab === "dashboard" ? <DashViewToggle view={view} onChange={setView} /> : undefined}
      filters={{
        period, onPeriodChange: setPeriod,
        drivers: DEMO_DRIVERS.map((d): { id: string; label: string; plate: string | null; active: boolean } => ({ id: d.id, label: d.full_name, plate: d.plate, active: d.active })).concat([{ id: "demo-d4", label: "Omar Fall", plate: null, active: false }]),
        driverIds, onDriverIdsChange: setDriverIds,
        segment: <Segmented options={FLEET_SEG_OPTS} value={demoSeg} onChange={setDemoSeg} ariaLabel="Type de véhicule" />,
      }}
    >
      {tab === "dashboard" ? (
        <DashboardV2 view={view} kpis={DEMO_KPIS} plat="Yango" tenantId="demo-tenant" driverIds={[]} onKpisChanged={() => {}} onOpenValidation={() => setTab("pending")}
          advanced={<Card style={{ minHeight: 200 }}>Sections actuelles (accordéons)</Card>} />
      ) : tab === "pending" ? (
        <PendingV2 reports={DEMO_REPORTS} expenses={DEMO_EXPENSES} loading={false} onRefresh={() => {}} />
      ) : tab === "vehicles" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <VehiclesSignalV2 demo={DEMO_FLEET} />
          <Card style={{ minHeight: 200, color: "var(--v2-muted)", fontSize: 14 }}>Gestion de flotte actuelle (FleetTab)</Card>
        </div>
      ) : tab === "kyc" ? (
        <TeamV2 drivers={DEMO_DRIVERS} onOpenHistory={() => setTab("history")}
          renderDocuments={() => <Card style={{ minHeight: 160, color: "var(--v2-muted)", fontSize: 14 }}>Documents KYC du chauffeur (composant actuel)</Card>} />
      ) : tab === "history" ? (
        <HistoryV2 reports={DEMO_HISTORY} drivers={DEMO_DRIVERS} loading={false} onRefresh={() => {}} />
      ) : tab === "saisie" ? (
        <SaisieOperateurV2 drivers={DEMO_DRIVERS} tenantId="demo-tenant" />
      ) : tab === "tendances" ? (
        <TendancesV2 driverIds={[]} segment={demoSeg} horsYango={demoHors} onHorsYango={setDemoHors} demo={DEMO_TRENDS} />
      ) : tab === "payments" || tab === "avances" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <FinanceKpisV2 kpis={{ ...DEMO_KPIS, expenseBreakdown: [...DEMO_KPIS.expenseBreakdown, { type: "💵 Salaires", amount: 690000, percent: 0 }] }} />
          <Card style={{ minHeight: 200, color: "var(--v2-muted)", fontSize: 14 }}>Onglet « {tab} » actuel</Card>
        </div>
      ) : (
        <Card style={{ minHeight: 320, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--v2-muted)", fontSize: 14 }}>
          Contenu actuel de l&apos;onglet « {tab} »
        </Card>
      )}
    </AdminShellV2>
  );
}

// Chiffres d'exemple de la maquette 2a (aucune donnée réelle).
const DEMO_DAYS = Array.from({ length: 23 }, (_, i) => {
  const brut = [62, 70, 0, 66, 74, 58, 69, 71, 0, 64, 60, 73, 68, 0, 75, 67, 63, 72, 0, 70, 65, 69, 66][i] * 1000;
  return { date: `2026-09-${String(i + 1).padStart(2, "0")}`, brutYango: brut * 0.92, horsYango: brut * 0.08, netRecettes: brut * 0.84, depenses: brut * 0.12, netFinal: brut * 0.72, km: 0, solde: 0, nbCourses: 0 };
});
const DEMO_KPIS = {
  loading: false, netFinal: 1214380, prevNetFinal: 1080000, joursOuvres: 19, prevJoursOuvres: 18, monthMarginPercent: 81.7,
  brutYango: 1368200, horsYango: 118000, tresorerie: 962150, decaissements: 320000,
  expenseBreakdown: [
    { type: "Carburant", amount: 142300, percent: 52.4 }, { type: "Solde Yango", amount: 61500, percent: 22.6 },
    { type: "Entretien", amount: 38000, percent: 14 }, { type: "Péage", amount: 18520, percent: 6.8 }, { type: "Lavage", amount: 11500, percent: 4.2 },
  ],
  dailyRows: DEMO_DAYS,
} as unknown as Parameters<typeof DashboardV2>[0]["kpis"];

// Éléments fictifs (identifiants non-UUID : toute écriture échouerait côté base).
const DEMO_REPORTS = [
  { id: "demo-r1", tenant_id: "demo-tenant", driver_id: "demo-d1", date: "2026-09-22", status: "submitted", created_at: new Date().toISOString(),
    _profile: { full_name: "Alioune Diagne" }, yango_cash: 52400, yango_card: 6800, yango_bonus: 4000, commission_amount: 9954, service_supplementaire: 0,
    off_yango_revenue: 945, net_after_expenses: 54191, yango_trip_count: 16, end_odometer: 151461, comment: "Bonne journée, trafic fluide" },
  { id: "demo-r2", tenant_id: "demo-tenant", driver_id: "demo-d2", date: "2026-09-22", status: "submitted", created_at: "2026-09-22T21:10:00Z",
    _profile: { full_name: "Moussa Diop" }, yango_cash: 41200, yango_card: 3800, yango_bonus: 2500, commission_amount: 7481, off_yango_revenue: 6000, net_after_expenses: 46019, yango_trip_count: 14 },
  { id: "demo-r3", tenant_id: "demo-tenant", driver_id: "demo-d3", date: "2026-09-22", status: "submitted", created_at: "2026-09-22T20:02:00Z",
    _profile: { full_name: "Ibrahima Sarr" }, yango_gross: 44000, yango_bonus: 0, commission_amount: 6930, off_yango_revenue: 1670, net_after_expenses: 38740 },
];
const DEMO_EXPENSES = [
  { id: "demo-e1", tenant_id: "demo-tenant", driver_id: "demo-d2", category: "Carburant", amount: 8000, expense_date: "2026-09-22", status: "submitted", profiles: { full_name: "Moussa Diop" }, description: "12L" },
  { id: "demo-e2", tenant_id: "demo-tenant", driver_id: "demo-d1", category: "Péage", amount: 1500, expense_date: "2026-09-22", status: "submitted", profiles: { full_name: "Alioune Diagne" } },
];

const DEMO_DRIVERS = [
  { id: "demo-d1", full_name: "Alioune Diagne", driver_id: "DRV002", plate: "DK-4410-BC", active: true, onboarding_status: "approved", city: "Dakar", joined_at: "2025-11-03" },
  { id: "demo-d2", full_name: "Moussa Diop", driver_id: "DRV001", plate: "AB-872-JG", active: true, onboarding_status: "in_review" },
  { id: "demo-d3", full_name: "Ibrahima Sarr", driver_id: "DRV003", plate: "DK-2291-AF", active: true, onboarding_status: "incomplete" },
];
const DEMO_HISTORY = DEMO_DRIVERS.flatMap((d, di) => Array.from({ length: 23 }, (_, i) => {
  const code = ["vvvvvvovvvvvvovvvvrvoav", "vvvvvovvvvvvovvvvvvvvaa", "vvrvvvovvvvvovvvvvovvrv"][di][i];
  if (code === "o") return { id: `h-${di}-${i}`, driver_id: d.id, date: `2026-09-${String(i + 1).padStart(2, "0")}`, status: "approved", comment: "[REPOS]", net_after_expenses: 0, tenant_id: "demo-tenant", _profile: { full_name: d.full_name } };
  const status = code === "v" ? "approved" : code === "a" ? "submitted" : "rejected";
  return { id: `h-${di}-${i}`, driver_id: d.id, date: `2026-09-${String(i + 1).padStart(2, "0")}`, status, tenant_id: "demo-tenant", _profile: { full_name: d.full_name },
    yango_cash: 41200, yango_card: 3800, yango_bonus: 2500, commission_amount: 7481, off_yango_revenue: 6000, net_after_expenses: 46019, yango_trip_count: 14 };
}));

const DEMO_FLEET = {
  vehicles: [
    { id: "v1", plate: "DK-4410-BC", name: "Toyota Corolla" }, { id: "v2", plate: "AB-872-JG", name: "Hyundai Accent" },
    { id: "v3", plate: "DK-2291-AF", name: "Kia Rio" }, { id: "v4", plate: "DK-7302-BB", name: "Suzuki Dzire" },
  ],
  devices: [
    { id: "g1", vehicleId: "v1", lastSeenAt: new Date(Date.now() - 3 * 60000).toISOString(), label: null, externalId: "868120" },
    { id: "g2", vehicleId: "v2", lastSeenAt: new Date(Date.now() - 40 * 60000).toISOString(), label: null, externalId: "868121" },
    { id: "g3", vehicleId: "v3", lastSeenAt: new Date(Date.now() - 5 * 3600000).toISOString(), label: null, externalId: "868122" },
  ],
};

// Tendances (vitrine) : 12 mois fictifs, 6 chauffeurs aux profils contrastés
const DEMO_TREND_DRIVERS = [
  { id: "t1", full_name: "Moussa Diop", base: 47_000 }, { id: "t2", full_name: "Awa Ndiaye", base: 42_000 },
  { id: "t3", full_name: "Cheikh Fall", base: 38_500 }, { id: "t4", full_name: "Ibrahima Sarr", base: 34_000 },
  { id: "t5", full_name: "Fatou Ba", base: 29_000 }, { id: "t6", full_name: "Omar Seck", base: 44_000 },
];
const DEMO_TRENDS = (() => {
  const buckets = lastBuckets("2026-10-02", "mois", 12);
  const reports: { driver_id: string; date: string; yango_gross: number; yango_trip_count: number; net_after_expenses: number }[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  buckets.forEach((b, bi) => {
    const start = new Date(`${b.from}T00:00:00Z`), end = new Date(`${b.to > "2026-10-02" ? "2026-10-02" : b.to}T00:00:00Z`);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      for (const drv of DEMO_TREND_DRIVERS) {
        if (rnd() < 0.18) continue; // repos
        const saison = 1 + 0.08 * Math.sin((bi / 12) * Math.PI * 2);
        const ca = Math.round(drv.base * saison * (0.7 + rnd() * 0.6));
        reports.push({ driver_id: drv.id, date: d.toISOString().slice(0, 10), yango_gross: ca, yango_trip_count: Math.round(ca / 2300), net_after_expenses: Math.round(ca * 0.78) });
      }
    }
  });
  return computeTrends({ reports, drivers: DEMO_TREND_DRIVERS, objectif: 40_000, granularite: "mois", buckets, today: "2026-10-02" });
})();
