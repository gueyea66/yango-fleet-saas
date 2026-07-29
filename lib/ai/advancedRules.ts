/**
 * Phase 1.1 — Règles d'optimisation issues de l'analyse croisée du 29/07.
 * 100% déterministes (stats classiques : cohortes, saisonnalité hebdo,
 * réconciliation comptable) — ZÉRO token LLM. Chaque recommandation porte un
 * gain en FCFA calculé.
 *
 * GARDE MATURITÉ (correctif Abdou 29/07) : un chauffeur avec moins de 14 jours
 * de rapports est en période promo Yango (solde offert ~1 semaine) — ses
 * chiffres sont artificiellement bons. Il est EXCLU des benchmarks
 * inter-chauffeurs et ne sert jamais de référence.
 */
import { AI_CALC_VERSION, RuleId } from "./types";
import type { RawReport, TenantWindow } from "./dataReader";
import {
  achatsCarburantPeriode, depensesOpePeriode, kmPeriode, soldeConsommePeriode,
} from "./dataReader";
import { coutCarburantParKm } from "@/lib/calc";
import { paramsHash } from "./insightEngine";
import type { RecoDraft } from "./recommendationEngine";

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
};
const fmt = (v: number) => new Intl.NumberFormat("fr-FR").format(Math.round(v));
const ok = (r: RawReport) => r.status === "approved" || r.status === "submitted";
const ca = (r: RawReport) => n(r.yango_gross) + n(r.yango_bonus) + n(r.off_yango_revenue);
const shiftDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().slice(0, 10);

function src(fn: string, tenantId: string, from: string, to: string) {
  return { function: fn, version: AI_CALC_VERSION, params_hash: paramsHash(tenantId, from, to) };
}

export const MATURITY_DAYS = 14;

/** Chauffeurs matures : premier rapport ≥ MATURITY_DAYS avant `today`. */
export function matureDriverIds(win: TenantWindow, today: string): Set<string> {
  const first = new Map<string, string>();
  for (const r of win.reports) {
    if (!first.has(r.driver_id) || r.date < first.get(r.driver_id)!) first.set(r.driver_id, r.date);
  }
  const cutoff = shiftDays(today, -MATURITY_DAYS);
  const out = new Set<string>();
  for (const [id, d] of first) if (d <= cutoff) out.add(id);
  return out;
}

export interface AdvancedCtx {
  tenantId: string;
  today: string;
  win: TenantWindow;
  activeVehicles: number; // véhicules status=active du tenant
}

interface DriverStat {
  id: string; prenom: string;
  days: number; caTotal: number; trips: number; km: number; fuel: number;
  panier: number | null; coutKm: number | null;
}

function driverStats30(ctx: AdvancedCtx, mature: Set<string>): DriverStat[] {
  const from = shiftDays(ctx.today, -29);
  return ctx.win.drivers
    .filter((d) => d.active !== false && mature.has(d.id))
    .map((d) => {
      const rr = ctx.win.reports.filter((r) => r.driver_id === d.id && ok(r) && r.date >= from && r.date <= ctx.today);
      const caTotal = rr.reduce((s, r) => s + ca(r), 0);
      const trips = rr.reduce((s, r) => s + n(r.yango_trip_count) + n(r.off_yango_trip_count), 0);
      const km = kmPeriode(ctx.win.reports.filter((r) => r.driver_id === d.id), from, ctx.today);
      const fuel = ctx.win.expenses
        .filter((e) => e.driver_id === d.id && e.category === "Carburant" && e.expense_date && e.expense_date >= from)
        .reduce((s, e) => s + n(e.amount), 0);
      return {
        id: d.id, prenom: (d.full_name ?? "Chauffeur").split(" ")[0],
        days: rr.length, caTotal, trips, km, fuel,
        panier: trips >= 30 ? caTotal / trips : null,        // min 30 courses pour parler panier
        coutKm: km >= 200 ? coutCarburantParKm(fuel, km) : null, // min 200 km pour parler conso
      };
    })
    .filter((s) => s.days >= 7);
}

