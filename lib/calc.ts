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

/* ═══════════════ 7. AMORTISSEMENT VÉHICULE (bloc RÉSULTAT) ═══════════════ */

/**
 * Charge d'usure du véhicule, étalée sur sa durée de vie utile.
 *
 * Distinction à ne jamais perdre (migration 071) : l'amortissement est une
 * charge CALCULÉE, non-cash, qui existe même sur un véhicule payé comptant —
 * elle appartient au RÉSULTAT. La mensualité de leasing est une sortie de cash
 * réelle qui appartient à la TRÉSORERIE. Les additionner dans le résultat
 * compterait deux fois le même véhicule.
 */

/** Tel que lu sur `fleet.vehicles` — tout est nullable, rien n'est garanti saisi. */
export interface VehiculeAmortissable {
  prixAcquisition?: number | null;
  valeurResiduelle?: number | null;
  dateAcquisition?: string | null;   // ISO YYYY-MM-DD
  compteurActuel?: number | null;    // km au compteur aujourd'hui (vehicles.mileage)
  plafondKm?: number | null;         // fin de vie utile, défaut 400 000
  dureeMaxMois?: number | null;      // plafond de durée, défaut 36
  porteePar?: string | null;         // 'exploitant' | 'proprietaire_tiers' | null
  segment?: string | null;           // fleet_segment, lu quand porteePar est null
}

/**
 * Le capital du véhicule pèse-t-il sur le résultat de l'exploitant ?
 *
 * `amort_porte_par` n'a volontairement pas de défaut en base (migration 071) :
 * la bonne valeur dépend du segment, et un DEFAULT SQL ne sait pas être
 * conditionnel ligne par ligne. NULL veut donc dire « déduire du segment »
 * — un véhicule de flotte partenaire est hébergé pour un tiers, son capital
 * n'est pas le nôtre. Une valeur explicite l'emporte toujours : un partenaire
 * peut confier un véhicule que l'exploitant finance réellement.
 */
export function porteParExploitant(v: VehiculeAmortissable): boolean {
  if (v.porteePar === "proprietaire_tiers") return false;
  if (v.porteePar === "exploitant") return true;
  return v.segment !== "partenaire";
}

export const AMORT_PLAFOND_KM_DEFAUT = 400_000;
export const AMORT_DUREE_MAX_DEFAUT = 36;

/**
 * Durée d'amortissement en mois, déduite du kilométrage restant puis bornée.
 *
 * `null` quand on ne sait pas encore : pas de km/mois mesuré (véhicule qui
 * vient d'entrer en flotte). Renvoyer le plafond par défaut dans ce cas
 * donnerait une fausse précision — l'appelant doit afficher « à renseigner »
 * et non un chiffre inventé.
 *
 * On retient la plus COURTE des deux contraintes, jamais la plus longue :
 * un véhicule peu roulé s'amortirait sinon sur 50 mois et plus, ce qui n'a pas
 * de sens économique sur une occasion.
 */
export function dureeAmortissementMois(
  v: VehiculeAmortissable,
  kmParMois: number | null | undefined,
): number | null {
  const dureeMax = Math.max(1, Math.round(num(v.dureeMaxMois) || AMORT_DUREE_MAX_DEFAUT));
  const kmMois = num(kmParMois);
  if (kmMois <= 0) return null;

  const plafond = num(v.plafondKm) || AMORT_PLAFOND_KM_DEFAUT;
  // Compteur au-delà du plafond : le véhicule a dépassé sa fin de vie estimée.
  // Reste 1 mois — pas 0, qui provoquerait une division par zéro chez l'appelant.
  const kmRestants = Math.max(0, plafond - num(v.compteurActuel));
  const dureeKm = Math.max(1, Math.round(kmRestants / kmMois));

  return Math.min(dureeKm, dureeMax);
}

/** Base amortissable = ce que le véhicule va réellement perdre en valeur. */
export function baseAmortissable(v: VehiculeAmortissable): number | null {
  if (v.prixAcquisition == null) return null;
  const prix = num(v.prixAcquisition);
  if (prix <= 0) return null;
  // Résiduelle absente = 0 : on amortit la totalité. Prudent et jamais négatif,
  // la contrainte SQL garantissant déjà residuelle <= prix.
  return Math.max(0, prix - num(v.valeurResiduelle));
}

