"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User } from "@supabase/supabase-js";
import { clearClient } from "@/lib/supabase/client";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Read from our localStorage key — instant, zero network
    try {
      const raw = localStorage.getItem("yango-auth");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.id) {
          setUser({ id: parsed.id, email: parsed.email } as User);
          setLoading(false);
          return;
        }
      }
    } catch { /* SSR */ }

    // No session found
    setLoading(false);
  }, []);

  const signOut = () => {
    // Nettoyage local immédiat, puis révocation du cookie serveur ci-dessous
    localStorage.removeItem("yango-auth");
    localStorage.removeItem("yango-session");
    clearClient(); // Reset singleton so next login creates fresh client
    setUser(null);
    // Cookie de session serveur aussi (sinon /api/* et /open restent ouverts),
    // puis connexion — même si l'appel échoue (hors ligne), on redirige.
    const go = () => { window.location.href = "/auth/login"; };
    // 3 s max : sur réseau lent, la déconnexion ne paraît jamais bloquée
    fetch("/api/auth/signout", { method: "POST", keepalive: true, signal: AbortSignal.timeout(3000) }).then(go, go);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
