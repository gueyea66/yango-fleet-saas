"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Lock, TriangleAlert } from "lucide-react";
import { BrandLogo, PoweredBy } from "@/components/brand/BrandShell";
import { useTenant } from "@/lib/tenant/context";
import { PLAN_LIMITS } from "@/lib/plans";
import { formatAmount } from "@/lib/v2/format";
import { Button } from "@/components/ui";
import { useLoginForm, type UserRole } from "@/components/auth/useLoginForm";
import { useForgotForm } from "@/components/auth/useForgotForm";
import { useResetForm } from "@/components/auth/useResetForm";
import { useRegisterForm } from "@/components/auth/useRegisterForm";

/* Coque commune des pages d'accès v2 (Owner and Platform.dc.html 3b / 5a–5c) :
   fond uni --sk-deep, sans dégradé ni halo. */
export function AuthShellV2({ children, width = 380 }: { children: ReactNode; width?: number }) {
  return (
    <main style={{ minHeight: "100dvh", background: "var(--sk-deep)", color: "var(--sk-t1)", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px" }}>
      <div style={{ width: "100%", maxWidth: width, display: "flex", flexDirection: "column", gap: 24 }}>{children}</div>
    </main>
  );
}

function Brand({ title, sub, size = 56 }: { title: string; sub?: string; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
      <BrandLogo size={size} />
      <div>
        <h1 style={{ margin: 0, fontSize: size >= 56 ? 24 : 22, fontWeight: 600, letterSpacing: "-.01em" }}>{title}</h1>
        {sub && <div style={{ fontSize: 14, color: "var(--v2-muted)", marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = { borderRadius: 18, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", padding: 28, display: "flex", flexDirection: "column", gap: 18 };
const inputStyle: CSSProperties = { width: "100%", height: 48, borderRadius: 12, background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", padding: "0 16px", fontSize: 15, color: "var(--sk-t1)", outline: "none" };

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} style={{ fontSize: 13, color: "var(--v2-muted)" }}>{label}</label>
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, background: "var(--v2-neg-bg)", border: "1px solid var(--v2-neg-bd)", fontSize: 13, color: "var(--v2-negative-ink)" }}>
      <TriangleAlert size={16} aria-hidden style={{ flex: "none", marginTop: 1 }} />{children}
    </div>
  );
}

/** Champ texte v2 : bordure --tenant-color au focus. */
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focus, setFocus] = useState(false);
  return (
    <input {...props} onFocus={(e) => { setFocus(true); props.onFocus?.(e); }} onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
      style={{ ...inputStyle, borderColor: focus ? "var(--tenant-color)" : "var(--sk-surface)", ...props.style }} />
  );
}

/* ─── 3b Connexion ─── */
export function LoginV2() {
  const { settings } = useTenant();
  const { role, setRole, email, setEmail, driverId, setDriverId, password, setPassword, loading, error, setError, handleSubmit } = useLoginForm();
  return (
    <AuthShellV2>
      <Brand title={settings.app_name} sub="Plateforme de gestion de flotte" />
      <div style={cardStyle}>
        <div role="tablist" aria-label="Type de compte" style={{ display: "flex", padding: 4, borderRadius: 12, background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
          {(["admin", "driver"] as UserRole[]).map((r) => (
            <button key={r} type="button" role="tab" aria-selected={role === r} onClick={() => { setRole(r); setError(null); }} className="v2-btn v2-focus"
              style={{ flex: 1, height: 38, borderRadius: 9, border: "none", cursor: "pointer", fontSize: 14, fontWeight: role === r ? 600 : 400,
                background: role === r ? "var(--tenant-color)" : "transparent", color: role === r ? "var(--sk-deep)" : "var(--sk-t2)" }}>
              {r === "admin" ? "Gestionnaire" : "Chauffeur"}
            </button>
          ))}
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {role === "admin" ? (
            <Field id="v2-email" label="Email">
              <Input id="v2-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@m3a.sn" required autoComplete="email" />
            </Field>
          ) : (
            <Field id="v2-driver" label="Identifiant chauffeur">
              <Input id="v2-driver" type="text" value={driverId} onChange={(e) => setDriverId(e.target.value.toUpperCase())} placeholder="DRV001" required autoComplete="username"
                className="v2-num" style={{ letterSpacing: ".14em" }} />
            </Field>
          )}
          <Field id="v2-pass" label="Mot de passe">
            <Input id="v2-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" required autoComplete="current-password" />
          </Field>
          <Button type="submit" size="lg" block disabled={loading} style={{ height: 52 }}>{loading ? "Connexion…" : "Se connecter"}</Button>
        </form>
        {role === "admin" && <Link href="/auth/forgot" style={{ textAlign: "center", fontSize: 13, color: "var(--sk-t2)" }}>Mot de passe oublié ?</Link>}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "var(--sk-t2)", display: "flex", flexDirection: "column", gap: 6 }}>
        {settings.operator_name && <span>{settings.operator_name}</span>}
        <PoweredBy />
        <Link href="/" style={{ color: "var(--sk-t3)" }}>Retour au site</Link>
      </div>
    </AuthShellV2>
  );
}

const Back = ({ href = "/auth/login", label = "Retour à la connexion" }: { href?: string; label?: string }) => (
  <Link href={href} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--sk-t2)", minHeight: 44 }}><ArrowLeft size={15} aria-hidden />{label}</Link>
);

/* ─── 5c Mot de passe oublié ─── */
export function ForgotV2() {
  const { email, setEmail, sent, loading, error, handleSubmit } = useForgotForm();
  return (
    <AuthShellV2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Mot de passe oublié</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--v2-muted)", lineHeight: 1.5 }}>Recevez un lien de réinitialisation par email. Chauffeur ? Demandez à votre gestionnaire.</p>
      </div>
      {sent ? (
        <div role="status" style={{ display: "flex", gap: 10, padding: "14px 16px", borderRadius: 14, background: "var(--v2-ok-bg)", border: "1px solid var(--v2-ok-bd)", fontSize: 14 }}>
          <CircleCheck size={18} aria-hidden style={{ color: "var(--fleet-positive)", flex: "none" }} />Si un compte existe pour {email}, un lien vient d&apos;être envoyé.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Field id="v2-forgot" label="Email">
            <Input id="v2-forgot" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@entreprise.sn" required autoComplete="email" style={{ background: "var(--sk-bg)" }} />
          </Field>
          <Button type="submit" size="lg" block disabled={loading} style={{ height: 50 }}>{loading ? "Envoi…" : "Envoyer le lien"}</Button>
        </form>
      )}
      <Back />
    </AuthShellV2>
  );
}

