import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/components/driver/shared";

export interface MonthReport {
  id: string;
  date: string;
  status: string;
  comment: string | null;
  net_after_expenses: number | null;
  yango_trip_count: number | null;
  rejection_reason?: string | null;
  [k: string]: unknown;
}
export interface MonthExpense {
  id: string;
  expense_date: string | null;
  created_at?: string;
  category: string | null;
  amount: number | null;
  status: string | null;
  [k: string]: unknown;
}

/**
 * Lecture seule des rapports et dépenses d'un mois du chauffeur (calendrier
 * v2, barres du pilotage). Mêmes tables et mêmes filtres chauffeur/tenant que
 * l'Historique actuel, bornées au mois au lieu des 30 dernières lignes.
 */
export function useDriverMonth(profile: Profile, year: number, month0: number) {
  const [reports, setReports] = useState<MonthReport[]>([]);
  const [expenses, setExpenses] = useState<MonthExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const from = `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
  const to = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(new Date(year, month0 + 1, 0).getDate()).padStart(2, "0")}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client non typé sur le schéma fleet (convention du projet)
      const supabase = createClient() as any;
      const [{ data: r }, { data: e }] = await Promise.all([
        supabase.from("daily_reports").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
          .gte("date", from).lte("date", to).order("date", { ascending: true }),
        supabase.from("expenses").select("*").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
          .gte("expense_date", from).lte("expense_date", to).order("expense_date", { ascending: true }),
      ]);
      if (!alive) return;
      setReports(r || []);
      setExpenses(e || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [profile.id, profile.tenant_id, from, to, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { reports, expenses, loading, refresh };
}
