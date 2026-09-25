import {
  bottomNavFor, daysRemainingInMonth, dailyNeeded, needsReview, REVIEW_CONFIDENCE, netCheck,
  nextTierInfo, buildMonthGrid, dayStatus, longDateFr, monthNameFr, shortDayFr, greeting, firstName, parseAmountInput,
} from "@/lib/v2/driver";
import { salaryLevel } from "@/components/driver/shared";

const TIERS = [
  { min_net: 0, total_salary: 200000, label: "Base" },
  { min_net: 1000000, total_salary: 230000, label: "Palier 1" },
  { min_net: 1150000, total_salary: 260000, label: "Palier 2" },
  { min_net: 1300000, total_salary: 300000, label: "Palier 3" },
];
const CFG = { salary_tiers: TIERS, base_amount: 200000 } as unknown as Parameters<typeof salaryLevel>[1];

describe("navigation chauffeur 7 → 4 onglets", () => {
  it("les 4 onglets principaux sont actifs tels quels", () => {
    for (const t of ["home", "report", "expense", "pilotage"] as const) {
      expect(bottomNavFor(t)).toEqual({ visible: true, active: t });
    }
  });
  it("Historique et Repos restent sous Accueil", () => {
    expect(bottomNavFor("history")).toEqual({ visible: true, active: "home" });
    expect(bottomNavFor("repos")).toEqual({ visible: true, active: "home" });
  });
  it("le Profil est dans la barre — c'est lui qui porte la déconnexion", () => {
    expect(bottomNavFor("profil")).toEqual({ visible: true, active: "profil" });
  });
});

describe("pilotage : rythme vs objectif", () => {
  it("jours restants (23 septembre → 7)", () => {
    expect(daysRemainingInMonth(new Date(2026, 8, 23))).toBe(7);
    expect(daysRemainingInMonth(new Date(2026, 8, 30))).toBe(0);
    expect(daysRemainingInMonth(new Date(2028, 1, 1))).toBe(28); // février bissextile
  });
  it("il faut X / jour = restant ÷ jours restants", () => {
    expect(dailyNeeded(412500, 7)).toBeCloseTo(58928.57, 1);
    expect(dailyNeeded(50000, 0)).toBe(50000); // dernier jour : tout aujourd'hui
    expect(dailyNeeded(-10, 5)).toBe(0);
    expect(dailyNeeded(NaN, 5)).toBe(0);
  });
});

describe("vérification du rapport lu", () => {
  it("à vérifier sous 0,75 de confiance", () => {
    expect(REVIEW_CONFIDENCE).toBe(0.75);
    expect(needsReview(0.74)).toBe(true);
    expect(needsReview(0.75)).toBe(false);
    expect(needsReview(0.99)).toBe(false);
    expect(needsReview(undefined)).toBe(false);
  });
  it("net affiché vs calculé", () => {
    expect(netCheck(null, 40019)).toBe("none");
    expect(netCheck(40019, 40019.4)).toBe("match");
    expect(netCheck(40020, 40019)).toBe("match");
    expect(netCheck(40519, 40019)).toBe("mismatch");
  });
});

describe("carte palier", () => {
  it("montant manquant et progression (mêmes règles que l'accueil actuel)", () => {
    const net = 587500;
    const info = nextTierInfo(net, TIERS, salaryLevel(net, CFG));
    expect(info.next?.label).toBe("Palier 1");
    expect(info.missing).toBe(412500);
    expect(info.progressPct).toBeCloseTo(58.75, 2);
  });
  it("palier intermédiaire", () => {
    const net = 1200000;
    const info = nextTierInfo(net, TIERS, salaryLevel(net, CFG));
    expect(info.next?.label).toBe("Palier 3");
    expect(info.missing).toBe(100000);
  });
  it("palier max atteint", () => {
    const net = 1400000;
    expect(nextTierInfo(net, TIERS, salaryLevel(net, CFG))).toEqual({ next: null, missing: 0, progressPct: 100 });
  });
});

describe("calendrier du mois", () => {
  it("septembre 2026 commence un mardi → 1 case vide", () => {
    const g = buildMonthGrid(2026, 8);
    expect(g[0]).toEqual({ date: null, day: null });
    expect(g[1]).toEqual({ date: "2026-09-01", day: 1 });
    expect(g.filter((c) => c.day).length).toBe(30);
  });
  it("un mois commençant un lundi n'a pas de case vide", () => {
    expect(buildMonthGrid(2026, 5)[0].date).toBe("2026-06-01");
  });
  it("un mois commençant un dimanche a 6 cases vides", () => {
    expect(buildMonthGrid(2026, 1).findIndex((c) => c.day === 1)).toBe(6);
  });
  it("état du jour", () => {
    expect(dayStatus([])).toBeNull();
    expect(dayStatus([{ status: "rejected" }])).toBe("rejected");
    expect(dayStatus([{ status: "rejected" }, { status: "submitted" }])).toBe("submitted");
    expect(dayStatus([{ status: "submitted" }, { status: "approved" }])).toBe("approved");
    expect(dayStatus([{ status: "approved", comment: "[REPOS] congé" }])).toBe("repos");
    expect(dayStatus([{ status: "rejected", comment: "[REPOS]" }])).toBe("rejected");
    expect(dayStatus([{ status: "archived" }])).toBeNull();
  });
});

describe("textes", () => {
  it("dates en français", () => {
    expect(longDateFr(new Date(2026, 8, 23))).toBe("Mercredi 23 septembre");
    expect(monthNameFr(8)).toBe("septembre");
    expect(monthNameFr(-1)).toBe("décembre");
    expect(shortDayFr("2026-09-22")).toBe("Mar. 22/09");
  });
  it("salutation", () => {
    expect(greeting(9)).toBe("Bonjour");
    expect(greeting(18)).toBe("Bonsoir");
    expect(greeting(23)).toBe("Bonsoir");
    expect(greeting(2)).toBe("Bonsoir");
    expect(firstName("Moussa Diop")).toBe("Moussa");
    expect(firstName(null)).toBe("");
  });
  it("saisie de montant", () => {
    expect(parseAmountInput("8 000")).toBe(8000);
    expect(parseAmountInput("8 000")).toBe(8000);
    expect(parseAmountInput("12,5")).toBe(12.5);
    expect(parseAmountInput("")).toBe(0);
    expect(parseAmountInput("abc")).toBe(0);
  });
});
