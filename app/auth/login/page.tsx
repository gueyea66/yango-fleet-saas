"use client";

export const dynamic = "force-dynamic";

import { useTenant } from "@/lib/tenant/context";
import { BrandLogo, PoweredBy } from "@/components/brand/BrandShell";
import { useLoginForm } from "@/components/auth/useLoginForm";
import { useUiV2 } from "@/components/v2/useUiV2";
import { LoginV2 } from "@/components/v2/public/AuthV2";

type UserRole = "admin" | "driver";

export default function LoginPage() {
  const uiV2 = useUiV2(); // refonte UI v2 (forçage appareil sur les pages publiques)
  const { settings } = useTenant();
  const brand = settings.primary_color || "var(--tenant-color)";
  const { role, setRole, email, setEmail, driverId, setDriverId, password, setPassword, loading, error, setError, handleSubmit } = useLoginForm();

  if (uiV2) return <LoginV2 />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, var(--sk-deep) 0%, var(--sk-bg) 50%, #0a0c12 100%)" }}>
      <div className="fixed inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse 60% 40% at 50% 0%, ${brand}10 0%, transparent 70%)` }} />
      <div className="w-full max-w-[400px] relative">
        <a href="/" className="inline-flex items-center gap-1.5 text-xs mb-6 transition-opacity hover:opacity-80" style={{ color: "var(--sk-t3)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5M5 12l7-7M5 12l7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Retour au site
        </a>
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <div className="absolute inset-0 rounded-2xl blur-xl opacity-40" style={{ background: brand, transform: "scale(1.3)" }} />
            <div className="relative"><BrandLogo size={56} /></div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--sk-t1)" }}>{settings.app_name}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--sk-t3)" }}>Plateforme de gestion de flotte</p>
        </div>

        <div className="rounded-2xl border p-8"
          style={{ background: "var(--sk-bg)", borderColor: "var(--sk-surface)", boxShadow: "0 0 0 1px rgba(var(--tenant-color-rgb),0.04), 0 24px 48px rgba(0,0,0,0.4)" }}>
          <div className="flex p-1 rounded-xl mb-7" style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)" }}>
            {(["admin", "driver"] as UserRole[]).map((r) => (
              <button key={r} type="button" onClick={() => { setRole(r); setError(null); }}
                className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
                style={{ background: role === r ? brand : "transparent", color: role === r ? "#000" : "var(--sk-t3)" }}>
                {r === "admin" ? "Admin" : "Conducteur"}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 mb-5 text-sm"
              style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>
                {role === "admin" ? "Email" : "ID Conducteur"}
              </label>
              {role === "admin" ? (
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@m3a.sn" required autoComplete="email"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}
                  onFocus={(e) => e.currentTarget.style.borderColor = "var(--tenant-color)"}
                  onBlur={(e) => e.currentTarget.style.borderColor = "var(--sk-surface)"} />
              ) : (
                <input type="text" value={driverId} onChange={(e) => setDriverId(e.target.value.toUpperCase())}
                  placeholder="DRV001" required autoComplete="username"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all font-mono tracking-widest"
                  style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}
                  onFocus={(e) => e.currentTarget.style.borderColor = "var(--tenant-color)"}
                  onBlur={(e) => e.currentTarget.style.borderColor = "var(--sk-surface)"} />
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--sk-t3)" }}>
                Mot de passe
              </label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••" required autoComplete="current-password"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                style={{ background: "var(--sk-deep)", border: "1px solid var(--sk-surface)", color: "var(--sk-t1)" }}
                onFocus={(e) => e.currentTarget.style.borderColor = "var(--tenant-color)"}
                onBlur={(e) => e.currentTarget.style.borderColor = "var(--sk-surface)"} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all duration-200 mt-2"
              style={{
                background: loading ? "var(--sk-surface)" : brand,
                color: loading ? "var(--sk-t3)" : "#000",
                boxShadow: loading ? "none" : `0 4px 20px ${brand}40`,
              }}>
              {loading ? "Connexion..." : "Se connecter →"}
            </button>
          </form>
          {role === "admin" && (
            <p className="text-center mt-5">
              <a href="/auth/forgot" className="text-xs" style={{ color: "var(--sk-t3)" }}>Mot de passe oublié ?</a>
            </p>
          )}
        </div>

        <div className="text-center mt-8">
          {settings.operator_name && (
            <p className="text-xs mb-1" style={{ color: "var(--sk-t4)" }}>{settings.operator_name}</p>
          )}
          <PoweredBy />
          {/* Accès opérateur plateforme (protégé par clé superadmin côté serveur) */}
          <p className="mt-3">
            <a href="/superadmin" className="text-[10px]" style={{ color: "#2a3040" }}>Espace opérateur</a>
          </p>
        </div>
      </div>
    </div>
  );
}
