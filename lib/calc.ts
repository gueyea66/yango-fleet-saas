/**
 * Moteur de calcul pur — sans dépendance DB/UI, entièrement testable.
 * Deux reportings (Commissions théorique / Opérationnel réel) + trésorerie
 * + salaire prorata + jours ouvrés + projection PnL.
 * Référence : docs/SPEC-CALCULS.md
 */

/* ═══════════════════ 1. COMMISSIONS (théorique, rému) ═══════════════════ */

export interface CommissionRates {
  yangoPct: number;   // % Yango (ex 15 = 15%)
  partnerPct: number; // % partenaire
}

/** Taux potentiellement absents (null/undefined) tels que lus en base. */
export type NullableRates = { yangoPct?: number | null; partnerPct?: number | null };

/**
 * Résolution des taux : chauffeur → véhicule → tenant (1re valeur définie).
 * Chaque niveau fournit yango/partner potentiellement null.
 */
export function resolveRates(
  driver: NullableRates | null | undefined,
  vehicle: NullableRates | null | undefined,
  tenant: CommissionRates,
): CommissionRates {
  const pick = (k: keyof CommissionRates): number => {
    const d = driver?.[k]; if (d != null && !Number.isNaN(d)) return d;
    const v = vehicle?.[k]; if (v != null && !Number.isNaN(v)) return v;
    return tenant[k];
  };
  return { yangoPct: pick("yangoPct"), partnerPct: pick("partnerPct") };
}

export interface CommissionInput {
  brutYango: number;
  bonusYango: number;
  horsYango: number;
  rates: CommissionRates;
  serviceSupplementaire?: number; // charge Yango add. saisie
}

export interface CommissionResult {
  base: number;
  commYango: number;
  commPartner: number;
  serviceSupp: number;
  netYango: number;
  netTotal: number; // net commissions (base − comms − service + hors)
}

export function computeCommissions(i: CommissionInput): CommissionResult {
  const base = num(i.brutYango) + num(i.bonusYango);
  const commYango = base * (num(i.rates.yangoPct) / 100);
  const commPartner = base * (num(i.rates.partnerPct) / 100);
  const serviceSupp = num(i.serviceSupplementaire);
  const netYango = base - commYango - commPartner - serviceSupp;
  return {
    base, commYango, commPartner, serviceSupp,
    netYango,
    netTotal: netYango + num(i.horsYango),
  };
}

/* ═══════════════════ 2. OPÉRATIONNEL RÉEL ═══════════════════ */

/**
 * Solde Yango consommé sur un jour (Modèle A) :
 *   consommé = solde_veille − solde_fin + provisions_du_jour   (≥ 0)
 */
export function soldeConsomme(params: {
  soldeVeille: number;
  soldeFin: number;
  provisionsDuJour: number;
}): number {
  const c = num(params.soldeVeille) - num(params.soldeFin) + num(params.provisionsDuJour);
  return Math.max(0, c);
}

/**
 * Coût carburant par km, dérivé de l'historique réel.
 * Retourne 0 si pas de km (évite division par zéro).
 */
export function coutCarburantParKm(totalMontantCarburant: number, totalKm: number): number {
  const km = num(totalKm);
  if (km <= 0) return 0;
  return num(totalMontantCarburant) / km;
}

/** Carburant consommé sur une période = km × coût/km. */
export function carburantConsomme(kmPeriode: number, coutParKm: number): number {
  return Math.max(0, num(kmPeriode) * num(coutParKm));
}

export interface OperationnelInput {
  recettes: number;          // brut + bonus + hors
  soldeConsomme: number;
  carburantConsomme: number;
  depensesOperationnelles: number; // hors "Solde Yango" et "Carburant"
  salaires: number;
}

/** Résultat opérationnel réel. */
export function computeOperationnel(i: OperationnelInput): number {
  return num(i.recettes) - num(i.soldeConsomme) - num(i.carburantConsomme)
       - num(i.depensesOperationnelles) - num(i.salaires);
}

/* ═══════════════════ 3. TRÉSORERIE (cash) ═══════════════════ */

