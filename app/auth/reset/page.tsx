"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/tenant/context";
import { BrandLogo, PoweredBy } from "@/components/brand/BrandShell";

export default function ResetPasswordPage() {
  const { settings } = useTenant();
  const brand = settings.primary_color || "#f5a623";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Mot de passe trop court (8 caractères minimum)"); return; }
    if (password !== confirm) { setError("Les mots de passe ne correspondent pas"); return; }
    setLoading(true);
    try {
      // La session est établie par le lien de l'email (hash tokens gérés par supabase-js)
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) { setError(updateError.message); return; }
      setDone(true);
      setTimeout(() => { window.location.href = "/auth/login"; }, 2500);
    } catch {
      setError("Lien invalide ou expiré — refaites une demande");
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
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "#f0f2f7" }}>Nouveau mot de passe</h1>
        </div>

        <div className="rounded-2xl border p-8" style={{ background: "#0d1117", borderColor: "#1e2330" }}>
          {done ? (
            <div className="text-center">
              <div className="text-3xl mb-3">✅</div>
              <p className="text-sm" style={{ color: "#f0f2f7" }}>
                Mot de passe mis à jour — redirection vers la connexion…
              </p>
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
                  Nouveau mot de passe
                </label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••" required autoComplete="new-password"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#555e75" }}>
                  Confirmer
                </label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••••" required autoComplete="new-password"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3.5 rounded-xl text-sm font-bold"
                style={{ background: loading ? "#1e2330" : brand, color: loading ? "#555e75" : "#000" }}>
                {loading ? "Mise à jour..." : "Définir le mot de passe"}
              </button>
            </form>
          )}
        </div>

        <div className="text-center mt-6"><PoweredBy /></div>
      </div>
    </div>
  );
}
