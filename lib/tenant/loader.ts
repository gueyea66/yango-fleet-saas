import { createClient } from "@/lib/supabase/client";
import type { TenantContext } from "./types";

const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || "m3a";

let cache: TenantContext | null = null;

function detectSlug(): string {
  if (typeof window === "undefined") return DEFAULT_SLUG;
  const hostname = window.location.hostname;
  // abdou.fleet.m3asolutions.com → 'abdou'
  // localhost → default
  if (hostname === "localhost" || hostname === "127.0.0.1") return DEFAULT_SLUG;
  const parts = hostname.split(".");
  if (parts.length >= 3) return parts[0];
  return DEFAULT_SLUG;
}

export async function loadTenantContext(): Promise<TenantContext> {
  if (cache) return cache;

  const slug = detectSlug();
  const supabase = createClient() as any;

  const { data: tenant, error: tErr } = await supabase
    .from("tenants")
    .select("*")
    .eq("slug", slug)
    .single();

  if (tErr || !tenant) throw new Error(`Tenant '${slug}' not found`);
  if (!tenant.active) throw new Error(`Tenant '${slug}' is suspended`);

  const [{ data: settings }, { data: remuneration }] = await Promise.all([
    supabase.from("tenant_settings").select("*").eq("tenant_id", tenant.id).single(),
    supabase.from("remuneration_config").select("*").eq("tenant_id", tenant.id).single(),
  ]);

  const defaults = {
    settings: {
      app_name: "Fleet Manager",
      logo_url: null,
      primary_color: "#f5a623",
      currency: "XOF",
      timezone: "Africa/Dakar",
      operator_name: null,
    },
    remuneration: {
      model: "fixed",
      base_amount: 0,
      commission_rate: 0,
      bonus_threshold: 0,
      bonus_amount: 0,
    },
  };

  cache = {
    tenant,
    settings: settings || { ...defaults.settings, tenant_id: tenant.id },
    remuneration: remuneration || { ...defaults.remuneration, tenant_id: tenant.id },
  };

  return cache;
}

export function clearTenantCache() {
  cache = null;
}
