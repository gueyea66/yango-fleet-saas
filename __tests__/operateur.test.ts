import { peutDecider, validerCharge, validerHorsYango, CATEGORIES_OPERATEUR } from "@/lib/operateur";

const D = "11111111-1111-4111-8111-111111111111";
const today = "2026-10-02";

describe("saisie hors Yango", () => {
  it("accepte une saisie complète, arrondit, nettoie la note", () => {
    const r = validerHorsYango({ driver_id: D, jour: "2026-10-01", montant: "12000.4", courses: "3", note: "  course privée  " }, today);
    expect(r).toEqual({ ok: true, value: { driver_id: D, jour: "2026-10-01", montant: 12000, courses: 3, note: "course privée" } });
  });
  it("refuse jour futur, montant nul, chauffeur manquant", () => {
    expect(validerHorsYango({ driver_id: D, jour: "2026-10-03", montant: 1 }, today).ok).toBe(false);
    expect(validerHorsYango({ driver_id: D, jour: "2026-10-01", montant: 0 }, today).ok).toBe(false);
    expect(validerHorsYango({ driver_id: "x", jour: "2026-10-01", montant: 10 }, today).ok).toBe(false);
  });
});

describe("saisie de charge", () => {
  it("catégorie de la liste, hors avance propriétaire", () => {
    expect(CATEGORIES_OPERATEUR).not.toContain("Décaissement propriétaire");
    expect(validerCharge({ driver_id: D, date: "2026-10-01", categorie: "Carburant", montant: 5000 }, today).ok).toBe(true);
    expect(validerCharge({ driver_id: D, date: "2026-10-01", categorie: "Décaissement propriétaire", montant: 5000 }, today).ok).toBe(false);
  });
  it("« Autre » exige une description", () => {
    expect(validerCharge({ driver_id: D, date: "2026-10-01", categorie: "Autre", montant: 5000 }, today).ok).toBe(false);
    expect(validerCharge({ driver_id: D, date: "2026-10-01", categorie: "Autre", montant: 5000, description: "Pneu" }, today).ok).toBe(true);
  });
});

describe("droit de décider", () => {
  const nicolas = { id: "n", peut_valider: true };
  const daniel = { id: "d", peut_valider: false };
  const saisie = { entered_by: "d", status: "submitted" };
  it("valideur, pas l'auteur, saisie en attente : OK", () => {
    expect(peutDecider({ decideur: nicolas, saisie, decision: "approved" }).ok).toBe(true);
  });
  it("profil saisie seule, auteur, déjà traitée : refusé", () => {
    expect(peutDecider({ decideur: daniel, saisie, decision: "approved" }).ok).toBe(false);
    expect(peutDecider({ decideur: { id: "d", peut_valider: true }, saisie, decision: "rejected" }).ok).toBe(false);
    expect(peutDecider({ decideur: nicolas, saisie: { ...saisie, status: "approved" }, decision: "rejected" }).ok).toBe(false);
  });
  it("charge sans preuve : rejet possible, validation impossible", () => {
    expect(peutDecider({ decideur: nicolas, saisie, decision: "approved", piecesJointes: 0 }).ok).toBe(false);
    expect(peutDecider({ decideur: nicolas, saisie, decision: "rejected", piecesJointes: 0 }).ok).toBe(true);
  });
});