export interface AmortissementResult {
  /** Charge d'amortissement de la période, en XOF. */
  montant: number;
  /** Mensualité pleine, avant prorata — pour l'afficher sur la fiche véhicule. */
  mensualite: number;
  dureeMois: number | null;
  /** Mois déjà amortis à la fin de la période. */
  moisEcoules: number;
  /** Mois restants à amortir. 0 = véhicule totalement amorti. */
  moisRestants: number | null;
  /**
   * Pourquoi la charge est nulle, quand elle l'est. L'écran doit distinguer
   * « rien à saisir » de « pas encore saisi » : sans ça un champ oublié
   * ressemble à un véhicule gratuit, et on revient à l'image embellie.
   */
  raison: null | "porte_par_tiers" | "non_renseigne" | "hors_periode" | "totalement_amorti";
}

const VIDE: AmortissementResult = {
  montant: 0, mensualite: 0, dureeMois: null, moisEcoules: 0, moisRestants: null, raison: "non_renseigne",
};

/**
 * Amortissement d'UN véhicule sur la période [from, to].
 *
 * Proratisé sur les jours de la période effectivement couverts par la période
 * d'amortissement : un véhicule acheté le 15 ne porte pas un mois plein, et un
 * véhicule totalement amorti en cours de mois ne porte que les jours d'avant.
 * Même logique que `salaireProrata`.
 */
export function amortissementPeriode(params: {
  vehicule: VehiculeAmortissable;
  fromISO: string;
  toISO: string;
  kmParMois: number | null | undefined;
}): AmortissementResult {
  const { vehicule: v, fromISO, toISO } = params;

  // Véhicule hébergé pour un tiers : son capital n'est pas porté par
  // l'exploitant. Le charger reviendrait à imputer à NMK un actif de M3A.
  if (!porteParExploitant(v)) return { ...VIDE, raison: "porte_par_tiers" };

  const base = baseAmortissable(v);
  const duree = dureeAmortissementMois(v, params.kmParMois);
  if (base == null || duree == null || !v.dateAcquisition) return VIDE;

  const mensualite = Math.round(base / duree);

  // Fenêtre d'amortissement : [date d'acquisition, +durée mois[.
  const debut = v.dateAcquisition;
  const finExclue = ajouterMois(debut, duree);
  if (!finExclue) return VIDE;

  // Intersection de la période demandée avec la fenêtre d'amortissement.
  const debutEffectif = fromISO > debut ? fromISO : debut;
  const finEffective = toISO < finExclue ? toISO : veille(finExclue);
  if (!finEffective || debutEffectif > finEffective) {
    const fini = fromISO >= finExclue;
    return {
      montant: 0, mensualite, dureeMois: duree,
      moisEcoules: fini ? duree : 0,
      moisRestants: fini ? 0 : duree,
      raison: fini ? "totalement_amorti" : "hors_periode",
    };
  }

  // Prorata : jours couverts de la période ÷ 30,4 jours par mois moyen. Le
  // dénominateur fixe évite qu'un véhicule porte plus d'amortissement en mars
  // (31 j) qu'en février (28 j) alors qu'il s'use pareil.
  const joursCouverts = joursCalendaires(debutEffectif, finEffective);
  const montant = Math.round(mensualite * (joursCouverts / 30.4));

  const moisEcoules = Math.min(duree, moisEntre(debut, finEffective) + 1);
  return {
    montant, mensualite, dureeMois: duree,
    moisEcoules, moisRestants: Math.max(0, duree - moisEcoules),
    raison: null,
  };
}

/**
 * Amortissement de tout un parc sur la période. `montant` est la ligne à
 * soustraire du net opérationnel ; `nonRenseignes` alimente l'avertissement à
 * l'écran — un parc à moitié paramétré donne un résultat à moitié vrai, et
 * l'utilisateur doit le savoir avant de lire le chiffre.
 */
