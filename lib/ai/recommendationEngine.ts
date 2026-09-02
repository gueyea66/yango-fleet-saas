/**
 * Moteur de recommandations — règles 100% déterministes, quantifiées en FCFA.
 * 4 règles Phase 1 (la 5e du catalogue, temps_morts, attend une donnée
 * d'activité horaire qui n'existe pas encore dans le SaaS — non implémentée).
 * Le LLM n'intervient PAS ici : les titres sont des gabarits, les montants
 * viennent des agrégats et de lib/calc.ts.
 */
import { AI_CALC_VERSION, RuleId } from "./types";
import { isDriverActiveOn } from "./dataReader";
import type { RawDriver, RawExpense, RawReport, TenantWindow } from "./dataReader";
import { achatsCarburantPeriode, isReposReport, kmPeriode, provisionsSoldePeriode, soldeConsommePeriode } from "./dataReader";
import { coutCarburantParKm, joursCalendaires, joursOuvresProjetes, joursOuvresRealises } from "@/lib/calc";
import type { SalaryTier } from "@/lib/tenant/types";
import { paramsHash } from "./insightEngine";

export interface RecoDraft {
  rule_id: RuleId;
  driver_id: string | null;
  priority: "HIGH" | "MEDIUM" | "LOW";
  impact_fcfa: number;
  title_fr: string;
  detail_fr: string | null;
  action_context: Record<string, unknown>;
  calculation_source: { function: string; version: string; params_hash: string };
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
};
const fmt = (v: number) => new Intl.NumberFormat("fr-FR").format(Math.round(v));
const approved = (r: RawReport) => r.status === "approved" || r.status === "submitted";

function src(fn: string, tenantId: string, from: string, to: string) {
  return { function: fn, version: AI_CALC_VERSION, params_hash: paramsHash(tenantId, from, to) };
}

export interface RecoContext {
  tenantId: string;
  today: string;              // YYYY-MM-DD (UTC = heure de Dakar)
  win: TenantWindow;
  salaryTiers: SalaryTier[];  // grille paliers du tenant (vide si non-tiered)
  thresholds: { carburant_km_delta_pct: number };
}

/** CA (recettes) d'un chauffeur sur [from, to]. */
function caDriver(reports: RawReport[], driverId: string, from: string, to: string): number {
  return reports
    .filter((r) => r.driver_id === driverId && approved(r) && r.date >= from && r.date <= to)
    .reduce((s, r) => s + n(r.yango_gross) + n(r.yango_bonus) + n(r.off_yango_revenue), 0);
}

