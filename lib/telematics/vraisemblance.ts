/**
 * Une position reçue est-elle vraisemblable ? Audit de sécurité du 18/10/2026 (I1) : un boîtier H02 ne
 * s'authentifie pas ; qui connaît son identifiant et l'adresse de la passerelle peut envoyer des positions.
 * On écarte donc ce qu'aucun camion réel ne produit : une heure dans le futur ou trop ancienne, et un saut
 * de position qui supposerait une vitesse impossible depuis le dernier point connu du boîtier.
 */
export const AVANCE_MAX_S = 10 * 60;
/** Le connecteur iGeoTrack peut rattraper un historique : on garde une marge large. */
export const RETARD_MAX_J = 45;
/** Au-delà, un camion ne roule pas ; en deçà de SAUT_MIN_M, le flottement du GPS suffit à l'expliquer. */
export const VITESSE_MAX_KMH = 160;
export const SAUT_MIN_M = 2000;

export interface Point { recordedAt: string; latitude: number; longitude: number }

const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Null si la position est vraisemblable, sinon la raison du refus. `precedent` : le dernier point connu du boîtier. */
export function invraisemblance(p: Point, precedent: Point | null, maintenant: number = Date.now()): string | null {
  const t = Date.parse(p.recordedAt);
  if (!Number.isFinite(t)) return "heure illisible";
  if (t - maintenant > AVANCE_MAX_S * 1000) return "heure dans le futur";
  if (maintenant - t > RETARD_MAX_J * 86400000) return "position trop ancienne";
  if (!precedent) return null;
  const d = distanceM(p, precedent);
  if (d < SAUT_MIN_M) return null;
  const secondes = Math.abs(t - Date.parse(precedent.recordedAt)) / 1000;
  const kmh = secondes > 0 ? (d / 1000) / (secondes / 3600) : Infinity;
  return kmh > VITESSE_MAX_KMH ? `saut impossible (${Math.round(d / 1000)} km à ${Number.isFinite(kmh) ? Math.round(kmh) : "∞"} km/h)` : null;
}

/**
 * Filtre une série de positions d'un même boîtier, dans l'ordre du temps : chaque position acceptée devient
 * la référence de la suivante ; une position refusée ne déplace pas la référence.
 */
export function filtrerVraisemblables<T extends Point>(positions: T[], dernier: Point | null, maintenant: number = Date.now()): { gardees: T[]; refus: { position: T; raison: string }[] } {
  const gardees: T[] = [], refus: { position: T; raison: string }[] = [];
  let ref = dernier;
  for (const p of [...positions].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const raison = invraisemblance(p, ref, maintenant);
    if (raison) refus.push({ position: p, raison });
    else { gardees.push(p); ref = p; }
  }
  return { gardees, refus };
}
