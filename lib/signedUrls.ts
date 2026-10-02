/**
 * Côté client : obtenir des URLs consultables pour des pièces de
 * `kyc-documents`, en remplacement de `getPublicUrl()`.
 *
 * `getPublicUrl()` ne construisait qu'une chaîne, sans appel réseau ni contrôle
 * d'accès — elle ne fonctionnait que parce que le bucket était public, donc
 * ouvert à tous. Ici, c'est le serveur qui décide : il vérifie en base que la
 * pièce appartient au tenant de l'appelant, et au chauffeur lui-même quand
 * c'en est un.
 *
 * Les URLs renvoyées expirent au bout de 30 minutes. C'est suffisant pour
 * ouvrir une pièce depuis un écran, et c'est voulu : une adresse copiée dans
 * une conversation cesse de fonctionner.
 */

/** Map chemin → URL signée. Un chemin absent = pièce introuvable ou refusée. */
export type UrlsSignees = Record<string, string>;

export async function obtenirUrlsSignees(paths: string[]): Promise<UrlsSignees> {
  const utiles = [...new Set(paths.filter(Boolean))];
  if (utiles.length === 0) return {};
  try {
    const res = await fetch("/api/kyc-signed-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: utiles }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Échec tracé (il était avalé en silence : l'admin voyait « aucune
      // photo » sans indice). L'écran affiche « Photo indisponible » + Réessayer.
      console.error("[signedUrls] signature refusée", res.status, body?.error ?? "");
      return {};
    }
    const urls = (body?.urls as UrlsSignees) ?? {};
    const manquants = utiles.filter((p) => !urls[p]);
    if (manquants.length) {
      // Pièce sans ligne `uploads` du tenant (tenant_id NULL, autre tenant) ou
      // fichier absent du bucket : signalé pour diagnostic.
      console.error(`[signedUrls] ${manquants.length} pièce(s) non signée(s)`, manquants);
    }
    return urls;
  } catch (err) {
    // Pas d'exception remontée : une vignette manquante ne doit pas faire
    // tomber l'écran de validation qui l'entoure.
    console.error("[signedUrls] réseau indisponible", err);
    return {};
  }
}
