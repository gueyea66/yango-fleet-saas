// Point d'entrée de l'app installée (PWA) : où envoyer l'utilisateur à
// l'ouverture. Jamais la vitrine — l'espace du rôle si une session existe,
// sinon la page de connexion.

export const LOGIN_PATH = "/auth/login";

export function entryPathFor(profile: { role?: string | null; active?: boolean | null } | null | undefined): string {
  if (!profile) return LOGIN_PATH;
  if (profile.role === "admin") return "/admin";
  // Chauffeur désactivé : le middleware le déconnecte sur /driver — on lui
  // montre directement le message au lieu d'un aller-retour.
  if (profile.role === "driver") return profile.active === false ? `${LOGIN_PATH}?disabled=1` : "/driver";
  return LOGIN_PATH;
}
