import { commentaireAbsence, lireAbsence, motifAbsence } from "@/lib/absence";

describe("catégories d'absence", () => {
  it("garde la marque [REPOS] en tête : les règles existantes reconnaissent toute absence", () => {
    for (const c of ["repos", "panne", "conge", "malade"] as const) {
      expect(commentaireAbsence(c, "x").startsWith("[REPOS]")).toBe(true);
    }
    expect(commentaireAbsence("repos")).toBe("[REPOS]");
    expect(commentaireAbsence("panne", "  garage ")).toBe("[REPOS][PANNE] garage");
  });

  it("relit la catégorie et le motif", () => {
    expect(lireAbsence("[REPOS][MALADE] palu")).toEqual({ categorie: "malade", motif: "palu" });
    expect(lireAbsence("[REPOS][CONGE]")).toEqual({ categorie: "conge", motif: "" });
    expect(lireAbsence("[REPOS]")).toEqual({ categorie: "repos", motif: "" });
    expect(motifAbsence("[REPOS][PANNE] pneu crevé")).toBe("pneu crevé");
  });

  it("devine la catégorie des anciennes saisies d'après leur motif libre", () => {
    expect(lireAbsence("[REPOS] Maladie")?.categorie).toBe("malade");
    expect(lireAbsence("[REPOS] Congé personnel")?.categorie).toBe("conge");
    expect(lireAbsence("[REPOS] voiture au garage")?.categorie).toBe("panne");
    expect(lireAbsence("[REPOS] fatigue")?.categorie).toBe("repos");
  });

  it("ignore ce qui n'est pas une absence", () => {
    expect(lireAbsence("Bonne journée")).toBeNull();
    expect(lireAbsence(null)).toBeNull();
  });
});
