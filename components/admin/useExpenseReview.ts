// Déplacé tel quel depuis app/admin/page.tsx (refonte UI v2, étape 4) :
// logique de validation partagée par la modale actuelle et le panneau v2 —
// mêmes lectures, mêmes écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logAction } from "@/lib/logAction";
import { obtenirUrlsSignees } from "@/lib/signedUrls";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature d'origine
export function useExpenseReview(expense: any, onRefresh: () => void) {
  const [uploads, setUploads] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(expense.status || "submitted");
  const [editAmount, setEditAmount] = useState(String(expense.amount || ""));
  const [editDate, setEditDate] = useState(expense.expense_date || expense.created_at?.slice(0, 10) || "");
  const [editCategory, setEditCategory] = useState(expense.category || "");
  const [editDesc, setEditDesc] = useState(expense.description || "");

  const saveEdit = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({
        amount: parseFloat(editAmount) || expense.amount,
        expense_date: editDate || null,
        category: editCategory,
        description: editDesc || null,
      }).eq("id", expense.id);
      if (error) throw error;
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (status: "approved" | "rejected") => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({ status }).eq("id", expense.id);
      if (error) throw error;
      // Log action (fire-and-forget — non-critical)
      logAction({
        tenantId: expense.tenant_id, entityType: "expense", entityId: expense.id,
        action: status,
        metadata: { category: expense.category, amount: expense.amount },
      });
      // Notification push/Telegram au chauffeur (comme pour les rapports).
      // Le type expense_${status} correspond à expense_approved / expense_rejected.
      void fetch("/api/notifications/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: `expense_${status === "approved" ? "approved" : "rejected"}`,
          tenantId: expense.tenant_id, driverId: expense.driver_id,
          data: { amount: expense.amount, category: expense.category },
        }),
      });
      setCurrentStatus(status);
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("uploads").select("*")
        .eq("driver_id", expense.driver_id)
        .eq("file_type", "expense")
        .order("created_at", { ascending: false });
      const liees = (data || [])
        .filter((u: any) => u.ref_id === expense.id || u.file_path?.includes(expense.id));
      // URLs signées : le bucket n'est plus public, une pièce ne s'ouvre que
      // pour qui a le droit de la voir.
      const urls = await obtenirUrlsSignees(liees.map((u: any) => u.file_path));
      const enriched = liees.map((u: any) => ({
        ...u,
        publicUrl: urls[u.file_path] || "",
        isImg: /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(u.file_name),
      }));
      setUploads(enriched);
    })();
  }, [expense.id, expense.driver_id]);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      const rawPath = `expense/${expense.driver_id}/${expense.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      fd.append("file", file);
      fd.append("path", rawPath);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");
      const supabase = createClient() as any;
      // `ref_id` et `tenant_id` manquaient : la pièce ajoutée par l'admin
      // n'était retrouvée que par le repli « le chemin contient l'id », et elle
      // échappait au cloisonnement par tenant. Elle est maintenant rattachée
      // comme celles du chauffeur.
      const { data: ligne, error: errIns } = await supabase.from("uploads").insert({
        driver_id: expense.driver_id, tenant_id: expense.tenant_id,
        file_name: file.name, file_path: result.path,
        file_type: "expense", file_size: file.size, ref_id: expense.id,
      }).select().single();
      if (errIns) throw errIns;
      setUploads((p) => [...p, { ...ligne, publicUrl: result.signedUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(file.name) }]);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setUploading(false); }
  };

  /**
   * Retire une pièce jointe — la ligne ET le fichier.
   *
   * Demandé par Abdou le 26/09 : on pouvait ajouter une pièce mais pas en
   * retirer une, donc un reçu envoyé par erreur (mauvaise dépense, photo
   * illisible, doublon) restait attaché pour toujours.
   *
   * L'ordre compte : la ligne d'abord, le fichier ensuite. Si le retrait du
   * fichier échoue, il reste un objet orphelin dans le bucket — invisible et
   * sans conséquence. L'inverse laisserait une pièce visible à l'écran qui ne
   * s'ouvre plus, ce qui ressemble à une perte de preuve.
   */
  const deleteUpload = async (upload: any) => {
    if (!upload?.id) { alert("Pièce non identifiable en base — suppression impossible."); return; }
    if (!confirm(`Supprimer la pièce jointe « ${upload.file_name} » ?`)) return;
    setUploading(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("uploads").delete().eq("id", upload.id);
      if (error) throw error;
      // Le retrait du fichier passe par le serveur : aucune policy DELETE
      // n'existe sur storage.objects, donc l'appel client échouait en silence
      // et laissait l'objet dans le bucket.
      await fetch("/api/kyc-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: upload.file_path }),
      }).catch(() => {});
      setUploads((p) => p.filter((u) => u.id !== upload.id));
      logAction({
        tenantId: expense.tenant_id, entityType: "expense", entityId: expense.id,
        action: "upload_deleted",
        metadata: { file_name: upload.file_name, file_path: upload.file_path },
      });
    } catch (err: any) { alert("Suppression refusée : " + err.message); }
    finally { setUploading(false); }
  };

  return { uploads, setUploads, uploading, saving, currentStatus, deleteUpload, editAmount, setEditAmount, editDate, setEditDate, editCategory, setEditCategory, editDesc, setEditDesc, saveEdit, updateStatus, uploadFile };
}
