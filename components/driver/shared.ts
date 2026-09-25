// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// partagé par l'UI actuelle et l'UI v2 — aucune logique modifiée.
import type { RemunerationConfig } from "@/lib/tenant/types";

export type Cfg = RemunerationConfig;

export const DEFAULT_CFG: Cfg = {
  id: "", tenant_id: "",
  model: "tiered",
  base_amount: 200000,
  commission_rate: 0,
  bonus_threshold: 0,
  bonus_amount: 0,
  comm_yango: 15,
  comm_partner: 0.75,
  salary_tiers: [
    { min_net: 0,       total_salary: 200000, label: "Base" },
    { min_net: 1000000, total_salary: 230000, label: "Palier 1" },
    { min_net: 1150000, total_salary: 260000, label: "Palier 2" },
    { min_net: 1300000, total_salary: 300000, label: "Palier 3" },
  ],
  target_net: 1300000,
  daily_rent: 0,
};

export function salaryLevel(net: number, cfg: Cfg) {
  const tiers = [...(cfg.salary_tiers || [])].sort((a, b) => b.min_net - a.min_net);
  return tiers.find((r) => net >= r.min_net) ?? tiers[tiers.length - 1] ?? { min_net: 0, total_salary: cfg.base_amount, label: "Base" };
}

export function xof(n: number) {
  return new Intl.NumberFormat("fr-FR").format(Math.round(n));
}

export interface Profile {
  id: string;
  driver_id: string;
  full_name: string;
  role: string;
  tenant_id: string;
  account_type?: string | null; // 'technical' = compte de décaissement (ex. Founder)
}

export type AiFields = {
  end_odometer: number | null; yango_cash: number | null; yango_card: number | null;
  yango_bonus: number | null; commission_yango: number | null; commission_partenaire: number | null;
  services_supplementaires: number | null; solde_yango: number | null;
  yango_trip_count: number | null; net_affiche: number | null;
};
export type AiScanResult = { extraction_id: string; fields: AiFields; confidences: Record<string, number>; coherence_alerts: { field: string; type: string; message: string }[]; status: string; stored_files?: { path: string; size: number; mime: string }[] };

export const AI_FIELD_LABELS: Record<string, string> = {
  end_odometer: "Km compteur", yango_cash: "Espèces", yango_card: "Carte",
  yango_bonus: "Bonus", commission_yango: "Comm. Yango", commission_partenaire: "Comm. partenaire",
  services_supplementaires: "Services supp.", solde_yango: "Solde",
  yango_trip_count: "Courses", net_affiche: "Net affiché",
};
