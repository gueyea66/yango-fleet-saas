import { filtrerVraisemblables, invraisemblance } from "@/lib/telematics/vraisemblance";

const T0 = Date.parse("2026-10-18T10:00:00Z");
const port = { latitude: 14.6833, longitude: -17.4275 };      // port de Dakar
const thies = { latitude: 14.7910, longitude: -16.9256 };     // Thiès, environ 55 km
const p = (min: number, lieu: { latitude: number; longitude: number }) => ({ recordedAt: new Date(T0 + min * 60000).toISOString(), ...lieu });

describe("vraisemblance d'une position GPS", () => {
  it("refuse une heure dans le futur ou trop ancienne", () => {
    expect(invraisemblance(p(30, port), null, T0)).toBe("heure dans le futur");
    expect(invraisemblance(p(5, port), null, T0)).toBeNull();
    expect(invraisemblance(p(-46 * 24 * 60, port), null, T0)).toBe("position trop ancienne");
  });
  it("refuse un saut impossible, garde un trajet réel et le flottement du GPS", () => {
    expect(invraisemblance(p(1, thies), p(0, port), T0)).toMatch(/^saut impossible/);
    expect(invraisemblance(p(60, thies), p(0, port), T0 + 3600000)).toBeNull();
    expect(invraisemblance(p(0, { latitude: 14.6837, longitude: -17.4279 }), p(0, port), T0)).toBeNull();
  });
  it("une position refusée ne devient pas la référence", () => {
    const { gardees, refus } = filtrerVraisemblables([p(1, port), p(2, thies), p(3, port)], p(0, port), T0 + 5 * 60000);
    expect(gardees.map((x) => x.recordedAt)).toEqual([p(1, port).recordedAt, p(3, port).recordedAt]);
    expect(refus).toHaveLength(1);
  });
});
