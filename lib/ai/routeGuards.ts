/**
 * Gardes communes des routes /api/ai/*.
 * Contrat flag OFF : 204 sans corps (l'UI ne monte rien, ne logge pas d'erreur).
 */
import { NextRequest } from "next/server";
import { requireAdminAuth, requireAnyAuth } from "@/lib/auth/server";
import { checkSuperadminKey, getClientIp, resolveSuperadminKey } from "@/lib/auth/server";
import { aiAdmin } from "./adminClient";
import { getTenantAiAccess, TenantAiAccess } from "./killSwitch";

export const AI_OFF = () => new Response(null, { status: 204 });

export async function verifySuperadmin(req: NextRequest): Promise<boolean> {
  const key = req.headers.get("x-superadmin-key") ?? "";
  if (!key) return false;
  const ip = getClientIp(req);
  const storedKey = await resolveSuperadminKey(async () => {
    const { data } = await aiAdmin()
      .from("superadmin_settings").select("value").eq("key", "access_key").single();
    return data?.value ?? null;
  });
  return checkSuperadminKey(key, storedKey, ip);
}

export interface AiRouteContext {
  tenantId: string;
  userId: string;
  access: TenantAiAccess;
}

/**
 * Auth admin + résolution de l'accès IA du tenant.
 * Retourne null si la couche est invisible pour ce tenant (→ répondre AI_OFF()).
 */
export async function requireAiAccess(req: NextRequest): Promise<AiRouteContext | null> {
  const { userId, tenantId } = await requireAdminAuth();
  const isSuperadmin = await verifySuperadmin(req).catch(() => false);
  const access = await getTenantAiAccess(tenantId, { isSuperadmin });
  if (!access.enabled) return null;
  return { tenantId, userId, access };
}

/**
 * Variante CHAUFFEUR (extraction vision) : auth admin OU driver.
 * Même contrat kill-switch : null → répondre AI_OFF() (204 sans corps).
 * Le stage "shadow" reste invisible pour un chauffeur (superadmin only).
 */
export async function requireAiAccessAny(req: NextRequest): Promise<AiRouteContext | null> {
  const { userId, tenantId } = await requireAnyAuth();
  const isSuperadmin = await verifySuperadmin(req).catch(() => false);
  const access = await getTenantAiAccess(tenantId, { isSuperadmin });
  if (!access.enabled) return null;
  return { tenantId, userId, access };
}
