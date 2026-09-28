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
    if (!res.ok) return {};
    const body = await res.json().catch(() => ({}));
    return (body?.urls as UrlsSignees) ?? {};
  } catch {
    // Pas d'exception remontée : une vignette manquante ne doit pas faire
    // tomber l'écran de validation qui l'entoure.
    return {};
  }
}