/* ── R5 : panier_moyen — la qualité de course bat le volume ─────────── */
export function rulePanierMoyen(ctx: AdvancedCtx, mature: Set<string>): RecoDraft[] {
  const stats = driverStats30(ctx, mature).filter((s) => s.panier !== null);
  if (stats.length < 2) return [];
  const ref = stats.reduce((a, b) => (a.panier! > b.panier! ? a : b));
  const out: RecoDraft[] = [];
  for (const s of stats) {
    if (s.id === ref.id) continue;
    const gap = ref.panier! - s.panier!;
    if (gap < ref.panier! * 0.1) continue; // écart < 10% : pas d'insight
    // Potentiel réaliste : +10% de panier à courses égales sur 30 j
    const impact = Math.round(s.trips * s.panier! * 0.1);
    out.push({
      rule_id: "panier_moyen" as RuleId,
      driver_id: s.id,
      priority: "MEDIUM",
      impact_fcfa: impact,
      title_fr: `${s.prenom} : panier moyen ${fmt(s.panier!)} FCFA/course vs ${fmt(ref.panier!)} pour ${ref.prenom} — +10% = ${fmt(impact)} FCFA/mois`,
      detail_fr:
        `Sur 30 j : ${s.trips} courses à ${fmt(s.panier!)} FCFA de moyenne (${ref.prenom} : ${fmt(ref.panier!)}). ` +
        `Même CA possible avec moins de km : viser courses longues, aéroport, heures de pointe. ` +
        `Un panier +10% rapporte ${fmt(impact)} FCFA/mois sans rouler plus.`,
      action_context: { prenom: s.prenom, panier_fcfa: Math.round(s.panier!), panier_ref_fcfa: Math.round(ref.panier!), ref_prenom: ref.prenom, action: "optimize_schedule" },
      calculation_source: src("rulePanierMoyen", ctx.tenantId, shiftDays(ctx.today, -29), ctx.today),
    });
  }
  return out;
}

/* ── R6 : efficience_carburant — FCFA/km comparé (chauffeurs matures) ── */
export function ruleEfficienceCarburant(ctx: AdvancedCtx, mature: Set<string>): RecoDraft[] {
  const stats = driverStats30(ctx, mature).filter((s) => s.coutKm !== null && s.coutKm! > 0);
  if (stats.length < 2) return [];
  const ref = stats.reduce((a, b) => (a.coutKm! < b.coutKm! ? a : b));
  const out: RecoDraft[] = [];
  for (const s of stats) {
    if (s.id === ref.id) continue;
    const surcout = s.coutKm! - ref.coutKm!;
    if (surcout < ref.coutKm! * 0.12) continue; // écart < 12% : bruit
    const impact = Math.round(surcout * s.km);
    out.push({
      rule_id: "efficience_carburant" as RuleId,
      driver_id: s.id,
      priority: "MEDIUM",
      impact_fcfa: impact,
      title_fr: `${s.prenom} consomme ${s.coutKm!.toFixed(1)} FCFA/km vs ${ref.coutKm!.toFixed(1)} pour ${ref.prenom} : surcoût ${fmt(impact)} FCFA/30 j`,
      detail_fr:
        `${fmt(s.km)} km sur 30 j. Écart de ${((surcout / ref.coutKm!) * 100).toFixed(0)}% vs le plus sobre. ` +
        `À trancher : véhicule ou conduite (croiser chauffeur×véhicule sur 2 semaines). ` +
        `Si c'est le véhicule : affecter le plus sobre à celui qui roule le plus.`,
      action_context: { prenom: s.prenom, cout_km: Math.round(s.coutKm! * 10) / 10, cout_km_ref: Math.round(ref.coutKm! * 10) / 10, ref_prenom: ref.prenom, action: "review_fuel_log" },
      calculation_source: src("ruleEfficienceCarburant", ctx.tenantId, shiftDays(ctx.today, -29), ctx.today),
    });
  }
  return out;
}

