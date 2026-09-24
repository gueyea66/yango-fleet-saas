// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// logique partagée par l'UI actuelle et l'UI v2 — mêmes requêtes, mêmes
// écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "./shared";

export function useDriverHomeData(profile: Profile) {
  const [monthNet, setMonthNet] = useState(0);
  const [monthPending, setMonthPending] = useState(0);
  const [todayStatus, setTodayStatus] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [loaded, setLoaded] = useState(false); // ajout v2 : squelette tant que rien n'est chargé

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const today = new Date().toISOString().split("T")[0];
      const monthStart = today.slice(0, 7) + "-01";

      const [{ data: m }, { data: mp }, { data: t }, { data: p }, { data: rej }] = await Promise.all([
        supabase.from("daily_reports").select("net_after_expenses").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).gte("date", monthStart).in("status", ["approved", "submitted"]),
        supabase.from("daily_reports").select("net_after_expenses").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).gte("date", monthStart).eq("status", "approved"),
        // Rapport ACTIF du jour uniquement (un rejeté ne doit ni s'afficher ici ni casser
        // .maybeSingle() si une resoumission coexiste avec le rejet pour la même date).
        supabase.from("daily_reports").select("status").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("date", today).in("status", ["submitted", "approved"]).limit(1).maybeSingle(),
        supabase.from("daily_reports").select("id").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("status", "submitted"),
        supabase.from("daily_reports").select("id, date").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("status", "rejected"),
      ]);
      setMonthNet((m || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0));
      setMonthPending((mp || []).reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0)); // approved only
      setTodayStatus(t?.status ?? null);
      setPendingCount(p?.length ?? 0);
      setRejectedCount((rej || []).length);
      setLoaded(true);
    })();
  }, [profile.id]);

  return { monthNet, monthPending, todayStatus, pendingCount, rejectedCount, loaded };
}
