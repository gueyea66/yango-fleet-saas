import type { RemunerationConfig } from "@/lib/tenant/types";

export interface RemunerationInput {
  grossYango: number;       // brut Yango du mois
  grossOffYango: number;    // recettes hors Yango
  daysWorked: number;       // jours travaillés
  advances: number;         // avances déjà versées
}

export interface RemunerationResult {
  model: string;
  baseSalary: number;
  commission: number;
  bonus: number;
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

  switch (config.model) {
    case "fixed":
      baseSalary = config.base_amount;
      break;

    case "percent":
      commission = totalRevenue * config.commission_rate;
      break;

    case "hybrid":
      baseSalary = config.base_amount;
      commission = totalRevenue * config.commission_rate;
      if (totalRevenue >= config.bonus_threshold && config.bonus_threshold > 0) {
        bonus = config.bonus_amount;
      }
      break;
  }

  const totalGross = baseSalary + commission + bonus;
  const netToPay = Math.max(0, totalGross - input.advances);

  const breakdownParts: string[] = [];
  if (baseSalary > 0) breakdownParts.push(`Fixe: ${fmt(baseSalary)}`);
  if (commission > 0) breakdownParts.push(`Commission (${(config.commission_rate * 100).toFixed(0)}%): ${fmt(commission)}`);
  if (bonus > 0) breakdownParts.push(`Bonus: ${fmt(bonus)}`);
  if (input.advances > 0) breakdownParts.push(`Avances: -${fmt(input.advances)}`);

  return {
    model: config.model,
    baseSalary,
    commission,
    bonus,
    totalGross,
    deductAdvances: input.advances,
    netToPay,
    breakdown: breakdownParts.join(" | "),
  };
}

function fmt(n: number) {
  return n.toLocaleString("fr-SN") + " XOF";
}
