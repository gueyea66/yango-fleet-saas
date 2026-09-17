import {
  labelDepuisNominatim,
  cleCache,
  urlNominatim,
  resoudreAdresses,
} from "@/lib/telematics/geocode";

/** Réponse type d'OpenStreetMap pour un point des Almadies, à Dakar. */
const REPONSE_DAKAR = {
  name: "Nirvana",
  display_name: "Nirvana, Route des Almadies, Almadies, Dakar, 11000, Sénégal",
  address: {
    amenity: "Nirvana",
    road: "Route des Almadies",
    suburb: "Almadies",
    city: "Dakar",
    postcode: "11000",
    country: "Sénégal",
    country_code: "sn",
  },
};

describe("labelDepuisNominatim", () => {
  it("produit un libellé qu'un gestionnaire reconnaît", () => {
    expect(labelDepuisNominatim(REPONSE_DAKAR)).toBe("Nirvana, Route des Almadies, Almadies");
  });

  it("n'affiche ni pays ni code postal", () => {
    const label = labelDepuisNominatim(REPONSE_DAKAR) ?? "";
    expect(label).not.toMatch(/Sénégal|11000/);
  });

  it("se rabat sur la rue et le quartier quand il n'y a pas de lieu nommé", () => {
    expect(labelDepuisNominatim({
      address: { road: "Boulevard de la Libération", suburb: "Plateau", city: "Dakar" },
    })).toBe("Boulevard de la Libération, Plateau, Dakar");
  });

  it("ne répète pas un nom présent deux fois", () => {
    expect(labelDepuisNominatim({
      name: "Carrière de Diack",
      address: { amenity: "Carrière de Diack", road: "Route de Diack", city: "Diack" },
    })).toBe("Carrière de Diack, Route de Diack, Diack");
  });

  it("rend null plutôt qu'un libellé inventé", () => {
    expect(labelDepuisNominatim(null)).toBeNull();
    expect(labelDepuisNominatim({ error: "Unable to geocode" })).toBeNull();
    expect(labelDepuisNominatim({})).toBeNull();
  });
});

describe("cleCache", () => {
  it("regroupe les points distants de quelques mètres", () => {
    expect(cleCache(14.673712, -17.440688)).toEqual({ lat: 14.6737, lon: -17.4407 });
    // ~5 m plus loin : même entrée de cache
    expect(cleCache(14.673751, -17.440712)).toEqual({ lat: 14.6738, lon: -17.4407 });
  });
});

describe("urlNominatim", () => {
  it("demande le détail d'adresse en français", () => {
    const url = urlNominatim(14.6737, -17.4407);
    expect(url).toContain("nominatim.openstreetmap.org/reverse");
    expect(url).toContain("addressdetails=1");
    expect(url).toContain("accept-language=fr");
  });
});

describe("resoudreAdresses", () => {
  const point = { lat: 14.6737, lon: -17.4407 };

  it("n'appelle pas le fournisseur quand le cache répond", async () => {
    let appels = 0;
    const res = await resoudreAdresses([point], {
      lire: async () => new Map([["14.6737,-17.4407", "Médina, Dakar"]]),
      ecrire: async () => {},
      fetchImpl: (async () => { appels++; return new Response("{}"); }) as unknown as typeof fetch,
      delaiMs: 0,
    });
    expect(appels).toBe(0);
    expect(res.get("14.6737,-17.4407")).toBe("Médina, Dakar");
  });

  it("résout puis enregistre les points inconnus", async () => {
    const ecrits: unknown[] = [];
    const res = await resoudreAdresses([point], {
      lire: async () => new Map(),
      ecrire: async (l) => { ecrits.push(...l); },
      fetchImpl: (async () => new Response(JSON.stringify(REPONSE_DAKAR), { status: 200 })) as unknown as typeof fetch,
      delaiMs: 0,
    });
    expect(res.get("14.6737,-17.4407")).toBe("Nirvana, Route des Almadies, Almadies");
    expect(ecrits).toHaveLength(1);
  });

  it("borne le nombre d'appels pour ne pas se faire bannir", async () => {
    let appels = 0;
    const points = Array.from({ length: 50 }, (_, i) => ({ lat: 14 + i / 1000, lon: -17 }));
    await resoudreAdresses(points, {
      lire: async () => new Map(),
      ecrire: async () => {},
      fetchImpl: (async () => { appels++; return new Response(JSON.stringify(REPONSE_DAKAR)); }) as unknown as typeof fetch,
      maxAppels: 5,
      delaiMs: 0,
    });
    expect(appels).toBe(5);
  });

  it("survit à une panne du fournisseur sans rien inventer", async () => {
    const res = await resoudreAdresses([point], {
      lire: async () => new Map(),
      ecrire: async () => {},
      fetchImpl: (async () => { throw new Error("réseau"); }) as unknown as typeof fetch,
      delaiMs: 0,
    });
    expect(res.size).toBe(0);
  });
});
