import { getPlanLimits, canDo, getTrialStatus, PLAN_LIMITS } from "../lib/plans";

describe("PLAN_LIMITS", () => {
  test("standard: maxDrivers = 20", () => {
    expect(PLAN_LIMITS.standard.maxDrivers).toBe(20);
  });

  test("pro: maxDrivers = Infinity", () => {
    expect(PLAN_LIMITS.pro.maxDrivers).toBe(Infinity);
  });
});

describe("getPlanLimits", () => {
  test("returns standard limits for 'standard'", () => {
    expect(getPlanLimits("standard").maxDrivers).toBe(20);
  });

  test("returns pro limits for 'pro'", () => {
    expect(getPlanLimits("pro").maxDrivers).toBe(Infinity);
  });

  test("unknown plan falls back to standard", () => {
    expect(getPlanLimits("enterprise").maxDrivers).toBe(20);
    expect(getPlanLimits("trial").maxDrivers).toBe(20);
    expect(getPlanLimits("").maxDrivers).toBe(20);
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
