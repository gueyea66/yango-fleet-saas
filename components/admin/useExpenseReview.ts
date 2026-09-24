// Déplacé tel quel depuis app/admin/page.tsx (refonte UI v2, étape 4) :
// logique de validation partagée par la modale actuelle et le panneau v2 —
// mêmes lectures, mêmes écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logAction } from "@/lib/logAction";

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
      const enriched = (data || [])
        .filter((u: any) => u.ref_id === expense.id || u.file_path?.includes(expense.id))
        .map((u: any) => {
          const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(u.file_path);
          return { ...u, publicUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(u.file_name) };
        });
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
      await supabase.from("uploads").insert({ driver_id: expense.driver_id, file_name: file.name, file_path: result.path, file_type: "expense", file_size: file.size });
      setUploads((p) => [...p, { file_name: file.name, publicUrl: result.signedUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name) }]);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setUploading(false); }
  };

  return { uploads, setUploads, uploading, saving, currentStatus, editAmount, setEditAmount, editDate, setEditDate, editCategory, setEditCategory, editDesc, setEditDesc, saveEdit, updateStatus, uploadFile };
}
