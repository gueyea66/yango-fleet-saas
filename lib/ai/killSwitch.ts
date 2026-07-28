import { aiAdmin } from "./adminClient";

/**
 * Kill-switch à deux étages :
 *  1. env AI_LAYER_ENABLED — master-off d'urgence ("off" → tout est coupé,
 *     nécessite un redéploiement Vercel ; c'est assumé, c'est le frein à main).
 *  2. fleet.ai_settings.enabled — autorité OPÉRATIONNELLE en DB (modifiable
 *     par le superadmin sans redéploiement). Défaut FALSE : déployer le code
 *     ne change rien tant que la couche n'est pas activée explicitement.
 *
 * Rollout par tenant : fleet.ai_config.rollout_stage
 *  disabled → jamais ; shadow → superadmin uniquement ; dogfood/general → visible.
 */

export interface TenantAiAccess {
  enabled: boolean;
  stage: "disabled" | "shadow" | "dogfood" | "general";
  thresholds: {
    net_operationnel_delta_pct: number;
    carburant_km_delta_pct: number;
    taux_soumission_min_pct: number;
  };
  llmModelOverride: string | null;
}

export const DEFAULT_THRESHOLDS: TenantAiAccess["thresholds"] = {
  net_operationnel_delta_pct: -5,
  carburant_km_delta_pct: 15,
  taux_soumission_min_pct: 80,
};

/** Étage 1 — env. Pur, testable. Défaut : on (l'étage DB décide). */
export function envEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AI_LAYER_ENABLED ?? "on").trim().toLowerCase() !== "off";
}

// Cache 60 s du réglage global (une ligne, lue à chaque requête IA sinon)
let globalCache: { value: boolean; at: number } | null = null;
const GLOBAL_TTL_MS = 60_000;

/** Étage 1 + 2 — la couche IA est-elle active globalement ? */
export async function isAiEnabled(): Promise<boolean> {
  if (!envEnabled()) return false;
  const now = Date.now();
  if (globalCache && now - globalCache.at < GLOBAL_TTL_MS) return globalCache.value;
  const { data } = await aiAdmin().from("ai_settings").select("enabled").eq("id", 1).maybeSingle();
  const value = data?.enabled === true;
  globalCache = { value, at: now };
  return value;
}

/** Invalide le cache (après un PATCH superadmin). */
export function clearAiEnabledCache() {
  globalCache = null;
}

/** Accès effectif d'un tenant (étages 1+2 + stage). */
export async function getTenantAiAccess(
  tenantId: string,
  opts: { isSuperadmin?: boolean } = {}
): Promise<TenantAiAccess> {
  const off: TenantAiAccess = {
    enabled: false, stage: "disabled",
    thresholds: DEFAULT_THRESHOLDS, llmModelOverride: null,
  };
  if (!(await isAiEnabled())) return off;

  const { data } = await aiAdmin()
    .from("ai_config")
    .select("rollout_stage, thresholds, llm_model_override")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Pas de ligne ai_config → tenant hors rollout (équivalent disabled)
  if (!data) return off;

  const stage = (data.rollout_stage ?? "disabled") as TenantAiAccess["stage"];
  const visible =
    stage === "general" || stage === "dogfood" ||
    (stage === "shadow" && opts.isSuperadmin === true);

  return {
    enabled: visible,
    stage,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(data.thresholds ?? {}) },
    llmModelOverride: data.llm_model_override ?? null,
  };
}
