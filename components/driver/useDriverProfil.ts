// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// logique partagée par l'UI actuelle et l'UI v2 — mêmes requêtes, mêmes
// écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "./shared";

// ─── PROFIL / KYC ────────────────────────────────────
export const KYC_DOCS = [
  { type: "cni_recto",    label: "CNI — Recto",     required: true },
  { type: "cni_verso",    label: "CNI — Verso",     required: true },
  { type: "permis_recto", label: "Permis — Recto",  required: true },
  { type: "permis_verso", label: "Permis — Verso",  required: true },
  { type: "contrat",      label: "Contrat signé",   required: true },
  { type: "photo_profil", label: "Photo de profil", required: false },
];

export const LEVEL_LABELS: Record<string, { label: string; color: string }> = {
  debutant:      { label: "Débutant",      color: "var(--tenant-color)" },
  intermediaire: { label: "Intermédiaire", color: "#3b82f6" },
  confirme:      { label: "Confirmé",      color: "#22c55e" },
};

export const ONBOARDING_LABELS: Record<string, { label: string; color: string }> = {
  incomplete: { label: "Dossier incomplet",            color: "var(--sk-t3)" },
  pending:    { label: "En attente de soumission",     color: "var(--tenant-color)" },
  in_review:  { label: "En cours de vérification",    color: "#3b82f6" },
  approved:   { label: "✓ Dossier validé",             color: "#22c55e" },
  rejected:   { label: "✗ Dossier rejeté",             color: "#ef4444" },
};

export function useDriverProfil(profile: Profile) {
  const [fullProfile, setFullProfile] = useState<any>(null);
  const [infoForm, setInfoForm] = useState({ address: "", city: "", birth_date: "", nationality: "", license_number: "", license_expiry: "", emergency_name: "", emergency_phone: "", emergency_relation: "", years_experience: "0" });
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);

  const [vehicle, setVehicle] = useState<any>(null);

  const [kycDocs, setKycDocs] = useState<Record<string, any>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);


  const loadData = async () => {
    const supabase = createClient() as any;
    const [{ data: p }, { data: v }, { data: docs }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", profile.id).single(),
      supabase.from("vehicles").select("*").eq("driver_id", profile.id).maybeSingle(),
      supabase.from("kyc_documents").select("*").eq("driver_id", profile.id),
    ]);
    if (p) {
      setFullProfile(p);
      setInfoForm({ address: p.address || "", city: p.city || "", birth_date: p.birth_date || "", nationality: p.nationality || "", license_number: p.license_number || "", license_expiry: p.license_expiry || "", emergency_name: p.emergency_name || "", emergency_phone: p.emergency_phone || "", emergency_relation: p.emergency_relation || "", years_experience: String(p.years_experience ?? 0) });
    }
    setVehicle(v || null);
    const docMap: Record<string, any> = {};
    (docs || []).forEach((d: any) => { docMap[d.doc_type] = d; });
    setKycDocs(docMap);
  };

  useEffect(() => { loadData(); }, [profile.id]);

  const setInfo = (k: string, v: string) => setInfoForm((f) => ({ ...f, [k]: v }));

  const saveInfo = async () => {
    setSavingInfo(true);
    const supabase = createClient() as any;
    await supabase.from("profiles").update({ address: infoForm.address, city: infoForm.city, birth_date: infoForm.birth_date || null, nationality: infoForm.nationality, license_number: infoForm.license_number, license_expiry: infoForm.license_expiry || null, emergency_name: infoForm.emergency_name, emergency_phone: infoForm.emergency_phone, emergency_relation: infoForm.emergency_relation, years_experience: parseInt(infoForm.years_experience) || 0 }).eq("id", profile.id);
    setSavingInfo(false);
    setInfoSaved(true);
    setTimeout(() => setInfoSaved(false), 2000);
    await loadData();
  };

  const uploadDoc = async (file: File, docType: string) => {
    setUploading(docType);
    try {
      const supabase = createClient() as any;
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${profile.tenant_id}/${profile.id}/${docType}.${ext}`;

      // Upload via server route (service role — no storage RLS needed)
      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", path);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");

      // file_path = chemin RÉEL renvoyé par la route (préfixé tenant/user).
      const storedPath = result.path || path;
      const existing = kycDocs[docType];
      if (existing) {
        await supabase.from("kyc_documents").update({ file_path: storedPath, file_name: file.name, file_size: file.size, status: "pending", uploaded_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("kyc_documents").insert({ driver_id: profile.id, tenant_id: profile.tenant_id, doc_type: docType, file_path: storedPath, file_name: file.name, file_size: file.size, status: "pending" });
      }
      await loadData();
    } catch (err: any) { alert("Erreur upload : " + err.message); }
    finally { setUploading(null); }
  };

  const submitDossier = async () => {
    setSubmitting(true);
    const supabase = createClient() as any;
    await supabase.from("profiles").update({ onboarding_status: "in_review", onboarding_submitted: new Date().toISOString() }).eq("id", profile.id);
    await loadData();
    setSubmitting(false);
  };

  const requiredDocs = KYC_DOCS.filter((d) => d.required);
  const completedRequired = requiredDocs.filter((d) => kycDocs[d.type]).length;
  const allRequiredDone = completedRequired === requiredDocs.length;
  const status = fullProfile?.onboarding_status || "incomplete";
  const level = fullProfile?.driver_level || "debutant";
  const statusInfo = ONBOARDING_LABELS[status] ?? ONBOARDING_LABELS.incomplete;
  const levelInfo = LEVEL_LABELS[level] ?? LEVEL_LABELS.debutant;
  const canSubmit = allRequiredDone && (status === "incomplete" || status === "pending" || status === "rejected");

  return { fullProfile, infoForm, savingInfo, infoSaved, vehicle, kycDocs, uploading, submitting, loadData, setInfo, saveInfo, uploadDoc, submitDossier, requiredDocs, completedRequired, allRequiredDone, status, level, statusInfo, levelInfo, canSubmit };
}
