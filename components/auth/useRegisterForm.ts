// Déplacé tel quel depuis app/register/page.tsx (refonte UI v2, étape 7) : logique du
// formulaire partagée par la page actuelle et la page v2 — même appel,
// même gestion d'erreur, même redirection.
import { useState } from "react";

export interface FormState {
  companyName: string;
  email: string;
  password: string;
  currency: string;
}

export function useRegisterForm() {
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

  return { form, setForm, loading, error, success, slugPreview, handleSubmit };
}
