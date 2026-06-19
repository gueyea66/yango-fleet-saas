import type { RemunerationConfig } from "@/lib/tenant/types";

export interface RemunerationInput {
  grossYango: number;
  grossOffYango: number;
  daysWorked: number;
  advances: number;
}

export interface RemunerationResult {
  model: string;
  baseSalary: number;
  commission: number;
  bonus: number;
  rentDue: number;       // location model
  totalGross: number;
  deductAdvances: number;
  netToPay: number;
  breakdown: string;
}

export function calculateRemuneration(
  config: RemunerationConfig,
  input: RemunerationInput
): RemunerationResult {
  const totalRevenue = input.grossYango + input.grossOffYango;
  let baseSalary = 0;
  let commission = 0;
  let bonus = 0;
  let rentDue = 0;

  switch (config.model) {
    case "fixed":
      baseSalary = config.base_amount;
      break;

    case "tiered": {
      const tiers = [...(config.salary_tiers || [])].sort((a, b) => b.min_net - a.min_net);
      const tier = tiers.find((t) => totalRevenue >= t.min_net) ?? tiers[tiers.length - 1];
      baseSalary = tier?.total_salary ?? config.base_amount;
      break;
    }

    case "percent":
      // driver_rate = commission_rate (0–1), driver earns that % of total revenue
      commission = totalRevenue * config.commission_rate;
      break;

    case "hybrid":
      baseSalary = config.base_amount;
      if (config.commission_rate > 0) commission = totalRevenue * config.commission_rate;
      if (config.bonus_threshold > 0 && totalRevenue >= config.bonus_threshold) {
        bonus = config.bonus_amount;
      }
      break;

    case "location":
      // Driver pays daily_rent per worked day to operator, keeps everything else
      rentDue = config.daily_rent * input.daysWorked;
      // "salary" for the driver = net revenue - rent due (driver-managed)
      commission = Math.max(0, totalRevenue - rentDue);
      break;
  }

  const totalGross = baseSalary + commission + bonus;
  const netToPay = Math.max(0, totalGross - input.advances);

  const parts: string[] = [];
  if (baseSalary > 0) parts.push(`Salaire: ${fmt(baseSalary)}`);
  if (commission > 0 && config.model !== "location") parts.push(`Commission: ${fmt(commission)}`);
  if (bonus > 0) parts.push(`Bonus: ${fmt(bonus)}`);
  if (rentDue > 0) parts.push(`Loyer dû: ${fmt(rentDue)}`);
  if (input.advances > 0) parts.push(`Avances: -${fmt(input.advances)}`);

  return {
    model: config.model,
    baseSalary,
    commission,
    bonus,
    rentDue,
    totalGross,
    deductAdvances: input.advances,
    netToPay,
    breakdown: parts.join(" | "),
  };
}

function fmt(n: number) {
  return n.toLocaleString("fr-SN") + " XOF";
}
