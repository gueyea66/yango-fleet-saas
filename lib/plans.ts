export type Plan = "standard" | "pro";

export interface PlanLimits {
  label: string;
  maxDrivers: number;
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
    maxDrivers: 20,
    canExportCSV: false,
    canCustomBranding: false,
    canSalaryAdvance: true,
    canMultiVehicle: false,
    canAccessAPI: false,
    price: "35 000 XOF/mois",
    priceXOF: 35000,
  },
  pro: {
    label: "Pro",
    maxDrivers: Infinity,
    canExportCSV: true,
    canCustomBranding: true,
    canSalaryAdvance: true,
    canMultiVehicle: true,
    canAccessAPI: true,
    price: "75 000 XOF/mois",
    priceXOF: 75000,
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

// Trial / expiry helpers
export const TRIAL_DAYS = 30;

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
