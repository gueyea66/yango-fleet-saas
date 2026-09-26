// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// logique partagée par l'UI actuelle et l'UI v2 — mêmes requêtes, mêmes
// écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveRates, computeCommissions } from "@/lib/calc";
import { computeElementsReels, hasElementsReels } from "@/lib/calcReel";
import { platLabel } from "@/lib/tenant/platformLabel";
import { logAction } from "@/lib/logAction";
import { envoyerPieces, messageEchecs } from "@/lib/uploadPieces";
import type { AiScanResult, Cfg, Profile } from "./shared";

export function useReportForm(profile: Profile, cfg: Cfg) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ date: today, end_odometer: "", yango_cash: "", yango_card: "", yango_gross: "", yango_bonus: "", off_yango_revenue: "", solde_yango: "", yango_trip_count: "", off_yango_trip_count: "", service_supplementaire: "", commission_yango_reelle: "", commission_partenaire_reelle: "", comment: "" });
  const [todayReport, setTodayReport] = useState<any>(null); // rapport ACTIF (submitted/approved) du jour, s'il existe
  const [rejectedToday, setRejectedToday] = useState<any>(null); // dernier rapport rejeté du jour, pour affichage/pré-remplissage uniquement
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehicle, setVehicle] = useState<any>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [aiExtractionId, setAiExtractionId] = useState<string | null>(null);
  // Photos scannées déjà uploadées par la route d'extraction : rattachées au
  // rapport à la soumission (fleet.uploads) — mêmes pièces jointes qu'un
  // upload manuel, sans renvoyer les fichiers.
  const [aiStoredFiles, setAiStoredFiles] = useState<{ path: string; size: number; mime: string }[]>([]);
  const n = (s: string) => parseFloat(s) || 0;
  // Brut Yango = Espèces + Carte (éléments réels de l'app). Dès qu'un des deux
  // est renseigné, le brut est dérivé automatiquement ; sinon il reste saisi
  // à la main (rétro-compatibilité avec l'ancien flux).
  const deriveGross = (f: { yango_cash: string; yango_card: string; yango_gross: string }) =>
    f.yango_cash || f.yango_card ? String(n(f.yango_cash) + n(f.yango_card)) : f.yango_gross;
  const set = (k: string, v: string) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "yango_cash" || k === "yango_card") next.yango_gross = deriveGross(next);
      return next;
    });
  // Copie synchrone : voir useExpenseForm. Le reset de l'input par l'appelant
  // vidait la FileList avant que React n'évalue le callback de setState.
  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const ajouts = Array.from(files);
    setPendingFiles((prev) => [...prev, ...ajouts]);
  };

  // Pré-remplissage depuis l'extraction vision : seules les valeurs LUES
  // remplacent le champ ; le chauffeur vérifie et corrige avant de soumettre.
  // Les éléments sont pris TELS QUELS (espèces, carte, commissions réelles) —
  // le brut est dérivé, jamais lu ni calculé par le LLM.
  const applyExtraction = (r: AiScanResult) => {
    setAiExtractionId(r.extraction_id);
    setAiStoredFiles(r.stored_files ?? []);
    setForm((f) => {
      const next = {
        ...f,
        end_odometer: r.fields.end_odometer !== null ? String(r.fields.end_odometer) : f.end_odometer,
        yango_cash: r.fields.yango_cash !== null ? String(r.fields.yango_cash) : f.yango_cash,
        yango_card: r.fields.yango_card !== null ? String(r.fields.yango_card) : f.yango_card,
        yango_bonus: r.fields.yango_bonus !== null ? String(r.fields.yango_bonus) : f.yango_bonus,
        solde_yango: r.fields.solde_yango !== null ? String(r.fields.solde_yango) : f.solde_yango,
        yango_trip_count: r.fields.yango_trip_count !== null ? String(r.fields.yango_trip_count) : f.yango_trip_count,
        service_supplementaire: r.fields.services_supplementaires !== null ? String(r.fields.services_supplementaires) : f.service_supplementaire,
        commission_yango_reelle: r.fields.commission_yango !== null ? String(r.fields.commission_yango) : f.commission_yango_reelle,
        commission_partenaire_reelle: r.fields.commission_partenaire !== null ? String(r.fields.commission_partenaire) : f.commission_partenaire_reelle,
      };
      next.yango_gross = deriveGross(next);
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data: veh } = await supabase.from("vehicles").select("id,plate,partner_rate,yango_rate").eq("driver_id", profile.id).maybeSingle();
      if (veh) setVehicle(veh);
    })();
  }, [profile.id]);

  // Rapport(s) existants pour la date SÉLECTIONNÉE dans le formulaire (pas
  // figé sur "aujourd'hui") — re-vérifié à chaque changement de date, pour
  // pouvoir choisir une date antérieure même si le rapport du jour est déjà
  // actif. Plusieurs rapports peuvent exister pour la même date (un rejeté +
  // une resoumission) : on ne prend plus .maybeSingle() sur la date seule, on
  // charge tout puis on distingue le rapport ACTIF (bloque l'édition des
  // autres champs) du dernier rapport REJETÉ (affiché à titre informatif,
  // sert seulement à pré-remplir — la resoumission crée une nouvelle ligne).
  useEffect(() => {
    (async () => {
      const supabase = createClient() as any;
      const { data: reps } = await supabase.from("daily_reports").select("*")
        .eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
        .eq("date", form.date).order("created_at", { ascending: false });
      const active = (reps || []).find((r: any) => r.status === "submitted" || r.status === "approved") || null;
      const lastRejected = (reps || []).find((r: any) => r.status === "rejected") || null;
      setTodayReport(active);
      setRejectedToday(lastRejected);
      const rep = !active ? lastRejected : null;
      // Pré-remplit depuis le dernier rejeté s'il y en a un pour cette date,
      // sinon vide les champs (nouvelle date, ou date déjà active → verrouillée
      // de toute façon). Ne touche jamais form.date : c'est ce qui a déclenché l'effet.
      setForm((f) => ({
        date: f.date,
        end_odometer: rep?.end_odometer ? String(rep.end_odometer) : "",
        yango_cash: rep?.yango_cash ? String(rep.yango_cash) : "",
        yango_card: rep?.yango_card ? String(rep.yango_card) : "",
        yango_gross: rep?.yango_gross ? String(rep.yango_gross) : "",
        yango_bonus: rep?.yango_bonus ? String(rep.yango_bonus) : "",
        off_yango_revenue: rep?.off_yango_revenue ? String(rep.off_yango_revenue) : "",
        solde_yango: rep?.solde_yango ? String(rep.solde_yango) : "",
        yango_trip_count: rep?.yango_trip_count ? String(rep.yango_trip_count) : "",
        off_yango_trip_count: rep?.off_yango_trip_count ? String(rep.off_yango_trip_count) : "",
        service_supplementaire: rep?.service_supplementaire ? String(rep.service_supplementaire) : "",
        commission_yango_reelle: rep?.commission_yango_reelle ? String(rep.commission_yango_reelle) : "",
        commission_partenaire_reelle: rep?.commission_partenaire_reelle ? String(rep.commission_partenaire_reelle) : "",
        comment: rep?.comment || "",
      }));
    })();
  }, [profile.id, form.date]);

  // Taux résolus : chauffeur → véhicule → tenant (tous en %)
  const rates = resolveRates(
    { yangoPct: (profile as any).comm_yango, partnerPct: (profile as any).comm_partner },
    { yangoPct: vehicle?.yango_rate != null ? vehicle.yango_rate * 100 : null,
      partnerPct: vehicle?.partner_rate != null ? vehicle.partner_rate * 100 : null },
    { yangoPct: cfg.comm_yango, partnerPct: cfg.comm_partner },
  );
  const calc = computeCommissions({
    brutYango: n(form.yango_gross), bonusYango: n(form.yango_bonus),
    horsYango: n(form.off_yango_revenue), rates,
    serviceSupplementaire: n(form.service_supplementaire),
  });

  // MODE RÉEL : dès qu'une commission réelle (lue dans l'app Yango) est
  // renseignée, plus AUCUN calcul de commission — les éléments affichés sont
  // pris tels quels et le net est leur simple somme (lib/calcReel, pur).
  // Sans éléments réels : mode théorique historique (calc.ts) inchangé.
  const modeReel = hasElementsReels({
    commissionYango: form.commission_yango_reelle ? n(form.commission_yango_reelle) : null,
    commissionPartenaire: form.commission_partenaire_reelle ? n(form.commission_partenaire_reelle) : null,
  });
  const reel = computeElementsReels({
    yangoCash: n(form.yango_cash),
    yangoCard: n(form.yango_card),
    bonus: n(form.yango_bonus),
    commissionYango: n(form.commission_yango_reelle),
    commissionPartenaire: n(form.commission_partenaire_reelle),
    servicesSupplementaires: n(form.service_supplementaire),
    horsYango: n(form.off_yango_revenue),
  });
  const netTotalEffectif = modeReel ? reel.netTotal : calc.netTotal;
  // todayReport ne contient désormais QUE le rapport actif (submitted/approved) ;
  // un rapport rejeté n'y figure jamais, donc plus besoin de le tester ici.
  const canEdit = !todayReport;

  const submit = async () => {
    if (!form.yango_gross && !form.off_yango_revenue) { alert(`Renseignez au moins un montant (${platLabel()} ou Hors ${platLabel()})`); return; }
    setSaving(true);
    try {
      const supabase = createClient() as any;
      const payload = {
        end_odometer: n(form.end_odometer),
        gross_earnings: modeReel
          ? reel.brutYango + n(form.yango_bonus) + n(form.off_yango_revenue)
          : calc.base + n(form.off_yango_revenue),
        yango_gross: n(form.yango_gross),
        // Éléments réels Yango (app) — colonnes additives nullables (036)
        yango_cash: form.yango_cash ? n(form.yango_cash) : null,
        yango_card: form.yango_card ? n(form.yango_card) : null,
        commission_yango_reelle: form.commission_yango_reelle ? n(form.commission_yango_reelle) : null,
        commission_partenaire_reelle: form.commission_partenaire_reelle ? n(form.commission_partenaire_reelle) : null,
        yango_bonus: n(form.yango_bonus),
        off_yango_revenue: n(form.off_yango_revenue),
        solde_yango: form.solde_yango ? n(form.solde_yango) : null,
        yango_trip_count: form.yango_trip_count ? n(form.yango_trip_count) : null,
        off_yango_trip_count: form.off_yango_trip_count ? n(form.off_yango_trip_count) : null,
        commission_rate: rates.yangoPct / 100,
        // Mode réel : la commission STOCKÉE est celle lue dans l'app Yango
        // (déclaratif), plus la théorique. Les taux restent tracés à titre
        // de configuration au moment de la soumission.
        commission_amount: modeReel
          ? n(form.commission_yango_reelle) + n(form.commission_partenaire_reelle)
          : calc.commYango + calc.commPartner,
        partner_rate: rates.partnerPct / 100,
        service_supplementaire: n(form.service_supplementaire),
        net_after_expenses: netTotalEffectif,
        vehicle_id: vehicle?.id ?? null,
        expense_count: 0,
        status: "submitted",
        comment: form.comment || null,
      };
      // Toujours un nouvel enregistrement — y compris après un rejet : le rapport
      // rejeté reste tel quel (historique + motif consultables), la resoumission
      // est une ligne différente. Seul contrôle : pas 2 rapports ACTIFS le même
      // jour (un rapport rejeté n'en est pas un — voir updateStatus côté admin
      // pour le verrou symétrique à la validation).
      const { data: dup } = await supabase.from("daily_reports")
        .select("id").eq("driver_id", profile.id).eq("tenant_id", profile.tenant_id)
        .eq("date", form.date).in("status", ["submitted", "approved"]).limit(1).maybeSingle();
      if (dup) { alert("Un rapport est déjà soumis ou validé pour cette date."); setSaving(false); return; }
      const { data: newReport, error } = await supabase.from("daily_reports")
        .insert({ driver_id: profile.id, tenant_id: profile.tenant_id, date: form.date, source: "saas", ...payload })
        .select("id").single();
      if (error) throw error;
      if (newReport?.id) {
        setReportId(newReport.id);
        // Upload pending files via API (service role)
        // Même correctif que la dépense : une pièce refusée est annoncée, et
        // seules les pièces réellement stockées sont enregistrées.
        const rPieces = await envoyerPieces({
          fichiers: pendingFiles, driverId: profile.id, tenantId: profile.tenant_id,
          fileType: "report", refId: newReport.id,
        });
        const nomsKO = new Set(rPieces.echecs.map((e) => e.nom));
        setPendingFiles((prev) => prev.filter((f) => nomsKO.has(f.name)));
        const msgPieces = messageEchecs(rPieces);
        if (msgPieces) alert(msgPieces);
        // Photos scannées (déjà dans le bucket via la route d'extraction) →
        // rattachées au rapport comme pièces jointes classiques.
        for (let i = 0; i < aiStoredFiles.length; i++) {
          const f = aiStoredFiles[i];
          const ext = f.mime === "image/png" ? "png" : f.mime === "image/webp" ? "webp" : "jpg";
          await supabase.from("uploads").insert({
            driver_id: profile.id, tenant_id: profile.tenant_id,
            file_name: `scan-declaration-${i + 1}.${ext}`, file_path: f.path,
            file_type: "report", file_size: f.size, ref_id: newReport.id,
          });
        }
        logAction({
          tenantId: profile.tenant_id, entityType: "daily_report", entityId: newReport.id,
          action: "submitted",
          metadata: { date: form.date, net: netTotalEffectif, mode: modeReel ? "elements_reels" : "theorique" },
        });
        // Notifie le gestionnaire (in-app + push) — l'événement manquait :
        // l'admin ne savait pas qu'un rapport attendait sa validation.
        void fetch("/api/notifications/trigger", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "report_submitted", data: { date: form.date } }),
        });
        // Feedback loop extraction vision : valeurs finales validées par le
        // chauffeur (mesure de précision). Best-effort — n'affecte jamais le rapport.
        if (aiExtractionId) {
          void fetch(`/api/ai/extraction/${aiExtractionId}/validate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              validated_values: {
                end_odometer: form.end_odometer ? Math.round(n(form.end_odometer)) : null,
                yango_cash: form.yango_cash ? Math.round(n(form.yango_cash)) : null,
                yango_card: form.yango_card ? Math.round(n(form.yango_card)) : null,
                yango_bonus: form.yango_bonus ? Math.round(n(form.yango_bonus)) : null,
                commission_yango: form.commission_yango_reelle ? Math.round(n(form.commission_yango_reelle)) : null,
                commission_partenaire: form.commission_partenaire_reelle ? Math.round(n(form.commission_partenaire_reelle)) : null,
                services_supplementaires: form.service_supplementaire ? Math.round(n(form.service_supplementaire)) : null,
                solde_yango: form.solde_yango ? Math.round(n(form.solde_yango)) : null,
                yango_trip_count: form.yango_trip_count ? Math.round(n(form.yango_trip_count)) : null,
              },
            }),
          }).catch(() => {});
        }
      }
      setSubmitted(true);
    } catch (err: any) { alert("Erreur : " + err.message); }
    finally { setSaving(false); }
  };

  return { today, form, todayReport, rejectedToday, submitted, saving, vehicle, reportId, pendingFiles, setPendingFiles, aiExtractionId, n, set, addFiles, applyExtraction, rates, calc, modeReel, reel, netTotalEffectif, canEdit, submit };
}
