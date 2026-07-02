export interface Tenant {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  plan: "trial" | "standard" | "pro" | "starter" | "enterprise"; // starter/enterprise = legacy
  active: boolean;
  created_at: string;
}

export interface TenantSettings {
  id: string;
  tenant_id: string;
  app_name: string;
  logo_url: string | null;
  primary_color: string;
  currency: string;
  timezone: string;
  operator_name: string | null;
}

export type RemunerationModel = "fixed" | "tiered" | "percent" | "hybrid" | "location";

export interface SalaryTier {
  min_net: number;
  total_salary: number;
  label: string;
}

export interface RemunerationConfig {
  id: string;
  tenant_id: string;
  model: RemunerationModel;
  base_amount: number;       // fixe mensuel (fixed / hybrid / tiered base)
  commission_rate: number;   // % brut que le driver garde (percent / hybrid)
  bonus_threshold: number;   // seuil CA pour bonus (hybrid)
  bonus_amount: number;      // montant bonus (hybrid)
  comm_yango: number;        // % commission Yango (tous modèles)
  comm_partner: number;      // % commission partenaire (tous modèles)
  salary_tiers: SalaryTier[];// grille paliers (tiered)
  target_net: number;        // objectif CA net mensuel (tiered / pilotage)
  daily_rent: number;        // loyer journalier dû à l'opérateur (location)
}

export interface TenantContext {
  tenant: Tenant;
  settings: TenantSettings;
  remuneration: RemunerationConfig;
}
