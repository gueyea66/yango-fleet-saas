import {
  aplatirBoitiers, lireBoitier, suggererVehicule, normaliserAdresse, plaqueNue, GpswoxError,
} from "@/lib/telematics/gpswox";

/**
 * Réponse de `/api/get_devices` reconstituée d'après la documentation GPSwox :
 * des groupes, chacun avec ses boîtiers. À remplacer par un relevé réel dès la
 * première connexion au serveur de NMK.
 */
const ITEM = {
  id: 12,
  name: "DK 4521 BC - Benne 4",
  online: "online",
  time: "13-10-2026 08:15:30",
  timestamp: 1791879330,
  lat: 14.6737,
  lng: -17.4407,
  course: 187,
  speed: 42,
  altitude: 22,
  protocol: "gt06",
  distance_unit_hour: "kph",
  total_distance: 15234.7,
  tail: [{ lat: "14.67", lng: "-17.44" }],
  device_data: { imei: "866123045678901", plate_number: "DK-4521-BC", sim_number: "770000000" },
};
const REPONSE = [
  { id: 0, title: "Non groupé", items: [ITEM] },
  { id: 3, title: "Bennes", items: [{ ...ITEM, id: 13, name: "Benne 5", device_data: { imei: "866123045678902" } }] },
];

describe("aplatirBoitiers", () => {
  it("déplie les groupes", () => {
    expect(aplatirBoitiers(REPONSE)).toHaveLength(2);
  });
  it("accepte une liste à plat et un objet { items }", () => {
    expect(aplatirBoitiers([ITEM])).toHaveLength(1);
    expect(aplatirBoitiers({ items: [ITEM] })).toHaveLength(1);
  });
  it("ne plante pas sur une réponse inattendue", () => {
    expect(aplatirBoitiers(null)).toEqual([]);
    expect(aplatirBoitiers({ status: 0, message: "Échec de connexion" })).toEqual([]);
  });
});

describe("lireBoitier", () => {
  it("normalise un boîtier : IMEI, horodatage Unix, vitesse en km/h", () => {
    const b = lireBoitier(ITEM);
    expect(b.imei).toBe("866123045678901");
    expect(b.plaque).toBe("DK-4521-BC");
    expect(b.vuLe).toBe(new Date(1791879330 * 1000).toISOString());
    expect(b.position.ok).toBe(true);
    if (!b.position.ok) return;
    const p = b.position.position;
    expect(p.externalId).toBe("866123045678901");
    expect(p.recordedAt).toBe(b.vuLe);
    expect(p.latitude).toBeCloseTo(14.6737, 4);
    expect(p.longitude).toBeCloseTo(-17.4407, 4);
    expect(p.speedKmh).toBe(42);
    expect(p.heading).toBe(187);
    expect(p.protocol).toBe("gt06");
    expect(p.ignition).toBeNull();
    expect(p.odometerM).toBeNull();
  });

  it("ne garde dans le brut ni la traîne de points ni la carte SIM", () => {
    const b = lireBoitier(ITEM);
    if (!b.position.ok) throw new Error("position attendue");
    const brut = JSON.stringify(b.position.position.raw);
    expect(brut).not.toContain("tail");
    expect(brut).not.toContain("770000000");
    expect(brut).toContain("total_distance");
  });

  it("lit les nombres envoyés sous forme de texte", () => {
    const b = lireBoitier({ ...ITEM, lat: "14.6737", lng: "-17.4407", speed: "42", timestamp: "1791879330" });
    expect(b.position.ok).toBe(true);
    if (b.position.ok) expect(b.position.position.latitude).toBeCloseTo(14.6737, 4);
  });

  it("convertit les miles par heure", () => {
    const b = lireBoitier({ ...ITEM, speed: 10, distance_unit_hour: "mph" });
    if (!b.position.ok) throw new Error("position attendue");
    expect(b.position.position.speedKmh).toBeCloseTo(16.09, 2);
  });

  it("accepte un horodatage en millisecondes", () => {
    expect(lireBoitier({ ...ITEM, timestamp: 1791879330000 }).vuLe)
      .toBe(new Date(1791879330 * 1000).toISOString());
  });

  it("ne devine pas l'heure à partir du texte `time`", () => {
    const b = lireBoitier({ ...ITEM, timestamp: 0 });
    expect(b.vuLe).toBeNull();
    expect(b.position.ok).toBe(false);
  });

  it("sans IMEI visible, identifie le boîtier par son numéro sur ce serveur", () => {
    const b = lireBoitier({ ...ITEM, device_data: {} }, "173.249.19.50");
    expect(b.imei).toBe("gpswox-173.249.19.50-12");
    expect(b.position.ok).toBe(true);
    if (b.position.ok) expect(b.position.position.externalId).toBe("gpswox-173.249.19.50-12");
  });

  it("refuse un boîtier sans aucune identité, sans coordonnées, ou resté à (0, 0)", () => {
    expect(lireBoitier({ ...ITEM, id: undefined, device_data: {} }).position.ok).toBe(false);
    expect(lireBoitier({ ...ITEM, lat: null }).position.ok).toBe(false);
    expect(lireBoitier({ ...ITEM, lat: 0, lng: 0 }).position.ok).toBe(false);
    expect(lireBoitier({ ...ITEM, lat: 140 }).position.ok).toBe(false);
  });

  it("ne reprend l'état moteur que s'il est un booléen explicite", () => {
    const allume = lireBoitier({ ...ITEM, engine_status: true });
    const texte = lireBoitier({ ...ITEM, engine_status: "On" });
    if (!allume.position.ok || !texte.position.ok) throw new Error("positions attendues");
    expect(allume.position.position.ignition).toBe(true);
    expect(texte.position.position.ignition).toBeNull();
  });
});

describe("suggererVehicule", () => {
  const parc = [
    { id: "v1", plate: "DK 4521 BC" },
    { id: "v2", plate: "AA-872-JG " },
  ];
  it("retrouve le véhicule par la plaque déclarée, quelle que soit la ponctuation", () => {
    expect(plaqueNue(" dk-4521 bc")).toBe("DK4521BC");
    expect(suggererVehicule({ nom: "Benne 4", plaque: "DK-4521-BC" }, parc)).toBe("v1");
  });
  it("à défaut, par la plaque écrite dans le nom", () => {
    expect(suggererVehicule({ nom: "aa 872 jg - Kia K3", plaque: null }, parc)).toBe("v2");
  });
  it("ne propose rien sans correspondance, ni quand deux véhicules conviennent", () => {
    expect(suggererVehicule({ nom: "Benne 9", plaque: null }, parc)).toBeNull();
    expect(suggererVehicule({ nom: "DK4521BC AA872JG", plaque: null }, parc)).toBeNull();
  });
});

describe("normaliserAdresse", () => {
  it("garde l'origine, sans chemin ni barre finale", () => {
    expect(normaliserAdresse(" http://173.249.19.50/ ")).toBe("http://173.249.19.50");
    expect(normaliserAdresse("173.249.19.50")).toBe("http://173.249.19.50");
    expect(normaliserAdresse("https://gps.exemple.sn/ui/login")).toBe("https://gps.exemple.sn");
  });
  it("refuse les adresses internes", () => {
    for (const a of ["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.10",
      "http://172.16.4.2", "http://169.254.169.254", "http://user:x@gps.exemple.sn", "ftp://x"]) {
      expect(() => normaliserAdresse(a)).toThrow(GpswoxError);
    }
  });
});
