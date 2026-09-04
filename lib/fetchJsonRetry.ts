/**
 * Fetch JSON avec retry automatique — fix instabilité des refresh (retour Abdou
 * 03/09) : au rechargement de la page, plusieurs appels /api/admin/* partent en
 * parallèle pendant que le token de session se rafraîchit ; l'un d'eux peut
 * prendre un 401/500 transitoire (course au refresh token, cold start Vercel).
 * Sans retry, le dashboard affichait des zéros silencieux ou « Session expirée »
 * alors qu'un second refresh suffisait. Ici : jusqu'à 2 retries espacés, et une
 * réponse non-ok devient une VRAIE erreur (jamais de données vides silencieuses).
 * 402 (tenant verrouillé) et 403 (interdit) sont définitifs : pas de retry.
 */
export async function fetchJsonRetry(
  url: string,
  init?: RequestInit,
  opts: { retries?: number; delayMs?: number } = {}
): Promise<any> {
  const { retries = 2, delayMs = 700 } = opts;
  let lastErr: (Error & { status?: number }) | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return await res.json();
      const body = await res.json().catch(() => ({} as { error?: string }));
      const err = new Error(body.error || `HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      if (res.status === 402 || res.status === 403) throw err;
      lastErr = err;
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 402 || err.status === 403) throw err;
      lastErr = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
  }
  throw lastErr || new Error("Échec de chargement");
}
