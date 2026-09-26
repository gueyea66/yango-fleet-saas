"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Plus, ScanLine, Paperclip, X, ChevronDown, Receipt } from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";
import { useReportForm } from "@/components/driver/useReportForm";
import { useAiScan } from "@/components/driver/useAiScan";
import { useDriverHomeData } from "@/components/driver/useDriverHomeData";
import { salaryLevel, type AiScanResult, type Cfg, type Profile } from "@/components/driver/shared";
import { platLabel } from "@/lib/tenant/platformLabel";
import { formatAmount } from "@/lib/v2/format";
import { needsReview, netCheck, nextTierInfo, type DriverTab } from "@/lib/v2/driver";
import { ScreenHeader, ScreenBody, Notice, InlineNumber, DoneHero, SkeletonBlock, fieldStyle } from "./parts";

type Step = "capture" | "reading" | "review";
type Slot = { file: File; url: string } | null;

const SLOTS = [
  { title: "Vue « Comparatif »", sub: "Espèces, carte, bonus, commissions", camera: false },
  { title: "Vue « Argent »", sub: "Solde du portefeuille, commandes", camera: false },
  { title: "Photo du compteur", sub: "Kilométrage fin de journée", camera: true },
];

// Champs de l'écran de vérification : clé du formulaire ↔ clé de l'extraction.
const MAIN_ROWS: { key: string; ai: string; label: () => string; suffix?: string }[] = [
  { key: "yango_cash", ai: "yango_cash", label: () => "Espèces" },
  { key: "yango_card", ai: "yango_card", label: () => "Carte" },
  { key: "yango_bonus", ai: "yango_bonus", label: () => "Bonus" },
  { key: "yango_trip_count", ai: "yango_trip_count", label: () => "Commandes" },
  { key: "solde_yango", ai: "solde_yango", label: () => "Solde portefeuille" },
  { key: "end_odometer", ai: "end_odometer", label: () => "Compteur", suffix: "km" },
];
const MORE_ROWS: { key: string; ai?: string; label: () => string }[] = [
  { key: "commission_yango_reelle", ai: "commission_yango", label: () => `Comm. ${platLabel()} (lue)` },
  { key: "commission_partenaire_reelle", ai: "commission_partenaire", label: () => "Comm. partenaire (lue)" },
  { key: "service_supplementaire", ai: "services_supplementaires", label: () => "Services supp." },
  { key: "off_yango_trip_count", label: () => `Courses hors ${platLabel()}` },
];

const ddmm = (iso: string) => { const [, m, d] = iso.split("-"); return d && m ? `${d}/${m}` : iso; };

/**
 * Rapport du soir v2 (maquettes 1b → 1c → 2a).
 * Toute la logique (pré-remplissage, calcul calc.ts / calcReel, insert
 * daily_reports + uploads + stored_files, notifications) est celle de l'UI
 * actuelle, partagée via useReportForm / useAiScan — cet écran ne fait que l'afficher.
 */
