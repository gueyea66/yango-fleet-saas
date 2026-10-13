import { tracePropre, type PointTrace } from "@/lib/telematics/trace";

const T0 = Date.parse("2026-10-13T08:00:00Z");
const pt = (i: number, lat: number, lon: number, speed: number | null): PointTrace =>
  ({ recorded_at: new Date(T0 + i * 15000).toISOString(), latitude: lat, longitude: lon, speed_kmh: speed });

describe("tracePropre", () => {
  it("réduit un véhicule garé à un seul point, même quand le fix se promène de 80 m", () => {
    // 400 fixes à vitesse nulle, dispersés dans un carré d'environ 160 m de côté
    const gare = Array.from({ length: 400 }, (_, i) =>
      pt(i, 14.7561 + Math.sin(i * 1.7) * 0.0007, -17.4514 + Math.cos(i * 2.3) * 0.0007, 0));
    const { trace, regroupes } = tracePropre(gare);
    expect(trace).toHaveLength(1);
    expect(regroupes).toBe(399);
  });

  it("garde un trajet réel point par point", () => {
    // environ 110 m entre deux points, à 26 km/h
    const roule = Array.from({ length: 60 }, (_, i) => pt(i, 14.70 + i * 0.001, -17.45, 26));
    expect(tracePropre(roule).trace).toHaveLength(60);
  });

  it("garde un déplacement lent mais réel, et un bond que la dérive n'explique pas", () => {
    // bouchon : 30 m par point à 7 km/h
    const bouchon = Array.from({ length: 20 }, (_, i) => pt(i, 14.70 + i * 0.00027, -17.45, 7));
    expect(tracePropre(bouchon).trace.length).toBeGreaterThanOrEqual(19);
    // boîtier qui n'annonce aucune vitesse (null) mais se retrouve 1 km plus loin
    const bond = [pt(0, 14.70, -17.45, null), pt(1, 14.7001, -17.45, null), pt(2, 14.709, -17.45, null), pt(3, 14.7095, -17.45, null)];
    expect(tracePropre(bond).trace.map((p) => p.latitude)).toEqual([14.70, 14.709, 14.7095]);
    // un fix aberrant isolé, lui, ne fait pas un déplacement
    const aberrant = [pt(0, 14.70, -17.45, 0), pt(1, 14.709, -17.45, 0), pt(2, 14.7001, -17.45, 0)];
    expect(tracePropre(aberrant).trace).toHaveLength(1);
  });

  it("garde l'arrêt puis le départ dans l'ordre", () => {
    const journee = [
      ...Array.from({ length: 50 }, (_, i) => pt(i, 14.7561 + Math.sin(i) * 0.0004, -17.4514, 0)),
      ...Array.from({ length: 10 }, (_, i) => pt(50 + i, 14.757 + i * 0.001, -17.4514, 30)),
    ];
    const { trace } = tracePropre(journee);
    expect(trace).toHaveLength(11);
    expect(trace[0].recorded_at).toBe(journee[0].recorded_at);
  });

  it("ne touche pas une trace vide ou d'un seul point", () => {
    expect(tracePropre([])).toEqual({ trace: [], regroupes: 0 });
    expect(tracePropre([pt(0, 14.7, -17.4, 0)]).trace).toHaveLength(1);
  });
});
