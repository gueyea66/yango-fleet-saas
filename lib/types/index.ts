export type { Database } from "./database";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "driver";
  phoneNumber?: string;
  avatarUrl?: string;
}

export interface Vehicle {
  id: string;
  driverId: string;
  registrationNumber: string;
  brand: string;
  model: string;
  color?: string;
  year: number;
  transmission?: string;
  fuelType?: string;
  status: "active" | "inactive" | "maintenance";
}

export interface DailyReportRow {
  id: string;
  driverId: string;
  vehicleId: string;
  date: string;
  startOdometer: number;
  endOdometer: number;
  grossEarnings: number;
  commissionRate: number;
  commissionAmount: number;
  netAfterExpenses: number;
  expenseCount: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  reportId: string;
  driverId: string;
  category: string;
  amount: number;
  description?: string;
  createdAt: string;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
}

export interface SalaryRule {
  id: string;
  minMonthlyEarnings: number;
  maxMonthlyEarnings: number;
  salaryPercentage: number;
  bonus?: number;
}