export interface TresorerieInput {
  encaissements: number;         // recettes encaissées
  provisionsSolde: number;       // achats de solde (front-load)
  achatsCarburant: number;       // achats de carburant (front-load)
  autresDepenses: number;        // dépenses opé hors solde/carburant
  salaires: number;
  soldeConsomme: number;
  carburantConsomme: number;
}

export interface TresorerieResult {
  decaissements: number;
  tresorerie: number;    // encaissements − décaissements
  avanceSolde: number;   // cash immobilisé en solde (provisions − consommé)
  avanceCarburant: number;
}

export function computeTresorerie(i: TresorerieInput): TresorerieResult {
  const decaissements = num(i.provisionsSolde) + num(i.achatsCarburant)
                      + num(i.autresDepenses) + num(i.salaires);
  return {
    decaissements,
    tresorerie: num(i.encaissements) - decaissements,
    avanceSolde: num(i.provisionsSolde) - num(i.soldeConsomme),
    avanceCarburant: num(i.achatsCarburant) - num(i.carburantConsomme),
  };
}

/* ═══════════════════ 4. JOURS OUVRÉS ═══════════════════ */

/** Nombre de jours calendaires dans [from, to] inclus (dates ISO YYYY-MM-DD). */
export function joursCalendaires(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
  return Math.floor((to - from) / 86_400_000) + 1;
}

/**
 * Jours ouvrés RÉALISÉS = jours calendaires − repos déclarés (dates dans la période).
 */
export function joursOuvresRealises(fromISO: string, toISO: string, reposDates: string[]): number {
  const total = joursCalendaires(fromISO, toISO);
  const repos = new Set(reposDates.filter((d) => d >= fromISO && d <= toISO));
  return Math.max(0, total - repos.size);
}

/**
 * Jours ouvrés PROJETÉS (futur) = jours calendaires × 6/7 (1 repos/semaine),
 * arrondi à l'entier le plus proche. Calé sur le calendrier réel de la période.
 */
export function joursOuvresProjetes(fromISO: string, toISO: string): number {
  const total = joursCalendaires(fromISO, toISO);
  return Math.round(total * 6 / 7);
}

/** Bornes ISO (1er, dernier jour) d'un mois donné. */
export function bornesMois(year: number, month1to12: number): { from: string; to: string } {
  const m = String(month1to12).padStart(2, "0");
  const last = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  return { from: `${year}-${m}-01`, to: `${year}-${m}-${String(last).padStart(2, "0")}` };
}

/* ═══════════════════ 5. SALAIRE AU PRORATA ═══════════════════ */

/**
 * Salaire proratisé pour un modèle à base fixe.
 * proratable=false (percent/location) → renvoie le salaire plein (pas de prorata).
 */
export function salaireProrata(params: {
  salaireMensuel: number;
  joursOuvresTravailles: number;
  joursOuvresMois: number;
  proratable: boolean;
}): number {
  const plein = num(params.salaireMensuel);
  if (!params.proratable) return plein;
  const denom = num(params.joursOuvresMois);
  if (denom <= 0) return 0;
  const ratio = Math.min(1, num(params.joursOuvresTravailles) / denom);
  return Math.round(plein * ratio);
}

/** Modèles de rému dont la base fixe est proratisable. */
export function estProratable(model: string): boolean {
  return model === "fixed" || model === "tiered" || model === "hybrid";
}

/* ═══════════════════ 6. PROJECTION PnL ═══════════════════ */

/**
 * Projection d'un résultat opérationnel sur une période cible, à partir du réalisé.
 *   moyenne/jour ouvré réalisé × jours ouvrés (projetés) de la période cible.
 */
export function projeterResultat(params: {
  resultatRealise: number;
  joursOuvresEcoules: number;
  joursOuvresCible: number;
}): number {
  const ecoules = num(params.joursOuvresEcoules);
  if (ecoules <= 0) return 0;
  const parJour = num(params.resultatRealise) / ecoules;
  return Math.round(parJour * num(params.joursOuvresCible));
}

/* ═══════════════════ util ═══════════════════ */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}
