/**
 * Configuration centralisée — domaine et contacts.
 * Renseigner via variables d'environnement (Vercel) pour éviter tout
 * hardcode de domaine. Tant que ROOT_DOMAIN est vide, l'app fonctionne
 * en mono-domaine (login relatif), sans sous-domaines par tenant.
 */

// Domaine racine des sous-domaines tenant, ex "fleet.mondomaine.com"
// → les clients auront {slug}.fleet.mondomaine.com
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim() || "";

// Emails de contact (fallback : email M3A connu). À remplacer par une
// adresse @domaine une fois le domaine acquis.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "gueye.a66@gmail.com";
export const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || SUPPORT_EMAIL;

/** URL de connexion d'un tenant. Sous-domaine si ROOT_DOMAIN défini, sinon relative. */
export function tenantLoginUrl(slug: string): string {
  return ROOT_DOMAIN ? `https://${slug}.${ROOT_DOMAIN}/auth/login` : "/auth/login";
}

/** Aperçu affichable du sous-domaine d'un tenant (ou message si non configuré). */
export function tenantDomainPreview(slug: string): string {
  return ROOT_DOMAIN ? `${slug}.${ROOT_DOMAIN}` : "(domaine à configurer)";
}
