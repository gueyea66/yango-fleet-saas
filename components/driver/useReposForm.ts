// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// logique partagée par l'UI actuelle et l'UI v2 — mêmes requêtes, mêmes
// écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "./shared";

export function useReposForm(profile: Profile) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [motif, setMotif] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [existing, setExisting] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      // Show past month + 2 months ahead for planning
      const from = new Date(); from.setMonth(from.getMonth() - 1);
      const to = new Date(); to.setMonth(to.getMonth() + 2);
      const { data } = await supabase.from("daily_reports")
        .select("date,status,comment")
        .eq("driver_id", profile.id)
        .eq("tenant_id", profile.tenant_id)
        .gte("date", from.toISOString().slice(0, 10))
        .lte("date", to.toISOString().slice(0, 10))
        .like("comment", "[REPOS]%")
        .order("date", { ascending: true });
      setExisting(data || []);
    })();
  }, [profile.id, today, submitted]);

  const submit = async () => {
    if (!date) return;
    setSaving(true);
    try {
      const supabase = createClient() as any;
      // Bloque seulement s'il existe déjà un rapport ACTIF (submitted/approved) pour
      // cette date — un rapport rejeté ne doit pas empêcher une nouvelle saisie.
      const { data: exists } = await supabase.from("daily_reports")
        .select("id").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id).eq("date", date)
        .in("status", ["submitted", "approved"]).limit(1).maybeSingle();
      if (exists) { alert("Un rapport existe déjà pour cette date."); setSaving(false); return; }
      const { error } = await supabase.from("daily_reports").insert({
        driver_id: profile.id,
        tenant_id: profile.tenant_id,
        date,
        source: "saas",
        status: "submitted",
        comment: `[REPOS]${motif ? " " + motif.trim() : ""}`,
        gross_earnings: 0,
        yango_gross: 0,
        yango_bonus: 0,
        off_yango_revenue: 0,
        net_after_expenses: 0,
        commission_rate: 0,
        commission_amount: 0,
        expense_count: 0,
      });
      if (error) throw error;
      void fetch("/api/notifications/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "report_submitted", data: { date } }),
      });
      setSubmitted(true);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  return { today, date, setDate, motif, setMotif, saving, submitted, setSubmitted, existing, submit };
}
