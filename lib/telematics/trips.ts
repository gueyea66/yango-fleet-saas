/**
 * Moteur d'inférence : positions brutes → trajets, événements, agrégat du jour.
 *
 * Fonction PURE (brief §11) : aucune base, aucun réseau, aucune horloge. Tout
 * est recalculable depuis les positions brutes, et le `METHOD_VERSION` permet
 * de savoir quelle méthode a produit une ligne — donc de tout rejouer quand la
 * méthode s'améliore, sans avoir perdu d'historique.
 *
 * Ce moteur ne dépend PAS de l'état moteur, qui n'est pas calibré sur le
 * ST-901 (cf. docs/TELEMATICS/02-ANALYTICS-DESIGN.md §3) : le mouvement se
 * mesure par le déplacement. Le jour où l'ignition sera fiable, elle viendra
 * confirmer ces trajets, pas les fonder.
 */

/**
 * Version de la méthode d'inférence. Toute ligne dérivée la porte, ce qui
 * permet de rejouer l'historique quand la méthode change, sans jamais toucher
 * aux positions brutes.
 *
 * 1.3.0 — un arrêt se juge sur la géométrie, plus seulement sur la durée :
 *         un embouteillage ne coupe plus une course en deux.
 * 1.2.0 — la couverture tient compte de la déperdition diffuse de points,
 *         pas seulement des coupures franches.
 * 1.1.0 — la couverture se mesure sur la journée de travail observée, et
 *         l'interruption nocturne n'est plus comptée comme une panne.
 * 1.0.0 — première version (couverture faussée par les nuits).
 */
export const METHOD_VERSION = "trips/1.3.0";

export interface RawPoint {
  recordedAt: string;
  latitude: number;
  longitude: number;
  speedKmh?: number | null;
  validFix?: boolean;
}

export interface TripParams {
  /** Durée d'immobilité qui clôt un trajet (s). */
  stopMinS: number;
  /**
   * Rayon dans lequel le véhicule doit être resté pour que l'immobilité
   * compte comme un arrêt (m).
   *
   * La durée seule ne distingue pas un arrêt d'un embouteillage : à Dakar, un
   * bouchon dépasse couramment cinq minutes, et le découpage par le temps
   * coupait alors une course en deux. Or un véhicule pris dans la circulation
   * n'est jamais immobile — il avance, lentement mais continûment, cent à
   * trois cents mètres pendant que l'horloge tourne. C'est la géométrie qui
   * les sépare, pas la durée. Seuil choisi bien au-dessus du bruit GPS
   * (≈ 15 m) et bien en dessous de toute progression réelle.
   */
  stopRadiusM: number;
  /** Écart entre deux points au-delà duquel on parle de saut de fix (m). */
  jumpMaxM: number;
  /** En deçà, le véhicule est considéré à l'arrêt (km/h). */
  movingSpeedKmh: number;
  /** Déplacement minimal d'un segment pour compter comme mouvement (m). */
  movingStepM: number;
  /** Immobilité qui produit un événement LONG_STOP (s). */
  longStopS: number;
  /** Silence du boîtier au-delà duquel on note une perte de couverture (s). */
  maxGapS: number;
  /** Distance minimale d'un trajet retenu (m) — en deçà, c'est de la dérive. */
  tripMinDistanceM: number;
  /** Durée minimale d'un trajet retenu (s). */
  tripMinDurationS: number;
  /** Cadence nominale attendue du boîtier (s) — sert à noter la confiance. */
  expectedIntervalS: number;
  /** Décalage du jour local par rapport à UTC (h). Dakar = 0 toute l'année. */
  localOffsetH: number;
  /**
   * Horodatage de référence (ms) pour décider qu'un trajet est ENCORE EN
   * COURS. Absent : aucun trajet n'est marqué en cours — le calcul reste
   * purement déterministe, ce qui est indispensable aux tests et au rejeu de
   * l'historique.
   */
  maintenant?: number;
}

export const DEFAULT_PARAMS: TripParams = {
  stopMinS: 300,
  stopRadiusM: 50,
  jumpMaxM: 3000,
  movingSpeedKmh: 5,
  movingStepM: 20,
  longStopS: 1200,
  maxGapS: 600,
  tripMinDistanceM: 300,
  tripMinDurationS: 60,
  expectedIntervalS: 30,
  localOffsetH: 0,
};

