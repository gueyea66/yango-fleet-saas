import { createClient } from "@/lib/supabase/client";
import { getTenantId } from "@/lib/supabase/tenanted";

export async function addExpense(
  driverId: string,
  reportId: string,
  data: {
    category: string;
    amount: number;
    description?: string;
  }
) {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      tenant_id: tid,
      driver_id: driverId,
      report_id: reportId,
      category: data.category,
      amount: data.amount,
      description: data.description,
    })
    .select()
    .single();

  if (error) throw error;
  return expense;
}

export async function getReportExpenses(reportId: string) {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("tenant_id", tid)
    .eq("report_id", reportId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function deleteExpense(expenseId: string) {
  const supabase = createClient() as any;

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId);

  if (error) throw error;
}

export async function getMonthlyExpenses(driverId: string, month: string) {
  const supabase = createClient() as any;
  const tid = await getTenantId();

  const { data, error } = await supabase
    .from("expenses")
    .select("category, amount")
    .eq("tenant_id", tid)
    .eq("driver_id", driverId)
    .like("created_at", `${month}%`)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const byCategory = (data as any[])?.reduce(
    (acc: Record<string, number>, exp: any) => {
      acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
      return acc;
    },
    {} as Record<string, number>
  ) || {};

  return {
    byCategory,
    total: (Object.values(byCategory) as number[]).reduce((a: number, b: number) => a + b, 0),
  };
}
