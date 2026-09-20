import { tenantAccessState, accessExpiresAt } from "@/lib/tenant/access";

const JOUR = 86_400_000;
const MAINTENANT = Date.parse("2026-09-20T12:00:00Z");
const hier = new Date(MAINTENANT - JOUR).toISOString();
const demain = new Date(MAINTENANT + JOUR).toISOString();
const dansUnMois = new Date(MAINTENANT + 30 * JOUR).toISOString();

describe("règle d'accès tenant", () => {
  it("laisse passer un tenant actif sans échéance", () => {
    const a = tenantAccessState({ active: true }, MAINTENANT);
    expect(a.locked).toBe(false);
    expect(a.expiresAt).toBeNull();
  });

  it("ferme un tenant suspendu, même avec une échéance dans le futur", () => {
    const a = tenantAccessState({ active: false, plan_expires_at: dansUnMois }, MAINTENANT);
    expect(a).toMatchObject({ locked: true, reason: "inactive" });
  });

  it("ferme un abonnement dépassé", () => {
    const a = tenantAccessState({ active: true, plan_expires_at: hier }, MAINTENANT);
    expect(a).toMatchObject({ locked: true, reason: "expired" });
    expect(a.daysLeft).toBeLessThanOrEqual(0);
  });

  it("ferme un essai dépassé", () => {
    const a = tenantAccessState({ active: true, trial_ends_at: hier }, MAINTENANT);
    expect(a).toMatchObject({ locked: true, reason: "expired" });
  });

  it("fait primer plan_expires_at sur trial_ends_at", () => {
    const a = tenantAccessState({ active: true, trial_ends_at: hier, plan_expires_at: demain }, MAINTENANT);
    expect(a.locked).toBe(false);
    expect(a.expiresAt).toBe(demain);
  });

  // ── Régression : l'incident « le credential admin de M3A ne marche plus » ──
  // La migration 011 avait posé un trial_ends_at par DEFAULT sur le tenant de
  // l'opérateur (plan 'pro', jamais passé par un paiement, plan_expires_at
  // NULL). Trente jours plus tard, la connexion réussissait et l'app renvoyait
  // sur /locked. `never_expires` est le seul contrat qui empêche ce retour.
  it("n'expire jamais un tenant marqué never_expires", () => {
    const operateur = {
      active: true, plan: "pro", never_expires: true,
      trial_ends_at: hier, plan_expires_at: null,
    };
    const a = tenantAccessState(operateur, MAINTENANT);
    expect(a.locked).toBe(false);
    expect(a.reason).toBeNull();
    expect(accessExpiresAt(operateur)).toBeNull();
  });

  it("ferme quand même un never_expires suspendu à la main", () => {
    const a = tenantAccessState({ active: false, never_expires: true }, MAINTENANT);
    expect(a).toMatchObject({ locked: true, reason: "inactive" });
  });

  it("n'enferme personne sur une date illisible", () => {
    const a = tenantAccessState({ active: true, plan_expires_at: "pas-une-date" }, MAINTENANT);
    expect(a.locked).toBe(false);
  });

  it("compte les jours restants", () => {
    expect(tenantAccessState({ active: true, plan_expires_at: dansUnMois }, MAINTENANT).daysLeft).toBe(30);
  });
});