export interface Trip {
  startedAt: string;
  endedAt: string;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  distanceM: number;
  durationS: number;
  movingS: number;
  idleS: number;
  maxSpeedKmh: number;
  avgMovingSpeedKmh: number;
  points: number;
  gapsS: number;
  jumpsDropped: number;
  confidence: number;
  evidence: Record<string, number | string>;
  methodVersion: string;
  /**
   * Trajet non terminé au moment du calcul : le véhicule roulait encore.
   * L'heure et le lieu d'arrivée sont ceux du DERNIER POINT CONNU, pas d'une
   * arrivée réelle — l'écran doit le dire, sinon un trajet en cours serait lu
   * comme un trajet accompli.
   */
  enCours: boolean;
}

export type DerivedEventType =
  | "TRIP_STARTED"
  | "TRIP_ENDED"
  | "LONG_STOP"
  | "GPS_OFFLINE";

export interface DerivedEvent {
  type: DerivedEventType;
  at: string;
  latitude: number;
  longitude: number;
  tripIndex: number | null;
  confidence: number;
  evidence: Record<string, number | string>;
  methodVersion: string;
}

export interface DailyAggregate {
  day: string;
  distanceM: number;
  movingS: number;
  idleS: number;
  trips: number;
  points: number;
  gapsS: number;
  jumpsDropped: number;
  firstMovementAt: string | null;
  lastMovementAt: string | null;
  /** Part du temps réellement couverte par le boîtier (0 à 1). */
  coverage: number;
  maxSpeedKmh: number;
  methodVersion: string;
}

export interface TripsResult {
  trips: Trip[];
  events: DerivedEvent[];
  daily: DailyAggregate[];
  /** Points écartés avant tout calcul, avec leur motif. */
  discarded: { invalidFix: number; outOfOrder: number; duplicates: number };
}

const EARTH_R = 6371000;

