/**
 * Mise en forme Équipe / Finance / Historique v2 (aucune donnée lue ici).
 */
import { dayStatus, type DayStatus } from "./driver";

/** KPI Finance (maquette 4b) à partir des agrégats de useDashboardKPIs. */
export function financeKpis(k: {
  tresorerie: number;
  decaissements: number;
  netFinal: number;
  expenseBreakdown: { type: string; amount: number }[];
}): { encaissements: number; decaissements: number; masseSalariale: number | null; margeApresSalaires: number } {
  const sal = k.expenseBreakdown.find((b) => /salaire/i.test(b.type));
  return {
    // même définition que la carte Trésorerie actuelle : encaissements = trésorerie + décaissements
    encaissements: k.tresorerie + k.decaissements,
    decaissements: k.decaissements,
    masseSalariale: sal ? sal.amount : null,
    // net final = recettes − charges, salaires compris
    margeApresSalaires: k.netFinal,
  };
}

export type KycState = "approved" | "in_review" | "rejected" | "incomplete";

export function kycState(onboardingStatus: string | null | undefined): KycState {
  if (onboardingStatus === "approved") return "approved";
  if (onboardingStatus === "in_review") return "in_review";
  if (onboardingStatus === "rejected") return "rejected";
  return "incomplete";
}

/** Compteurs d'équipe (maquette 4a) sur les profils chauffeurs. */
export function teamCounts(drivers: { active?: boolean | null; onboarding_status?: string | null }[]) {
  return {
    total: drivers.length,
    actifs: drivers.filter((d) => d.active !== false).length,
    kycValides: drivers.filter((d) => kycState(d.onboarding_status) === "approved").length,
    kycAVerifier: drivers.filter((d) => kycState(d.onboarding_status) === "in_review").length,
  };
}

/**
 * Grille Historique (maquette 4c) : chauffeur × jour du mois → état du jour
 * (mêmes règles que le calendrier chauffeur).
 */
export function driverDayGrid(
  reports: { driver_id: string; date: string; status?: string | null; comment?: string | null }[],
  year: number,
  month0: number,
): { days: string[]; cell: (driverId: string, date: string) => DayStatus } {
  const n = new Date(year, month0 + 1, 0).getDate();
  const mm = String(month0 + 1).padStart(2, "0");
  const days = Array.from({ length: n }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`);
  const map = new Map<string, { status?: string | null; comment?: string | null }[]>();
  for (const r of reports) {
    if (!r.date?.startsWith(`${year}-${mm}`)) continue;
    const key = `${r.driver_id}|${r.date}`;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return { days, cell: (driverId, date) => dayStatus(map.get(`${driverId}|${date}`) ?? []) };
}