/* ─── 5c Réinitialisation (même gabarit) ─── */
export function ResetV2() {
  const { password, setPassword, confirm, setConfirm, done, loading, error, handleSubmit } = useResetForm();
  return (
    <AuthShellV2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Nouveau mot de passe</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--v2-muted)" }}>8 caractères minimum.</p>
      </div>
      {done ? (
        <div role="status" style={{ display: "flex", gap: 10, padding: "14px 16px", borderRadius: 14, background: "var(--v2-ok-bg)", border: "1px solid var(--v2-ok-bd)", fontSize: 14 }}>
          <CircleCheck size={18} aria-hidden style={{ color: "var(--fleet-positive)", flex: "none" }} />Mot de passe modifié. Redirection vers la connexion…
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Field id="v2-np" label="Nouveau mot de passe">
            <Input id="v2-np" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" style={{ background: "var(--sk-bg)" }} />
          </Field>
          <Field id="v2-np2" label="Confirmer">
            <Input id="v2-np2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" style={{ background: "var(--sk-bg)" }} />
          </Field>
          <Button type="submit" size="lg" block disabled={loading} style={{ height: 50 }}>{loading ? "Enregistrement…" : "Enregistrer"}</Button>
        </form>
      )}
      <Back />
    </AuthShellV2>
  );
}

