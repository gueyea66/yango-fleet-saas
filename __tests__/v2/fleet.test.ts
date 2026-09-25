import { vehicleSignal } from "@/lib/v2/fleet";

describe("signal GPS véhicule", () => {
  const now = new Date("2026-09-23T21:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();
  it("vert sous 15 min", () => {
    expect(vehicleSignal(ago(0), true, now)).toEqual({ tone: "ok", text: "Signal à l'instant" });
    expect(vehicleSignal(ago(14), true, now)).toEqual({ tone: "ok", text: "Signal il y a 14 min" });
  });
  it("jaune sous 60 min", () => {
    expect(vehicleSignal(ago(15), true, now).tone).toBe("accent");
    expect(vehicleSignal(ago(59), true, now).tone).toBe("accent");
  });
  it("rouge au-delà", () => {
    expect(vehicleSignal(ago(180), true, now)).toEqual({ tone: "neg", text: "Silencieux depuis 3 h" });
    expect(vehicleSignal(ago(60 * 72), true, now).text).toBe("Silencieux depuis 3 j");
  });
  it("gris sans boîtier ou sans signal", () => {
    expect(vehicleSignal(null, false, now).tone).toBe("idle");
    expect(vehicleSignal(null, true, now).text).toBe("Aucun signal reçu");
    expect(vehicleSignal("n/a", true, now).tone).toBe("idle");
  });
});
