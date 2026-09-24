import {
  ADMIN_DESTINATIONS, destinationFor, entryTab, coveredTabs, periodFromMonths, monthsForPeriod,
} from "@/lib/v2/adminNav";

// Onglets de la sidebar actuelle (tabGroups de app/admin/page.tsx).
const CURRENT_TABS = [
  "dashboard", "pending", "history", "calendrier",
  "payments", "avances", "pilotage",
  "suivi", "vehicles", "drivers", "kyc",
  "remuneration", "boitiers", "journal", "import", "settings",
];

describe("navigation gestionnaire 13 → 8", () => {
  it("6 destinations principales + 2 secondaires", () => {
    expect(ADMIN_DESTINATIONS.filter((d) => !d.secondary).map((d) => d.label))
      .toEqual(["Tableau de bord", "À valider", "Pilotage", "Véhicules", "Équipe", "Finance"]);
    expect(ADMIN_DESTINATIONS.filter((d) => d.secondary).map((d) => d.label)).toEqual(["Historique", "Paramètres"]);
  });
  it("aucun onglet actuel perdu, aucun doublon, identifiants inchangés", () => {
    const covered = coveredTabs();
    expect([...covered].sort()).toEqual([...CURRENT_TABS].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });
  it("regroupements du README", () => {
    expect(destinationFor("suivi").key).toBe("fleet");
    expect(destinationFor("boitiers").key).toBe("fleet");
    expect(destinationFor("kyc").key).toBe("team");
    expect(destinationFor("avances").key).toBe("fin");
    expect(destinationFor("calendrier").key).toBe("hist");
    expect(destinationFor("journal").key).toBe("set");
    expect(destinationFor("remuneration").key).toBe("set");
    expect(destinationFor("inconnu").key).toBe("dash");
  });
  it("une destination ouvre son premier sous-onglet interne", () => {
    expect(entryTab(destinationFor("drivers")).tab).toBe("kyc");
    expect(entryTab(destinationFor("suivi")).tab).toBe("vehicles");
    expect(entryTab(destinationFor("journal")).tab).toBe("settings");
  });
});

describe("période FilterBar ↔ mois sélectionnés", () => {
  it("aller-retour", () => {
    expect(periodFromMonths([9])).toBe("mois");
    expect(periodFromMonths([7, 8, 9])).toBe("mois");
    expect(periodFromMonths(monthsForPeriod("annee", 9))).toBe("annee");
    expect(monthsForPeriod("mois", 9)).toEqual([9]);
  });
});
