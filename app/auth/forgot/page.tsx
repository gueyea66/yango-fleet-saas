"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/tenant/context";
import { BrandLogo, PoweredBy } from "@/components/brand/BrandShell";

export default function ForgotPasswordPage() {
  const { settings } = useTenant();
  const brand = settings.primary_color || "#f5a623";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      if (resetError) { setError(resetError.message); return; }
      setSent(true);
    } catch {
      setError("Erreur lors de l'envoi — réessayez");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #080a0f 0%, #0d1117 50%, #0a0c12 100%)" }}>
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-10">
          <div className="mb-5"><BrandLogo size={56} /></div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f2f7" }}>Mot de passe oublié</h1>
          <p className="text-sm mt-1 text-center" style={{ color: "#555e75" }}>
            Recevez un lien de réinitialisation par email
          </p>
        </div>

        <div className="rounded-2xl border p-8" style={{ background: "#0d1117", borderColor: "#1e2330" }}>
          {sent ? (
            <div className="text-center">
              <div className="text-3xl mb-3">📬</div>
              <p className="text-sm mb-2" style={{ color: "#f0f2f7" }}>
                Si un compte existe pour <strong>{email}</strong>, un email de réinitialisation vient d&apos;être envoyé.
              </p>
              <p className="text-xs" style={{ color: "#555e75" }}>Pensez à vérifier vos spams.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-xl px-4 py-3 text-sm"
                  style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>
                  Email du compte admin
                </label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@entreprise.sn" required autoComplete="email"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3.5 rounded-xl text-sm font-bold"
                style={{ background: loading ? "#1e2330" : brand, color: loading ? "#555e75" : "#000" }}>
                {loading ? "Envoi..." : "Envoyer le lien"}
              </button>
            </form>
          )}
          <p className="text-xs text-center mt-5" style={{ color: "#555e75" }}>
            Chauffeur ? Demandez à votre gestionnaire de réinitialiser votre mot de passe.
          </p>
        </div>

        <div className="text-center mt-6">
          <Link href="/auth/login" className="text-xs" style={{ color: "#555e75" }}>← Retour à la connexion</Link>
          <div className="mt-3"><PoweredBy /></div>
        </div>
      </div>
    </div>
  );
}