/* ── R7 : jour_optimal_repos — saisonnalité hebdo (hebdomadaire) ─────── */
export function ruleJourOptimalRepos(ctx: AdvancedCtx, mature: Set<string>): RecoDraft[] {
  const WD = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const reps = ctx.win.reports.filter((r) => ok(r) && mature.has(r.driver_id));
  const byDay: number[][] = Array.from({ length: 7 }, () => []);
  for (const r of reps) byDay[new Date(r.date + "T00:00:00Z").getUTCDay()].push(ca(r));
  const avgs = byDay.map((v) => (v.length >= 6 ? v.reduce((s, x) => s + x, 0) / v.length : null));
  const known = avgs.filter((v): v is number => v !== null);
  if (known.length < 5) return []; // pas assez de couverture hebdo
  const mean = known.reduce((s, v) => s + v, 0) / known.length;
  let worst = -1;
  for (let i = 0; i < 7; i++) if (avgs[i] !== null && (worst === -1 || avgs[i]! < avgs[worst]!)) worst = i;
  if (worst === -1 || avgs[worst]! > mean * 0.85) return []; // pas de creux marqué
  const manque = Math.round(mean - avgs[worst]!);
  const impact = manque * 4; // ~4 occurrences/mois
  return [{
    rule_id: "jour_optimal_repos" as RuleId,
    driver_id: null,
    priority: "MEDIUM",
    impact_fcfa: impact,
    title_fr: `Le ${WD[worst]} rapporte ${fmt(manque)} FCFA de moins que la moyenne — y placer les repos = ~${fmt(impact)} FCFA/mois`,
    detail_fr:
      `CA moyen par rapport : ${fmt(avgs[worst]!)} FCFA le ${WD[worst]} vs ${fmt(mean)} en moyenne ` +
      `(chauffeurs matures uniquement). En posant systématiquement les repos hebdomadaires le ${WD[worst]}, ` +
      `les jours travaillés se concentrent sur les créneaux qui rapportent.`,
    action_context: { jour: WD[worst], ca_moyen_jour: Math.round(avgs[worst]!), ca_moyen_global: Math.round(mean), action: "optimize_schedule" },
    calculation_source: src("ruleJourOptimalRepos", ctx.tenantId, shiftDays(ctx.today, -89), ctx.today),
  }];
}

/* ── R8 : reconciliation_solde — consommé vs commissions déclarées ───── */
export function ruleReconciliationSolde(ctx: AdvancedCtx, mature: Set<string>): RecoDraft[] {
  const from = shiftDays(ctx.today, -29);
  const out: RecoDraft[] = [];
  for (const d of ctx.win.drivers.filter((x) => x.active !== false && mature.has(x.id))) {
    const rr = ctx.win.reports
      .filter((r) => r.driver_id === d.id && ok(r) && r.date >= from && r.solde_yango != null);
    if (rr.length < 5) continue;
    const cons = soldeConsommePeriode(
      ctx.win.reports.filter((r) => r.driver_id === d.id), ctx.win.expenses, from, ctx.today);
    const decl = rr.reduce((s, r) => s + n((r as RawReport & { commission_amount?: number }).commission_amount), 0);
    const ecart = Math.round(cons - decl);
    if (Math.abs(ecart) <= 10_000) continue;
    const prenom = (d.full_name ?? "Chauffeur").split(" ")[0];
    out.push({
      rule_id: "reconciliation_solde" as RuleId,
      driver_id: d.id,
      priority: "HIGH",
      impact_fcfa: Math.abs(ecart),
      title_fr: `${prenom} : le wallet a consommé ${fmt(Math.abs(ecart))} FCFA de ${ecart > 0 ? "PLUS" : "MOINS"} que les commissions déclarées (30 j)`,
      detail_fr:
        `Solde consommé mesuré : ${fmt(cons)} FCFA vs commissions déclarées : ${fmt(decl)} FCFA. ` +
        `Règle métier : consommé ≈ déclaré. Un écart durable = paramétrage de taux, charge non déclarée ` +
        `ou fuite — réconcilier ligne par ligne dans le wallet Yango.`,
      action_context: { prenom, solde_consomme_fcfa: Math.round(cons), commissions_declarees_fcfa: Math.round(decl), ecart_fcfa: ecart, action: "review_advance" },
      calculation_source: src("ruleReconciliationSolde", ctx.tenantId, from, ctx.today),
    });
  }
  return out;
}

/* ── R9 : utilisation_vehicule — jours d'immobilisation (hebdomadaire) ─ */
export function ruleUtilisationVehicule(ctx: AdvancedCtx): RecoDraft[] {
  if (ctx.activeVehicles <= 0) return [];
  const from = shiftDays(ctx.today, -13);
  const reps = ctx.win.reports.filter((r) => ok(r) && r.date >= from && r.date < ctx.today);
  if (!reps.length) return [];
  const byDate = new Map<string, number>();
  for (const r of reps) byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
  let idle = 0;
  for (let t = Date.parse(from); t < Date.parse(ctx.today); t += 86_400_000) {
    const ds = new Date(t).toISOString().slice(0, 10);
    idle += Math.max(0, ctx.activeVehicles - (byDate.get(ds) ?? 0));
  }
  if (idle <= 2) return []; // tolérance : repos normaux
  const caMoyen = reps.reduce((s, r) => s + ca(r), 0) / reps.length;
  const impact = Math.round(idle * caMoyen);
  return [{
    rule_id: "utilisation_vehicule" as RuleId,
    driver_id: null,
    priority: "HIGH",
    impact_fcfa: impact,
    title_fr: `${idle} jours-véhicule sans activité sur 14 j : ~${fmt(impact)} FCFA de CA envolé`,
    detail_fr:
      `${ctx.activeVehicles} véhicule(s) actif(s), CA moyen ${fmt(caMoyen)} FCFA/jour roulé. ` +
      `Chaque jour de véhicule immobile coûte ce CA. Suivre le taux d'utilisation ` +
      `(jours roulés / jours disponibles) — c'est LE chiffre qui dit si un véhicule de plus est rentable.`,
    action_context: { jours_immobiles_14j: idle, ca_moyen_jour_fcfa: Math.round(caMoyen), vehicules_actifs: ctx.activeVehicles, action: "optimize_schedule" },
    calculation_source: src("ruleUtilisationVehicule", ctx.tenantId, from, ctx.today),
  }];
}

