import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Rate-limit PERSISTANT (fix audit V4) — partagé entre toutes les instances
 * serverless via Postgres (fonction atomique fleet.rate_limit_hit, migration
 * 041). Retourne true si la requête est autorisée. FAIL-OPEN : si la fonction
 * n'existe pas encore ou en cas d'erreur, on n'échoue jamais côté sécurité
 * critique (le déploiement du code avant la migration reste sûr).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _rlClient: any = null;
function rlClient() {
  if (!_rlClient) {
    _rlClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: "fleet" } },
    );
  }
  return _rlClient;
}

export async function rateLimitOk(
  bucket: string, ip: string, max: number, windowSec: number,
): Promise<boolean> {
  try {
    const { data, error } = await rlClient().rpc("rate_limit_hit", {
      p_bucket: `${bucket}:${ip}`, p_max: max, p_window_sec: windowSec,
    });
    if (error) return true; // fail-open (migration 041 non appliquée, etc.)
    return data !== false;
  } catch {
    return true;
  }
}

export interface AuthedAdmin {
  userId: string;
  tenantId: string;
  role: string;
}

/**
 * Vérifie que la requête provient d'un admin authentifié.
 * Lit la session depuis les cookies (Supabase SSR).
 * Retourne { userId, tenantId, role } ou lève une erreur avec status HTTP.
 */
export async function requireAdminAuth(): Promise<AuthedAdmin> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    const err = new Error("UNAUTHORIZED") as Error & { status: number };
    err.status = 401;
    throw err;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.tenant_id) {
    const err = new Error("FORBIDDEN") as Error & { status: number };
    err.status = 403;
    throw err;
  }

  if (profile.role !== "admin") {
    const err = new Error("FORBIDDEN: role insuffisant") as Error & { status: number };
    err.status = 403;
    throw err;
  }

  // Gating abonnement (fix audit V5) : mêmes règles que le middleware pages,
  // appliquées aussi à l'API — un tenant suspendu/expiré ne doit pas garder
  // un accès complet via des appels directs qui contournent /locked.
  await assertTenantActive(supabase, profile.tenant_id);

  return { userId: user.id, tenantId: profile.tenant_id, role: profile.role };
}

/**
 * Lève 402 si le tenant est suspendu (active=false) ou expiré
 * (plan_expires_at prioritaire, sinon trial_ends_at). Fail-open sur erreur
 * de lecture pour ne jamais bloquer à tort en cas d'incident base.
 */
export async function assertTenantActive(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
): Promise<void> {
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("active, trial_ends_at, plan_expires_at")
    .eq("id", tenantId)
    .single();
  if (error || !tenant) return; // fail-open : ne pas bloquer sur incident
  const deny = (reason: string) => {
    const err = new Error(`TENANT_LOCKED: ${reason}`) as Error & { status: number };
    err.status = 402;
    throw err;
  };
  if (tenant.active === false) deny("inactive");
  const expiresAt = tenant.plan_expires_at ?? tenant.trial_ends_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) deny("expired");
}

/**
 * Vérifie que l'utilisateur est authentifié (admin OU driver).
 * Utilisé pour les endpoints accessibles aux deux rôles (ex: upload fichier).
 */
export async function requireAnyAuth(): Promise<AuthedAdmin> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    const err = new Error("UNAUTHORIZED") as Error & { status: number };
    err.status = 401;
    throw err;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) {
    const err = new Error("FORBIDDEN") as Error & { status: number };
    err.status = 403;
    throw err;
  }

  return { userId: user.id, tenantId: profile.tenant_id, role: profile.role };
}

/** Helper pour retourner une réponse 401 */
export function unauthorizedResponse(message = "Non autorisé") {
  return NextResponse.json({ error: message }, { status: 401 });
}

/** Helper pour retourner une réponse 403 */
export function forbiddenResponse(message = "Accès interdit") {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Vérifie la clé superadmin avec rate limiting.
 * Rate limiting basique : 5 tentatives / 15 min par IP.
 *
 * @param providedKey  Clé fournie dans la requête
 * @param storedKey    Clé attendue (depuis DB ou env SUPERADMIN_KEY)
 * @param ip           IP du client pour le rate limiting
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkSuperadminKey(providedKey: string, storedKey: string, ip: string): boolean {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 5;

  const entry = rateLimitMap.get(ip);
  if (entry) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    } else if (entry.count >= maxAttempts) {
      return false;
    }
  }

  if (!storedKey) {
    console.error("SUPERADMIN_KEY non configurée");
    return false;
  }

  // Comparaison constant-time (évite les timing attacks)
  const a = Buffer.from(String(providedKey ?? ""));
  const b = Buffer.from(storedKey);
  const valid = a.length === b.length && timingSafeEqual(a, b);

  if (!valid) {
    const current = rateLimitMap.get(ip);
    if (current && now <= current.resetAt) {
      current.count += 1;
    } else {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    }
  }

  return valid;
}

/** Résout la clé superadmin : DB en priorité, sinon env SUPERADMIN_KEY */
export async function resolveSuperadminKey(dbLookup: () => Promise<string | null>): Promise<string> {
  const fromDb = await dbLookup();
  if (fromDb) return fromDb;
  const fromEnv = process.env.SUPERADMIN_KEY;
  if (!fromEnv) throw new Error("SUPERADMIN_KEY non configurée");
  return fromEnv;
}

/** Extrait l'IP du client depuis les headers de la requête */
export function getClientIp(req: { headers: { get: (key: string) => string | null } }): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