export function haversineM(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Jour local au format YYYY-MM-DD. */
function localDay(iso: string, offsetH: number): string {
  return new Date(Date.parse(iso) + offsetH * 3600_000).toISOString().slice(0, 10);
}

interface Segment {
  fromIdx: number;
  toIdx: number;
  dtS: number;
  distM: number;
  speedKmh: number;
  moving: boolean;
  jump: boolean;
  gap: boolean;
  /**
   * Trou de couverture survenu À L'INTÉRIEUR d'une même journée locale.
   *
   * Distinction indispensable, constatée sur les premières données réelles :
   * le silence entre le dernier point du soir et le premier du lendemain
   * matin dure 18 h. Compté comme une panne, il détruisait la couverture de
   * toutes les journées (0 %) et produisait une fausse alerte par nuit. Or un
   * véhicule à l'arrêt hors service n'est pas un boîtier défaillant : on ne
   * mesure la couverture que sur la journée de travail observée.
   */
  gapIntraDay: boolean;
}

export function buildTrips(
  input: RawPoint[],
  params: Partial<TripParams> = {},
): TripsResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const discarded = { invalidFix: 0, outOfOrder: 0, duplicates: 0 };

  // ── Nettoyage : on écarte, et on dit ce qu'on a écarté ────────────────
  const clean = input
    .filter((pt) => {
      if (pt.validFix === false) { discarded.invalidFix++; return false; }
      return Number.isFinite(pt.latitude) && Number.isFinite(pt.longitude);
    })
    .map((pt) => ({ ...pt, t: Date.parse(pt.recordedAt) }))
    .filter((pt) => Number.isFinite(pt.t))
    .sort((a, b) => a.t - b.t)
    .filter((pt, i, arr) => {
      if (i > 0 && arr[i - 1].t === pt.t) { discarded.duplicates++; return false; }
      return true;
    });

  if (clean.length < 2) {
    return { trips: [], events: [], daily: [], discarded };
  }

  // ── Segments entre points consécutifs ─────────────────────────────────
  const segs: Segment[] = [];
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1];
    const b = clean[i];
    const dtS = (b.t - a.t) / 1000;
    const distM = haversineM(a.latitude, a.longitude, b.latitude, b.longitude);
    const jump = distM > p.jumpMaxM;
    const gap = dtS > p.maxGapS;
    // Vitesse : celle du boîtier quand elle est fournie, sinon la vitesse
    // implicite du segment. Un saut de fix ne produit jamais de vitesse.
    const implied = dtS > 0 ? (distM / dtS) * 3.6 : 0;
    const speedKmh = jump ? 0 : (b.speedKmh ?? implied);
    const moving = !jump && distM >= p.movingStepM && speedKmh >= p.movingSpeedKmh;
    const gapIntraDay =
      gap &&
      localDay(a.recordedAt, p.localOffsetH) === localDay(b.recordedAt, p.localOffsetH);
    segs.push({ fromIdx: i - 1, toIdx: i, dtS, distM, speedKmh, moving, jump, gap, gapIntraDay });
  }

  // ── Découpage en trajets, séparés par une immobilité ≥ stopMinS ───────
  const trips: Trip[] = [];
  const events: DerivedEvent[] = [];

  let current: Segment[] = [];
  let pendingStopS = 0;
  let pendingStopStart: number | null = null;
  let pendingStopMuet = false;
  let bouchonsAbsorbes = 0;

  /**
   * L'immobilité en cours est-elle un vrai arrêt ?
   *
   * Le temps ne suffit pas à répondre : un embouteillage immobilise les
   * compteurs sans immobiliser le véhicule. On regarde donc où il se trouve
   * par rapport au début de l'immobilité. S'il a progressé, c'est de la
   * circulation dense : la course continue, et la fenêtre repart d'ici pour
   * qu'un véritable arrêt, plus loin, soit tout de même reconnu.
   */
  const arretConfirme = (idxCourant: number): boolean => {
    if (pendingStopS < p.stopMinS || pendingStopStart === null) return false;
    // Le raisonnement géométrique suppose d'avoir vu le véhicule pendant toute
    // l'immobilité. Après un silence du boîtier — une nuit, une coupure — on
    // n'a rien vu : le réveil à cinq kilomètres de là n'est pas une progression
    // au pas, c'est un trou. Le trajet se ferme, et l'écart se lit dans les
    // événements GPS_OFFLINE plutôt que d'être avalé dans une course fictive.
    if (pendingStopMuet) return true;
    const depuis = clean[pendingStopStart];
    const ici = clean[idxCourant];
    const ecartM = haversineM(
      depuis.latitude, depuis.longitude, ici.latitude, ici.longitude,
    );
    if (ecartM <= p.stopRadiusM) return true;
    bouchonsAbsorbes++;
    pendingStopS = 0;
    pendingStopStart = idxCourant;
    pendingStopMuet = false;
    return false;
  };

  const flush = () => {
    if (current.length === 0) return;
    const trip = assembleTrip(current, clean, p);
    if (trip) {
      trip.evidence = { ...trip.evidence, bouchons_absorbes: bouchonsAbsorbes };
      const idx = trips.length;
      trips.push(trip);
      events.push({
        type: "TRIP_STARTED",
        at: trip.startedAt,
        latitude: trip.startLatitude,
        longitude: trip.startLongitude,
        tripIndex: idx,
        confidence: trip.confidence,
        evidence: { points: trip.points, methode: "premier déplacement continu" },
        methodVersion: METHOD_VERSION,
      });
      events.push({
        type: "TRIP_ENDED",
        at: trip.endedAt,
        latitude: trip.endLatitude,
        longitude: trip.endLongitude,
        tripIndex: idx,
        confidence: trip.confidence,
        evidence: {
          points: trip.points,
          distance_m: trip.distanceM,
          methode: `immobilité ≥ ${p.stopMinS} s dans un rayon de ${p.stopRadiusM} m`,
          bouchons_absorbes: bouchonsAbsorbes,
        },
        methodVersion: METHOD_VERSION,
      });
    }
    current = [];
    bouchonsAbsorbes = 0;
  };

  for (const s of segs) {
    // Seuls les silences SURVENUS PENDANT la journée de travail sont des
    // pertes de couverture. L'interruption nocturne n'en est pas une : la
    // signaler produirait une fausse alerte chaque nuit.
    if (s.gapIntraDay) {
      const from = clean[s.fromIdx];
      events.push({
        type: "GPS_OFFLINE",
        at: from.recordedAt,
        latitude: from.latitude,
        longitude: from.longitude,
        tripIndex: null,
        // Un silence est un fait constaté, pas une inférence.
        confidence: 1,
        evidence: { duree_s: round(s.dtS, 0), attendu_s: p.expectedIntervalS },
        methodVersion: METHOD_VERSION,
      });
    }

    if (s.moving) {
      if (arretConfirme(s.fromIdx)) flush();
      // Un arrêt court fait partie du trajet (feu rouge, client) : on le garde.
      pendingStopS = 0;
      pendingStopStart = null;
      pendingStopMuet = false;
      current.push(s);
    } else {
      if (pendingStopStart === null) pendingStopStart = s.fromIdx;
      pendingStopS += s.dtS;
      if (s.gap) pendingStopMuet = true;

      if (pendingStopS >= p.longStopS && pendingStopStart !== null) {
        const at = clean[pendingStopStart];
        const already = events.some(
          (e) => e.type === "LONG_STOP" && e.at === at.recordedAt,
        );
        if (!already) {
          events.push({
            type: "LONG_STOP",
            at: at.recordedAt,
            latitude: at.latitude,
            longitude: at.longitude,
            tripIndex: null,
            confidence: 0.9,
            evidence: { duree_s: round(pendingStopS, 0), seuil_s: p.longStopS },
            methodVersion: METHOD_VERSION,
          });
        }
      }
      if (arretConfirme(s.toIdx)) flush();
      else if (current.length > 0) current.push(s); // arrêt court ou bouchon : dans le trajet
    }
  }
  flush();

  // ── Trajet encore en cours ───────────────────────────────────────────
  // Un véhicule qui roule au moment du calcul a un trajet ouvert : son
  // arrivée n'existe pas encore. Le marquer évite qu'un gestionnaire lise
  // « arrivé à 14h32 » alors que le camion est toujours sur la route.
  // Critère : le dernier point est trop récent pour qu'un arrêt de fin de
  // trajet ait pu être constaté.
  const dernier = trips[trips.length - 1];
  if (p.maintenant && dernier) {
    const silenceDepuisFin = p.maintenant - Date.parse(dernier.endedAt);
    if (silenceDepuisFin < p.stopMinS * 1000) {
      dernier.enCours = true;
      dernier.evidence = {
        ...dernier.evidence,
        etat: "en cours au moment du calcul",
        dernier_point_il_y_a_s: Math.round(silenceDepuisFin / 1000),
      };
    }
  }

  return { trips, events, daily: aggregateDaily(trips, segs, clean, p), discarded };
}

