import { createClient } from "@/lib/supabase/client";
import type { TenantContext } from "./types";

const DEFAULT_SLUG = process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || "m3a";

let cache: TenantContext | null = null;

function detectSlug(): string {
  if (typeof window === "undefined") return DEFAULT_SLUG;
  const hostname = window.location.hostname;
  // abdou.fleet.mondomaine.com → 'abdou' (voir NEXT_PUBLIC_ROOT_DOMAIN)
  // localhost → default
  if (hostname === "localhost" || hostname === "127.0.0.1") return DEFAULT_SLUG;
  const parts = hostname.split(".");
  if (parts.length >= 3) return parts[0];
  return DEFAULT_SLUG;
}

const DEFAULT_SETTINGS = {
  app_name: "Fleet Manager",
  logo_url: null,
  primary_color: "#f5a623",
  currency: "XOF",
  timezone: "Africa/Dakar",
  operator_name: null,
};

const DEFAULT_REMUNERATION = {
  model: "fixed",
  base_amount: 0,
  commission_rate: 0,
  bonus_threshold: 0,
  bonus_amount: 0,
};

export async function loadTenantContext(): Promise<TenantContext> {
  if (cache) return cache;

  const slug = detectSlug();

  // Branding via l'API publique (service role côté serveur) : fonctionne AVANT
  // connexion — la lecture directe de `tenants` est bloquée par RLS pour les anonymes.
  const res = await fetch(`/api/public/tenant-branding?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(`Tenant '${slug}' not found`);
  const { tenant, settings } = await res.json();
  if (!tenant.active) throw new Error(`Tenant '${slug}' is suspended`);

  // Config de rémunération : donnée privée, via session Supabase (RLS).
  // Échoue silencieusement pour un visiteur non connecté — les pages qui en ont
  // besoin (driver/pilotage) sont derrière l'authentification.
  let remuneration = null;
  try {
    const supabase = createClient() as any;
    const { data } = await supabase
      .from("remuneration_config")
      .select("*")
      .eq("tenant_id", tenant.id)
      .single();
    remuneration = data;
  } catch {
    // non connecté — defaults
  }

  cache = {
    tenant,
    settings: settings || { ...DEFAULT_SETTINGS, tenant_id: tenant.id },
    remuneration: remuneration || { ...DEFAULT_REMUNERATION, tenant_id: tenant.id },
  };

  return cache;
}

export function clearTenantCache() {
  cache = null;
}
