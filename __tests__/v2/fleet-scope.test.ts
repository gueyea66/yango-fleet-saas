import { driverScope, segCountsOf, NO_DRIVER } from "@/lib/v2/fleetScope";

const drivers = [
  { id: "a", segment: "interne" as const },
  { id: "b", segment: "partenaire" as const },
  { id: "c", segment: null },          // sans véhicule → interne
];

describe("filtre type de véhicule → chauffeurs", () => {
  it("Tous véhicules : la sélection chauffeurs est inchangée", () => {
    expect(driverScope([], "all", drivers)).toEqual([]);
    expect(driverScope(["b"], "all", drivers)).toEqual(["b"]);
  });
  it("Interne / Externe : chauffeurs du segment, croisés avec la sélection", () => {
    expect(driverScope([], "interne", drivers)).toEqual(["a", "c"]);
    expect(driverScope([], "partenaire", drivers)).toEqual(["b"]);
    expect(driverScope(["a", "b"], "partenaire", drivers)).toEqual(["b"]);
  });
  it("intersection vide : aucun chauffeur, jamais « tous »", () => {
    expect(driverScope(["a"], "partenaire", drivers)).toEqual([NO_DRIVER]);
  });
  it("comptage par segment", () => {
    expect(segCountsOf(drivers)).toEqual({ interne: 2, partenaire: 1 });
  });
});
