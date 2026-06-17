"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getVirtualEmailForDriver } from "@/lib/auth/utils";

type UserRole = "admin" | "driver";

export default function LoginPage() {
  const [role, setRole] = useState<UserRole>("admin");
  const [email, setEmail] = useState("");
  const [driverId, setDriverId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const loginEmail = role === "admin" ? email : getVirtualEmailForDriver(driverId);

      if (!loginEmail || !password) {
        setError("Champs requis manquants");
        setLoading(false);
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      // Get session — either from response or from client state
      const session = data?.session ?? (await supabase.auth.getSession()).data.session;

      if (session?.user) {
        localStorage.setItem("yango-session", JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user: session.user,
        }));
        localStorage.setItem("yango-auth", JSON.stringify({
          id: session.user.id,
          email: session.user.email,
          role,
        }));
        window.location.href = role === "admin" ? "/admin" : "/driver";
      } else {
        setError("Session introuvable — réessayez");
      }
    } catch {
      setError("Erreur de connexion — vérifiez vos identifiants");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #080a0f 0%, #0d1117 50%, #0a0c12 100%)" }}>

      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(245,166,35,0.06) 0%, transparent 70%)"
      }} />

      <div className="w-full max-w-[400px] relative">
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <div className="absolute inset-0 rounded-2xl blur-xl opacity-40"
              style={{ background: "#f5a623", transform: "scale(1.3)" }} />
            <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl text-black"
              style={{ background: "linear-gradient(135deg, #f5a623, #e8951a)" }}>
              Y
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0f2f7" }}>
            Yango Fleet
          </h1>
          <p className="text-sm mt-1" style={{ color: "#555e75" }}>
            Plateforme de gestion de flotte
          </p>
        </div>

        <div className="rounded-2xl border p-8"
          style={{ background: "#0d1117", borderColor: "#1e2330", boxShadow: "0 0 0 1px rgba(245,166,35,0.04), 0 24px 48px rgba(0,0,0,0.4)" }}>

          <div className="flex p-1 rounded-xl mb-7"
            style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
            {(["admin", "driver"] as UserRole[]).map((r) => (
              <button key={r} type="button" onClick={() => setRole(r)}
                className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
                style={{
                  background: role === r ? "linear-gradient(135deg, #f5a623, #e8951a)" : "transparent",
                  color: role === r ? "#000" : "#555e75",
                }}>
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
            {role === "admin" ? (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: "#555e75" }}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@yango.sn" required name="email" autoComplete="email"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}
                  onFocus={(e) => e.currentTarget.style.borderColor = "#f5a623"}
                  onBlur={(e) => e.currentTarget.style.borderColor = "#1e2330"} />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: "#555e75" }}>ID Conducteur</label>
                <input type="text" value={driverId} onChange={(e) => setDriverId(e.target.value.toUpperCase())}
                  placeholder="DRV001" required name="username" autoComplete="username"
                  className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all font-mono"
                  style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}
                  onFocus={(e) => e.currentTarget.style.borderColor = "#f5a623"}
                  onBlur={(e) => e.currentTarget.style.borderColor = "#1e2330"} />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: "#555e75" }}>Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••" required name="password" autoComplete="current-password"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}
                onFocus={(e) => e.currentTarget.style.borderColor = "#f5a623"}
                onBlur={(e) => e.currentTarget.style.borderColor = "#1e2330"} />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all duration-200 mt-2"
              style={{
                background: loading ? "#1e2330" : "linear-gradient(135deg, #f5a623, #e8951a)",
                color: loading ? "#555e75" : "#000",
                boxShadow: loading ? "none" : "0 4px 20px rgba(245,166,35,0.25)",
              }}>
              {loading ? "Authentification..." : "Se connecter →"}
            </button>
          </form>
        </div>

        <div className="text-center mt-8">
          <p className="text-xs" style={{ color: "#2a2f3d" }}>
            Powered by <span className="font-semibold" style={{ color: "#3d4560" }}>M3A Solution</span>
          </p>
        </div>
      </div>
    </div>
  );
}
