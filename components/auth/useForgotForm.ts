// Déplacé tel quel depuis app/auth/forgot/page.tsx (refonte UI v2, étape 7) : logique du
// formulaire partagée par la page actuelle et la page v2 — même appel,
// même gestion d'erreur, même redirection.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useForgotForm() {
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

  return { email, setEmail, sent, loading, error, handleSubmit };
}
