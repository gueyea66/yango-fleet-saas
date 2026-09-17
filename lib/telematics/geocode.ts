/**
 * Géocodage inverse : des coordonnées vers un lieu lisible.
 *
 * « 07:03 → 09:13, 124 km » ne se lit pas. « Départ Almadies, arrivée carrière
 * de Diack » se lit. C'est la différence entre une donnée et une information.
 *
 * Deux parties :
 *   • `labelDepuisNominatim()` — PURE, testable : transforme une réponse
 *     OpenStreetMap en libellé court et utilisable ;
 *   • `resoudreAdresses()` — appelle le fournisseur en respectant sa limite
 *     de débit, avec cache partagé en base.
 *
 * Choix du fournisseur : Nominatim (OpenStreetMap), gratuit et sans clé, mais
 * limité à une requête par seconde et interdit d'usage massif. C'est tenable
 * ici — on ne géocode QUE les deux extrémités d'un trajet, pas les positions,
 * et le résultat est mis en cache. Le jour où la flotte grossit, il faudra un
 * fournisseur payant : seule cette fonction changera.
 */

export interface LieuResolu {
  lat: number;
  lon: number;
  label: string;
}

/** Arrondi ~11 m : deux arrêts au même endroit partagent la même entrée de cache. */
export function cleCache(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

type AdresseOSM = Record<string, string | undefined>;

/**
 * Construit un libellé court à partir d'une réponse Nominatim.
 *
 * On privilégie ce qu'un conducteur reconnaîtrait : le lieu-dit ou le
 * commerce, la rue, le quartier, la ville. Jamais le pays ni le code postal,
 * qui n'apprennent rien à un gestionnaire de flotte dakarois.
 */
export function labelDepuisNominatim(reponse: unknown): string | null {
  if (!reponse || typeof reponse !== "object") return null;
  const r = reponse as { name?: string; display_name?: string; address?: AdresseOSM; error?: string };
  if (r.error) return null;

  const a = r.address ?? {};
  const morceaux = [
    r.name?.trim() || undefined,
    a.amenity || a.building || a.shop || undefined,
    a.road || a.pedestrian || a.footway || undefined,
    a.neighbourhood || a.suburb || a.quarter || a.village || undefined,
    a.town || a.city || a.municipality || a.county || undefined,
  ];

  const vus = new Set<string>();
  const label = morceaux
    .filter((m): m is string => Boolean(m && m.trim()))
    .map((m) => m.trim())
    .filter((m) => {
      const k = m.toLowerCase();
      if (vus.has(k)) return false;
      vus.add(k);
      return true;
    })
    .slice(0, 3)
    .join(", ");

  if (label) return label;
  // Dernier recours : le libellé complet, amputé du pays et du code postal.
  const brut = r.display_name?.split(",").slice(0, 3).join(",").trim();
  return brut || null;
}

export function urlNominatim(lat: number, lon: number): string {
  const p = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "17",
    addressdetails: "1",
    "accept-language": "fr",
  });
  return `https://nominatim.openstreetmap.org/reverse?${p}`;
}

/**
 * Résout une liste de points, cache d'abord.
 *
 * `lire` et `ecrire` sont fournis par l'appelant (accès base), pour que cette
 * fonction reste testable sans base ni réseau. Le débit est volontairement
 * bridé : dépasser la limite de Nominatim ferait bannir l'adresse IP du
 * service, donc couperait la fonction pour tous les clients.
 */
export async function resoudreAdresses(
  points: { lat: number; lon: number }[],
  deps: {
    lire: (cles: { lat: number; lon: number }[]) => Promise<Map<string, string>>;
    ecrire: (lieux: LieuResolu[]) => Promise<void>;
    fetchImpl?: typeof fetch;
    contact?: string;
    maxAppels?: number;
    delaiMs?: number;
  },
): Promise<Map<string, string>> {
  const { lire, ecrire, fetchImpl = fetch, contact, maxAppels = 25, delaiMs = 1100 } = deps;
  const cle = (p: { lat: number; lon: number }) => {
    const c = cleCache(p.lat, p.lon);
    return `${c.lat},${c.lon}`;
  };

  const uniques = new Map<string, { lat: number; lon: number }>();
  for (const p of points) {
    if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) uniques.set(cle(p), cleCache(p.lat, p.lon));
  }

  const connus = await lire([...uniques.values()]);
  const manquants = [...uniques.entries()].filter(([k]) => !connus.has(k)).slice(0, maxAppels);

  const nouveaux: LieuResolu[] = [];
  for (const [k, point] of manquants) {
    try {
      const res = await fetchImpl(urlNominatim(point.lat, point.lon), {
        headers: {
          // Nominatim exige une identification : sans elle, les requêtes sont
          // rejetées, et une identification mensongère fait bannir.
          "User-Agent": `M3A Fleet/1.0 (${contact ?? "contact@m3afleet.com"})`,
          "Accept-Language": "fr",
        },
      });
      if (!res.ok) continue;
      const label = labelDepuisNominatim(await res.json());
      if (label) {
        connus.set(k, label);
        nouveaux.push({ lat: point.lat, lon: point.lon, label });
      }
    } catch {
      // Un géocodage raté n'est pas un incident : le trajet reste affiché avec
      // ses coordonnées, et la prochaine passe réessaiera.
    }
    if (delaiMs > 0) await new Promise((r) => setTimeout(r, delaiMs));
  }

  if (nouveaux.length) await ecrire(nouveaux);
  return connus;
}
