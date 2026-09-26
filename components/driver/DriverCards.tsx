"use client";

// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// composants partagés par l'UI actuelle et l'UI v2 (pièces jointes, cartes
// d'historique avec resoumission / archivage, avances).
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { platLabel, displayLabel } from "@/lib/tenant/platformLabel";
import { recomputeReportNet } from "@/lib/reportNet";
import { logAction } from "@/lib/logAction";
import { Wallet, Paperclip, Calendar, HandCoins } from "lucide-react";
import { xof, type Profile } from "./shared";
import { obtenirUrlsSignees } from "@/lib/signedUrls";

// ─── UPLOAD BLOCK (reusable) ─────────────────────────
export function UploadBlock({ driverId, refId, refType, label = "Photos / Reçus" }: { driverId: string; refId: string | null; refType: string; label?: string }) {
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<{ name: string; url: string; isImg: boolean }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load existing files from DB when refId is available
  useEffect(() => {
    if (!refId) return;
    setLoadingFiles(true);
    const supabase = createClient() as any;
    supabase.from("uploads").select("file_name,file_path,file_type,ref_id")
      .eq("driver_id", driverId)
      .eq("file_type", refType)
      .then(async ({ data }: any) => {
        if (data?.length) {
          const liees = data
            // Match by ref_id (new) OR by path containing refId (legacy)
            .filter((f: any) => f.ref_id === refId || f.file_path?.includes(refId));
          const urls = await obtenirUrlsSignees(liees.map((f: any) => f.file_path));
          setFiles(liees.map((f: any) => ({
            name: f.file_name,
            url: urls[f.file_path] || "",
            isImg: /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(f.file_name),
          })));
        }
        setLoadingFiles(false);
      });
  }, [refId, driverId, refType]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const supabase = createClient() as any;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${refType}/${driverId}/${refId || "pending"}/${Date.now()}-${safeName}`;

      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", path);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Upload échoué");

      await supabase.from("uploads").insert({ driver_id: driverId, file_name: file.name, file_path: result.path || path, file_type: refType, file_size: file.size, ...(refId ? { ref_id: refId } : {}) });
      const isImg = /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name);
      setFiles((p) => [...p, { name: file.name, url: result.signedUrl || result.publicUrl, isImg }]);
    } catch (err: any) { alert("Upload échoué : " + err.message); }
    finally { setUploading(false); }
  };

  const cameraRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--sk-t4)" }}><Paperclip size={12} strokeWidth={2} />{label}</div>
      <div className="flex gap-2 mb-3">
        <button onClick={() => cameraRef.current?.click()} disabled={uploading}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: uploading ? "var(--sk-surface)" : "rgba(var(--tenant-color-rgb),.08)", border: "1px solid rgba(var(--tenant-color-rgb),.25)", color: uploading ? "#374151" : "var(--tenant-color)" }}>
          {uploading ? "⏳ Upload..." : "📷 Photo"}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium border-dashed border-2 transition-all"
          style={{ background: "transparent", borderColor: uploading ? "var(--tenant-color)" : "var(--sk-border)", color: uploading ? "var(--tenant-color)" : "var(--sk-t3)" }}>
          {uploading ? "⏳" : "📁 Fichier / Galerie"}
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { Array.from(e.target.files || []).forEach(upload); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,video/*" multiple className="hidden"
        onChange={(e) => { Array.from(e.target.files || []).forEach(upload); e.target.value = ""; }} />
      {loadingFiles && <div className="text-xs text-center py-2" style={{ color: "var(--sk-t4)" }}>Chargement...</div>}
      {files.length > 0 && (
        <div className="space-y-2">
          {/* Image thumbnails grid */}
          {files.filter(f => f.isImg).length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {files.filter(f => f.isImg).map((f, i) => (
                <a key={i} href={f.url} target="_blank" rel="noopener noreferrer">
                  <img src={f.url} alt={f.name} className="w-full h-20 object-cover rounded-lg"
                    style={{ border: "1px solid var(--sk-surface)" }} />
                </a>
              ))}
            </div>
          )}
          {/* PDF / other files */}
          {files.filter(f => !f.isImg).map((f, i) => (
            <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs p-2 rounded-lg"
              style={{ background: "var(--sk-surface)", color: "var(--sk-t2)" }}>
              <span>📄</span><span className="truncate flex-1">{f.name}</span><span style={{ color: "var(--tenant-color)" }}>Ouvrir →</span>
            </a>
          ))}
        </div>
      )}
      {!loadingFiles && files.length === 0 && refId && (
        <div className="text-xs text-center py-1" style={{ color: "var(--sk-t4)" }}>Aucune pièce jointe</div>
      )}
    </div>
  );
}

// ─── REPORT HISTORY CARD (with full edit on rejected) ─────────
export function ReportHistoryCard({ report, profile, onRefresh }: { report: any; profile: Profile; onRefresh: () => void }) {
  const [open, setOpen] = useState(report.status === "rejected");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const s = (v: any) => (v != null && v !== 0 ? String(v) : "");
  const [editForm, setEditForm] = useState({
    end_odometer: s(report.end_odometer),
    yango_gross: s(report.yango_gross),
    yango_bonus: s(report.yango_bonus),
    off_yango_revenue: s(report.off_yango_revenue),
    solde_yango: s(report.solde_yango),
    yango_trip_count: s(report.yango_trip_count),
    off_yango_trip_count: s(report.off_yango_trip_count),
    comment: report.comment || "",
  });
  const set = (k: string, v: string) => setEditForm((f) => ({ ...f, [k]: v }));
  const n = (v: string) => parseFloat(v) || 0;

  const saveAndResubmit = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      // Le rapport rejeté n'est plus jamais écrasé : il reste consultable tel
      // quel (motif inclus). La resoumission crée une NOUVELLE ligne pour la
      // même date. Garde-fou : pas de resoumission si un rapport actif
      // (submitted/approved) existe déjà pour cette date (ex. déjà corrigé
      // depuis un autre écran).
      const { data: dup } = await supabase.from("daily_reports")
        .select("id").eq("driver_id", report.driver_id).eq("tenant_id", report.tenant_id)
        .eq("date", report.date).in("status", ["submitted", "approved"]).limit(1).maybeSingle();
      if (dup) { alert("Un rapport actif existe déjà pour cette date."); setSaving(false); return; }
      // Net recalculé avec les montants corrigés, dans le mode d'origine du
      // rapport (éléments réels ou taux figés) — l'ancien net était recopié tel quel.
      const recalc = recomputeReportNet({
        yangoGross: n(editForm.yango_gross), yangoBonus: n(editForm.yango_bonus),
        horsYango: n(editForm.off_yango_revenue),
        serviceSupplementaire: report.service_supplementaire ?? 0,
        commissionYangoReelle: report.commission_yango_reelle ?? null,
        commissionPartenaireReelle: report.commission_partenaire_reelle ?? null,
        commissionRate: report.commission_rate ?? null,
        partnerRate: report.partner_rate ?? null,
      });
      const { data: newReport, error } = await supabase.from("daily_reports").insert({
        driver_id: report.driver_id, tenant_id: report.tenant_id, date: report.date,
        source: report.source || "saas", status: "submitted",
        end_odometer: n(editForm.end_odometer),
        yango_gross: n(editForm.yango_gross),
        yango_bonus: n(editForm.yango_bonus),
        off_yango_revenue: n(editForm.off_yango_revenue),
        solde_yango: n(editForm.solde_yango) || null,
        yango_trip_count: n(editForm.yango_trip_count) || null,
        off_yango_trip_count: n(editForm.off_yango_trip_count) || null,
        comment: editForm.comment || null,
        gross_earnings: recalc.grossEarnings,
        // Champs non ré-éditables ici — repris tels quels de l'original.
        yango_cash: report.yango_cash, yango_card: report.yango_card,
        commission_yango_reelle: report.commission_yango_reelle,
        commission_partenaire_reelle: report.commission_partenaire_reelle,
        commission_rate: report.commission_rate, partner_rate: report.partner_rate,
        commission_amount: recalc.commissionAmount, net_after_expenses: recalc.netAfterExpenses,
        service_supplementaire: report.service_supplementaire,
        vehicle_id: report.vehicle_id ?? null, expense_count: report.expense_count ?? 0,
      }).select("id").single();
      if (error) throw error;
      void fetch("/api/notifications/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "report_submitted", data: { date: report.date } }),
      });
      logAction({
        tenantId: profile.tenant_id, entityType: "daily_report", entityId: newReport?.id,
        action: "submitted",
        metadata: { date: report.date, resubmission: true, original_report_id: report.id },
      });
      setEditing(false);
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const archive = async () => {
    if (!confirm("Archiver ce rapport rejeté ?")) return;
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("daily_reports").update({ status: "archived" }).eq("id", report.id);
      if (error) throw error;
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const badge = (status: string) => {
    const map: Record<string, [string, string]> = { approved: ["#22c55e", "rgba(34,197,94,.1)"], rejected: ["#ef4444", "rgba(239,68,68,.1)"] };
    const [color, bg] = map[status] ?? ["var(--tenant-color)", "rgba(var(--tenant-color-rgb),.1)"];
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{status === "approved" ? "Validé" : status === "rejected" ? "Rejeté" : "En attente"}</span>;
  };

  const inputStyle = { background: "var(--sk-bg)", border: "1px solid var(--sk-border)", color: "var(--sk-t1)", borderRadius: 10, padding: "8px 12px", width: "100%", fontSize: 13, outline: "none" };

  return (
    <div className="rounded-2xl" style={{ background: "var(--sk-bg)", border: `1px solid ${report.status === "rejected" ? "rgba(239,68,68,.3)" : "var(--sk-surface)"}` }}>
      <div className="flex items-start justify-between p-4 cursor-pointer" onClick={() => { setOpen(!open); setEditing(false); }}>
        <div>
          <div className="font-semibold text-sm text-white">{report.date}</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--sk-t4)" }}>
            {[report.yango_trip_count ? `${report.yango_trip_count} courses` : null, report.end_odometer ? `${report.end_odometer} km` : null].filter(Boolean).join(" · ") || "—"}
          </div>
          {report.solde_yango > 0 && <div className="flex items-center gap-1 text-xs mt-1" style={{ color: "var(--tenant-color)" }}><Wallet size={11} strokeWidth={2} />{xof(report.solde_yango)}</div>}
        </div>
        <div className="text-right">
          <div className="font-mono font-bold text-sm text-white">{xof(report.net_after_expenses ?? 0)}</div>
          <div className="mt-1">{badge(report.status)}</div>
          <span className="text-[10px]" style={{ color: "var(--sk-t4)" }}>{open ? "▲" : "▼ détails"}</span>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--sk-surface)" }}>

          {/* Motif de rejet */}
          {report.status === "rejected" && (
            <div className="pt-3 rounded-xl p-3" style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.2)" }}>
              <div className="text-xs font-semibold" style={{ color: "#ef4444" }}>⚠ Rapport rejeté</div>
              {report.rejection_reason && <div className="text-xs mt-1" style={{ color: "#f87171" }}>Motif : {report.rejection_reason}</div>}
            </div>
          )}

          {/* Mode lecture */}
          {!editing && (
            <div className="pt-2 space-y-1 text-xs" style={{ color: "var(--sk-t3)" }}>
              {[
                ["Km fin de journée", report.end_odometer ? `${report.end_odometer} km` : null],
                [`Brut ${platLabel()}`, report.yango_gross ? xof(report.yango_gross) : null],
                [`Bonus ${platLabel()}`, report.yango_bonus ? xof(report.yango_bonus) : null],
                [`Hors ${platLabel()}`, report.off_yango_revenue ? xof(report.off_yango_revenue) : null],
                ["Solde wallet", report.solde_yango ? xof(report.solde_yango) : null],
                [`Courses ${platLabel()}`, report.yango_trip_count],
                ["Courses hors", report.off_yango_trip_count],
                ["Net total", report.net_after_expenses ? xof(report.net_after_expenses) : null],
              ].map(([l, v]) => v != null ? (
                <div key={String(l)} className="flex justify-between">
                  <span>{l}</span>
                  <span className="font-mono" style={{ color: "var(--sk-t1)" }}>{String(v)}</span>
                </div>
              ) : null)}
              {report.comment && <div className="mt-1 italic" style={{ color: "var(--sk-t4)" }}>"{report.comment}"</div>}
            </div>
          )}

          {/* Mode édition (rapport rejeté uniquement) */}
          {editing && report.status === "rejected" && (
            <div className="pt-2 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Km fin journée", "end_odometer"],
                  [`Brut ${platLabel()}`, "yango_gross"],
                  [`Bonus ${platLabel()}`, "yango_bonus"],
                  [`Hors ${platLabel()}`, "off_yango_revenue"],
                  ["Solde wallet", "solde_yango"],
                  [`Courses ${platLabel()}`, "yango_trip_count"],
                  ["Courses hors", "off_yango_trip_count"],
                ].map(([label, key]) => (
                  <div key={key}>
                    <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>{label}</div>
                    <input type="number" value={editForm[key as keyof typeof editForm]}
                      onChange={(e) => set(key, e.target.value)}
                      style={inputStyle} />
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: "var(--sk-t4)" }}>Commentaire</div>
                <textarea value={editForm.comment} onChange={(e) => set("comment", e.target.value)} rows={2}
                  style={{ ...inputStyle, resize: "none" }} />
              </div>
            </div>
          )}

          <UploadBlock driverId={profile.id} refId={report.id} refType="report" label="Pièces jointes" />

          {/* Actions */}
          {report.status === "rejected" && !editing && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(true)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "var(--sk-surface)", color: "var(--tenant-color)", border: "1px solid rgba(var(--tenant-color-rgb),.3)" }}>
                ✏️ Modifier
              </button>
              <button onClick={saveAndResubmit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))", color: "#000" }}>
                {saving ? "..." : "🔁 Resoumettre"}
              </button>
              <button onClick={archive} disabled={saving}
                className="py-2.5 px-3 rounded-xl text-sm"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t3)", border: "1px solid var(--sk-border)" }}>
                Archiver
              </button>
            </div>
          )}
          {report.status === "rejected" && editing && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(false)}
                className="py-2.5 px-4 rounded-xl text-sm"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t2)", border: "1px solid var(--sk-border)" }}>
                Annuler
              </button>
              <button onClick={saveAndResubmit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))", color: "#000" }}>
                {saving ? "..." : "💾 Sauvegarder & resoumettre"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EXPENSE CARD (history with upload + status) ─────
export function ExpenseCard({ expense, driverId, profile, onRefresh }: { expense: any; driverId: string; profile: any; onRefresh: () => void }) {
  const [open, setOpen] = useState(expense.status === "rejected");
  const [saving, setSaving] = useState(false);

  const statusBadge = (status: string) => {
    const map: Record<string, [string, string]> = {
      approved: ["#22c55e", "rgba(34,197,94,.1)"],
      rejected: ["#ef4444", "rgba(239,68,68,.1)"],
    };
    const [color, bg] = map[status] ?? ["var(--tenant-color)", "rgba(var(--tenant-color-rgb),.1)"];
    const label = status === "approved" ? "Validée" : status === "rejected" ? "Rejetée" : "En attente";
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{label}</span>;
  };

  const resubmit = async () => {
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({ status: "submitted" }).eq("id", expense.id);
      if (error) throw error;
      logAction({
        tenantId: profile.tenant_id, entityType: "expense", entityId: expense.id,
        action: "submitted",
        metadata: { category: expense.category, amount: expense.amount, resubmission: true },
      });
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  const archive = async () => {
    if (!confirm("Archiver cette dépense rejetée ?")) return;
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const { error } = await supabase.from("expenses").update({ status: "archived" }).eq("id", expense.id);
      if (error) throw error;
      onRefresh();
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-2xl" style={{
      background: "var(--sk-bg)",
      border: `1px solid ${expense.status === "rejected" ? "rgba(239,68,68,.3)" : expense.status === "approved" ? "rgba(34,197,94,.15)" : "var(--sk-surface)"}`,
    }}>
      <div className="flex items-start justify-between p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-sm text-white">{displayLabel(expense.category || "")}</div>
            {statusBadge(expense.status || "submitted")}
          </div>
          <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: "var(--sk-t4)" }}>
            <Calendar size={11} strokeWidth={2} />{expense.expense_date || expense.created_at?.slice(0, 10)}
          </div>
          {expense.description && <div className="text-xs mt-1" style={{ color: "var(--sk-t3)" }}>{expense.description}</div>}
          {expense.status === "rejected" && (
            <div className="text-xs mt-1 font-semibold" style={{ color: "#ef4444" }}>
              ⚠ Rejetée — action requise
            </div>
          )}
        </div>
        <div className="text-right ml-3 flex-shrink-0">
          <div className="font-mono font-bold text-sm" style={{ color: "#ef4444" }}>-{xof(expense.amount || 0)}</div>
          <button onClick={() => setOpen(!open)} className="text-[10px] mt-1 px-2 py-0.5 rounded-full transition-all"
            style={{ background: open ? "rgba(var(--tenant-color-rgb),.15)" : "var(--sk-surface)", color: open ? "var(--tenant-color)" : "var(--sk-t3)" }}>
            {open ? "Fermer ▲" : "Détails ▾"}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 border-t space-y-3" style={{ borderColor: "var(--sk-surface)" }}>
          <div className="pt-3">
            <UploadBlock driverId={driverId} refId={expense.id} refType="expense" label="Ajouter / voir photos" />
          </div>
          {expense.status === "rejected" && (
            <div className="flex gap-2">
              <button onClick={resubmit} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))", color: "#000" }}>
                {saving ? "..." : "🔁 Resoumettre"}
              </button>
              <button onClick={archive} disabled={saving}
                className="py-2.5 px-4 rounded-xl text-sm"
                style={{ background: "var(--sk-surface)", color: "var(--sk-t3)", border: "1px solid var(--sk-border)" }}>
                Archiver
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AVANCES SECTION (driver view) ───────────────────
export function DriverAvancesSection({ driverId }: { driverId: string }) {
  const [advances, setAdvances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const xof = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data } = await supabase.from("payments")
        .select("id,amount,payment_date,notes,is_deducted,deducted_at")
        .eq("driver_id", driverId)
        .eq("type", "acompte")
        .order("payment_date", { ascending: false })
        .limit(20);
      setAdvances(data || []);
      setLoading(false);
    })();
  }, [driverId]);

  const pending = advances.filter((a) => !a.is_deducted).reduce((s, a) => s + (a.amount || 0), 0);

  if (!loading && advances.length === 0) return null;

  return (
    <div className="rounded-2xl p-5 mt-4" style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5 font-semibold text-white text-sm"><HandCoins size={15} strokeWidth={2} style={{ color: "var(--tenant-color)" }} />Avances sur salaire</div>
        {pending > 0 && (
          <div className="text-xs font-mono font-bold px-3 py-1 rounded-full"
            style={{ background: "rgba(var(--tenant-color-rgb),.1)", color: "var(--tenant-color)" }}>
            {xof(pending)} à déduire
          </div>
        )}
      </div>
      {loading ? (
        <div className="text-xs text-center py-4" style={{ color: "var(--sk-t4)" }}>Chargement...</div>
      ) : (
        <div className="space-y-2">
          {advances.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl px-3 py-2.5"
              style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
              <div>
                <div className="text-xs font-semibold text-white">{a.payment_date}</div>
                {a.notes && <div className="text-[10px] mt-0.5" style={{ color: "var(--sk-t3)" }}>{a.notes}</div>}
              </div>
              <div className="flex items-center gap-2">
                <div className="font-mono text-sm font-bold" style={{ color: a.is_deducted ? "var(--sk-t4)" : "var(--tenant-color)" }}>
                  {xof(a.amount)}
                </div>
                {a.is_deducted
                  ? <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "#22c55e", background: "rgba(34,197,94,.1)" }}>✓ Déduit</span>
                  : <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "var(--tenant-color)", background: "rgba(var(--tenant-color-rgb),.1)" }}>En attente</span>
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
