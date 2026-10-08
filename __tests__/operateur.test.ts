import { doublonsPossibles, peutChangerDroit, peutDecider, peutModifierSaisie, peutSaisirDecaissement, validerCharge, validerCompteAdmin, validerDecaissement, validerHorsYango, CATEGORIES_OPERATEUR } from "@/lib/operateur";

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
  it("contrôle routier : validation possible sans preuve, pas les autres catégories", () => {
    expect(peutDecider({ decideur: nicolas, saisie: { ...saisie, category: "Contrôle routier" }, decision: "approved", piecesJointes: 0 }).ok).toBe(true);
    expect(peutDecider({ decideur: nicolas, saisie: { ...saisie, category: "Carburant" }, decision: "approved", piecesJointes: 0 }).ok).toBe(false);
    expect(peutDecider({ decideur: nicolas, saisie: { ...saisie, category: "Amende" }, decision: "approved", piecesJointes: 0 }).ok).toBe(false);
  });
});

describe("décaissement", () => {
  const T = "22222222-2222-4222-8222-222222222222";
  it("réservé aux valideurs", () => {
    expect(peutSaisirDecaissement({ peut_valider: true }).ok).toBe(true);
    expect(peutSaisirDecaissement({ peut_valider: false }).ok).toBe(false);
  });
  it("compte, montant et motif requis ; bénéficiaire facultatif et distinct du compte", () => {
    expect(validerDecaissement({ driver_id: T, date: "2026-10-01", montant: 50000, description: " avance carburant " }, today))
      .toEqual({ ok: true, value: { driver_id: T, date: "2026-10-01", montant: 50000, advance_driver_id: null, description: "avance carburant" } });
    expect(validerDecaissement({ driver_id: T, date: "2026-10-01", montant: 50000, advance_driver_id: D, description: "avance" }, today).ok).toBe(true);
    expect(validerDecaissement({ driver_id: T, date: "2026-10-01", montant: 50000 }, today).ok).toBe(false);
    expect(validerDecaissement({ driver_id: T, date: "2026-10-01", montant: 50000, advance_driver_id: T, description: "x" }, today).ok).toBe(false);
    expect(validerDecaissement({ driver_id: T, date: "2026-10-03", montant: 50000, description: "x" }, today).ok).toBe(false);
  });
});

describe("corriger ou annuler sa saisie", () => {
  it("auteur et en attente seulement", () => {
    expect(peutModifierSaisie({ userId: "d", saisie: { entered_by: "d", status: "submitted" } }).ok).toBe(true);
    expect(peutModifierSaisie({ userId: "n", saisie: { entered_by: "d", status: "submitted" } }).ok).toBe(false);
    expect(peutModifierSaisie({ userId: "d", saisie: { entered_by: "d", status: "approved" } }).ok).toBe(false);
    expect(peutModifierSaisie({ userId: "d", saisie: { entered_by: "d", status: "rejected" } }).ok).toBe(false);
  });
});

describe("doublon avec le flux chauffeur", () => {
  const c = { id: "a", driver_id: D, expense_date: "2026-10-01", category: "Carburant", amount: 5000 };
  it("même chauffeur, date, catégorie et montant, hors rejetées et hors elle-même", () => {
    const autres = [
      { ...c },
      { ...c, id: "b", status: "submitted" },
      { ...c, id: "c", status: "rejected" },
      { ...c, id: "d", amount: 5500 },
      { ...c, id: "e", expense_date: "2026-09-30" },
      { ...c, id: "f", category: "Péage" },
    ];
    expect(doublonsPossibles(c, autres).map((e) => e.id)).toEqual(["b"]);
  });
});

describe("droit de valider des administrateurs", () => {
  const n = { id: "n", peut_valider: true }, d = { id: "d", peut_valider: true }, o = { id: "o", peut_valider: false };
  it("un valideur change le droit d'un autre administrateur", () => {
    expect(peutChangerDroit({ acteur: n, cibleId: "d", nouveau: false, admins: [n, d] }).ok).toBe(true);
    expect(peutChangerDroit({ acteur: n, cibleId: "o", nouveau: true, admins: [n, o] }).ok).toBe(true);
  });
  it("jamais son propre droit : ni se le retirer, ni se le rendre", () => {
    expect(peutChangerDroit({ acteur: n, cibleId: "n", nouveau: false, admins: [n, d] }).ok).toBe(false);
    expect(peutChangerDroit({ acteur: o, cibleId: "o", nouveau: true, admins: [n, o] }).ok).toBe(false);
  });
  it("un profil saisie seule ne change le droit de personne", () => {
    expect(peutChangerDroit({ acteur: o, cibleId: "n", nouveau: false, admins: [n, o] }).ok).toBe(false);
  });
  it("il reste toujours un valideur actif : les deux comptes ne peuvent pas finir en saisie seule", () => {
    // n retire le droit de d : il reste n. d ne peut plus rien changer, n ne peut pas se retirer le sien.
    const apres = [n, { ...d, peut_valider: false }];
    expect(peutChangerDroit({ acteur: n, cibleId: "d", nouveau: false, admins: [n, d] }).ok).toBe(true);
    expect(peutChangerDroit({ acteur: n, cibleId: "n", nouveau: false, admins: apres }).ok).toBe(false);
    expect(peutChangerDroit({ acteur: apres[1], cibleId: "n", nouveau: false, admins: apres }).ok).toBe(false);
    // un valideur désactivé ne compte pas comme valideur restant
    expect(peutChangerDroit({ acteur: n, cibleId: "d", nouveau: false, admins: [{ ...n, active: false }, d] }).ok).toBe(false);
  });
  it("cible inconnue : refus", () => {
    expect(peutChangerDroit({ acteur: n, cibleId: "x", nouveau: false, admins: [n, d] }).ok).toBe(false);
  });
});

describe("compte gestionnaire", () => {
  const base = { full_name: "  Awa Diop ", email: " Awa.Diop@Exemple.sn ", profil: "operateur", password: "provisoire-2026" };
  it("création : nom, e-mail normalisé, profil et mot de passe provisoire", () => {
    expect(validerCompteAdmin(base, "creation")).toEqual({ ok: true, value: { full_name: "Awa Diop", email: "awa.diop@exemple.sn", profil: "operateur", password: "provisoire-2026" } });
    expect(validerCompteAdmin({ ...base, password: "court" }, "creation").ok).toBe(false);
    expect(validerCompteAdmin({ ...base, email: "pas-une-adresse" }, "creation").ok).toBe(false);
    expect(validerCompteAdmin({ ...base, full_name: " " }, "creation").ok).toBe(false);
  });
  it("seuls deux profils existent : valideur et opérateur", () => {
    expect(validerCompteAdmin({ ...base, profil: "valideur" }, "creation").ok).toBe(true);
    expect(validerCompteAdmin({ ...base, profil: "superadmin" }, "creation").ok).toBe(false);
  });
  it("modification : le mot de passe n'est jamais repris", () => {
    expect(validerCompteAdmin({ ...base, password: "autre-mot-de-passe" }, "modification")).toEqual({ ok: true, value: { full_name: "Awa Diop", email: "awa.diop@exemple.sn", profil: "operateur" } });
  });
});