/* ── Règle 1 : palier_a_risque ──────────────────────────────────────── */
export function rulePalierARisque(ctx: RecoContext): RecoDraft[] {
  if (!ctx.salaryTiers.length) return [];
  const monthStart = ctx.today.slice(0, 8) + "01";
  const [y, m] = ctx.today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayOfMonth = Number(ctx.today.slice(8, 10));
  const daysElapsed = Math.max(1, dayOfMonth);
  const daysRemaining = daysInMonth - dayOfMonth;
  if (daysRemaining < 3 || daysElapsed < 7) return []; // trop tôt / trop tard pour agir

  const tiers = [...ctx.salaryTiers].sort((a, b) => a.min_net - b.min_net);
  const out: RecoDraft[] = [];

  const joursOuvresRestants = joursOuvresProjetes(shiftDays(ctx.today, 1), `${ctx.today.slice(0, 8)}${String(daysInMonth).padStart(2, "0")}`);
  for (const d of ctx.win.drivers) {
    if (!isDriverActiveOn(d, ctx.today)) continue; // contrat terminé = plus de recos
    const mtd = caDriver(ctx.win.reports, d.id, monthStart, ctx.today);
    if (mtd <= 0) continue;
    // Rythme sur jours OUVRÉS écoulés du chauffeur (démarrage réel, repos
    // [REPOS] déduits) : les jours calendaires écrasaient la projection.
    const rr = ctx.win.reports.filter((r) => r.driver_id === d.id && approved(r)
      && r.date >= monthStart && r.date <= ctx.today);
    const debut = rr.length ? rr.reduce((min, r) => (r.date < min ? r.date : min), ctx.today) : monthStart;
    const reposDates = rr.filter(isReposReport).map((r) => r.date);
    const joursTravailles = Math.max(1, joursOuvresRealises(debut, ctx.today, reposDates));
    const projete = Math.round(mtd + (mtd / joursTravailles) * joursOuvresRestants);

    // Palier cible = premier palier strictement au-dessus de la projection,
    // considéré "à risque mais atteignable" si le manque ≤ 15% du palier.
    const cible = tiers.find((t) => t.min_net > projete && t.min_net > 0);
    if (!cible) continue;
    const manque = cible.min_net - projete;
    if (manque > cible.min_net * 0.15) continue;

    const projTier = [...tiers].reverse().find((t) => projete >= t.min_net);
    const perteSalaire = cible.total_salary - (projTier?.total_salary ?? 0);

    out.push({
      rule_id: "palier_a_risque",
      driver_id: d.id,
      priority: "HIGH",
      impact_fcfa: Math.max(perteSalaire, 0),
      title_fr: `${d.full_name ?? "Chauffeur"} risque de manquer le palier « ${cible.label} » de ${fmt(manque)} FCFA`,
      detail_fr:
        `CA du mois : ${fmt(mtd)} FCFA en ${joursTravailles} j travaillés. Projection fin de mois : ${fmt(projete)} FCFA ` +
        `pour un palier à ${fmt(cible.min_net)} FCFA. Il reste ${daysRemaining} j pour combler ${fmt(manque)} FCFA ` +
        `(≈ ${fmt(manque / daysRemaining)} FCFA/j de plus).`,
      action_context: {
        driver_name: d.full_name, ca_mtd_fcfa: Math.round(mtd), ca_projete_fcfa: projete,
        palier_cible_fcfa: cible.min_net, montant_manquant_fcfa: manque,
        jours_restants: daysRemaining, action: "contact_driver",
      },
      calculation_source: src("rulePalierARisque", ctx.tenantId, monthStart, ctx.today),
    });
  }
  return out;
}

/* ── Règle 2 : carburant_derive ─────────────────────────────────────── */
export function ruleCarburantDerive(ctx: RecoContext): RecoDraft[] {
  const to = ctx.today;
  const from7 = shiftDays(to, -6);
  const from30 = shiftDays(to, -29);

  const km7 = kmPeriode(ctx.win.reports, from7, to);
  const km30 = kmPeriode(ctx.win.reports, from30, to);
  if (km7 < 50 || km30 < 200) return []; // pas assez de données

  const cout7 = coutCarburantParKm(achatsCarburantPeriode(ctx.win.expenses, from7, to), km7);
  const cout30 = coutCarburantParKm(achatsCarburantPeriode(ctx.win.expenses, from30, to), km30);
  if (cout30 <= 0) return [];

  const hausse = ((cout7 - cout30) / cout30) * 100;
  if (hausse < ctx.thresholds.carburant_km_delta_pct) return [];

  const impact = Math.round((cout7 - cout30) * km7);
  return [{
    rule_id: "carburant_derive",
    driver_id: null,
    priority: "MEDIUM",
    impact_fcfa: impact,
    title_fr: `Coût carburant/km en hausse de ${Math.round(hausse)}% sur 7 jours : surcoût ≈ ${fmt(impact)} FCFA`,
    detail_fr:
      `Coût 7 derniers jours : ${cout7.toFixed(1)} FCFA/km vs moyenne 30 j : ${cout30.toFixed(1)} FCFA/km ` +
      `sur ${fmt(km7)} km. Vérifier les pleins déclarés (litres, reçus) et les trajets improductifs.`,
    action_context: {
      cout_7j_fcfa_km: Math.round(cout7 * 10) / 10, cout_30j_fcfa_km: Math.round(cout30 * 10) / 10,
      km_7j: km7, action: "review_fuel_log",
    },
    calculation_source: src("ruleCarburantDerive", ctx.tenantId, from7, to),
  }];
}

