/**
 * Adaptateur Traccar → position normalisée.
 *
 * Traccar POSTe `{ position: {...}, device: {...} }` quand `forward.type=json`.
 * Fonction PURE, testable sans réseau ni base : c'est le pendant de
 * `h02.ts` pour la passerelle retenue en production.
 *
 * Champs Traccar utilisés (vérifiés dans org.traccar.model.Position) :
 *   fixTime / deviceTime  ISO 8601
 *   valid                 booléen
 *   latitude / longitude  degrés décimaux
 *   speed                 NŒUDS (commentaire explicite du code source)
 *   course                degrés
 *   altitude              mètres
 *   protocol              'h02', 'teltonika', …
 *   attributes            sac de champs dépendant du protocole
 *   device.uniqueId       identifiant fabricant du boîtier
 *
 * Règle appliquée aux `attributes` : on ne relaie QUE ce que la source
 * déclare explicitement et dans le bon type. Rien n'est déduit. Pour le
 * ST-901, `ignition` et `odometer` seront très probablement absents — ils
 * resteront donc `null`, ce qui est le comportement voulu.
 */

export interface TraccarPayload {
  position?: Record<string, unknown>;
  device?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface IngestPosition {
  externalId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  altitudeM: number | null;
  satellites: number | null;
  validFix: boolean;
  ignition: boolean | null;
  odometerM: number | null;
  batteryV: number | null;
  externalV: number | null;
  protocol: string;
  eventType: string;
  statusRaw: string | null;
  raw: Record<string, unknown>;
}

export type AdaptResult =
  | { ok: true; position: IngestPosition }
  | { ok: false; reason: string };

const KNOTS_TO_KMH = 1.852;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Normalise un payload Traccar en position d'ingestion. */
export function adaptTraccarPayload(body: TraccarPayload): AdaptResult {
  const p = body?.position;
  const d = body?.device;
  if (!p || typeof p !== "object") return { ok: false, reason: "position absente" };

  const externalId =
    str(d?.["uniqueId"]) ?? str(p["uniqueId"]) ?? str(p["deviceId"]);
  if (!externalId) return { ok: false, reason: "identifiant de boîtier absent" };

  const recordedRaw = str(p["fixTime"]) ?? str(p["deviceTime"]) ?? str(p["serverTime"]);
  if (!recordedRaw) return { ok: false, reason: "horodatage absent" };
  const recorded = new Date(recordedRaw);
  if (Number.isNaN(recorded.getTime())) return { ok: false, reason: "horodatage illisible" };

  const latitude = num(p["latitude"]);
  const longitude = num(p["longitude"]);
  if (latitude === null || longitude === null) return { ok: false, reason: "coordonnées absentes" };
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { ok: false, reason: "coordonnées hors bornes" };
  }

  const attrs = (p["attributes"] && typeof p["attributes"] === "object"
    ? (p["attributes"] as Record<string, unknown>)
    : {});

  const knots = num(p["speed"]);

  return {
    ok: true,
    position: {
      externalId,
      recordedAt: recorded.toISOString(),
      latitude,
      longitude,
      speedKmh: knots === null ? null : Math.round(knots * KNOTS_TO_KMH * 100) / 100,
      heading: num(p["course"]),
      altitudeM: num(p["altitude"]),
      satellites: num(attrs["sat"]),
      // `valid` absent ⇒ on ne suppose pas que le point est bon.
      validFix: p["valid"] === true,
      ignition: bool(attrs["ignition"]),
      odometerM: num(attrs["odometer"]),
      batteryV: num(attrs["battery"]),
      externalV: num(attrs["power"]),
      protocol: str(p["protocol"]) ?? "unknown",
      eventType: str(attrs["alarm"]) ?? "position",
      statusRaw: str(attrs["status"]),
      raw: { position: p, device: d ?? null },
    },
  };
}

/** Convertit une position H02 déjà parsée au format d'ingestion commun. */
export function fromH02(pos: {
  externalId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  speedKmh: number;
  heading: number;
  validFix: boolean;
  statusRaw: string | null;
  raw: unknown;
}): IngestPosition {
  return {
    externalId: pos.externalId,
    recordedAt: pos.recordedAt,
    latitude: pos.latitude,
    longitude: pos.longitude,
    speedKmh: pos.speedKmh,
    heading: pos.heading,
    altitudeM: null,
    satellites: null,
    validFix: pos.validFix,
    ignition: null, // masque de statut non calibré — jamais deviné
    odometerM: null,
    batteryV: null,
    externalV: null,
    protocol: "h02",
    eventType: "position",
    statusRaw: pos.statusRaw,
    raw: pos.raw as Record<string, unknown>,
  };
}
