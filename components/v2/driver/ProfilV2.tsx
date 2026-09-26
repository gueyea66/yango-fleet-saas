"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, Clock, CircleX, Plus, TriangleAlert, Moon, Sun, LogOut, UserRound, ChevronDown, ChevronRight } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui";
import { useDriverProfil, KYC_DOCS } from "@/components/driver/useDriverProfil";
import { DriverAvancesSection } from "@/components/driver/DriverCards";
import type { Profile } from "@/components/driver/shared";
import { initials } from "@/lib/v2/format";
import { ScreenHeader, ScreenBody, Notice, fieldStyle, Label, SkeletonBlock } from "./parts";

/**
 * Profil & documents v2 (maquette 2d), ouvert depuis l'avatar de l'en-tête.
 * Upload KYC, soumission du dossier et informations personnelles : logique
 * actuelle partagée via useDriverProfil (mêmes écritures).
 */
export function ProfilV2({ profile, onBack, onSignOut }: { profile: Profile; onBack: () => void; onSignOut: () => void }) {
  const {
    fullProfile, infoForm, savingInfo, infoSaved, vehicle, kycDocs, uploading, submitting,
    setInfo, saveInfo, uploadDoc, submitDossier, status, statusInfo, canSubmit,
  } = useDriverProfil(profile);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [infoOpen, setInfoOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Même préférence d'appareil que ThemeToggle (localStorage « m3a-theme »).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture post-montage
      if (localStorage.getItem("m3a-theme") === "light") setTheme("light");
    } catch { /* stockage indisponible → sombre */ }
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("m3a-theme", next); } catch { /* best-effort */ }
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  };

  const missing = KYC_DOCS.filter((d) => !kycDocs[d.type]);
  const missingRequired = missing.filter((d) => d.required);

  return (
    <>
      <ScreenHeader title="Mon profil" onBack={onBack} />
      <ScreenBody padding="22px 16px">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--sk-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600, color: "var(--v2-nav-inactive)", flex: "none" }}>
            {initials(profile.full_name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{profile.full_name}</div>
            <div className="v2-num" style={{ fontSize: 13, color: "var(--v2-muted)", marginTop: 2 }}>
              {[profile.driver_id, vehicle?.plate].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>

        {!fullProfile ? <SkeletonBlock height={52} radius={14} /> : missing.length > 0 ? (
          <Notice tone="wait">
            {missing.length} document{missing.length > 1 ? "s" : ""} manquant{missing.length > 1 ? "s" : ""} : {missing.map((d) => d.label.toLowerCase()).join(", ")}
          </Notice>
        ) : (
          <Notice tone={status === "approved" ? "ok" : status === "rejected" ? "neg" : "info"}>
            {statusInfo.label.replace(/^[✓✗]\s*/, "")}
            {status === "rejected" && fullProfile?.onboarding_notes ? ` — ${fullProfile.onboarding_notes}` : ""}
          </Notice>
        )}

        <Card mobile flush>
          {KYC_DOCS.map((doc, i) => {
            const up = kycDocs[doc.type];
            const busy = uploading === doc.type;
            const st = up?.status as string | undefined;
            return (
              <div key={doc.type} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px", minHeight: 52, borderBottom: i < KYC_DOCS.length - 1 ? "1px solid var(--sk-surface)" : "none" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15 }}>
                  {doc.label}{doc.required && !up && <span style={{ color: "var(--v2-negative-ink)" }}> *</span>}
                </span>
                {busy ? (
                  <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>Envoi…</span>
                ) : !up ? (
                  <button type="button" onClick={() => fileRefs.current[doc.type]?.click()} className="v2-focus"
                    style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 44, background: "none", border: "none", color: "var(--tenant-color)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                    <Plus size={16} aria-hidden />Ajouter
                  </button>
                ) : (
                  <>
                    {st === "approved" && <CircleCheck size={20} aria-label="Validé" style={{ color: "var(--fleet-positive)" }} />}
                    {st === "rejected" && <Badge tone="neg">Rejeté</Badge>}
                    {st !== "approved" && st !== "rejected" && <Clock size={18} aria-label="En attente de vérification" style={{ color: "var(--fleet-warning)" }} />}
                    {st !== "approved" && (
                      <button type="button" onClick={() => fileRefs.current[doc.type]?.click()} className="v2-focus"
                        style={{ minHeight: 44, background: "none", border: "none", color: "var(--sk-t2)", fontSize: 13, cursor: "pointer" }}>
                        Remplacer
                      </button>
                    )}
                  </>
                )}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf" hidden ref={(el) => { fileRefs.current[doc.type] = el; }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadDoc(f, doc.type); e.target.value = ""; }} />
              </div>
            );
          })}
        </Card>
        {canSubmit && (
          <Button size="lg" block disabled={submitting} onClick={() => void submitDossier()} style={{ height: 52 }}>
            {submitting ? "Envoi en cours…" : "Envoyer mon dossier pour vérification"}
          </Button>
        )}
        {missingRequired.length === 0 && status === "in_review" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--fleet-info)" }}><Clock size={14} aria-hidden />Dossier en cours de vérification</div>
        )}
        {status === "rejected" && <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--v2-negative-ink)" }}><CircleX size={14} aria-hidden />Dossier rejeté — remplace les pièces signalées puis renvoie.</div>}

        <Card mobile flush>
          <button type="button" onClick={() => setInfoOpen((o) => !o)} aria-expanded={infoOpen} className="v2-row v2-focus"
            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 52, padding: "0 16px", background: "none", border: "none", borderBottom: "1px solid var(--sk-surface)", color: "var(--sk-t2)", cursor: "pointer" }}>
            <UserRound size={20} aria-hidden />
            <span style={{ flex: 1, textAlign: "left", fontSize: 15, color: "var(--sk-t1)" }}>Informations personnelles</span>
            {infoOpen ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden style={{ color: "var(--sk-t3)" }} />}
          </button>
          {infoOpen && (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, borderBottom: "1px solid var(--sk-surface)" }}>
              {([
                ["birth_date", "Date de naissance", "date"], ["nationality", "Nationalité", "text"], ["address", "Adresse", "text"], ["city", "Ville", "text"],
                ["license_number", "N° de permis", "text"], ["license_expiry", "Expiration du permis", "date"], ["years_experience", "Années d'expérience", "number"],
                ["emergency_name", "Contact d'urgence — nom", "text"], ["emergency_phone", "Contact d'urgence — téléphone", "tel"], ["emergency_relation", "Contact d'urgence — relation", "text"],
              ] as const).map(([k, label, type]) => (
                <div key={k}>
                  <Label htmlFor={`v2-info-${k}`}>{label}</Label>
                  <input id={`v2-info-${k}`} type={type} value={infoForm[k]} onChange={(e) => setInfo(k, e.target.value)} className="v2-focus"
                    style={{ ...fieldStyle, background: "var(--sk-deep)", colorScheme: "inherit" as never }} />
                </div>
              ))}
              <Button variant={infoSaved ? "outline" : "primary"} size="lg" block disabled={savingInfo} onClick={() => void saveInfo()}>
                {infoSaved ? "Enregistré" : savingInfo ? "…" : "Enregistrer"}
              </Button>
            </div>
          )}
          <button type="button" onClick={toggleTheme} className="v2-row v2-focus"
            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 52, padding: "0 16px", background: "none", border: "none", color: "var(--sk-t2)", cursor: "pointer" }}>
            {theme === "dark" ? <Moon size={20} aria-hidden /> : <Sun size={20} aria-hidden />}
            <span style={{ flex: 1, textAlign: "left", fontSize: 15, color: "var(--sk-t1)" }}>Thème</span>
            <span style={{ fontSize: 13 }}>{theme === "dark" ? "Sombre" : "Clair"}</span>
          </button>
        </Card>

        {!vehicle && fullProfile && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--v2-muted)" }}>
            <TriangleAlert size={14} aria-hidden />Aucun véhicule attribué pour l&apos;instant.
          </div>
        )}

        <DriverAvancesSection driverId={profile.id} />

        {/* Déconnexion (maquette 2d) : tout en bas, en rouge — appelle useAuth().signOut via onSignOut. */}
        <button type="button" onClick={() => { setSigningOut(true); onSignOut(); }} disabled={signingOut} className="v2-btn v2-focus"
          style={{ marginTop: "auto", width: "100%", minHeight: 52, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: "var(--v2-neg-bg)", border: "1px solid var(--v2-neg-bd)", color: "var(--v2-negative-ink)", fontSize: 15, fontWeight: 600, cursor: "pointer",
            marginBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <LogOut size={18} aria-hidden />{signingOut ? "Déconnexion…" : "Se déconnecter"}
        </button>
      </ScreenBody>
    </>
  );
}