/* ── Règle 3 : rapport_manquant (J-1, complète la relance existante) ─── */
export function ruleRapportManquant(ctx: RecoContext): RecoDraft[] {
  const j1 = shiftDays(ctx.today, -1);
  const out: RecoDraft[] = [];

  for (const d of ctx.win.drivers) {
    if (!isDriverActiveOn(d, ctx.today)) continue; // contrat terminé = plus de recos
    const hasReport = ctx.win.reports.some((r) => r.driver_id === d.id && r.date === j1);
    if (hasReport) continue;

    // Moyenne sur les 7 derniers jours TRAVAILLÉS : un [REPOS] (CA 0) dans la
    // fenêtre sous-estimerait le CA « perdu » du rapport manquant.
    const last7 = ctx.win.reports
      .filter((r) => r.driver_id === d.id && approved(r) && !isReposReport(r) && r.date < j1)
      .slice(-7);
    if (!last7.length) continue; // jamais rapporté → onboarding, pas une anomalie

    const caEstime = Math.round(
      last7.reduce((s, r) => s + n(r.yango_gross) + n(r.yango_bonus) + n(r.off_yango_revenue), 0) / last7.length
    );

    out.push({
      rule_id: "rapport_manquant",
      driver_id: d.id,
      priority: "HIGH",
      impact_fcfa: caEstime,
      title_fr: `Rapport du ${j1} manquant pour ${d.full_name ?? "un chauffeur"} — CA estimé non déclaré ≈ ${fmt(caEstime)} FCFA`,
      detail_fr:
        `[ESTIMATION] Moyenne des ${last7.length} derniers rapports : ${fmt(caEstime)} FCFA/jour. ` +
        `La relance J-1 automatique reste active ; cette recommandation quantifie l'enjeu.`,
      action_context: {
        driver_name: d.full_name, date_manquante: j1,
        ca_estime_fcfa: caEstime, estimation: true, action: "request_report",
      },
      calculation_source: src("ruleRapportManquant", ctx.tenantId, j1, j1),
    });
  }
  return out;
}

/* ── Règle 4 : avance_solde_gonflee ─────────────────────────────────── */
export function ruleAvanceSoldeGonflee(ctx: RecoContext): RecoDraft[] {
  const to = ctx.today;
  const from30 = shiftDays(to, -29);
  const provisions = provisionsSoldePeriode(ctx.win.expenses, from30, to);
  if (provisions <= 0) return [];
  const consomme = soldeConsommePeriode(ctx.win.reports, ctx.win.expenses, from30, to);
  const avance = Math.round(provisions - consomme);

  // Seuils : cash immobilisé > 25% des provisions ET > 30 000 FCFA
  if (avance <= 30_000 || avance <= provisions * 0.25) return [];

  return [{
    rule_id: "avance_solde_gonflee",
    driver_id: null,
    priority: "MEDIUM",
    impact_fcfa: avance,
    title_fr: `${fmt(avance)} FCFA de cash immobilisé en solde Yango non consommé (30 j)`,
    detail_fr:
      `Provisions de solde sur 30 j : ${fmt(provisions)} FCFA, consommé mesuré : ${fmt(consomme)} FCFA ` +
      `(SPEC-CALCULS §3 : avance_solde = provisions − consommé). Réduire les prochains rechargements ` +
      `pour libérer la trésorerie.`,
    action_context: {
      provisions_30j_fcfa: Math.round(provisions), consomme_30j_fcfa: Math.round(consomme),
      avance_fcfa: avance, action: "review_advance",
    },
    calculation_source: src("ruleAvanceSoldeGonflee", ctx.tenantId, from30, to),
  }];
}

/** Exécute tout le catalogue. */
export function runRules(ctx: RecoContext): RecoDraft[] {
  return [
    ...rulePalierARisque(ctx),
    ...ruleCarburantDerive(ctx),
    ...ruleRapportManquant(ctx),
    ...ruleAvanceSoldeGonflee(ctx),
  ];
}

function shiftDays(iso: string, delta: number): string {
  return new Date(Date.parse(iso) + delta * 86_400_000).toISOString().slice(0, 10);
}