export function ReportV2({ profile, cfg, onNav }: { profile: Profile; cfg: Cfg; onNav: (t: DriverTab) => void }) {
  const {
    today, form, todayReport, rejectedToday, submitted, saving, vehicle, pendingFiles, setPendingFiles,
    set, addFiles, applyExtraction, calc, modeReel, reel, netTotalEffectif, canEdit, submit,
  } = useReportForm(profile, cfg);
  // Net du mois AVANT cet envoi (lecture de l'Accueil) → « il te manque » sur l'écran envoyé.
  const { monthNet } = useDriverHomeData(profile);

  const [step, setStep] = useState<Step | null>(null);
  const [source, setSource] = useState<"ai" | "manual">("manual");
  const [slots, setSlots] = useState<Slot[]>([null, null, null]);
  const [probeDone, setProbeDone] = useState(false);
  const [more, setMore] = useState(false);

  const onExtracted = (r: AiScanResult) => {
    applyExtraction(r);
    setSource("ai");
    setStep("review");
  };
  const { enabled, phase, message, result, scan } = useAiScan(form.date, onExtracted);

  // Sonde IA : 200 → captures d'abord ; 204 / réseau → formulaire manuel.
  useEffect(() => {
    const t = setTimeout(() => setProbeDone(true), 1500);
    return () => clearTimeout(t);
  }, []);
  const resolvedStep: Step | null = step ?? (enabled && canEdit ? "capture" : probeDone ? "review" : null);

  // Libère les aperçus d'images.
  const slotsRef = useRef(slots);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => () => { slotsRef.current.forEach((s) => s && URL.revokeObjectURL(s.url)); }, []);

  const setSlot = (i: number, file: File | null) =>
    setSlots((prev) => prev.map((s, j) => {
      if (j !== i) return s;
      if (s) URL.revokeObjectURL(s.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    }));

  const files = slots.filter(Boolean).map((s) => (s as { file: File }).file);

  const read = async () => {
    setStep("reading");
    await scan(files);
    // Succès → onExtracted a déjà basculé sur « review ». Sinon retour aux captures.
    setStep((s) => (s === "reading" ? "capture" : s));
  };

  const netCalc = modeReel ? reel.netYango : calc.netYango;
  const check = source === "ai" ? netCheck(result?.fields.net_affiche ?? null, netCalc) : "none";
  const conf = (aiKey?: string) => (source === "ai" && aiKey && result ? result.confidences[aiKey] : undefined);

  const tierAfter = useMemo(() => {
    if (cfg.model !== "tiered") return null;
    const total = monthNet + netTotalEffectif;
    return nextTierInfo(total, cfg.salary_tiers || [], salaryLevel(total, cfg));
  }, [cfg, monthNet, netTotalEffectif]);

  // ── 2a — envoyé ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <>
        <ScreenBody padding="24px 20px" style={{ justifyContent: "center", alignItems: "stretch" }}>
          <DoneHero title="Rapport envoyé" text="Ton gestionnaire va le valider. Tu recevras une notification." />
          <Card mobile padding="16px" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ color: "var(--sk-t2)" }}>Net du jour</span>
              <span className="v2-num" style={{ fontWeight: 600, color: "var(--fleet-positive)" }}>{formatAmount(netTotalEffectif)} XOF</span>
            </div>
            {tierAfter?.next && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, gap: 12 }}>
                <span style={{ color: "var(--sk-t2)" }}>Il te manque pour {tierAfter.next.label}</span>
                <span className="v2-num" style={{ fontWeight: 600, color: "var(--fleet-accent)" }}>{formatAmount(tierAfter.missing)}</span>
              </div>
            )}
          </Card>
        </ScreenBody>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, flex: "none" }}>
          <Button variant="outline" size="lg" icon={Receipt} block onClick={() => onNav("expense")} style={{ height: 56 }}>Ajouter une dépense</Button>
          <button type="button" onClick={() => onNav("home")} className="v2-focus"
            style={{ height: 48, background: "none", border: "none", color: "var(--sk-t2)", fontSize: 15, cursor: "pointer" }}>
            Retour à l&apos;accueil
          </button>
        </div>
      </>
    );
  }

  // ── Chargement de la sonde ──────────────────────────────────────────────
  if (!resolvedStep) {
    return (
      <>
        <ScreenHeader title={`Rapport du ${ddmm(form.date)}`} onBack={() => onNav("home")} />
        <ScreenBody><SkeletonBlock height={40} radius={10} /><SkeletonBlock height={96} /><SkeletonBlock height={96} /><SkeletonBlock height={96} /></ScreenBody>
      </>
    );
  }

  // ── 1b — captures ────────────────────────────────────────────────────────
  if (resolvedStep === "capture" || resolvedStep === "reading") {
    const reading = resolvedStep === "reading";
    return (
      <>
        <ScreenHeader
          title={`Rapport du ${ddmm(form.date)}`}
          onBack={() => onNav("home")}
          right={vehicle?.plate ? <span className="v2-num" style={{ fontSize: 12, color: "var(--v2-muted)" }}>{vehicle.plate}</span> : undefined}
        />
        <ScreenBody gap={18}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.01em" }}>{reading ? "Lecture de tes captures…" : "Ajoute tes captures"}</div>
            <div style={{ fontSize: 14, color: "var(--v2-muted)", marginTop: 6, lineHeight: 1.5 }}>
              {reading ? (message || "Quelques secondes.") : "Les champs se remplissent seuls. Tu vérifies, tu envoies."}
            </div>
          </div>
          {rejectedToday && <Notice tone="neg">Ton précédent rapport du {ddmm(form.date)} a été rejeté{rejectedToday.rejection_reason ? ` : ${rejectedToday.rejection_reason}` : ""}. Corrige et renvoie.</Notice>}
          {phase === "error" && !reading && <Notice tone="wait">{message}</Notice>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-busy={reading}>
            {SLOTS.map((s, i) => (
              <CaptureTile key={i} title={s.title} sub={s.sub} camera={s.camera} slot={slots[i]} disabled={reading}
                onPick={(f) => setSlot(i, f)} onClear={() => setSlot(i, null)} />
            ))}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <Button size="xl" icon={ScanLine} block disabled={files.length === 0 || reading || saving} onClick={read}>
              {reading ? "Lecture en cours…" : "Lire mes captures"}
            </Button>
            <button type="button" disabled={reading} onClick={() => { setSource("manual"); setStep("review"); }} className="v2-focus"
              style={{ minHeight: 44, background: "none", border: "none", color: "var(--sk-t2)", fontSize: 14, cursor: "pointer" }}>
              Saisir à la main
            </button>
          </div>
        </ScreenBody>
      </>
    );
  }

  // ── 1c — vérification (ou saisie manuelle) ──────────────────────────────
  const thumbs = slots.filter(Boolean) as { file: File; url: string }[];
  const moreFilled = MORE_ROWS.some((r) => (form as Record<string, string>)[r.key]) || !!form.comment;
  const showMore = more || moreFilled;
  const legacyGross = !form.yango_cash && !form.yango_card && !!form.yango_gross;

  return (
    <>
      <ScreenHeader
        title="Vérifie ton rapport"
        onBack={() => (enabled && canEdit ? setStep("capture") : onNav("home"))}
        right={thumbs.length > 0 ? (
          <div style={{ display: "flex", gap: 4 }}>
            {thumbs.map((t, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:), pas d'optimisation possible
              <img key={i} src={t.url} alt={`Capture ${i + 1}`} style={{ width: 22, height: 30, objectFit: "cover", borderRadius: 4, border: "1px solid var(--sk-border)" }} />
            ))}
          </div>
        ) : undefined}
      />
      <ScreenBody padding="18px 16px" gap={14}>
        {todayReport ? (
          <Notice tone="ok">Rapport du {ddmm(form.date)} déjà envoyé · {todayReport.status === "submitted" ? "en attente de validation" : "validé"}. Change la date pour en saisir un autre.</Notice>
        ) : check === "match" ? (
          <Notice tone="ok">Net lu sur {platLabel()} <b className="v2-num">{formatAmount(result?.fields.net_affiche)}</b> = net calculé. Tout concorde.</Notice>
        ) : check === "mismatch" ? (
          <Notice tone="wait">Net lu sur {platLabel()} <b className="v2-num">{formatAmount(result?.fields.net_affiche)}</b> ≠ calculé <b className="v2-num">{formatAmount(netCalc)}</b>. Vérifie la carte.</Notice>
        ) : source === "manual" ? (
          <Notice tone="info">Saisie manuelle — recopie les chiffres de l&apos;app {platLabel()}.</Notice>
        ) : null}

        {!todayReport && rejectedToday && (
          <Notice tone="neg">Rapport précédent rejeté{rejectedToday.rejection_reason ? ` : ${rejectedToday.rejection_reason}` : ""}. Les champs reprennent l&apos;ancienne saisie ; l&apos;envoi crée un nouveau rapport.</Notice>
        )}
        {source === "ai" && result?.coherence_alerts?.map((a, i) => <Notice key={i} tone="wait">{a.message}</Notice>)}

        <Card mobile flush>
          <div style={{ display: "flex", alignItems: "center", padding: "0 16px", minHeight: 52, borderBottom: "1px solid var(--sk-surface)" }}>
            <label htmlFor="v2-report-date" style={{ flex: 1, fontSize: 14, color: "var(--sk-t2)" }}>Date</label>
            <input id="v2-report-date" type="date" value={form.date} max={today} onChange={(e) => set("date", e.target.value)} className="v2-num v2-focus"
              style={{ height: 38, padding: "0 10px", borderRadius: 8, background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)", fontSize: 15, colorScheme: "inherit" as never }} />
          </div>
          {MAIN_ROWS.map((r, i) => {
            const warn = needsReview(conf(r.ai));
            return (
              <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", minHeight: 52, borderBottom: i < MAIN_ROWS.length - 1 ? "1px solid var(--sk-surface)" : "none", background: warn ? "rgba(249,115,22,.07)" : "transparent" }}>
                <span style={{ flex: 1, fontSize: 14, color: "var(--sk-t2)" }}>{r.label()}</span>
                {warn && <Badge tone="wait">à vérifier</Badge>}
                <InlineNumber ariaLabel={r.label()} value={(form as Record<string, string>)[r.key]} onChange={(v) => set(r.key, v)} disabled={!canEdit} warn={warn} suffix={r.suffix} />
              </div>
            );
          })}
        </Card>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px", fontSize: 13, color: "var(--sk-t2)" }}>
          <span style={{ flex: 1 }}>Hors {platLabel()} aujourd&apos;hui ?</span>
          <InlineNumber ariaLabel={`Hors ${platLabel()}`} value={form.off_yango_revenue} onChange={(v) => set("off_yango_revenue", v)} disabled={!canEdit} width={104} />
        </div>

        {!showMore ? (
          <button type="button" onClick={() => setMore(true)} className="v2-focus"
            style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 44, padding: "0 4px", background: "none", border: "none", color: "var(--sk-t2)", fontSize: 13, cursor: "pointer" }}>
            <ChevronDown size={16} aria-hidden /> Commissions, courses hors {platLabel()}, commentaire
          </button>
        ) : (
          <Card mobile flush>
            {MORE_ROWS.map((r) => {
              const warn = needsReview(conf(r.ai));
              return (
                <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", minHeight: 52, borderBottom: "1px solid var(--sk-surface)", background: warn ? "rgba(249,115,22,.07)" : "transparent" }}>
                  <span style={{ flex: 1, fontSize: 14, color: "var(--sk-t2)" }}>{r.label()}</span>
                  {warn && <Badge tone="wait">à vérifier</Badge>}
                  <InlineNumber ariaLabel={r.label()} value={(form as Record<string, string>)[r.key]} onChange={(v) => set(r.key, v)} disabled={!canEdit} warn={warn} />
                </div>
              );
            })}
            {legacyGross && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px", minHeight: 52, borderBottom: "1px solid var(--sk-surface)" }}>
                <span style={{ flex: 1, fontSize: 14, color: "var(--sk-t2)" }}>Brut {platLabel()}</span>
                <InlineNumber ariaLabel={`Brut ${platLabel()}`} value={form.yango_gross} onChange={(v) => set("yango_gross", v)} disabled={!canEdit} />
              </div>
            )}
            <div style={{ padding: "12px 16px" }}>
              <textarea aria-label="Commentaire" placeholder="Commentaire (optionnel)" value={form.comment} onChange={(e) => set("comment", e.target.value)} disabled={!canEdit} rows={2} className="v2-focus"
                style={{ ...fieldStyle, height: "auto", padding: "10px 12px", resize: "none", background: "var(--sk-deep)" }} />
            </div>
          </Card>
        )}

        {canEdit && source === "manual" && (
          <AttachRow files={pendingFiles} onAdd={addFiles} onRemove={(i) => setPendingFiles((prev) => prev.filter((_, j) => j !== i))} />
        )}

        <div style={{ marginTop: "auto", display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "8px 4px 0" }}>
          <span style={{ fontSize: 14, color: "var(--sk-t2)" }}>Net du jour</span>
          <span className="v2-num" style={{ fontSize: 26, fontWeight: 600, color: "var(--fleet-positive)", letterSpacing: "-.02em" }}>
            {formatAmount(netTotalEffectif)} <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>XOF</span>
          </span>
        </div>
        {canEdit ? (
          <Button size="xl" block disabled={saving} onClick={() => void submit()}>
            {saving ? "Envoi en cours…" : "Envoyer le rapport"}
          </Button>
        ) : (
          <Button size="xl" variant="outline" block onClick={() => onNav("history")}>Voir l&apos;historique</Button>
        )}
      </ScreenBody>
    </>
  );
}