function assembleTrip(
  segments: Segment[],
  points: { recordedAt: string; latitude: number; longitude: number; t: number }[],
  p: TripParams,
): Trip | null {
  const kept = segments.filter((s) => !s.jump);
  const distanceM = kept.reduce((sum, s) => sum + s.distM, 0);
  const first = points[segments[0].fromIdx];
  const last = points[segments[segments.length - 1].toIdx];
  const durationS = (last.t - first.t) / 1000;

  if (distanceM < p.tripMinDistanceM || durationS < p.tripMinDurationS) return null;

  const movingS = segments.filter((s) => s.moving).reduce((sum, s) => sum + s.dtS, 0);
  const idleS = Math.max(0, durationS - movingS);
  const gapsS = segments.filter((s) => s.gapIntraDay).reduce((sum, s) => sum + s.dtS, 0);
  const jumpsDropped = segments.filter((s) => s.jump).length;
  const maxSpeedKmh = segments.reduce((m, s) => Math.max(m, s.speedKmh), 0);
  const nbPoints = segments.length + 1;

  // Confiance : densité de points réelle vs cadence nominale, pénalisée par
  // les trous de couverture et les sauts de fix. Bornée à [0,05 ; 1].
  const expectedPoints = Math.max(1, durationS / p.expectedIntervalS);
  const density = Math.min(1, nbPoints / expectedPoints);
  const gapPenalty = durationS > 0 ? gapsS / durationS : 0;
  const jumpPenalty = Math.min(0.3, jumpsDropped * 0.1);
  const confidence = Math.max(
    0.05,
    Math.min(1, density * (1 - gapPenalty) - jumpPenalty),
  );

  return {
    startedAt: first.recordedAt,
    endedAt: last.recordedAt,
    startLatitude: first.latitude,
    startLongitude: first.longitude,
    endLatitude: last.latitude,
    endLongitude: last.longitude,
    distanceM: round(distanceM, 1),
    durationS: round(durationS, 0),
    movingS: round(movingS, 0),
    idleS: round(idleS, 0),
    maxSpeedKmh: round(maxSpeedKmh, 1),
    avgMovingSpeedKmh: movingS > 0 ? round((distanceM / movingS) * 3.6, 1) : 0,
    points: nbPoints,
    gapsS: round(gapsS, 0),
    jumpsDropped,
    confidence: round(confidence, 2),
    evidence: {
      points_attendus: round(expectedPoints, 0),
      densite: round(density, 2),
      part_trous: round(gapPenalty, 2),
      sauts_ecartes: jumpsDropped,
    },
    methodVersion: METHOD_VERSION,
    enCours: false,
  };
}

