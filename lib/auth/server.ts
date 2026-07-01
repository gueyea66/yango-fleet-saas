import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

  return { userId: user.id, tenantId: profile.tenant_id, role: profile.role };
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

  const valid = providedKey === storedKey;

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
