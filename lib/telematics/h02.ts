/**
 * Protocole H02 (SinoTrack ST-901 et compatibles) → position normalisée.
 *
 * Fonction PURE : aucun accès réseau, aucun accès base. C'est l'adaptateur
 * fabricant du brief §6 — la seule couche qui connaît SinoTrack. Tout ce qui
 * est en aval ne voit que `NormalizedPosition`.
 *
 * Format d'une trame de position (ASCII, terminée par #) :
 *
 *   *HQ,9170258210,V1,201844,A,1440.1234,N,01726.5678,W,000.80,000,150926,FFFFF9FF,...#
 *    0      1       2    3   4     5     6     7      8    9     10    11      12    13+
 *
 *   0  en-tête constructeur (*HQ, *TH, *DC…)
 *   1  numéro de série du boîtier (= Device ID imprimé dessus)
 *   2  type de trame (V1 = position ; V4 = réponse à une commande)
 *   3  heure UTC HHMMSS
 *   4  validité du point : A = fix valide, V = invalide
 *   5  latitude DDMM.MMMM        6  N/S
 *   7  longitude DDDMM.MMMM      8  E/W
 *   9  vitesse en NŒUDS          10 cap en degrés
 *   11 date UTC DDMMYY
 *   12 masque de statut, 4 octets en hexadécimal
 *   13+ champs réseau variables selon le firmware (mcc, mnc, lac, cid…)
 *
 * Ce qu'on ne décode volontairement PAS :
 *   - l'état du moteur. La sémantique des bits du masque varie d'un fabricant
 *     à l'autre ; deviner produirait de fausses heures de service. Le masque
 *     est conservé brut (`statusRaw`) et sera calibré en observant le K3
 *     moteur coupé, puis moteur tournant.
 *   - les trames binaires ($…) : elles sont signalées comme non supportées
 *     plutôt que mal interprétées.
 */

export interface NormalizedPosition {
  /** Identifiant fabricant du boîtier, tel qu'il voyage dans la trame. */
  externalId: string;
  vendor: "sinotrack";
  protocol: "h02";
  /** Horodatage de l'APPAREIL, en ISO 8601 UTC. Fait foi sur l'heure serveur. */
  recordedAt: string;
  latitude: number;
  longitude: number;
  /** Convertie en km/h (la trame est en nœuds). */
  speedKmh: number;
  heading: number;
  /** false quand le boîtier signale un point non fixé (champ « V »). */
  validFix: boolean;
  /** Masque de statut brut, non interprété. */
  statusRaw: string | null;
  eventType: "position";
  /** Trame d'origine + champs non mappés, conservés comme preuve. */
  raw: { frame: string; extra: string[] };
}

export type ParseResult =
  | { ok: true; position: NormalizedPosition }
  | { ok: false; reason: string; frame: string };

const KNOTS_TO_KMH = 1.852;

function fail(frame: string, reason: string): ParseResult {
  return { ok: false, reason, frame };
}

/**
 * Convertit une coordonnée DDMM.MMMM / DDDMM.MMMM en degrés décimaux.
 * `degDigits` vaut 2 pour une latitude, 3 pour une longitude.
 */
function toDecimalDegrees(value: string, degDigits: 2 | 3): number | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const dot = value.indexOf(".");
  const intPart = dot === -1 ? value : value.slice(0, dot);
  // Certains firmwares omettent le zéro de tête sur la longitude.
  if (intPart.length < degDigits + 1) return null;
  const degrees = Number(value.slice(0, intPart.length - 2));
  const minutes = Number(value.slice(intPart.length - 2));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null;
  if (minutes >= 60) return null;
  return degrees + minutes / 60;
}

/** DDMMYY + HHMMSS → ISO 8601 UTC. */
function toIsoUtc(date: string, time: string): string | null {
  if (!/^\d{6}$/.test(date) || !/^\d{6}$/.test(time)) return null;
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const year = 2000 + Number(date.slice(4, 6));
  const hh = Number(time.slice(0, 2));
  const mm = Number(time.slice(2, 4));
  const ss = Number(time.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hh, mm, ss);
  const d = new Date(ms);
  // Rejette les dates impossibles absorbées par Date.UTC (31 février…).
  if (d.getUTCDate() !== day || d.getUTCMonth() !== month - 1) return null;
  return d.toISOString();
}

/** Parse une trame H02 unique. */
export function parseH02Frame(input: string): ParseResult {
  const frame = input.trim();
  if (!frame) return fail(frame, "trame vide");
  if (frame.startsWith("$")) return fail(frame, "trame binaire H02 non supportée");
  if (!frame.startsWith("*")) return fail(frame, "en-tête manquant");

  const body = frame.endsWith("#") ? frame.slice(1, -1) : frame.slice(1);
  const f = body.split(",");
  if (f.length < 13) return fail(frame, `trame trop courte (${f.length} champs)`);

  const [, externalId, type, time, validity, latRaw, ns, lonRaw, ew, speedRaw, headingRaw, date, status] = f;

  if (type !== "V1") return fail(frame, `type de trame non géré : ${type}`);
  if (!externalId || !/^\d{6,20}$/.test(externalId)) return fail(frame, "numéro de boîtier invalide");

  const recordedAt = toIsoUtc(date, time);
  if (!recordedAt) return fail(frame, "date/heure invalide");

  const lat = toDecimalDegrees(latRaw, 2);
  const lon = toDecimalDegrees(lonRaw, 3);
  if (lat === null || lon === null) return fail(frame, "coordonnées illisibles");
  if (ns !== "N" && ns !== "S") return fail(frame, "hémisphère invalide");
  if (ew !== "E" && ew !== "W") return fail(frame, "méridien invalide");

  const latitude = ns === "S" ? -lat : lat;
  const longitude = ew === "W" ? -lon : lon;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return fail(frame, "coordonnées hors bornes");
  }

  const knots = Number(speedRaw);
  const heading = Number(headingRaw);

  return {
    ok: true,
    position: {
      externalId,
      vendor: "sinotrack",
      protocol: "h02",
      recordedAt,
      latitude,
      longitude,
      speedKmh: Number.isFinite(knots) ? Math.round(knots * KNOTS_TO_KMH * 100) / 100 : 0,
      heading: Number.isFinite(heading) ? heading : 0,
      validFix: validity === "A",
      statusRaw: status || null,
      eventType: "position",
      raw: { frame, extra: f.slice(13) },
    },
  };
}

/**
 * Découpe un segment TCP en trames. Un paquet peut en contenir plusieurs
 * collées, ou se terminer au milieu de l'une d'elles : le reste incomplet est
 * renvoyé dans `rest`, à rabouter avec le paquet suivant.
 */
export function parseH02Stream(chunk: string): { results: ParseResult[]; rest: string } {
  const results: ParseResult[] = [];
  let rest = chunk;

  for (;;) {
    const end = rest.indexOf("#");
    if (end === -1) break;
    const frame = rest.slice(0, end + 1);
    rest = rest.slice(end + 1);
    if (frame.trim()) results.push(parseH02Frame(frame));
  }

  // Garde-fou : un flux sans « # » ne doit pas faire gonfler la mémoire.
  if (rest.length > 4096) rest = "";

  return { results, rest };
}