function CaptureTile({ title, sub, camera, slot, disabled, onPick, onClear }: {
  title: string; sub: string; camera: boolean; slot: Slot; disabled: boolean;
  onPick: (f: File) => void; onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const filled = !!slot;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, padding: 12, borderRadius: 16,
      background: filled ? "var(--sk-bg)" : "transparent",
      border: filled ? "1px solid var(--sk-surface)" : "1.5px dashed var(--sk-border)",
      opacity: disabled ? 0.7 : 1,
    }}>
      <button type="button" onClick={() => ref.current?.click()} disabled={disabled} aria-label={`${filled ? "Remplacer" : "Ajouter"} : ${title}`} className="v2-focus"
        style={{ width: 52, height: 72, borderRadius: 8, flex: "none", padding: 0, overflow: "hidden", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          border: filled ? "none" : "1px solid var(--sk-surface)", background: "transparent", color: "var(--tenant-color)" }}>
        {filled
          // eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:)
          ? <img src={slot.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : camera ? <Camera size={22} aria-hidden /> : <Plus size={22} aria-hidden />}
      </button>
      <button type="button" onClick={() => ref.current?.click()} disabled={disabled} className="v2-focus"
        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sk-t1)" }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 2 }}>{sub}</div>
      </button>
      {filled ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(74,222,128,.14)", color: "var(--fleet-positive)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Check size={16} aria-label="Ajoutée" />
          </span>
          {!disabled && (
            <button type="button" onClick={onClear} aria-label={`Retirer : ${title}`} className="v2-focus"
              style={{ width: 32, height: 44, background: "none", border: "none", color: "var(--sk-t3)", cursor: "pointer" }}>
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tenant-color)" }}>Ajouter</span>
      )}
      <input ref={ref} type="file" accept="image/*" hidden {...(camera ? { capture: "environment" as const } : {})}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </div>
  );
}

function AttachRow({ files, onAdd, onRemove }: { files: File[]; onAdd: (f: FileList | null) => void; onRemove: (i: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Card mobile flush>
      <button type="button" onClick={() => ref.current?.click()} className="v2-row v2-focus"
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 52, padding: "0 16px", background: "none", border: "none", color: "var(--sk-t1)", fontSize: 15, cursor: "pointer", borderBottom: files.length ? "1px solid var(--sk-surface)" : "none" }}>
        <Paperclip size={20} aria-hidden style={{ color: "var(--sk-t2)" }} />
        <span style={{ flex: 1, textAlign: "left" }}>Joindre une photo</span>
        <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>optionnel</span>
      </button>
      {files.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 16px", minHeight: 44, fontSize: 13, color: "var(--sk-t2)", borderBottom: i < files.length - 1 ? "1px solid var(--sk-surface)" : "none" }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label={`Retirer ${f.name}`} className="v2-focus"
            style={{ width: 44, height: 44, background: "none", border: "none", color: "var(--v2-negative-ink)", cursor: "pointer" }}><X size={16} aria-hidden /></button>
        </div>
      ))}
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf" multiple hidden onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
    </Card>
  );
}
