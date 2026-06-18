"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type UserRole = "admin" | "driver";

const PIN_KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

export default function LoginPage() {
  const [role, setRole] = useState<UserRole>("admin");
  // admin
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // driver
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePinKey = (key: string) => {
    if (key === "⌫") { setPin(p => p.slice(0, -1)); return; }
    if (key === "") return;
    if (pin.length < 4) setPin(p => p + key);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let loginEmail: string;
      let loginPassword: string;

      if (role === "admin") {
        loginEmail = email;
        loginPassword = password;
        if (!loginEmail || !loginPassword) {
          setError("Champs requis manquants");
          setLoading(false);
          return;
        }
      } else {
        const cleaned = phone.replace(/\D/g, "");
        if (!cleaned || pin.length !== 4) {
          setError("Numéro et code PIN requis");
          setLoading(false);
          return;
        }
        loginEmail = `driver-${cleaned}@internal.yango`;
        loginPassword = pin;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (signInError) {
        setError(role === "driver" ? "Numéro ou code PIN incorrect" : signInError.message);
        return;
      }

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
      setError("Erreur de connexion");
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
        {/* Logo */}
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

          {/* Role tabs */}
          <div className="flex p-1 rounded-xl mb-7"
            style={{ background: "#080a0f", border: "1px solid #1e2330" }}>
            {(["admin", "driver"] as UserRole[]).map((r) => (
              <button key={r} type="button" onClick={() => { setRole(r); setError(null); setPin(""); }}
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

          <form onSubmit={handleSubmit}>
            {role === "admin" ? (
              /* ── ADMIN: email + password ── */
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: "#555e75" }}>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@m3a.sn" required autoComplete="email"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
                    style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7" }}
                    onFocus={(e) => e.currentTarget.style.borderColor = "#f5a623"}
                    onBlur={(e) => e.currentTarget.style.borderColor = "#1e2330"} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: "#555e75" }}>Mot de passe</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••" required autoComplete="current-password"
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
                  {loading ? "Connexion..." : "Se connecter →"}
                </button>
              </div>
            ) : (
              /* ── DRIVER: phone + PIN pad ── */
              <div className="space-y-6">
                {/* Phone number */}
                <div>
                  <label className="block text-base font-bold mb-3 text-center"
                    style={{ color: "#f0f2f7" }}>📱 Ton numéro</label>
                  <input
                    type="tel" value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="77 000 00 00"
                    inputMode="numeric"
                    autoComplete="tel"
                    className="w-full rounded-xl px-4 py-4 text-xl font-bold text-center outline-none transition-all"
                    style={{ background: "#080a0f", border: "1px solid #1e2330", color: "#f0f2f7", letterSpacing: "0.1em" }}
                    onFocus={(e) => e.currentTarget.style.borderColor = "#f5a623"}
                    onBlur={(e) => e.currentTarget.style.borderColor = "#1e2330"} />
                </div>

                {/* PIN display */}
                <div>
                  <label className="block text-base font-bold mb-3 text-center"
                    style={{ color: "#f0f2f7" }}>🔑 Code secret (4 chiffres)</label>
                  <div className="flex justify-center gap-4 mb-5">
                    {[0,1,2,3].map(i => (
                      <div key={i} className="w-12 h-14 rounded-xl flex items-center justify-center text-2xl font-bold"
                        style={{
                          background: "#080a0f",
                          border: pin.length > i ? "2px solid #f5a623" : "2px solid #1e2330",
                          color: "#f5a623"
                        }}>
                        {pin.length > i ? "●" : ""}
                      </div>
                    ))}
                  </div>

                  {/* PIN pad */}
                  <div className="grid grid-cols-3 gap-3">
                    {PIN_KEYS.map((key, idx) => (
                      <button key={idx} type="button" onClick={() => handlePinKey(key)}
                        disabled={key === ""}
                        className="rounded-xl py-4 text-xl font-bold transition-all duration-150 active:scale-95"
                        style={{
                          background: key === "⌫" ? "rgba(239,68,68,0.1)" : key === "" ? "transparent" : "#141820",
                          color: key === "⌫" ? "#f87171" : "#f0f2f7",
                          border: key === "" ? "none" : "1px solid #1e2330",
                          cursor: key === "" ? "default" : "pointer",
                          boxShadow: key !== "" && key !== "⌫" ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
                        }}>
                        {key}
                      </button>
                    ))}
                  </div>
                </div>

                <button type="submit" disabled={loading || pin.length !== 4 || !phone.trim()}
                  className="w-full py-4 rounded-xl text-base font-bold tracking-wide transition-all duration-200"
                  style={{
                    background: (loading || pin.length !== 4 || !phone.trim()) ? "#1e2330" : "linear-gradient(135deg, #f5a623, #e8951a)",
                    color: (loading || pin.length !== 4 || !phone.trim()) ? "#555e75" : "#000",
                    boxShadow: (pin.length === 4 && phone.trim()) ? "0 4px 20px rgba(245,166,35,0.25)" : "none",
                  }}>
                  {loading ? "Connexion..." : "Entrer →"}
                </button>
              </div>
            )}
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
