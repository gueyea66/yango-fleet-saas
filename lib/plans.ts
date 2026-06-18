export type Plan = "starter" | "pro" | "enterprise";

export interface PlanLimits {
  label: string;
  maxDrivers: number;
  canExportCSV: boolean;
  canCustomBranding: boolean;
  canAccessAPI: boolean;
  canSalaryAdvance: boolean;
  canMultiVehicle: boolean;
  price: string;
  features: string[];
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  starter: {
    label: "Starter",
    maxDrivers: 10,
    canExportCSV: false,
    canCustomBranding: false,
    canAccessAPI: false,
    canSalaryAdvance: false,
    canMultiVehicle: false,
    price: "Gratuit",
    features: [
      "Jusqu'à 10 chauffeurs",
      "Rapports journaliers",
      "Tableau de bord admin",
    ],
  },
  pro: {
    label: "Pro",
    maxDrivers: 50,
    canExportCSV: true,
    canCustomBranding: true,
    canAccessAPI: false,
    canSalaryAdvance: true,
    canMultiVehicle: true,
    price: "25 000 XOF/mois",
    features: [
      "Jusqu'à 50 chauffeurs",
      "Export CSV",
      "Branding personnalisé",
      "Avances sur salaire",
      "Multi-véhicules",
    ],
  },
  enterprise: {
    label: "Enterprise",
    maxDrivers: Infinity,
    canExportCSV: true,
    canCustomBranding: true,
    canAccessAPI: true,
    canSalaryAdvance: true,
    canMultiVehicle: true,
    price: "Sur devis",
    features: [
      "Chauffeurs illimités",
      "Tout Pro inclus",
      "Accès API",
      "Support prioritaire",
      "SLA garanti",
    ],
  },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.starter;
}

export function canDo(plan: string, feature: keyof PlanLimits): boolean {
  const limits = getPlanLimits(plan);
  const val = limits[feature];
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val > 0;
  return false;
}
