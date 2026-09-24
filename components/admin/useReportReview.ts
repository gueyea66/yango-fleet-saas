// Déplacé tel quel depuis app/admin/page.tsx (refonte UI v2, étape 4) :
// logique de validation partagée par la modale actuelle et le panneau v2 —
// mêmes lectures, mêmes écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recomputeReportNet } from "@/lib/reportNet";
import { logAction } from "@/lib/logAction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- signature d'origine
export function useReportReview(report: any, onRefresh: () => void) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(report.comment || "");
  const [yangoGrossEdit, setYangoGrossEdit] = useState(String(report.yango_gross || ""));
  const [yangoBonus, setYangoBonus] = useState(String(report.yango_bonus || ""));
  const [horsYangoEdit, setHorsYangoEdit] = useState(String(report.off_yango_revenue || ""));
  const [soldeEdit, setSoldeEdit] = useState(String(report.solde_yango || ""));
  const [dateEdit, setDateEdit] = useState(report.date || "");
  const [kmEdit, setKmEdit] = useState(String(report.end_odometer || ""));
  const [yangoTripsEdit, setYangoTripsEdit] = useState(String(report.yango_trip_count || ""));
  const [offYangoTripsEdit, setOffYangoTripsEdit] = useState(String(report.off_yango_trip_count || ""));
  const [serviceSuppEdit, setServiceSuppEdit] = useState(String(report.service_supplementaire || ""));
  const [uploads, setUploads] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("uploads").select("*").eq("driver_id", report.driver_id).order("created_at", { ascending: false });
      // Keep files linked to this report: either by ref_id or file_path (legacy path)
      const enriched = (data || [])
        .filter((u: any) => u.ref_id === report.id || u.file_path?.includes(report.id))
        .map((u: any) => {
        const { data: { publicUrl } } = supabase.storage.from("kyc-documents").getPublicUrl(u.file_path);
        return { ...u, publicUrl, isImg: /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(u.file_name) };
      });
      setUploads(enriched);
    })();
  }, [report.driver_id]);

  // Net recalculé dans le MODE D'ORIGINE du rapport (lib/reportNet) : éléments
  // réels si des commissions lues dans l'app sont stockées, sinon taux figés.
  const recalc = (yg: number, yb: number, hy: number, serviceSupp: number) => recomputeReportNet({
    yangoGross: yg, yangoBonus: yb, horsYango: hy, serviceSupplementaire: serviceSupp,
    commissionYangoReelle: report.commission_yango_reelle ?? null,
    commissionPartenaireReelle: report.commission_partenaire_reelle ?? null,
    commissionRate: report.commission_rate ?? null,
    partnerRate: report.partner_rate ?? null,
  });

  const saveFields = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const yg = parseFloat(yangoGrossEdit) || 0;
      const yb = parseFloat(yangoBonus) || 0;
      const hy = parseFloat(horsYangoEdit) || 0;
      const serviceSupp = parseFloat(serviceSuppEdit) || 0;
      const calc = recalc(yg, yb, hy, serviceSupp);
      const { error } = await supabase.from("daily_reports").update({
        date: dateEdit || report.date,
        yango_gross: yg, yango_bonus: yb, off_yango_revenue: hy,
        gross_earnings: calc.grossEarnings, commission_amount: calc.commissionAmount,
        service_supplementaire: serviceSupp,
        net_after_expenses: calc.netAfterExpenses,
        solde_yango: parseFloat(soldeEdit) || 0,
        end_odometer: kmEdit ? parseInt(kmEdit) : null,
        yango_trip_count: yangoTripsEdit ? parseInt(yangoTripsEdit) : null,
        off_yango_trip_count: offYangoTripsEdit ? parseInt(offYangoTripsEdit) : null,
        comment: note || null,
      }).eq("id", report.id);
      if (error) throw error;
      alert("Modifications enregistrées ✓");
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const updateStatus = async (status: "approved" | "rejected") => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      if (status === "approved") {
        // Un seul rapport ACTIF par chauffeur et par date : si un autre rapport
        // est déjà validé pour cette date, on bloque plutôt que de créer un doublon.
        const { data: dup } = await supabase.from("daily_reports")
          .select("id").eq("driver_id", report.driver_id).eq("tenant_id", report.tenant_id)
          .eq("date", report.date).eq("status", "approved").neq("id", report.id).limit(1).maybeSingle();
        if (dup) {
          alert("Un autre rapport est déjà validé pour ce chauffeur à cette date. Annulez-le d'abord (bouton « Annuler ») si tu veux valider celui-ci à la place.");
          setSaving(false);
          return;
        }
      }
      const { error } = await supabase.from("daily_reports").update({
        status,
        // Le net n'est plus réécrit ici (il écrasait une correction fraîchement
        // enregistrée) : seul « Enregistrer les modifications » le recalcule.
        ...(note ? { comment: note } : {}),
        // Motif de rejet — colonne dédiée lue par l'écran chauffeur (report.rejection_reason),
        // distincte de `comment` : sans ça, le motif n'était jamais montré au chauffeur.
        ...(status === "rejected" ? { rejection_reason: note || null } : {}),
      }).eq("id", report.id);
      if (error) throw error;
      // Log action (fire-and-forget — non-critical)
      logAction({
        tenantId: report.tenant_id, entityType: "daily_report", entityId: report.id,
        action: status,
        metadata: { date: report.date, net: report.net_after_expenses },
      });
      // Notification push au chauffeur
      void fetch("/api/notifications/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: `report_${status}`, tenantId: report.tenant_id, driverId: report.driver_id, data: { date: report.date } }),
      });
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      const rawPath = `admin/reports/${report.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      fd.append("file", file);
      fd.append("path", rawPath);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");
      const supabase = createClient() as any;
      await supabase.from("uploads").insert({ driver_id: report.driver_id, file_name: file.name, file_path: result.path, file_type: "admin-report", file_size: file.size });
      setUploads((p) => [...p, { file_name: file.name, file_path: result.path, file_type: "admin-report", created_at: new Date().toISOString() }]);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setUploading(false); }
  };

  return { saving, note, setNote, yangoGrossEdit, setYangoGrossEdit, yangoBonus, setYangoBonus, horsYangoEdit, setHorsYangoEdit, soldeEdit, setSoldeEdit, dateEdit, setDateEdit, kmEdit, setKmEdit, yangoTripsEdit, setYangoTripsEdit, offYangoTripsEdit, setOffYangoTripsEdit, serviceSuppEdit, setServiceSuppEdit, uploads, uploading, recalc, saveFields, updateStatus, uploadFile };
}
