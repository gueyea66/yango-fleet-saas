import { groupInput } from "@/lib/v2/format";

const NB = " ";

describe("saisie numérique groupée (affichage seulement)", () => {
  it("groupe les milliers sans changer la valeur", () => {
    expect(groupInput("41200")).toBe(`41${NB}200`);
    expect(groupInput("151461")).toBe(`151${NB}461`);
    expect(groupInput("800")).toBe("800");
  });
  it("décimales à la virgule", () => {
    expect(groupInput("12.5")).toBe("12,5");
    expect(groupInput("1234.")).toBe(`1${NB}234,`);
  });
  it("vide", () => {
    expect(groupInput("")).toBe("");
  });
});