function aggregateDaily(
  trips: Trip[],
  segs: Segment[],
  points: { recordedAt: string; latitude: number; longitude: number; t: number }[],
  p: TripParams,
): DailyAggregate[] {
  const byDay = new Map<string, DailyAggregate>();

  const ensure = (day: string): DailyAggregate => {
    let d = byDay.get(day);
    if (!d) {
      d = {
        day,
        distanceM: 0, movingS: 0, idleS: 0, trips: 0, points: 0,
        gapsS: 0, jumpsDropped: 0,
        firstMovementAt: null, lastMovementAt: null,
        coverage: 0, maxSpeedKmh: 0,
        methodVersion: METHOD_VERSION,
      };
      byDay.set(day, d);
    }
    return d;
  };

  for (const t of trips) {
    const d = ensure(localDay(t.startedAt, p.localOffsetH));
    d.distanceM += t.distanceM;
    d.movingS += t.movingS;
    d.idleS += t.idleS;
    d.trips += 1;
    d.jumpsDropped += t.jumpsDropped;
    d.maxSpeedKmh = Math.max(d.maxSpeedKmh, t.maxSpeedKmh);
    if (!d.firstMovementAt || t.startedAt < d.firstMovementAt) d.firstMovementAt = t.startedAt;
    if (!d.lastMovementAt || t.endedAt > d.lastMovementAt) d.lastMovementAt = t.endedAt;
  }

  // Amplitude réellement observée par jour : du premier au dernier point reçu.
  const span = new Map<string, { first: number; last: number }>();
  for (const pt of points) {
    const day = localDay(pt.recordedAt, p.localOffsetH);
    ensure(day).points += 1;
    const s = span.get(day);
    if (!s) span.set(day, { first: pt.t, last: pt.t });
    else {
      if (pt.t < s.first) s.first = pt.t;
      if (pt.t > s.last) s.last = pt.t;
    }
  }

  for (const s of segs) {
    if (s.gapIntraDay) {
      ensure(localDay(points[s.fromIdx].recordedAt, p.localOffsetH)).gapsS += s.dtS;
    }
  }

  for (const d of byDay.values()) {
    d.distanceM = round(d.distanceM, 1);
    d.gapsS = round(d.gapsS, 0);

    // Couverture : à quel point la journée de travail OBSERVÉE (premier →
    // dernier point du jour) est réellement documentée. On ne compte ni la
    // nuit ni les heures hors service : le boîtier n'est pas en faute quand le
    // véhicule ne travaille pas. Sans cette mesure, un écart de kilométrage
    // n'est pas interprétable — et ne doit pas être affiché.
    //
    // Deux façons de mal documenter une journée, et il faut les deux :
    //   • les coupures franches (boîtier hors réseau) → part sans trou ;
    //   • la déperdition diffuse (un point sur deux perdu, sans jamais
    //     atteindre le seuil de coupure) → densité observée vs cadence
    //     nominale. Sans ce second terme, une journée à moitié captée
    //     s'affichait « 100 % couverte », ce qui est faux.
    // La couverture retenue est la plus sévère des deux.
    const sp = span.get(d.day);
    const amplitudeS = sp ? (sp.last - sp.first) / 1000 : 0;

    if (amplitudeS < 600) {
      // Moins de 10 minutes observées : on ne prétend pas avoir couvert la journée.
      d.coverage = 0;
    } else {
      const sansTrou = Math.max(0, Math.min(1, 1 - d.gapsS / amplitudeS));
      const attendus = amplitudeS / p.expectedIntervalS;
      const densite = attendus > 0 ? Math.min(1, d.points / attendus) : 0;
      d.coverage = round(Math.min(sansTrou, densite), 2);
    }
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
