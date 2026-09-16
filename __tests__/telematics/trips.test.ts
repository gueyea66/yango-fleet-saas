import {
  buildTrips,
  haversineM,
  DEFAULT_PARAMS,
  METHOD_VERSION,
  type RawPoint,
} from "@/lib/telematics/trips";

/**
 * Fabrique une suite de points le long d'un axe, cadencés comme le K3 (30 s).
 * `speedKmh = 0` produit un véhicule à l'arrêt au même endroit.
 */
function track(opts: {
  startIso: string;
  count: number;
  intervalS?: number;
  fromLat?: number;
  fromLon?: number;
  speedKmh: number;
  headingLat?: number;
}): RawPoint[] {
  const {
    startIso, count, intervalS = 30,
    fromLat = 14.6737, fromLon = -17.4407, speedKmh, headingLat = 1,
  } = opts;
  const t0 = Date.parse(startIso);
  const stepM = (speedKmh / 3.6) * intervalS;
  const stepDeg = (stepM / 111_320) * headingLat;

  return Array.from({ length: count }, (_, i) => ({
    recordedAt: new Date(t0 + i * intervalS * 1000).toISOString(),
    latitude: fromLat + i * stepDeg,
    longitude: fromLon,
    speedKmh,
    validFix: true,
  }));
}

describe("haversineM", () => {
  it("mesure une distance connue", () => {
    // Un degré de latitude ≈ 111,2 km.
    expect(haversineM(14.0, -17.44, 15.0, -17.44)).toBeGreaterThan(110_000);
    expect(haversineM(14.0, -17.44, 15.0, -17.44)).toBeLessThan(112_000);
    expect(haversineM(14.6737, -17.4407, 14.6737, -17.4407)).toBe(0);
  });
});

describe("buildTrips — découpage", () => {
  it("reconstruit un trajet unique à vitesse constante", () => {
    const pts = track({ startIso: "2026-09-15T08:00:00Z", count: 40, speedKmh: 40 });
    const { trips, daily } = buildTrips(pts);

    expect(trips).toHaveLength(1);
    const t = trips[0];
    // 39 segments × 30 s à 40 km/h ≈ 13 km
    expect(t.distanceM).toBeGreaterThan(12_500);
    expect(t.distanceM).toBeLessThan(13_500);
    expect(t.durationS).toBe(39 * 30);
    expect(t.avgMovingSpeedKmh).toBeGreaterThan(38);
    expect(t.avgMovingSpeedKmh).toBeLessThan(42);
    expect(t.methodVersion).toBe(METHOD_VERSION);
    expect(daily[0].trips).toBe(1);
  });

  it("coupe en deux trajets quand le véhicule stationne assez longtemps", () => {
    const aller = track({ startIso: "2026-09-15T08:00:00Z", count: 30, speedKmh: 40 });
    const last = aller[aller.length - 1];
    // 15 min à l'arrêt, au même endroit
    const pause = track({
      startIso: new Date(Date.parse(last.recordedAt) + 30_000).toISOString(),
      count: 30, speedKmh: 0,
      fromLat: last.latitude, fromLon: last.longitude,
    });
    const reprise = track({
      startIso: new Date(Date.parse(pause[pause.length - 1].recordedAt) + 30_000).toISOString(),
      count: 30, speedKmh: 40,
      fromLat: last.latitude, fromLon: last.longitude,
    });

    const { trips, events } = buildTrips([...aller, ...pause, ...reprise]);
    expect(trips).toHaveLength(2);
    expect(events.filter((e) => e.type === "TRIP_STARTED")).toHaveLength(2);
    expect(events.filter((e) => e.type === "TRIP_ENDED")).toHaveLength(2);
    // 15 min d'immobilité ≥ seuil LONG_STOP (20 min) ? non — pas d'événement.
    expect(events.filter((e) => e.type === "LONG_STOP")).toHaveLength(0);
  });

  it("garde un arrêt court à l'intérieur du trajet (feu rouge, client)", () => {
    const debut = track({ startIso: "2026-09-15T08:00:00Z", count: 20, speedKmh: 40 });
    const last = debut[debut.length - 1];
    const feu = track({
      startIso: new Date(Date.parse(last.recordedAt) + 30_000).toISOString(),
      count: 4, speedKmh: 0, fromLat: last.latitude, fromLon: last.longitude,
    }); // 2 min
    const suite = track({
      startIso: new Date(Date.parse(feu[feu.length - 1].recordedAt) + 30_000).toISOString(),
      count: 20, speedKmh: 40, fromLat: last.latitude, fromLon: last.longitude,
    });

    const { trips } = buildTrips([...debut, ...feu, ...suite]);
    expect(trips).toHaveLength(1);
    expect(trips[0].idleS).toBeGreaterThan(0); // l'arrêt est compté comme inactif
    expect(trips[0].movingS).toBeLessThan(trips[0].durationS);
  });

  it("signale un arrêt long", () => {
    const debut = track({ startIso: "2026-09-15T08:00:00Z", count: 20, speedKmh: 40 });
    const last = debut[debut.length - 1];
    const pause = track({
      startIso: new Date(Date.parse(last.recordedAt) + 30_000).toISOString(),
      count: 60, speedKmh: 0, fromLat: last.latitude, fromLon: last.longitude,
    }); // 30 min

    const { events } = buildTrips([...debut, ...pause]);
    const longStops = events.filter((e) => e.type === "LONG_STOP");
    expect(longStops).toHaveLength(1);
    expect(Number(longStops[0].evidence.duree_s)).toBeGreaterThanOrEqual(DEFAULT_PARAMS.longStopS);
  });

  it("ne fabrique pas de trajet à partir de la dérive d'un véhicule garé", () => {
    const gare: RawPoint[] = Array.from({ length: 60 }, (_, i) => ({
      recordedAt: new Date(Date.parse("2026-09-15T02:00:00Z") + i * 30_000).toISOString(),
      // dérive de quelques mètres autour du même point
      latitude: 14.6737 + (Math.sin(i) * 8) / 111_320,
      longitude: -17.4407 + (Math.cos(i) * 8) / 111_320,
      speedKmh: 0,
      validFix: true,
    }));
    expect(buildTrips(gare).trips).toHaveLength(0);
  });
});

