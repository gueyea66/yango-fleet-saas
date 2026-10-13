/**
 * Lecture de l'API d'une plateforme GPSwox — le boîtier n'est jamais touché.
 *
 * Le boîtier continue d'émettre vers sa plateforme d'origine ; M3A relit
 * simplement ce que cette plateforme sait déjà. Rien n'est à demander au
 * prestataire GPS, et le client garde son application.
 *
 * Deux moitiés, volontairement séparées :
 *   - lecture PURE de la réponse (`aplatirBoitiers`, `lireBoitier`), testable
 *     sans réseau ;
 *   - deux appels réseau (`connecter`, `listerBoitiers`).
 *
 * Champs GPSwox utilisés (`/api/get_devices`) :
 *   device_data.imei   identifiant du boîtier — c'est lui qui fait le lien
 *   timestamp          secondes Unix, sans ambiguïté de fuseau
 *   lat / lng          degrés décimaux
 *   speed              dans l'unité du compte (`distance_unit_hour`)
 *   course, altitude   degrés, mètres
 *
 * Le champ `time` est ignoré : c'est un texte mis en forme dans le fuseau et
 * le format choisis par l'utilisateur du compte. Le lire reviendrait à deviner
 * l'heure — et une heure fausse déplace un trajet d'un jour à l'autre.
 */

import { normalizeDeviceId } from "./devices";
import type { AdaptResult } from "./traccar";

export interface BoitierGpswox {
  imei: string | null;
  nom: string | null;
  plaque: string | null;
  protocole: string | null;
  /** Dernier signal connu de la plateforme d'origine (ISO), ou null. */
  vuLe: string | null;
  position: AdaptResult;
}

const MPH_TO_KMH = 1.609344;
const AN_2000_S = 946_684_800;

// GPSwox sérialise selon les versions un nombre ou sa forme texte ("14.6737").
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * `/api/get_devices` rend des groupes (`[{ title, items: [...] }]`). On accepte
 * aussi une liste à plat, pour ne pas dépendre de la version du serveur.
 */
export function aplatirBoitiers(payload: unknown): Record<string, unknown>[] {
  const racine = Array.isArray(payload) ? payload : obj(payload)?.["items"];
  if (!Array.isArray(racine)) return [];
  const out: Record<string, unknown>[] = [];
  for (const entree of racine) {
    const e = obj(entree);
    if (!e) continue;
    if (Array.isArray(e["items"])) {
      for (const item of e["items"]) {
        const i = obj(item);
        if (i) out.push(i);
      }
    } else {
      out.push(e);
    }
  }
  return out;
}

/** Ce qu'on garde comme preuve : ni la traîne de points, ni les données de carte SIM. */
function brut(item: Record<string, unknown>): Record<string, unknown> {
  const garde: Record<string, unknown> = {};
  for (const k of ["id", "name", "online", "time", "timestamp", "acktimestamp", "lat", "lng",
    "speed", "course", "altitude", "protocol", "distance_unit_hour", "total_distance",
    "stop_duration", "engine_status"]) {
    if (item[k] !== undefined) garde[k] = item[k];
  }
  return { source: "gpswox-api", item: garde };
}

export function lireBoitier(item: Record<string, unknown>): BoitierGpswox {
  const data = obj(item["device_data"]) ?? {};
  const imeiBrut = str(data["imei"]) ?? str(item["imei"]) ?? (num(data["imei"]) !== null ? String(data["imei"]) : null);
  const imei = imeiBrut ? normalizeDeviceId(imeiBrut) : null;
  const nom = str(item["name"]) ?? str(data["name"]);
  const plaque = str(data["plate_number"]) ?? str(item["plate_number"]);
  const protocole = str(item["protocol"])?.toLowerCase() ?? null;

  let ts = num(item["timestamp"]);
  if (ts !== null && ts > 1e12) ts = ts / 1000; // certaines versions répondent en millisecondes
  const horodate = ts !== null && ts > AN_2000_S ? new Date(ts * 1000) : null;
  const vuLe = horodate ? horodate.toISOString() : null;

  const base = { imei, nom, plaque, protocole, vuLe };
  const refus = (reason: string): BoitierGpswox => ({ ...base, position: { ok: false, reason } });

  if (!imei) return refus(`boîtier « ${nom ?? "sans nom"} » sans IMEI lisible`);
  if (!vuLe) return refus(`boîtier ${imei} : aucun signal horodaté sur la plateforme d'origine`);

  const latitude = num(item["lat"]) ?? num(item["latitude"]);
  const longitude = num(item["lng"]) ?? num(item["longitude"]);
  if (latitude === null || longitude === null) return refus(`boîtier ${imei} : coordonnées absentes`);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return refus(`boîtier ${imei} : coordonnées hors bornes`);
  // (0, 0) est la valeur d'un boîtier qui n'a jamais eu de fix, pas un point dans le golfe de Guinée.
  if (latitude === 0 && longitude === 0) return refus(`boîtier ${imei} : pas encore de position GPS`);

  const vitesse = num(item["speed"]);
  const unite = str(item["distance_unit_hour"])?.toLowerCase() ?? "";
  const speedKmh = vitesse === null ? null
    : Math.round(vitesse * (unite.startsWith("mph") ? MPH_TO_KMH : 1) * 100) / 100;

  return {
    ...base,
    position: {
      ok: true,
      position: {
        externalId: imei,
        recordedAt: vuLe,
        latitude,
        longitude,
        speedKmh,
        heading: num(item["course"]),
        altitudeM: num(item["altitude"]),
        satellites: null,
        validFix: true,
        // Seul un booléen explicite est repris : les capteurs GPSwox portent
        // des libellés libres (« On », « Allumé »…) qu'on ne devine pas.
        ignition: typeof item["engine_status"] === "boolean" ? (item["engine_status"] as boolean) : null,
        // `total_distance` est un cumul calculé par GPSwox, pas le compteur du
        // véhicule : il reste dans le brut, pas dans l'odomètre.
        odometerM: null,
        batteryV: null,
        externalV: null,
        protocol: protocole ?? "gpswox",
        eventType: "position",
        statusRaw: str(item["online"]),
        raw: brut(item),
      },
    },
  };
}