export function amortissementParc(
  vehicules: Array<{ id: string; vehicule: VehiculeAmortissable; kmParMois: number | null | undefined }>,
  fromISO: string,
  toISO: string,
): { montant: number; parVehicule: Array<{ id: string } & AmortissementResult>; nonRenseignes: string[] } {
  const parVehicule = vehicules.map((x) => ({
    id: x.id,
    ...amortissementPeriode({ vehicule: x.vehicule, fromISO, toISO, kmParMois: x.kmParMois }),
  }));
  return {
    montant: parVehicule.reduce((s, r) => s + r.montant, 0),
    parVehicule,
    nonRenseignes: parVehicule.filter((r) => r.raison === "non_renseigne").map((r) => r.id),
  };
}

/**
 * Point mort d'un véhicule : recette nette minimale par jour ouvré pour couvrir
 * sa part de charges fixes, amortissement compris. C'est le chiffre qu'un
 * exploitant cherche vraiment — en dessous, le véhicule détruit de la valeur
 * même s'il « rapporte » quelque chose chaque jour.
 */
export function pointMortParJour(params: {
  amortissementMensuel: number;
  salaireMensuel: number;
  chargesFixesMensuelles: number;
  joursOuvresMois: number;
}): number {
  const jours = num(params.joursOuvresMois);
  if (jours <= 0) return 0;
  const fixes = num(params.amortissementMensuel) + num(params.salaireMensuel)
              + num(params.chargesFixesMensuelles);
  return Math.round(fixes / jours);
}

/* ═══════════════ 8. FINANCEMENT (bloc TRÉSORERIE) ═══════════════ */

export interface Financement {
  mensualite?: number | null;
  dateDebut?: string | null;   // ISO
  dureeMois?: number | null;
  dateFin?: string | null;     // renseignée si soldé par anticipation
  actif?: boolean | null;
}

/**
 * Mensualités de financement décaissées sur la période.
 *
 * ⚠️ Cette somme ne doit JAMAIS être soustraite du résultat : elle contient du
 * capital, déjà porté par l'amortissement. Elle n'a de sens que dans le bloc
 * trésorerie, en réponse à « est-ce que je peux payer l'échéance ce mois-ci ? ».
 */
export function financementPeriode(f: Financement, fromISO: string, toISO: string): number {
  if (f.actif === false) return 0;
  const mens = num(f.mensualite);
  if (mens <= 0 || !f.dateDebut) return 0;

  const duree = Math.max(0, Math.round(num(f.dureeMois)));
  const finTheorique = duree > 0 ? ajouterMois(f.dateDebut, duree) : null;
  // La date de fin saisie (remboursement anticipé) primait sur l'échéancier.
  const fin = f.dateFin ?? finTheorique;

  const debutEffectif = fromISO > f.dateDebut ? fromISO : f.dateDebut;
  const borneFin = fin && toISO >= fin ? veille(fin) : toISO;
  if (!borneFin || debutEffectif > borneFin) return 0;

  return Math.round(mens * (joursCalendaires(debutEffectif, borneFin) / 30.4));
}

/* ═══════════════════ util dates ═══════════════════ */

/** Date ISO + n mois, en gardant le dernier jour valide du mois cible. */
function ajouterMois(iso: string, mois: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const cible = new Date(Date.UTC(y, mo - 1 + mois, 1));
  // 31 janvier + 1 mois = 28 (ou 29) février, pas le 3 mars.
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(d, dernier));
  return cible.toISOString().slice(0, 10);
}

/** Veille d'une date ISO. */
function veille(iso: string): string | null {
  const t = new Date(iso + "T00:00:00Z").getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

/** Nombre de mois entiers écoulés entre deux dates ISO. */
function moisEntre(depuisISO: string, jusquISO: string): number {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(depuisISO);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jusquISO);
  if (!a || !b) return 0;
  const brut = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  return Math.max(0, Number(b[3]) >= Number(a[3]) ? brut : brut - 1);
}

/* ═══════════════════ util ═══════════════════ */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}
