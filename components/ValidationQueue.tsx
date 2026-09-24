"use client";

// Déplacé tel quel depuis components/SimpleModeAdmin.tsx (refonte UI v2, étape 3) :
// file « À valider » partagée par le mode simple et le tableau de bord v2 —
// mêmes écritures (statut + action_logs + notification), même ordre, même
// gestion d'erreur. Seul changement : le rafraîchissement des KPIs passe par
// le rappel `onChanged` au lieu du setRefreshTick local.
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchJsonRetry } from "@/lib/fetchJsonRetry";

export function useValidationQueue(tenantId: string, onChanged?: () => void) {
  const [pending, setPending] = useState<any[]>([]);
  const [pendingExp, setPendingExp] = useState<any[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    try {
      const supabase = createClient() as any;
      // fetchJsonRetry : un 401 transitoire (course au refresh token) laissait
      // le bloc vide jusqu'au prochain refresh manuel (retour Abdou 03/09).
      const [json, { data: profs }] = await Promise.all([
        fetchJsonRetry(`/api/admin/reports?tenantId=${tenantId}`),
        supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).eq("role", "driver"),
      ]);
      setDriverNames(Object.fromEntries((profs || []).map((p: any) => [p.id, p.full_name])));
      setPending((json.reports || []).filter((r: any) => r.status === "submitted"));
      setPendingExp((json.expenses || []).filter((e: any) => e.status === "submitted"));
    } catch { /* silencieux — le bloc s'affiche vide */ }
  }, [tenantId]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const afterAction = async () => {
    await loadPending();
    onChanged?.(); // les hero/graphes reflètent la validation
  };

  const reportAction = async (r: any, status: "approved" | "rejected") => {
    setActing(r.id);
    try {
      const supabase = createClient() as any;
      if (status === "approved") {
        // Un seul rapport ACTIF par chauffeur et par date.
        const { data: dup } = await supabase.from("daily_reports")
          .select("id").eq("driver_id", r.driver_id).eq("tenant_id", r.tenant_id)
          .eq("date", r.date).eq("status", "approved").neq("id", r.id).limit(1).maybeSingle();
        if (dup) { alert("Un autre rapport est déjà validé pour ce chauffeur à cette date."); setActing(null); return; }
      }
      const { error } = await supabase.from("daily_reports").update({ status }).eq("id", r.id);
      if (error) throw error;
      void supabase.from("action_logs").insert({
        tenant_id: r.tenant_id, actor_role: "admin",
        entity_type: "daily_report", entity_id: r.id, action: status,
        metadata: { date: r.date, net: r.net_after_expenses },
      });
      void fetch("/api/notifications/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: `report_${status}`, tenantId: r.tenant_id, driverId: r.driver_id, data: { date: r.date } }),
      });
      await afterAction();
    } catch (err: any) {
      alert("Erreur : " + (err.message || "validation impossible"));
    } finally {
      setActing(null);
    }
  };

  const expenseAction = async (e: any, status: "approved" | "rejected") => {
    setActing(e.id);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({ status }).eq("id", e.id);
      if (error) throw error;
      void supabase.from("action_logs").insert({
        tenant_id: e.tenant_id, actor_role: "admin",
        entity_type: "expense", entity_id: e.id, action: status,
        metadata: { category: e.category, amount: e.amount },
      });
      await afterAction();
    } catch (err: any) {
      alert("Erreur : " + (err.message || "validation impossible"));
    } finally {
      setActing(null);
    }
  };

  return { pending, pendingExp, driverNames, acting, loadPending, reportAction, expenseAction };
}