/** Plaque réduite à ses lettres et chiffres : « AA 123 BC », « aa-123-bc » → « AA123BC ». */
export const plaqueNue = (v: string | null | undefined): string =>
  String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Propose le véhicule d'un boîtier d'après sa plaque — celle déclarée dans
 * GPSwox, ou à défaut celle que l'installateur a écrite dans le nom.
 * Ne propose rien quand deux véhicules conviennent : c'est au gestionnaire de trancher.
 */
export function suggererVehicule(
  boitier: { nom: string | null; plaque: string | null },
  vehicules: { id: string; plate: string }[],
): string | null {
  const textes = [plaqueNue(boitier.plaque), plaqueNue(boitier.nom)].filter(Boolean);
  if (!textes.length) return null;
  const trouves = vehicules.filter((v) => {
    const p = plaqueNue(v.plate);
    return p.length >= 4 && textes.some((t) => t.includes(p));
  });
  return trouves.length === 1 ? trouves[0].id : null;
}

// ── Réseau ───────────────────────────────────────────────────────────────

export class GpswoxError extends Error {
  constructor(message: string, readonly code: "adresse" | "identifiants" | "session" | "injoignable" | "reponse") {
    super(message);
  }
}

/**
 * Adresse du serveur GPSwox, telle que le prestataire la communique.
 * Le serveur de M3A va l'appeler : on refuse donc tout ce qui pointerait vers
 * une machine interne plutôt que vers une plateforme GPS publique.
 */
export function normaliserAdresse(saisie: string): string {
  const texte = saisie.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(texte) && !/^https?:\/\//i.test(texte)) throw new Error("schéma");
    url = new URL(/^https?:\/\//i.test(texte) ? texte : `http://${texte}`);
  } catch {
    throw new GpswoxError("Adresse du serveur illisible.", "adresse");
  }
  const h = url.hostname.toLowerCase();
  const prive = h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.includes(":")
    || /^(0|10|127)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (prive || url.username || url.password) {
    throw new GpswoxError("Cette adresse n'est pas celle d'une plateforme GPS publique.", "adresse");
  }
  return `${url.protocol}//${url.host}`;
}

async function appeler(url: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new GpswoxError("La plateforme GPS ne répond pas.", "injoignable");
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/**
 * Échange l'identifiant et le mot de passe contre la clé d'API du compte.
 * Le mot de passe ne sert qu'ici : il n'est ni stocké ni journalisé.
 */
export async function connecter(baseUrl: string, email: string, password: string): Promise<string> {
  const { status, json } = await appeler(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }).toString(),
  });
  const cle = str(obj(json)?.["user_api_hash"]);
  if (cle) return cle;
  if (status === 401 || status === 422) {
    throw new GpswoxError("Identifiant ou mot de passe refusé par la plateforme GPS.", "identifiants");
  }
  throw new GpswoxError(`Réponse inattendue de la plateforme GPS (HTTP ${status}).`, "reponse");
}

export async function listerBoitiers(baseUrl: string, cle: string): Promise<BoitierGpswox[]> {
  // L'API GPSwox n'accepte la clé que dans l'adresse ; l'appel part du serveur, jamais du navigateur.
  const { status, json } = await appeler(
    `${baseUrl}/api/get_devices?lang=fr&user_api_hash=${encodeURIComponent(cle)}`);
  if (status === 401 || status === 403) {
    throw new GpswoxError("La plateforme GPS ne reconnaît plus la connexion : reconnectez le compte.", "session");
  }
  if (status !== 200 || json === null) {
    throw new GpswoxError(`Réponse inattendue de la plateforme GPS (HTTP ${status}).`, "reponse");
  }
  return aplatirBoitiers(json).map(lireBoitier);
}
