import { segmentResolver } from "@/lib/analytics/segment";

describe("segment choisi par chauffeur (migration 078)", () => {
  const vehicles = [
    { id: "v-int", driver_id: "d-int", plate: "AA-111-AA", fleet_segment: "interne" },
    { id: "v-par", driver_id: "d-par", plate: "BB-222-BB", fleet_segment: "partenaire" },
  ];

  it("sans choix : le véhicule décide, et un chauffeur sans véhicule est interne", () => {
    const seg = segmentResolver(vehicles);
    expect(seg.ofDriver("d-int")).toBe("interne");
    expect(seg.ofDriver("d-par")).toBe("partenaire");
    expect(seg.ofDriver("d-sans-vehicule")).toBe("interne");
    expect(seg.ofReport({ driver_id: "d-sans-vehicule", vehicle_id: "v-par" })).toBe("partenaire");
  });

  it("le choix du gestionnaire l'emporte sur le véhicule, partout", () => {
    const seg = segmentResolver(vehicles, [
      { id: "d-sans-vehicule", fleet_segment: "partenaire" }, // externe sans véhicule affecté
      { id: "d-par", fleet_segment: "interne" },               // interne qui roule sur un véhicule partenaire
      { id: "d-int", fleet_segment: null },                    // pas de choix : véhicule
    ]);
    expect(seg.ofDriver("d-sans-vehicule")).toBe("partenaire");
    expect(seg.ofReport({ driver_id: "d-sans-vehicule", vehicle_id: "v-int" })).toBe("partenaire");
    expect(seg.ofPlate("AA111AA", "d-sans-vehicule")).toBe("partenaire");
    expect(seg.ofDriver("d-par")).toBe("interne");
    expect(seg.ofReport({ driver_id: "d-par", vehicle_id: "v-par" })).toBe("interne");
    expect(seg.ofDriver("d-int")).toBe("interne");
  });

  it("une valeur inconnue est ignorée", () => {
    const seg = segmentResolver(vehicles, [{ id: "d-par", fleet_segment: "autre" }]);
    expect(seg.ofDriver("d-par")).toBe("partenaire");
  });
});
