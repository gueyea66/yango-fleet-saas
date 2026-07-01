// Tests for calcDriverSalary — critical business logic
// Extracted from app/admin/page.tsx for testing

function calcDriverSalary(netDeclared: number, cfg: any): number {
  const model: string = cfg.model || "tiered";
  if (model === "fixed") return cfg.base_amount || 0;
  if (model === "tiered") {
    const tiers: any[] = Array.isArray(cfg.salary_tiers) ? cfg.salary_tiers : [];
    const sorted = [...tiers].sort((a: any, b: any) => b.min_net - a.min_net);
    const tier = sorted.find((t: any) => netDeclared >= t.min_net) ?? sorted[sorted.length - 1];
    return tier?.total_salary ?? cfg.base_amount ?? 0;
  }
  if (model === "percent") return netDeclared * (cfg.commission_rate || 0);
  if (model === "hybrid") {
    const base = cfg.base_amount || 0;
    const bonus = cfg.bonus_threshold > 0 && netDeclared >= cfg.bonus_threshold ? (cfg.bonus_amount || 0) : 0;
    return base + bonus + netDeclared * (cfg.commission_rate || 0);
  }
  if (model === "location") return 0;
  return 0;
}

// ─── Fixed model ─────────────────────────────────────

describe("calcDriverSalary — fixed model", () => {
  const cfg = { model: "fixed", base_amount: 150_000 };

  test("returns base_amount regardless of net declared", () => {
    expect(calcDriverSalary(0, cfg)).toBe(150_000);
    expect(calcDriverSalary(500_000, cfg)).toBe(150_000);
    expect(calcDriverSalary(1_000_000, cfg)).toBe(150_000);
  });

  test("returns 0 when base_amount missing", () => {
    expect(calcDriverSalary(500_000, { model: "fixed" })).toBe(0);
  });
});

// ─── Tiered model ─────────────────────────────────────

describe("calcDriverSalary — tiered model", () => {
  const tiers = [
    { min_net: 0,       total_salary: 80_000,  label: "Bronze" },
    { min_net: 300_000, total_salary: 120_000, label: "Silver" },
    { min_net: 500_000, total_salary: 160_000, label: "Gold"   },
    { min_net: 800_000, total_salary: 200_000, label: "Platinum" },
  ];
  const cfg = { model: "tiered", salary_tiers: tiers };

  test("0 XOF net → lowest tier (80 000)", () => {
    expect(calcDriverSalary(0, cfg)).toBe(80_000);
  });

  test("299 999 XOF → bronze tier (80 000)", () => {
    expect(calcDriverSalary(299_999, cfg)).toBe(80_000);
  });

  test("300 000 XOF → silver tier (120 000)", () => {
    expect(calcDriverSalary(300_000, cfg)).toBe(120_000);
  });

  test("500 000 XOF → gold tier (160 000)", () => {
    expect(calcDriverSalary(500_000, cfg)).toBe(160_000);
  });

  test("800 000 XOF → platinum tier (200 000)", () => {
    expect(calcDriverSalary(800_000, cfg)).toBe(200_000);
  });

  test("1 200 000 XOF → still platinum (highest tier)", () => {
    expect(calcDriverSalary(1_200_000, cfg)).toBe(200_000);
  });

  test("empty tiers → falls back to base_amount", () => {
    expect(calcDriverSalary(500_000, { model: "tiered", salary_tiers: [], base_amount: 100_000 })).toBe(100_000);
  });

  test("no tiers, no base_amount → 0", () => {
    expect(calcDriverSalary(500_000, { model: "tiered" })).toBe(0);
  });
});

// ─── Percent model ─────────────────────────────────────

describe("calcDriverSalary — percent model", () => {
  const cfg = { model: "percent", commission_rate: 0.35 };

  test("35% of 400 000 = 140 000", () => {
    expect(calcDriverSalary(400_000, cfg)).toBe(140_000);
  });

  test("35% of 0 = 0", () => {
    expect(calcDriverSalary(0, cfg)).toBe(0);
  });

  test("missing commission_rate defaults to 0", () => {
    expect(calcDriverSalary(400_000, { model: "percent" })).toBe(0);
  });
});

// ─── Hybrid model ─────────────────────────────────────

describe("calcDriverSalary — hybrid model (base + bonus + %)", () => {
  const cfg = {
    model: "hybrid",
    base_amount: 100_000,
    bonus_threshold: 600_000,
    bonus_amount: 30_000,
    commission_rate: 0.05,
  };

  test("below threshold: base + commission, no bonus", () => {
    // 100 000 + 0 + 500 000 * 0.05 = 125 000
    expect(calcDriverSalary(500_000, cfg)).toBe(125_000);
  });

  test("at threshold: base + bonus + commission", () => {
    // 100 000 + 30 000 + 600 000 * 0.05 = 160 000
    expect(calcDriverSalary(600_000, cfg)).toBe(160_000);
  });

  test("above threshold: base + bonus + commission", () => {
    // 100 000 + 30 000 + 800 000 * 0.05 = 170 000
    expect(calcDriverSalary(800_000, cfg)).toBe(170_000);
  });

  test("zero net: base only (below threshold)", () => {
    expect(calcDriverSalary(0, cfg)).toBe(100_000);
  });
});

// ─── Location model ─────────────────────────────────────

describe("calcDriverSalary — location model", () => {
  test("driver keeps their own net — always returns 0", () => {
    expect(calcDriverSalary(0, { model: "location" })).toBe(0);
    expect(calcDriverSalary(999_999, { model: "location" })).toBe(0);
  });
});

// ─── Unknown model ─────────────────────────────────────

describe("calcDriverSalary — edge cases", () => {
  test("unknown model returns 0", () => {
    expect(calcDriverSalary(500_000, { model: "custom_unknown" })).toBe(0);
  });

  test("missing model defaults to tiered", () => {
    const tiers = [{ min_net: 0, total_salary: 90_000, label: "Base" }];
    expect(calcDriverSalary(100_000, { salary_tiers: tiers })).toBe(90_000);
  });
});
