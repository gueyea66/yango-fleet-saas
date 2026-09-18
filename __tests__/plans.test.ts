import { getPlanLimits, canDo, getTrialStatus, PLAN_LIMITS } from "../lib/plans";

describe("PLAN_LIMITS", () => {
  // L'unité facturée est le véhicule actif. Aucun palier ne plafonne les
  // chauffeurs : la page publique et les devis promettent l'inverse, et un
  // quota qui refuserait le vingt-et-unième démentirait la promesse.
  test("aucun palier ne plafonne les chauffeurs", () => {
    for (const p of Object.values(PLAN_LIMITS)) {
      expect(p.maxDrivers).toBe(Infinity);
    }
  });

  test("les véhicules compris suivent le barème public 3 / 7 / 10", () => {
    expect(PLAN_LIMITS.standard.includedVehicles).toBe(3);
    expect(PLAN_LIMITS.pro.includedVehicles).toBe(7);
    expect(PLAN_LIMITS.enterprise.includedVehicles).toBe(10);
  });

  test("le véhicule supplémentaire vaut 10 000 XOF dans tous les paliers", () => {
    for (const p of Object.values(PLAN_LIMITS)) {
      expect(p.extraVehicleXOF).toBe(10000);
    }
  });

  // Le barème se referme sur lui-même : chaque palier s'arrête là où le
  // suivant devient moins cher, sinon un client resterait piégé au mauvais.
  test("chaque palier cède au suivant au bon nombre de véhicules", () => {
    const cout = (p: keyof typeof PLAN_LIMITS, vehicules: number) => {
      const l = PLAN_LIMITS[p];
      return l.priceXOF + Math.max(0, vehicules - l.includedVehicles) * l.extraVehicleXOF;
    };
    expect(cout("standard", 7)).toBe(PLAN_LIMITS.pro.priceXOF);
    expect(cout("pro", 10)).toBeGreaterThan(PLAN_LIMITS.enterprise.priceXOF);
  });

  test("le palier vendu aux flottes existe et vaut 100 000", () => {
    expect(PLAN_LIMITS.enterprise.priceXOF).toBe(100000);
    expect(PLAN_LIMITS.enterprise.canExportCSV).toBe(true);
    expect(PLAN_LIMITS.enterprise.canCustomBranding).toBe(true);
  });
});

describe("getPlanLimits", () => {
  test("rend le palier demandé", () => {
    expect(getPlanLimits("standard").includedVehicles).toBe(3);
    expect(getPlanLimits("pro").includedVehicles).toBe(7);
    expect(getPlanLimits("enterprise").includedVehicles).toBe(10);
  });

  test("un plan inconnu retombe sur standard", () => {
    expect(getPlanLimits("trial").includedVehicles).toBe(3);
    expect(getPlanLimits("").includedVehicles).toBe(3);
  });
});

describe("canDo — feature flags", () => {
  test("standard cannot export CSV", () => {
    expect(canDo("standard", "canExportCSV")).toBe(false);
  });

  test("pro can export CSV", () => {
    expect(canDo("pro", "canExportCSV")).toBe(true);
  });

  test("standard cannot use custom branding", () => {
    expect(canDo("standard", "canCustomBranding")).toBe(false);
  });

  test("pro can use custom branding", () => {
    expect(canDo("pro", "canCustomBranding")).toBe(true);
  });

  test("both plans can use salary advance", () => {
    expect(canDo("standard", "canSalaryAdvance")).toBe(true);
    expect(canDo("pro", "canSalaryAdvance")).toBe(true);
  });

  test("standard cannot use API access", () => {
    expect(canDo("standard", "canAccessAPI")).toBe(false);
  });

  test("pro can use API access", () => {
    expect(canDo("pro", "canAccessAPI")).toBe(true);
  });
});

describe("getTrialStatus", () => {
  const daysFromNow = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  test("active: 30 days left", () => {
    const status = getTrialStatus(daysFromNow(30), null);
    expect(status.state).toBe("active");
    if (status.state === "active") {
      expect(status.daysLeft).toBeGreaterThanOrEqual(29);
    }
  });

  test("warning at 14 days", () => {
    const status = getTrialStatus(daysFromNow(14), null);
    expect(status.state).toBe("warning");
    if (status.state === "warning") {
      expect(status.horizon).toBe("14d");
    }
  });

  test("warning at 7 days", () => {
    const status = getTrialStatus(daysFromNow(7), null);
    expect(status.state).toBe("warning");
    if (status.state === "warning") {
      expect(status.horizon).toBe("7d");
    }
  });

  test("warning at 3 days", () => {
    const status = getTrialStatus(daysFromNow(3), null);
    expect(status.state).toBe("warning");
    if (status.state === "warning") {
      expect(status.horizon).toBe("3d");
    }
  });

  test("warning at 1 day", () => {
    const status = getTrialStatus(daysFromNow(1), null);
    expect(status.state).toBe("warning");
    if (status.state === "warning") {
      expect(status.horizon).toBe("1d");
    }
  });

  test("expired: past date", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(getTrialStatus(past, null).state).toBe("expired");
  });

  test("expired: null dates", () => {
    expect(getTrialStatus(null, null).state).toBe("expired");
  });

  test("planExpiresAt takes precedence over trialEndsAt", () => {
    const pastTrial = new Date(Date.now() - 86_400_000).toISOString();
    const futurePlan = daysFromNow(30);
    const status = getTrialStatus(pastTrial, futurePlan);
    expect(status.state).toBe("active");
  });
});
