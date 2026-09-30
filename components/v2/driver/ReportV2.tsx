"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Images, ScanLine, Paperclip, X, ChevronDown, Receipt } from "lucide-react";
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
type Shot = { file: File; url: string };

/** Limite de l'extraction vision (app/api/ai/extract-declaration : MAX_IMAGES). */
const MAX_SHOTS = 3;

// Ce que le chauffeur doit fournir — une aide affichée, plus trois cases
// séparées : l'extraction lit les images sans se soucier de l'ordre, et un
// emplacement par image imposait trois passages dans le sélecteur de fichiers.
const EXPECTED = [
  { title: "Vue « Comparatif »", sub: "Espèces, carte, bonus, commissions" },
  { title: "Vue « Argent »", sub: "Solde du portefeuille, commandes" },
  { title: "Photo du compteur", sub: "Kilométrage fin de journée" },
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
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotsNote, setShotsNote] = useState<string | null>(null);
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
  const shotsRef = useRef(shots);
  useEffect(() => { shotsRef.current = shots; }, [shots]);
  useEffect(() => () => { shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)); }, []);

  // Ajout groupé : galerie (plusieurs images en une fois) ou appareil photo.
  // Le surplus au-delà de MAX_SHOTS est ignoré, et on le DIT — sans quoi le
  // chauffeur croirait avoir envoyé une image que l'extraction n'a pas vue.
  const addShots = (list: FileList | File[] | null) => {
    const picked = Array.from(list || []).filter((f) => f.type.startsWith("image/"));
    if (picked.length === 0) return;
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) {
      setShotsNote(`Maximum ${MAX_SHOTS} images — retire-en une pour en ajouter une autre.`);
      return;
    }
    setShotsNote(picked.length > room ? `Seules les ${room === 1 ? "1re" : `${room} premières`} images ont été gardées (maximum ${MAX_SHOTS}).` : null);
    const kept = picked.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setShots((prev) => [...prev, ...kept]);
  };

  const removeShot = (i: number) => {
    const s = shots[i];
    if (s) URL.revokeObjectURL(s.url);
    setShotsNote(null);
    setShots((prev) => prev.filter((_, j) => j !== i));
  };

  const files = shots.map((s) => s.file);

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
              {reading ? (message || "Quelques secondes.") : `Sélectionne tes ${MAX_SHOTS} images d'un coup dans la galerie. Les champs se remplissent seuls : tu vérifies, tu envoies.`}
            </div>
          </div>
          {rejectedToday && <Notice tone="neg">Ton précédent rapport du {ddmm(form.date)} a été rejeté{rejectedToday.rejection_reason ? ` : ${rejectedToday.rejection_reason}` : ""}. Corrige et renvoie.</Notice>}
          {phase === "error" && !reading && <Notice tone="wait">{message}</Notice>}
          {shotsNote && <Notice tone="info">{shotsNote}</Notice>}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-busy={reading}>
            <CaptureStrip shots={shots} disabled={reading} onAdd={addShots} onRemove={removeShot} />
            <CaptureChecklist count={shots.length} />
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <Button size="xl" icon={ScanLine} block disabled={files.length === 0 || reading || saving} onClick={read}>
              {reading ? "Lecture en cours…" : `Lire mes captures${files.length ? ` (${files.length})` : ""}`}
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
  const thumbs = shots;
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

/**
 * Bande de captures : vignettes déjà choisies + deux entrées.
 *
 * « Choisir mes captures » ouvre la galerie en `multiple` — les trois images
 * partent en une seule fois. « Prendre une photo » ouvre l'appareil (utile pour
 * le compteur) mais n'est plus imposé : la photo du tableau de bord peut aussi
 * venir de la galerie, comme les autres.
 */
