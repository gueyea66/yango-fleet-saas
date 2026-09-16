import { adaptTraccarPayload, fromH02 } from "@/lib/telematics/traccar";
import { parseH02Frame } from "@/lib/telematics/h02";

/** Payload tel que Traccar le POSTe avec forward.type=json. */
const PAYLOAD = {
  position: {
    id: 42,
    deviceId: 7,
    protocol: "h02",
    deviceTime: "2026-09-15T08:15:28.000Z",
    fixTime: "2026-09-15T08:15:30.000Z",
    serverTime: "2026-09-15T08:15:33.000Z",
    valid: true,
    latitude: 14.6737,
    longitude: -17.4407,
    altitude: 22.0,
    speed: 32.4, // nœuds
    course: 187.0,
    accuracy: 0,
    attributes: { sat: 9, power: 12.6, battery: 3.9, odometer: 133478000 },
  },
  device: { id: 7, name: "Kia K3", uniqueId: "9170258210", model: "ST-901" },
};

describe("adaptTraccarPayload", () => {
  it("normalise une position Traccar, vitesse convertie en km/h", () => {
    const r = adaptTraccarPayload(PAYLOAD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.position.externalId).toBe("9170258210");
    expect(r.position.recordedAt).toBe("2026-09-15T08:15:30.000Z"); // fixTime prioritaire
    expect(r.position.latitude).toBeCloseTo(14.6737, 4);
    expect(r.position.longitude).toBeCloseTo(-17.4407, 4);
    expect(r.position.speedKmh).toBeCloseTo(60.0, 1);
    expect(r.position.heading).toBe(187);
    expect(r.position.validFix).toBe(true);
    expect(r.position.protocol).toBe("h02");
  });

  it("relaie les attributs déclarés, sans en inventer", () => {
    const r = adaptTraccarPayload(PAYLOAD);
    if (!r.ok) throw new Error("payload refusé à tort");
    expect(r.position.satellites).toBe(9);
    expect(r.position.externalV).toBe(12.6);
    expect(r.position.odometerM).toBe(133478000);
    // `ignition` n'est pas dans les attributs → reste NULL, jamais déduit
    // de la vitesse ou de la tension (cf. 00-GAP-ANALYSIS §2.4).
    expect(r.position.ignition).toBeNull();
  });

  it("ne suppose pas qu'un point est valide quand Traccar ne le dit pas", () => {
    const sans = { ...PAYLOAD, position: { ...PAYLOAD.position, valid: undefined } };
    const r = adaptTraccarPayload(sans);
    if (!r.ok) throw new Error("payload refusé à tort");
    expect(r.position.validFix).toBe(false);
  });

  it("conserve le payload d'origine comme preuve", () => {
    const r = adaptTraccarPayload(PAYLOAD);
    if (!r.ok) throw new Error("payload refusé à tort");
    expect(r.position.raw.position).toEqual(PAYLOAD.position);
    expect(r.position.raw.device).toEqual(PAYLOAD.device);
  });

  it("refuse ce qui est inexploitable", () => {
    expect(adaptTraccarPayload({}).ok).toBe(false);
    expect(adaptTraccarPayload({ position: { latitude: 1, longitude: 2 } }).ok).toBe(false); // pas d'id
    expect(
      adaptTraccarPayload({ position: { fixTime: "2026-09-15T08:15:30Z" }, device: { uniqueId: "1" } }).ok,
    ).toBe(false); // pas de coordonnées
    expect(
      adaptTraccarPayload({
        position: { fixTime: "pas une date", latitude: 1, longitude: 2 },
        device: { uniqueId: "1" },
      }).ok,
    ).toBe(false);
    expect(
      adaptTraccarPayload({
        position: { fixTime: "2026-09-15T08:15:30Z", latitude: 200, longitude: 2 },
        device: { uniqueId: "1" },
      }).ok,
    ).toBe(false);
  });
});

describe("fromH02", () => {
  it("produit le même format d'ingestion que la voie Traccar", () => {
    const parsed = parseH02Frame(
      "*HQ,9170258210,V1,081530,A,1440.4200,N,01726.4400,W,032.40,187,150926,FFFFFBFF#",
    );
    if (!parsed.ok) throw new Error("trame refusée à tort");
    const a = fromH02(parsed.position);
    const b = adaptTraccarPayload(PAYLOAD);
    if (!b.ok) throw new Error("payload refusé à tort");

    // Les deux chemins convergent : même boîtier, même instant, même vitesse.
    expect(a.externalId).toBe(b.position.externalId);
    expect(a.recordedAt).toBe(b.position.recordedAt);
    expect(a.speedKmh).toBeCloseTo(b.position.speedKmh!, 1);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b.position).sort());
  });
});
