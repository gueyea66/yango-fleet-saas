export interface Tenant {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  plan: "starter" | "pro" | "enterprise";
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

export interface RemunerationConfig {
  id: string;
  tenant_id: string;
  model: "fixed" | "percent" | "hybrid";
  base_amount: number;
  commission_rate: number;
  bonus_threshold: number;
  bonus_amount: number;
}

export interface TenantContext {
  tenant: Tenant;
  settings: TenantSettings;
  remuneration: RemunerationConfig;
}
