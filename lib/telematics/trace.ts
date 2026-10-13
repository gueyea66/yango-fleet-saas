import { haversineM } from "./trips";

/**
 * Trace à dessiner : les positions, moins la dérive du GPS à l'arrêt.
 *
 * Un véhicule garé n'envoie pas le même point en boucle : entre des immeubles,
 * la position calculée se promène de quelques dizaines de mètres, parfois plus
 * de cent. Reliés par un trait, ces points dessinent un gribouillis qui
 * ressemble à des allers-retours — alors que le calcul des trajets, lui, compte
 * zéro kilomètre (constaté le 13/10/2026 sur le K3 garé aux Parcelles).
 *
 * La carte doit montrer ce que le calcul compte. Les points d'un arrêt sont
 * donc ramenés à un seul, et un point n'ouvre un déplacement que si :
 *   - le boîtier annonce une vitesse, et le point est sorti du bruit ordinaire ;
 *   - ou deux points de suite sont trop loin du CENTRE de l'arrêt pour qu'une
 *     dérive l'explique, vitesse annoncée ou non.
 * La distance se mesure au centre du nuage et non à son premier point : ce
 * premier point peut être au bord, et un nuage de 160 m de large s'en
 * éloignerait « réellement » à chaque oscillation.
 * Les positions brutes ne sont pas touchées : seul le dessin est allégé.
 */

export interface PointTrace {
  recorded_at: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
}

/** Vitesse à partir de laquelle on croit le boîtier quand il dit rouler (km/h). */
const VITESSE_ROULE = 5;
/** Bruit ordinaire d'un fix à l'arrêt (m). */
const BRUIT_M = 25;
/** Au-delà de cette distance au centre de l'arrêt, deux points de suite font un départ (m). */
const DERIVE_MAX_M = 150;

export function tracePropre<T extends PointTrace>(points: T[]): { trace: T[]; regroupes: number } {
  if (points.length < 2) return { trace: points, regroupes: 0 };
  const trace: T[] = [points[0]];
  // centre de l'arrêt en cours : moyenne des points qu'on y a regroupés
  let lat = points[0].latitude, lon = points[0].longitude, n = 1;
  let candidat: T | null = null;
  const repartir = (p: T) => { trace.push(p); lat = p.latitude; lon = p.longitude; n = 1; candidat = null; };

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const d = haversineM(lat, lon, p.latitude, p.longitude);
    if ((p.speed_kmh ?? 0) >= VITESSE_ROULE && d > BRUIT_M) {
      repartir(p);
    } else if (d > DERIVE_MAX_M) {
      if (candidat) { trace.push(candidat); repartir(p); } else candidat = p;
    } else {
      candidat = null;
      lat = (lat * n + p.latitude) / (n + 1); lon = (lon * n + p.longitude) / (n + 1); n++;
    }
  }
  return { trace, regroupes: points.length - trace.length };
}