/* ── R10 : frais_evitables — amendes/contrôles + dérive entretien ────── */
export function ruleFraisEvitables(ctx: AdvancedCtx): RecoDraft[] {
  const from30 = shiftDays(ctx.today, -29);
  const from60 = shiftDays(ctx.today, -59);
  const out: RecoDraft[] = [];

  const evitables = ctx.win.expenses
    .filter((e) => ["Amende", "Contrôle routier"].includes(e.category ?? "")
      && e.expense_date && e.expense_date >= from30)
    .reduce((s, e) => s + n(e.amount), 0);
  if (evitables > 10_000) {
    out.push({
      rule_id: "frais_evitables" as RuleId,
      driver_id: null,
      priority: "LOW",
      impact_fcfa: Math.round(evitables),
      title_fr: `${fmt(evitables)} FCFA d'amendes et contrôles routiers sur 30 j — 100% évitable`,
      detail_fr: `Papiers à jour, conduite conforme : ce poste peut tomber à zéro. C'est de la marge nette directe.`,
      action_context: { total_30j_fcfa: Math.round(evitables), action: "review_fuel_log" },
      calculation_source: src("ruleFraisEvitables", ctx.tenantId, from30, ctx.today),
    });
  }

  const entretien30 = sumCat(ctx, "Entretien", from30, ctx.today);
  const entretienPrev = sumCat(ctx, "Entretien", from60, shiftDays(from30, -1));
  if (entretien30 > 50_000 && entretien30 > entretienPrev * 2) {
    out.push({
      rule_id: "frais_evitables" as RuleId,
      driver_id: null,
      priority: "MEDIUM",
      impact_fcfa: Math.round(entretien30 - entretienPrev),
      title_fr: `Entretien : ${fmt(entretien30)} FCFA sur 30 j (vs ${fmt(entretienPrev)} le mois d'avant) — dérive à surveiller`,
      detail_fr:
        `Si ce rythme persiste au-delà de 60 000 FCFA/mois/véhicule, la question de l'âge du véhicule s'ouvre. ` +
        `Vérifier d'abord s'il s'agit d'un rattrapage de saisie ou de vraies pannes récurrentes.`,
      action_context: { entretien_30j_fcfa: Math.round(entretien30), entretien_mois_precedent_fcfa: Math.round(entretienPrev), action: "review_fuel_log" },
      calculation_source: src("ruleFraisEvitables", ctx.tenantId, from60, ctx.today),
    });
  }
  return out;
}

function sumCat(ctx: AdvancedCtx, cat: string, from: string, to: string): number {
  return ctx.win.expenses
    .filter((e) => e.category === cat && e.expense_date && e.expense_date >= from && e.expense_date <= to)
    .reduce((s, e) => s + n(e.amount), 0);
}

/** Cadence : les croisements lourds tournent le dimanche (batch hebdo). */
export const WEEKLY_RULES: RuleId[] = ["jour_optimal_repos", "utilisation_vehicule", "panier_moyen", "efficience_carburant"];
export const DAILY_ADVANCED_RULES: RuleId[] = ["reconciliation_solde", "frais_evitables"];

export function runAdvancedRules(ctx: AdvancedCtx, opts: { weekly: boolean }): RecoDraft[] {
  const mature = matureDriverIds(ctx.win, ctx.today);
  const out: RecoDraft[] = [
    ...ruleReconciliationSolde(ctx, mature),
    ...ruleFraisEvitables(ctx),
  ];
  if (opts.weekly) {
    out.push(
      ...rulePanierMoyen(ctx, mature),
      ...ruleEfficienceCarburant(ctx, mature),
      ...ruleJourOptimalRepos(ctx, mature),
      ...ruleUtilisationVehicule(ctx),
    );
  }
  return out;
}