function CaptureStrip({ shots, disabled, onAdd, onRemove }: {
  shots: Shot[]; disabled: boolean;
  onAdd: (l: FileList | null) => void; onRemove: (i: number) => void;
}) {
  const galRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const full = shots.length >= MAX_SHOTS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {shots.length > 0 && (
        <ul style={{ display: "flex", gap: 10, listStyle: "none", margin: 0, padding: 0, flexWrap: "wrap" }}>
          {shots.map((s, i) => (
            <li key={s.url} style={{ position: "relative", width: 84, height: 112, borderRadius: 12, overflow: "hidden", border: "1px solid var(--sk-surface)", background: "var(--sk-bg)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) */}
              <img src={s.url} alt={`Capture ${i + 1} : ${s.file.name}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span aria-hidden style={{ position: "absolute", left: 6, bottom: 6, width: 22, height: 22, borderRadius: "50%", background: "rgba(74,222,128,.9)", color: "#06210f", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Check size={14} />
              </span>
              {!disabled && (
                <button type="button" onClick={() => onRemove(i)} aria-label={`Retirer la capture ${i + 1}`} className="v2-focus"
                  style={{ position: "absolute", top: 2, right: 2, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(0,0,0,.55)", border: "none", color: "#fff", cursor: "pointer" }}>
                  <X size={15} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <label htmlFor="v2-rep-gallery" className="v2-focus" tabIndex={disabled || full ? -1 : 0}
        onKeyDown={(e) => { if (!disabled && !full && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); galRef.current?.click(); } }}
        style={{
          display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, cursor: disabled || full ? "not-allowed" : "pointer",
          border: shots.length ? "1px solid var(--sk-surface)" : "1.5px dashed var(--sk-border)",
          background: shots.length ? "var(--sk-bg)" : "transparent", opacity: disabled || full ? 0.55 : 1,
        }}>
        <span style={{ width: 44, height: 44, flex: "none", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--v2-select-bg)", color: "var(--tenant-color)" }}>
          <Images size={22} aria-hidden />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--sk-t1)" }}>Choisir mes captures</span>
          <span style={{ display: "block", fontSize: 13, color: "var(--v2-muted)", marginTop: 2 }}>
            {full ? `${MAX_SHOTS} images sur ${MAX_SHOTS} — retires-en une pour changer` : `Galerie · plusieurs images à la fois (${shots.length}/${MAX_SHOTS})`}
          </span>
        </span>
      </label>

      <button type="button" onClick={() => camRef.current?.click()} disabled={disabled || full} className="v2-focus"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: 14, background: "none", border: "1px solid var(--sk-surface)", color: "var(--sk-t2)", fontSize: 14, cursor: disabled || full ? "not-allowed" : "pointer", opacity: disabled || full ? 0.55 : 1 }}>
        <Camera size={18} aria-hidden /> Prendre une photo
      </button>

      <input ref={galRef} id="v2-rep-gallery" type="file" accept="image/*" multiple disabled={disabled || full}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden disabled={disabled || full}
        onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

/** Rappel de ce qu'on attend — coché au fur et à mesure du nombre d'images. */
function CaptureChecklist({ count }: { count: number }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {EXPECTED.map((e, i) => {
        const done = i < count;
        return (
          <li key={e.title} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.4 }}>
            <span aria-hidden style={{ width: 18, height: 18, flex: "none", marginTop: 1, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? "rgba(74,222,128,.14)" : "var(--sk-bg)", color: done ? "var(--fleet-positive)" : "var(--sk-t3)", border: done ? "none" : "1px solid var(--sk-surface)" }}>
              {done ? <Check size={12} /> : null}
            </span>
            <span style={{ color: done ? "var(--sk-t2)" : "var(--v2-muted)" }}>
              {e.title} <span style={{ color: "var(--sk-t3)" }}>— {e.sub}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AttachRow({ files, onAdd, onRemove }: { files: File[]; onAdd: (f: FileList | null) => void; onRemove: (i: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  // Même mécanisme natif que la dépense : le clic sur un label ouvre le
  // sélecteur sans passer par JavaScript. Aligné ici alors que cet écran
  // fonctionnait, pour que les deux formulaires ne divergent pas — deux
  // mécanismes pour un même geste, c'est deux fois plus à déboguer.
  return (
    <Card mobile flush>
      <label htmlFor="v2-rep-attach" className="v2-row v2-focus" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 52, padding: "0 16px", background: "none", border: "none", color: "var(--sk-t1)", fontSize: 15, cursor: "pointer", borderBottom: files.length ? "1px solid var(--sk-surface)" : "none" }}>
        <Paperclip size={20} aria-hidden style={{ color: "var(--sk-t2)" }} />
        <span style={{ flex: 1, textAlign: "left" }}>Joindre une photo</span>
        <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>optionnel</span>
      </label>
      {files.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 16px", minHeight: 44, fontSize: 13, color: "var(--sk-t2)", borderBottom: i < files.length - 1 ? "1px solid var(--sk-surface)" : "none" }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label={`Retirer ${f.name}`} className="v2-focus"
            style={{ width: 44, height: 44, background: "none", border: "none", color: "var(--v2-negative-ink)", cursor: "pointer" }}><X size={16} aria-hidden /></button>
        </div>
      ))}
      <input ref={ref} id="v2-rep-attach" type="file" accept="image/*,.pdf" multiple
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }} />
    </Card>
  );
}
