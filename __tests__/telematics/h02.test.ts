import { parseH02Frame, parseH02Stream } from "@/lib/telematics/h02";

/**
 * Trame de référence documentée du protocole H02 (Traccar, port 5013).
 * Sert de témoin : si le parser la lit correctement, il lit le ST-901.
 */
const TRAME_REFERENCE =
  "*HQ,4210209006,V1,201844,A,2608.9437,N,08016.2521,W,000.80,000,150317,FFFFF9FF,310,260,0,0,6#";

/** Trame du K3 (boîtier 9170258210) telle qu'elle sera émise depuis Dakar. */
const TRAME_K3 =
  "*HQ,9170258210,V1,081530,A,1440.4200,N,01726.4400,W,032.40,187,150926,FFFFFBFF,608,1,0,0#";

describe("parseH02Frame", () => {
  it("lit la trame de référence du protocole", () => {
    const r = parseH02Frame(TRAME_REFERENCE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.position.externalId).toBe("4210209006");
    expect(r.position.recordedAt).toBe("2017-03-15T20:18:44.000Z");
    expect(r.position.latitude).toBeCloseTo(26.149062, 5);
    expect(r.position.longitude).toBeCloseTo(-80.270868, 5); // W → négatif
    expect(r.position.speedKmh).toBeCloseTo(1.48, 2); // 0,80 nœud
    expect(r.position.validFix).toBe(true);
    expect(r.position.statusRaw).toBe("FFFFF9FF");
  });

  it("place le K3 à Dakar avec la bonne vitesse en km/h", () => {
    const r = parseH02Frame(TRAME_K3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.position.externalId).toBe("9170258210");
    expect(r.position.recordedAt).toBe("2026-09-15T08:15:30.000Z");
    // Dakar : ~14,67° N / ~17,44° O
    expect(r.position.latitude).toBeCloseTo(14.6737, 3);
    expect(r.position.longitude).toBeCloseTo(-17.4407, 3);
    expect(r.position.speedKmh).toBeCloseTo(60.0, 1); // 32,40 nœuds
    expect(r.position.heading).toBe(187);
  });

  it("conserve la trame brute et les champs non mappés", () => {
    const r = parseH02Frame(TRAME_K3);
    if (!r.ok) throw new Error("trame refusée à tort");
    expect(r.position.raw.frame).toBe(TRAME_K3);
    expect(r.position.raw.extra).toEqual(["608", "1", "0", "0"]);
  });

  it("ne devine jamais l'état du moteur", () => {
    const r = parseH02Frame(TRAME_K3);
    if (!r.ok) throw new Error("trame refusée à tort");
    // `ignition` n'existe pas dans la position normalisée tant que le masque
    // de statut n'a pas été calibré sur le terrain (cf. 00-GAP-ANALYSIS §2.4).
    expect("ignition" in r.position).toBe(false);
  });

  it("marque un point non fixé sans le rejeter", () => {
    const r = parseH02Frame(TRAME_K3.replace(",A,", ",V,"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.position.validFix).toBe(false);
  });

  it("gère l'hémisphère sud et le méridien est", () => {
    const r = parseH02Frame(
      "*HQ,9170258210,V1,081530,A,1440.4200,S,01726.4400,E,000.00,000,150926,FFFFFBFF#",
    );
    if (!r.ok) throw new Error("trame refusée à tort");
    expect(r.position.latitude).toBeCloseTo(-14.6737, 3);
    expect(r.position.longitude).toBeCloseTo(17.4407, 3);
  });

  it("refuse ce qu'il ne sait pas lire, au lieu de l'interpréter", () => {
    const cas: [string, string][] = [
      ["$\x01\x02binaire", "trame binaire"],
      ["", "trame vide"],
      ["*HQ,9170258210,V1,081530,A#", "trop courte"],
      ["*HQ,9170258210,V4,081530,A,1440.42,N,01726.44,W,000,000,150926,FF#", "type"],
      ["*HQ,9170258210,V1,081530,A,1440.42,N,01726.44,W,000,000,999999,FF,1#", "date"],
      ["*HQ,9170258210,V1,081530,A,1499.99,N,01726.44,W,000,000,150926,FF,1#", "minutes ≥ 60"],
    ];
    for (const [frame] of cas) {
      expect(parseH02Frame(frame).ok).toBe(false);
    }
  });
});

describe("parseH02Stream", () => {
  it("sépare plusieurs trames collées dans un même paquet TCP", () => {
    const { results, rest } = parseH02Stream(TRAME_REFERENCE + TRAME_K3);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(rest).toBe("");
  });

  it("garde le fragment incomplet pour le paquet suivant", () => {
    const coupe = TRAME_K3.slice(0, 40);
    const first = parseH02Stream(TRAME_REFERENCE + coupe);
    expect(first.results).toHaveLength(1);
    expect(first.rest).toBe(coupe);

    const second = parseH02Stream(first.rest + TRAME_K3.slice(40));
    expect(second.results).toHaveLength(1);
    expect(second.results[0].ok).toBe(true);
    expect(second.rest).toBe("");
  });

  it("ne laisse pas gonfler un flux sans fin de trame", () => {
    const { rest } = parseH02Stream("x".repeat(5000));
    expect(rest).toBe("");
  });
});
