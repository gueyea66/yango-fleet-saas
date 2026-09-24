// Déplacé tel quel depuis app/auth/reset/page.tsx (refonte UI v2, étape 7) : logique du
// formulaire partagée par la page actuelle et la page v2 — même appel,
// même gestion d'erreur, même redirection.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useResetForm() {
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

  return { password, setPassword, confirm, setConfirm, done, loading, error, handleSubmit };
}
