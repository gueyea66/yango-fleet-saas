export type Plan = "standard" | "pro" | "enterprise";

/**
 * L'unité de facturation est le VÉHICULE ACTIF, jamais le chauffeur.
 *
 * Le plafond de chauffeurs a disparu : la page publique et les devis promettent
 * des chauffeurs illimités, et un logiciel qui refuse le vingt-et-unième
 * dément la promesse au pire moment. En ajouter un ne coûte rien, ni au client
 * ni à nous.
 *
 * `includedVehicles` est DÉCLARATIF : il sert aux devis, aux offres et à
 * l'affichage, pas à bloquer la création d'un véhicule. La facturation se fait
 * à la main, et couper l'outil d'un client qui vient d'acheter une voiture
 * serait une façon absurde de lui réclamer 10 000 XOF.
 */
export interface PlanLimits {
  label: string;
  maxDrivers: number;
  /** Véhicules actifs compris dans l'abonnement — déclaratif (voir ci-dessus). */
  includedVehicles: number;
  /** Prix mensuel du véhicule actif au-delà du forfait. */
  extraVehicleXOF: number;
  canExportCSV: boolean;
  canCustomBranding: boolean;
  canSalaryAdvance: boolean;
  canMultiVehicle: boolean;
  canAccessAPI: boolean;
  price: string;
  priceXOF: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  standard: {
    label: "Standard",
    maxDrivers: Infinity,
    includedVehicles: 3,
    extraVehicleXOF: 10000,
    canExportCSV: false,
    canCustomBranding: false,
    canSalaryAdvance: true,
    // Trois véhicules sont compris : le multi-véhicules ne peut plus être
    // refusé à ce palier sans contredire ce qui est vendu.
    canMultiVehicle: true,
    canAccessAPI: false,
    price: "35 000 XOF/mois",
    priceXOF: 35000,
  },
  pro: {
    label: "Pro",
    maxDrivers: Infinity,
    includedVehicles: 7,
    extraVehicleXOF: 10000,
    canExportCSV: true,
    canCustomBranding: true,
    canSalaryAdvance: true,
    canMultiVehicle: true,
    canAccessAPI: true,
    price: "75 000 XOF/mois",
    priceXOF: 75000,
  },
  // Le palier réellement vendu aux flottes (devis NMK du 17/09) : il manquait
  // ici, si bien qu'un client à 100 000 XOF était compté 75 000 dans le MRR.
  enterprise: {
    label: "Entreprise",
    maxDrivers: Infinity,
    includedVehicles: 10,
    extraVehicleXOF: 10000,
    canExportCSV: true,
    canCustomBranding: true,
    canSalaryAdvance: true,
    canMultiVehicle: true,
    canAccessAPI: true,
    price: "100 000 XOF/mois",
    priceXOF: 100000,
  },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.standard;
}

export function canDo(plan: string, feature: keyof PlanLimits): boolean {
  const val = getPlanLimits(plan)[feature];
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val > 0;
  return false;
}

// Trial / expiry helpers — 14 jours, aligné sur les CGU et la page register
export const TRIAL_DAYS = 14;

export type TrialStatus =
  | { state: "active"; daysLeft: number }
  | { state: "warning"; daysLeft: number; horizon: "14d" | "7d" | "3d" | "1d" }
  | { state: "expired" };

export function getTrialStatus(trialEndsAt: string | null, planExpiresAt: string | null): TrialStatus {
  const expiresAt = planExpiresAt ?? trialEndsAt;
  if (!expiresAt) return { state: "expired" };

  const now = Date.now();
  const end = new Date(expiresAt).getTime();
  const daysLeft = Math.ceil((end - now) / 86_400_000);

  if (daysLeft <= 0) return { state: "expired" };
  if (daysLeft <= 1)  return { state: "warning", daysLeft, horizon: "1d" };
  if (daysLeft <= 3)  return { state: "warning", daysLeft, horizon: "3d" };
  if (daysLeft <= 7)  return { state: "warning", daysLeft, horizon: "7d" };
  if (daysLeft <= 14) return { state: "warning", daysLeft, horizon: "14d" };
  return { state: "active", daysLeft };
}