describe("buildTrips — honnêteté de la mesure", () => {
  it("écarte un saut de fix et le compte au lieu de l'avaler", () => {
    const pts = track({ startIso: "2026-09-15T08:00:00Z", count: 20, speedKmh: 40 });
    // Point aberrant : 200 km plus loin, revenu juste après.
    pts.splice(10, 0, {
      recordedAt: new Date(Date.parse(pts[9].recordedAt) + 10_000).toISOString(),
      latitude: 16.5, longitude: -17.4407, speedKmh: 40, validFix: true,
    });

    const { trips } = buildTrips(pts);
    expect(trips).toHaveLength(1);
    expect(trips[0].jumpsDropped).toBeGreaterThan(0);
    // Sans l'écart, la distance exploserait à des centaines de kilomètres.
    expect(trips[0].distanceM).toBeLessThan(20_000);
    expect(trips[0].confidence).toBeLessThan(1);
  });

  it("ignore les points sans fix valide et le dit", () => {
    const pts = track({ startIso: "2026-09-15T08:00:00Z", count: 20, speedKmh: 40 });
    pts[5].validFix = false;
    pts[6].validFix = false;
    const { discarded } = buildTrips(pts);
    expect(discarded.invalidFix).toBe(2);
  });

  it("note la perte de couverture au lieu de la lisser", () => {
    const avant = track({ startIso: "2026-09-15T08:00:00Z", count: 15, speedKmh: 40 });
    const last = avant[avant.length - 1];
    // 25 minutes de silence, puis le boîtier revient plus loin
    const apres = track({
      startIso: new Date(Date.parse(last.recordedAt) + 1_500_000).toISOString(),
      count: 15, speedKmh: 40,
      fromLat: last.latitude + 0.01, fromLon: last.longitude,
    });

    const { events, daily } = buildTrips([...avant, ...apres]);
    expect(events.filter((e) => e.type === "GPS_OFFLINE")).toHaveLength(1);
    expect(daily[0].gapsS).toBeGreaterThan(1000);
    expect(daily[0].coverage).toBeLessThan(1);
  });

  it("ne compte pas la nuit comme une panne de boîtier", () => {
    // Cas réel rencontré le 16/09/2026 sur les premières données injectées :
    // le silence entre le dernier point du soir et le premier du lendemain
    // détruisait la couverture (0 %) et produisait une alerte par nuit.
    const jour1 = track({ startIso: "2026-09-15T08:00:00Z", count: 60, speedKmh: 40 });
    const jour2 = track({ startIso: "2026-09-16T08:00:00Z", count: 60, speedKmh: 40 });

    const { daily, events } = buildTrips([...jour1, ...jour2]);

    expect(daily).toHaveLength(2);
    expect(daily[0].coverage).toBe(1);
    expect(daily[1].coverage).toBe(1);
    expect(daily[0].gapsS).toBe(0);
    // Aucune alerte : l'interruption nocturne n'est pas une perte de signal.
    expect(events.filter((e) => e.type === "GPS_OFFLINE")).toHaveLength(0);
  });

  it("voit la déperdition diffuse de points, pas seulement les coupures", () => {
    // Un point sur deux perdu, sans jamais atteindre le seuil de coupure :
    // la journée est à moitié documentée et doit le dire.
    const complet = track({ startIso: "2026-09-15T08:00:00Z", count: 80, speedKmh: 40 });
    const troue = complet.filter((_, i) => i % 2 === 0);

    expect(buildTrips(complet).daily[0].coverage).toBe(1);
    const degrade = buildTrips(troue).daily[0].coverage;
    expect(degrade).toBeLessThan(0.7);
    expect(degrade).toBeGreaterThan(0.3);
  });

  it("baisse la confiance quand les points sont trop espacés", () => {
    const dense = buildTrips(track({ startIso: "2026-09-15T08:00:00Z", count: 40, speedKmh: 40 }));
    const clairseme = buildTrips(
      track({ startIso: "2026-09-15T08:00:00Z", count: 6, intervalS: 180, speedKmh: 40 }),
    );
    expect(dense.trips[0].confidence).toBeGreaterThan(clairseme.trips[0].confidence);
    expect(clairseme.trips[0].confidence).toBeGreaterThan(0);
  });

  it("remet les points dans l'ordre et supprime les doublons d'horodatage", () => {
    const pts = track({ startIso: "2026-09-15T08:00:00Z", count: 20, speedKmh: 40 });
    const desordre = [pts[5], ...pts.slice(0, 5), pts[5], ...pts.slice(6)];
    const { trips, discarded } = buildTrips(desordre);
    expect(discarded.duplicates).toBeGreaterThan(0);
    expect(trips).toHaveLength(1);
    expect(trips[0].startedAt).toBe(pts[0].recordedAt);
  });

  it("ne renvoie rien plutôt qu'un chiffre inventé quand les données manquent", () => {
    expect(buildTrips([]).trips).toHaveLength(0);
    expect(buildTrips([{ recordedAt: "2026-09-15T08:00:00Z", latitude: 14, longitude: -17 }]).trips)
      .toHaveLength(0);
  });
});

describe("buildTrips — agrégat journalier", () => {
  it("sépare les journées et calcule les bornes de service", () => {
    const jour1 = track({ startIso: "2026-09-15T08:00:00Z", count: 30, speedKmh: 40 });
    const jour2 = track({ startIso: "2026-09-16T09:00:00Z", count: 30, speedKmh: 40 });
    const { daily } = buildTrips([...jour1, ...jour2]);

    expect(daily.map((d) => d.day)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(daily[0].firstMovementAt).toBe(jour1[0].recordedAt);
    expect(daily[1].trips).toBe(1);
    expect(daily[0].distanceM).toBeGreaterThan(9_000);
  });
});
