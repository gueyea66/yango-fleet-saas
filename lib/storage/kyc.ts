import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "kyc-documents";

/** Client Storage service role — contourne les policies RLS de storage.objects. */
let _client: SupabaseClient | null = null;
export function storageAdmin(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _client;
}

/**
 * Le bucket kyc-documents est privé : sans une VRAIE clé service role, chaque
 * appel Storage échoue sur un « Access denied » opaque, impossible à
 * diagnostiquer depuis l'interface. On vérifie donc la clé en amont.
 *
 * Retourne un message d'erreur explicite, ou null si la clé est exploitable.
 */
export function assertServiceRoleKey(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) return "Configuration serveur : NEXT_PUBLIC_SUPABASE_URL est absente.";
  if (!key) {
    return "Configuration serveur : SUPABASE_SERVICE_ROLE_KEY est absente. " +
           "Ajoute-la dans les variables d'environnement (Vercel > Settings > Environment Variables) puis redéploie.";
  }

  // Nouveau format de clés Supabase (2025) : sb_secret_… = serveur, sb_publishable_… = navigateur.
  if (key.startsWith("sb_publishable_")) {
    return "Configuration serveur : SUPABASE_SERVICE_ROLE_KEY contient une clé publishable " +
           "(sb_publishable_…) au lieu de la clé secrète (sb_secret_…). " +
           "Copie la clé « secret » depuis Supabase > Settings > API Keys, puis redéploie.";
  }
  if (key.startsWith("sb_secret_")) return null;

  // Ancien format : JWT dont le claim `role` doit valoir service_role.
  const role = jwtRole(key);
  if (role === null) {
    return "Configuration serveur : SUPABASE_SERVICE_ROLE_KEY n'est pas une clé Supabase valide. " +
           "Recopie-la depuis Supabase > Settings > API, puis redéploie.";
  }
  if (role !== "service_role") {
    return `Configuration serveur : SUPABASE_SERVICE_ROLE_KEY contient une clé « ${role} » ` +
           "et non la clé service_role. C'est la cause du refus « Access denied » sur les uploads. " +
           "Remplace-la par la clé service_role (Supabase > Settings > API), puis redéploie.";
  }
  return null;
}

/** Lit le claim `role` d'un JWT Supabase sans vérifier la signature. */
function jwtRole(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const role = JSON.parse(json)?.role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

/**
 * Traduit une erreur Supabase Storage en message actionnable.
 * « Access denied » brut ne dit rien à l'utilisateur ni à l'exploitant.
 */
export function describeStorageError(err: { message?: string; name?: string }): { status: number; message: string } {
  const raw = err?.message || "Erreur de stockage inconnue";

  if (/access denied|unauthorized|row-level security|not authorized/i.test(raw)) {
    return {
      status: 502,
      message:
        "Stockage refusé par Supabase (« " + raw + " »). Cause la plus probable : " +
        "SUPABASE_SERVICE_ROLE_KEY invalide ou périmée côté serveur. " +
        "Vérifie la variable dans Vercel puis redéploie. " +
        "Si elle est correcte, exécute supabase-storage-kyc-policies.sql dans le SQL Editor.",
    };
  }
  if (/mime type/i.test(raw)) {
    return { status: 400, message: `Type de fichier refusé par le bucket : ${raw}` };
  }
  if (/exceeded|too large|payload/i.test(raw)) {
    return { status: 413, message: `Fichier refusé par le bucket : ${raw}` };
  }
  return { status: 502, message: raw };
}