/* ─── 5a Inscription ─── */
export function RegisterV2({ currencies }: { currencies: { code: string; label: string }[] }) {
  const { form, setForm, loading, error, success, handleSubmit } = useRegisterForm();
  if (success) {
    const end = new Date(success.trialEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return (
      <AuthShellV2 width={420}>
        <div style={{ ...cardStyle, alignItems: "center", textAlign: "center" }}>
          <CircleCheck size={44} aria-hidden style={{ color: "var(--fleet-positive)" }} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Espace créé</h1>
          <p style={{ margin: 0, fontSize: 14, color: "var(--v2-muted)" }}>Essai actif jusqu&apos;au <b style={{ color: "var(--sk-t1)" }}>{end}</b>.</p>
          <a href={success.loginUrl} className="v2-btn v2-btn-fill" style={{ width: "100%", height: 50, borderRadius: 12, background: "var(--tenant-color)", color: "var(--sk-deep)", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
            Accéder à mon tableau de bord
          </a>
          <code className="v2-num" style={{ fontSize: 12, color: "var(--sk-t2)", wordBreak: "break-all" }}>{success.loginUrl}</code>
        </div>
      </AuthShellV2>
    );
  }
  return (
    <AuthShellV2 width={420}>
      <Brand title="Créer votre espace flotte" sub="14 jours d'essai, sans carte bancaire" size={44} />
      <form onSubmit={handleSubmit} style={{ ...cardStyle, padding: 24, gap: 14 }}>
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field id="v2-co" label="Nom de l'entreprise">
          <Input id="v2-co" type="text" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required style={{ height: 44 }} />
        </Field>
        <Field id="v2-re" label="Email">
          <Input id="v2-re" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@entreprise.sn" required autoComplete="email" style={{ height: 44 }} />
        </Field>
        <Field id="v2-rp" label="Mot de passe">
          <Input id="v2-rp" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8 caractères minimum" required minLength={8} autoComplete="new-password" style={{ height: 44 }} />
        </Field>
        <Field id="v2-cur" label="Devise">
          <select id="v2-cur" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ ...inputStyle, height: 44 }}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </Field>
        <Button type="submit" size="lg" block disabled={loading} style={{ height: 50, marginTop: 4 }}>{loading ? "Création…" : "Démarrer l'essai"}</Button>
      </form>
      <div style={{ textAlign: "center", fontSize: 13, color: "var(--sk-t2)" }}>Déjà un compte ? <Link href="/auth/login" style={{ color: "var(--tenant-color)" }}>Se connecter</Link></div>
    </AuthShellV2>
  );
}

/* ─── 5b Accès suspendu = paiement (fusion /locked + /paiement) ─── */
const WHATSAPP = "221770000000"; // numéro de contact de la page /locked actuelle

export function AccessV2({ reason, initialPlan = "pro", reference }: { reason: "expired" | "inactive" | "payment"; initialPlan?: "standard" | "pro" | "enterprise"; reference?: string }) {
  const [plan, setPlan] = useState<"standard" | "pro" | "enterprise">(initialPlan);
  const [pay, setPay] = useState<{ wavePhone: string; omPhone: string; companyName: string; prices: Record<string, number> } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/public/payment-settings").then((r) => r.json()).then((j) => { if (alive) setPay(j); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const amount = pay?.prices?.[plan] ?? PLAN_LIMITS[plan].priceXOF;
  const ref = reference || `M3A-${new Date().getFullYear()}`;
  const msg = encodeURIComponent(`J'ai payé ${amount} XOF — formule ${PLAN_LIMITS[plan].label} — référence ${ref}`);
  const features = (k: typeof plan) => {
    const l = PLAN_LIMITS[k];
    return [`${l.includedVehicles} véhicules`, l.canExportCSV && "export", l.canCustomBranding && "marque", l.canAccessAPI && k === "enterprise" && "API"].filter(Boolean).join(" · ");
  };
  const inactive = reason === "inactive";

  return (
    <AuthShellV2 width={460}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "rgba(249,115,22,.12)", color: "var(--fleet-warning)", display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={20} aria-hidden /></div>
        <h1 style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 600 }}>{inactive ? "Compte suspendu" : reason === "payment" ? "Finaliser votre abonnement" : "Votre essai est terminé"}</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--v2-muted)", lineHeight: 1.5 }}>
          {inactive ? "Votre compte a été suspendu. Contactez-nous pour le réactiver." : "Vos données sont conservées. Choisissez une formule pour réactiver l'accès de toute l'équipe."}
        </p>
      </div>
      {!inactive && (
        <>
          <div role="radiogroup" aria-label="Formule" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(["standard", "pro", "enterprise"] as const).map((k) => {
              const on = k === plan;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setPlan(k)} className="v2-focus"
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, cursor: "pointer", textAlign: "left", color: "inherit",
                    border: `1px solid ${on ? "var(--tenant-color)" : "var(--sk-surface)"}`, background: on ? "rgba(var(--tenant-color-rgb),.07)" : "var(--sk-bg)" }}>
                  <span style={{ flex: 1 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{PLAN_LIMITS[k].label}</span><span style={{ fontSize: 13, color: "var(--v2-muted)", marginLeft: 8 }}>{features(k)}</span></span>
                  <span className="v2-num" style={{ fontSize: 15 }}>{formatAmount(pay?.prices?.[k] ?? PLAN_LIMITS[k].priceXOF)} <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>/mois</span></span>
                </button>
              );
            })}
            <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>Véhicule supplémentaire : {formatAmount(PLAN_LIMITS.standard.extraVehicleXOF)} XOF/mois. Chauffeurs illimités.</div>
          </div>
          <div style={{ ...cardStyle, padding: 16, gap: 10 }}>
            <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Payer <span className="v2-num" style={{ color: "var(--sk-t1)" }}>{formatAmount(amount)} XOF</span> par · référence <span className="v2-num" style={{ color: "var(--tenant-color)" }}>{ref}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[["Wave", pay?.wavePhone], ["Orange Money", pay?.omPhone]].map(([l, n]) => (
                <div key={l} style={{ padding: 12, borderRadius: 10, border: "1px solid var(--sk-border)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{l}</div>
                  <div className="v2-num" style={{ fontSize: 13, color: "var(--v2-nav-inactive)", marginTop: 4 }}>{n || "—"}</div>
                </div>
              ))}
            </div>
            <a href={`https://wa.me/${WHATSAPP}?text=${msg}`} target="_blank" rel="noreferrer" className="v2-btn v2-btn-fill v2-focus"
              style={{ height: 46, borderRadius: 11, background: "var(--tenant-color)", color: "var(--sk-deep)", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
              J&apos;ai payé — envoyer la référence
            </a>
          </div>
        </>
      )}
      {inactive && (
        <a href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Je souhaite réactiver mon compte Fleet")}`} target="_blank" rel="noreferrer" className="v2-btn v2-btn-fill"
          style={{ height: 50, borderRadius: 12, background: "var(--tenant-color)", color: "var(--sk-deep)", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          Contacter M3A sur WhatsApp
        </a>
      )}
      {reason !== "payment" && (
        <Link href="/auth/login" onClick={() => localStorage.clear()}
          style={{ alignSelf: "center", display: "flex", alignItems: "center", minHeight: 44, color: "var(--sk-t2)", fontSize: 13 }}>
          Se déconnecter
        </Link>
      )}
    </AuthShellV2>
  );
}
