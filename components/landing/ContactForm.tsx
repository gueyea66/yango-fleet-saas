"use client";

import { useState, FormEvent } from "react";

type Status = "idle" | "loading" | "success" | "error";

const inputStyle: React.CSSProperties = {
  background: "var(--sk-deep)",
  border: "1px solid var(--sk-surface)",
  color: "var(--sk-t1)",
};

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || ""),
      company: String(data.get("company") || ""),
      phone: String(data.get("phone") || ""),
      email: String(data.get("email") || ""),
      fleetSize: String(data.get("fleetSize") || ""),
      message: String(data.get("message") || ""),
    };

    try {
      const res = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json.error || "Une erreur est survenue. Réessayez.");
        setStatus("error");
        return;
      }
      setStatus("success");
      form.reset();
    } catch {
      setErrorMsg("Connexion impossible. Réessayez dans un instant.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: "var(--sk-surface)", border: "1px solid var(--sk-border)" }}
      >
        <div
          className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: "rgba(74,222,128,0.15)" }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold mb-2" style={{ color: "var(--sk-t1)" }}>
          Demande envoyée
        </h3>
        <p style={{ color: "var(--sk-t2)" }}>
          Merci ! Un membre de l&apos;équipe M3A Fleet revient vers vous très vite pour
          organiser votre démonstration.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl p-6 sm:p-8 space-y-5"
      style={{ background: "var(--sk-surface)", border: "1px solid var(--sk-border)" }}
    >
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1.5" style={{ color: "var(--sk-t1)" }}>
            Nom complet <span style={{ color: "#f5a623" }}>*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            className="w-full rounded-lg px-3.5 py-2.5 text-base outline-none focus:ring-2"
            style={{ ...inputStyle, ["--tw-ring-color" as string]: "#f5a623" }}
            placeholder="Votre nom"
          />
        </div>
        <div>
          <label htmlFor="company" className="block text-sm font-medium mb-1.5" style={{ color: "var(--sk-t1)" }}>
            Entreprise
          </label>
          <input
            id="company"
            name="company"
            type="text"
            autoComplete="organization"
            className="w-full rounded-lg px-3.5 py-2.5 text-base outline-none focus:ring-2"
            style={{ ...inputStyle, ["--tw-ring-color" as string]: "#f5a623" }}
            placeholder="Nom de votre société"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium mb-1.5" style={{ color: "var(--sk-t1)" }}>
            Téléphone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            className="w-full rounded-lg px-3.5 py-2.5 text-base outline-none focus:ring-2"
            style={{ ...inputStyle, ["--tw-ring-color" as string]: "#f5a623" }}
            placeholder="+221 XX XXX XX XX"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: "var(--sk-t1)" }}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="w-full rounded-lg px-3.5 py-2.5 text-base outline-none focus:ring-2"
            style={{ ...inputStyle, ["--tw-ring-color" as string]: "#f5a623" }}
            placeholder="vous@entreprise.com"
          />
        </div>
      </div>

      <p className="text-xs -mt-2" style={{ color: "var(--sk-t3)" }}>
        Téléphone ou email : de quoi vous recontacter.
      </p>

      <div>
        <label htmlFor="fleetSize" className="block text-sm font-medium mb-1.5" style={{ color: "var(--sk-t1)" }}>
          Taille de la flotte
        </label>
        <select
          id="fleetSize"
          name="fleetSize"
          defaultValue=""
          className="w-full rounded-lg px-3.5 py-2.5 text-base outline-none focus:ring-2"
          style={{ ...inputStyle, ["--tw-ring-color" as string]: "#f5a623" }}
        >
          <option value="">Sélectionner (optionnel)</option>
          <option value="1-5">1 à 5 véhicules</option>
          <option value="6-20">6 à 20 véhicules</option>
          <option value="21-50">21 à 50 véhicules</option>
          <option value="50+">Plus de 50 véhicules</option>
        </select>
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium mb-1.5" style={{ color: "var(--sk-t1)" }}>
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          className="w-full rounded-lg px-3.5 py-2.5 text-base outline-none focus:ring-2 resize-none"
          style={{ ...inputStyle, ["--tw-ring-color" as string]: "#f5a623" }}
          placeholder="Votre secteur, votre besoin, vos questions… (optionnel)"
        />
      </div>

      {status === "error" && (
        <p role="alert" className="text-sm" style={{ color: "#ef4444" }}>
          {errorMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-lg py-3 font-semibold text-base transition-opacity cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: "#f5a623", color: "#080a0f" }}
      >
        {status === "loading" ? "Envoi en cours…" : "Demander une démonstration"}
      </button>

      <p className="text-xs text-center" style={{ color: "var(--sk-t3)" }}>
        Réponse sous 24 à 48 h ouvrées.
      </p>
    </form>
  );
}
