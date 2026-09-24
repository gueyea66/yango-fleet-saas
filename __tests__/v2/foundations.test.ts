import { resolveUiV2, UI_V2_STORAGE_KEY } from "@/lib/v2/flag";
import { formatAmount, formatDecimal, formatPct, sharePct, initials } from "@/lib/v2/format";
import { parseFilterParams, serializeFilterParams, periodRange, rangeLabel } from "@/lib/v2/filters";

const NB = " ";

describe("drapeau UI v2", () => {
  it("éteint par défaut", () => {
    expect(resolveUiV2(undefined, null)).toBe(false);
    expect(resolveUiV2(null, null)).toBe(false);
    expect(resolveUiV2(false, null)).toBe(false);
  });
  it("allumé par le tenant", () => {
    expect(resolveUiV2(true, null)).toBe(true);
  });
  it("forcé sur l'appareil uniquement avec la valeur exacte « v2 »", () => {
    expect(UI_V2_STORAGE_KEY).toBe("m3a-ui");
    expect(resolveUiV2(false, "v2")).toBe(true);
    expect(resolveUiV2(undefined, "V2")).toBe(false);
    expect(resolveUiV2(undefined, "1")).toBe(false);
  });
});

describe("formatage", () => {
  it("groupe les milliers avec une espace insécable", () => {
    expect(formatAmount(412500)).toBe(`412${NB}500`);
    expect(formatAmount(1284500.6)).toBe(`1${NB}284${NB}501`);
    expect(formatAmount(-8000)).toBe(`-8${NB}000`);
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount(NaN)).toBe("—");
  });
  it("décimales à la française", () => {
    expect(formatDecimal(14.2)).toBe("14,2");
    expect(formatDecimal(1234.56, 2)).toBe(`1${NB}234,56`);
    expect(formatDecimal(-0.04)).toBe("0,0");
  });
  it("parts en % : null si total nul", () => {
    expect(sharePct(25, 200)).toBe(12.5);
    expect(sharePct(10, 0)).toBeNull();
    expect(sharePct(10, -5)).toBeNull();
    expect(formatPct(12.5)).toBe(`12,5${NB}%`);
    expect(formatPct(null)).toBe("—");
  });
  it("initiales", () => {
    expect(initials("Moussa Diop")).toBe("MD");
    expect(initials("Awa Binta Ndiaye")).toBe("AN");
    expect(initials("abdou")).toBe("AB");
    expect(initials("")).toBe("?");
  });
});

describe("FilterBar — paramètres d'URL", () => {
  it("lit p et d, avec repli sur mois", () => {
    expect(parseFilterParams("?p=7j&d=abc")).toEqual({ period: "7j", driverId: "abc" });
    expect(parseFilterParams("p=inconnu")).toEqual({ period: "mois", driverId: "" });
    expect(parseFilterParams("", "jour")).toEqual({ period: "jour", driverId: "" });
  });
  it("écrit p/d sans perdre les autres paramètres", () => {
    const q = serializeFilterParams({ period: "annee", driverId: "x1" }, "tab=pending&d=old");
    const sp = new URLSearchParams(q);
    expect(sp.get("tab")).toBe("pending");
    expect(sp.get("p")).toBe("annee");
    expect(sp.get("d")).toBe("x1");
    expect(new URLSearchParams(serializeFilterParams({ period: "mois", driverId: "" }, q)).has("d")).toBe(false);
  });
  it("aller-retour", () => {
    const s = { period: "jour" as const, driverId: "d-42" };
    expect(parseFilterParams(serializeFilterParams(s))).toEqual(s);
  });
});

describe("FilterBar — périodes", () => {
  const today = new Date(2026, 8, 23, 21, 30); // mardi 23 septembre 2026
  it("bornes incluses se terminant aujourd'hui", () => {
    expect(periodRange("jour", today)).toEqual({ from: "2026-09-23", to: "2026-09-23" });
    expect(periodRange("7j", today)).toEqual({ from: "2026-09-17", to: "2026-09-23" });
    expect(periodRange("mois", today)).toEqual({ from: "2026-09-01", to: "2026-09-23" });
    expect(periodRange("annee", today)).toEqual({ from: "2026-01-01", to: "2026-09-23" });
  });
  it("7 j à cheval sur deux mois", () => {
    expect(periodRange("7j", new Date(2026, 9, 3))).toEqual({ from: "2026-09-27", to: "2026-10-03" });
  });
  it("libellés", () => {
    expect(rangeLabel("2026-09-01", "2026-09-23")).toBe("Septembre 2026");
    expect(rangeLabel("2026-09-23", "2026-09-23")).toBe("23 septembre 2026");
    expect(rangeLabel("2026-09-17", "2026-09-23")).toBe("17 → 23 sept.");
    expect(rangeLabel("2026-08-28", "2026-09-03")).toBe("28 août → 3 sept.");
    expect(rangeLabel("2026-01-01", "2026-09-23")).toBe("2026");
    expect(rangeLabel("2025-12-28", "2026-01-03")).toBe("28/12/2025 → 03/01/2026");
    expect(rangeLabel("", "2026-01-03")).toBe("—");
  });
});
