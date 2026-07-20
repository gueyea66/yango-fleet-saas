"use client";

import { useState } from "react";
import Link from "next/link";
import { tenantDomainPreview } from "@/lib/config";

interface FormState {
  companyName: string;
  email: string;
  password: string;
  currency: string;
}

const CURRENCIES = [
  { code: "XOF", label: "Franc CFA (XOF)" },
  { code: "USD", label: "Dollar américain (USD)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "MAD", label: "Dirham marocain (MAD)" },
  { code: "GHS", label: "Cedi ghanéen (GHS)" },
  { code: "NGN", label: "Naira nigérian (NGN)" },
  { code: "KES", label: "Shilling kényan (KES)" },
];

export default function RegisterPage() {
  const [form, setForm] = useState<FormState>({ companyName: "", email: "", password: "", currency: "XOF" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ loginUrl: string; trialEndsAt: string } | null>(null);

  const slugPreview = form.companyName
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erreur inconnue"); return; }
      // Redirect to payment page after 1 second
      setTimeout(() => {
        window.location.href = `/paiement?slug=${data.slug}&plan=${form.currency === "XOF" ? "standard" : "standard"}&ref=M3A-${data.slug.toUpperCase()}-${new Date().getFullYear()}`;
      }, 1500);
      setSuccess({ loginUrl: data.loginUrl, trialEndsAt: data.trialEndsAt });
    } catch {
      setError("Erreur réseau — réessayez.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    const trialEnd = new Date(success.trialEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    return (
      <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div style={{ background: "#1a1f2e", border: "1px solid #2a3147", borderRadius: "16px", padding: "40px", maxWidth: "480px", width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🎉</div>
          <h1 style={{ color: "var(--sk-t1)", fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>Compte créé !</h1>
          <p style={{ color: "#8892a4", marginBottom: "24px" }}>
            Votre essai gratuit est actif jusqu&apos;au <strong style={{ color: "var(--sk-t1)" }}>{trialEnd}</strong>.
          </p>
          <a
            href={success.loginUrl}
            style={{ display: "block", background: "#f5a623", color: "#000", borderRadius: "8px", padding: "14px 24px", fontWeight: 700, textDecoration: "none", fontSize: "16px", marginBottom: "16px" }}
          >
            Accéder à mon tableau de bord →
          </a>
          <p style={{ color: "#8892a4", fontSize: "13px" }}>
            URL de connexion :<br />
            <code style={{ color: "#f5a623", fontSize: "12px" }}>{success.loginUrl}</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ background: "#1a1f2e", border: "1px solid #2a3147", borderRadius: "16px", padding: "40px", maxWidth: "480px", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1 style={{ color: "var(--sk-t1)", fontSize: "28px", fontWeight: 800, marginBottom: "8px" }}>Créer votre compte</h1>
          <p style={{ color: "#8892a4", fontSize: "15px" }}>14 jours d&apos;essai gratuit — aucune carte bancaire requise</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", color: "#a0aab8", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
              Nom de l&apos;entreprise *
            </label>
            <input
              type="text"
              value={form.companyName}
              onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
              placeholder="Ex: Keur Transport Dakar"
              required
              style={{ width: "100%", background: "#252b3b", border: "1px solid var(--sk-border)", color: "var(--sk-t1)", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
            />
            {slugPreview && (
              <p style={{ color: "#8892a4", fontSize: "12px", marginTop: "4px" }}>
                URL : <code style={{ color: "#f5a623" }}>{tenantDomainPreview(slugPreview)}</code>
              </p>
            )}
          </div>

          <div>
            <label style={{ display: "block", color: "#a0aab8", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
              Email administrateur *
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="admin@votreentreprise.com"
              required
              style={{ width: "100%", background: "#252b3b", border: "1px solid var(--sk-border)", color: "var(--sk-t1)", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", color: "#a0aab8", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
              Mot de passe *
            </label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Minimum 8 caractères"
              required
              minLength={8}
              style={{ width: "100%", background: "#252b3b", border: "1px solid var(--sk-border)", color: "var(--sk-t1)", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", color: "#a0aab8", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
              Devise
            </label>
            <select
              value={form.currency}
              onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
              style={{ width: "100%", background: "#252b3b", border: "1px solid var(--sk-border)", color: "var(--sk-t1)", borderRadius: "8px", padding: "10px 14px", fontSize: "14px", outline: "none", boxSizing: "border-box" }}
            >
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>

          {error && (
            <div style={{ background: "#2d1515", border: "1px solid #c53030", color: "#fc8181", borderRadius: "8px", padding: "12px 14px", fontSize: "14px" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ background: loading ? "#a0711a" : "#f5a623", color: "#000", border: "none", borderRadius: "8px", padding: "14px", fontSize: "16px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", marginTop: "8px" }}
          >
            {loading ? "Création en cours..." : "Créer mon compte →"}
          </button>
        </form>

        <p style={{ color: "#8892a4", fontSize: "13px", textAlign: "center", marginTop: "24px" }}>
          Déjà un compte ?{" "}
          <Link href="/auth/login" style={{ color: "#f5a623", textDecoration: "none" }}>Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
