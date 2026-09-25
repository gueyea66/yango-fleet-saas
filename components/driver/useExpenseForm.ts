// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// logique partagée par l'UI actuelle et l'UI v2 — mêmes requêtes, mêmes
// écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CAT_AVANCE, EXPENSE_CATEGORIES } from "@/lib/expenseCategories";
import { logAction } from "@/lib/logAction";
import type { Profile } from "./shared";

export function useExpenseForm(profile: Profile) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ expense_date: today, type: "Carburant", amount: "", odometer: "", fuel_liters: "", comment: "" });
  const [submitted, setSubmitted] = useState(false);
  const [expenseId, setExpenseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // « Décaissement propriétaire » = avance de fonds : réservé aux comptes
  // techniques (ex. Founder) — un chauffeur déclare la charge réelle, jamais l'avance.
  const isTechnical = profile.account_type === "technical";
  const expenseTypes = EXPENSE_CATEGORIES.filter((t) => isTechnical || t !== CAT_AVANCE);
  // Destinataire de l'avance (suivi « remis vs justifié » par chauffeur)
  const [advanceTo, setAdvanceTo] = useState("");
  const [targets, setTargets] = useState<Array<{ id: string; full_name: string }>>([]);
  useEffect(() => {
    if (!isTechnical || form.type !== CAT_AVANCE || targets.length > 0) return;
    fetch("/api/driver/advance-targets").then((r) => r.json())
      .then((d) => setTargets(d.targets || [])).catch(() => {});
  }, [isTechnical, form.type, targets.length]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const submit = async () => {
    if (!form.amount) { alert("Le montant est requis"); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { data, error } = await supabase.from("expenses").insert({
        driver_id: profile.id, tenant_id: profile.tenant_id, category: form.type, amount: parseFloat(form.amount),
        expense_date: form.expense_date, status: "submitted", source: "saas",
        // Avance propriétaire : porte le chauffeur destinataire (migration 046)
        ...(form.type === CAT_AVANCE && advanceTo ? { advance_driver_id: advanceTo } : {}),
        description: [form.odometer ? `KM: ${form.odometer}` : null, form.fuel_liters ? `${form.fuel_liters}L` : null, form.comment || null].filter(Boolean).join(" · ") || null,
      }).select().single();
      if (error) throw error;
      const expId = data?.id || null;
      setExpenseId(expId);
      // Upload pending files via API (service role)
      if (expId && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const ext = file.name.split(".").pop();
          const path = `${profile.id}/expense_${expId}_${Date.now()}.${ext}`;
          const fd = new FormData(); fd.append("file", file); fd.append("path", path);
          const up = await fetch("/api/kyc-upload", { method: "POST", body: fd });
          const upRes = await up.json().catch(() => ({}));
          await supabase.from("uploads").insert({ driver_id: profile.id, tenant_id: profile.tenant_id, file_name: file.name, file_path: upRes.path || path, file_type: "expense", file_size: file.size, ref_id: expId });
        }
      }
      if (expId) {
        logAction({
          tenantId: profile.tenant_id, entityType: "expense", entityId: expId,
          action: "submitted",
          metadata: { category: form.type, amount: parseFloat(form.amount) },
        });
        void fetch("/api/notifications/trigger", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "expense_submitted", data: { category: form.type, amount: parseFloat(form.amount) } }),
        });
      }
      setSubmitted(true);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  return { today, form, setForm, submitted, setSubmitted, expenseId, setExpenseId, saving, pendingFiles, setPendingFiles, set, isTechnical, expenseTypes, advanceTo, setAdvanceTo, targets, addFiles, submit };
}
