export interface Commission {
  rate: number;
  amount: number;
}

export interface DailyReport {
  grossEarnings: number;
  expenses: number;
  commission: Commission;
  netAfterExpenses: number;
}

export interface SalaryTier {
  minEarnings: number;
  maxEarnings: number;
  percentage: number;
  bonus: number;
}

export interface MonthlySalary {
  totalEarnings: number;
  salaryPercentage: number;
  baseSalary: number;
  bonus: number;
  totalSalary: number;
}

export const calculateCommission = (
  grossEarnings: number
): Commission => {
  let rate = 0;

  if (grossEarnings < 15000) {
    rate = 0.15; // 15%
  } else if (grossEarnings < 25000) {
    rate = 0.2; // 20%
  } else if (grossEarnings < 40000) {
    rate = 0.25; // 25%
  } else {
    rate = 0.3; // 30%
  }

  const amount = grossEarnings * rate;

  return { rate, amount };
};

export const calculateDailyReport = (
  grossEarnings: number,
  expenses: number
): DailyReport => {
  const commission = calculateCommission(grossEarnings);
  const netAfterExpenses = grossEarnings - commission.amount - expenses;

  return {
    grossEarnings,
    expenses,
    commission,
    netAfterExpenses,
  };
};

export const determineSalaryTier = (
  monthlyEarnings: number,
  tiers: SalaryTier[]
): SalaryTier | null => {
  return (
    tiers.find(
      (tier) =>
        monthlyEarnings >= tier.minEarnings &&
        monthlyEarnings <= tier.maxEarnings
    ) || null
  );
};

export const calculateMonthlySalary = (
  totalEarnings: number,
  tier: SalaryTier | null
): MonthlySalary => {
  if (!tier) {
    return {
      totalEarnings,
      salaryPercentage: 0,
      baseSalary: 0,
      bonus: 0,
      totalSalary: 0,
    };
  }

  const baseSalary = totalEarnings * (tier.percentage / 100);
  const totalSalary = baseSalary + tier.bonus;

  return {
    totalEarnings,
    salaryPercentage: tier.percentage,
    baseSalary,
    bonus: tier.bonus,
    totalSalary,
  };
};

export const projectMonthly = (
  dailyReports: Array<{
    grossEarnings: number;
    expenses: number;
    date: string;
  }>
): {
  projectedEarnings: number;
  projectedExpenses: number;
  projectedNet: number;
} => {
  const daysWithReports = dailyReports.length;
  const daysInMonth = 30;
  const multiplier = daysInMonth / daysWithReports;

  const totalGross = dailyReports.reduce(
    (sum, report) => sum + report.grossEarnings,
    0
  );
  const totalExpenses = dailyReports.reduce(
    (sum, report) => sum + report.expenses,
    0
  );

  const projectedEarnings = totalGross * multiplier;
  const projectedExpenses = totalExpenses * multiplier;
  const projectedNet = projectedEarnings - projectedExpenses;

  return {
    projectedEarnings,
    projectedExpenses,
    projectedNet,
  };
};
