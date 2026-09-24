// Déplacé tel quel depuis app/auth/login/page.tsx (refonte UI v2, étape 7) : logique du
// formulaire partagée par la page actuelle et la page v2 — même appel,
// même gestion d'erreur, même redirection.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getVirtualEmailForDriver } from "@/lib/auth/utils";

export type UserRole = "admin" | "driver";

export function useLoginForm() {
  const [role, setRole] = useState<UserRole>("admin");
  const [email, setEmail] = useState("");
  const [driverId, setDriverId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirigé par le middleware quand un chauffeur désactivé tente d'accéder à l'app
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("disabled")) {
      setError("Ce compte chauffeur a été désactivé par le gestionnaire de la flotte.");
    }
  }, []);

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
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (signInError) { setError(signInError.message); return; }
      const session = data?.session ?? (await supabase.auth.getSession()).data.session;
      if (session?.user) {
        localStorage.setItem("yango-session", JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token, user: session.user }));
        localStorage.setItem("yango-auth", JSON.stringify({ id: session.user.id, email: session.user.email, role }));
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

  return { role, setRole, email, setEmail, driverId, setDriverId, password, setPassword, loading, error, setError, handleSubmit };
}
