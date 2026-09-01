/**
 * Accès navigateur aux fichiers du bucket privé `kyc-documents`.
 *
 * Le bucket n'est pas public : `getPublicUrl()` renvoie une URL qui ne
 * résout pas, et signer côté client dépend de policies storage.objects qui
 * peuvent ne pas être déployées (« Access denied »). On passe donc par
 * /api/kyc-file, qui signe avec la clé service role après contrôle du tenant.
 */

/** URLs signées pour plusieurs chemins. Les fichiers inaccessibles sont omis. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const wanted = paths.filter(Boolean);
  if (wanted.length === 0) return {};
  try {
    const res = await fetch("/api/kyc-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: wanted }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    return json?.urls ?? {};
  } catch {
    return {};
  }
}

/** URL signée pour un seul chemin, ou null. */
export async function signedUrl(path: string): Promise<string | null> {
  if (!path) return null;
  const urls = await signedUrls([path]);
  return urls[path] ?? null;
}
