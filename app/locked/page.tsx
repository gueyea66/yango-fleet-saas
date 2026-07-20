"use client";
export const dynamic = "force-dynamic";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LockedContent() {
  const params = useSearchParams();
  const reason = params.get("reason");

  const isInactive = reason === "inactive";

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, var(--sk-deep) 0%, var(--sk-bg) 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        background: "var(--sk-bg)",
        border: "1px solid #ef444430",
        borderRadius: 20,
        padding: 48,
        maxWidth: 420,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h1 style={{ color: "var(--sk-t1)", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          {isInactive ? "Compte suspendu" : "Accès expiré"}
        </h1>
        <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
          {isInactive
            ? "Votre compte a été suspendu par l'administrateur."
            : "Votre période d'essai ou d'abonnement est terminée."}
        </p>
        <p style={{ color: "#374151", fontSize: 12, marginBottom: 32 }}>
          {isInactive
            ? "Contactez M3A pour réactiver votre accès."
            : "Connectez-vous à /superadmin → cliquez sur votre tenant → Étendre l'accès."}
        </p>

        <a href="https://wa.me/221770000000?text=Je+souhaite+renouveler+mon+abonnement+Fleet+SaaS"
          target="_blank" rel="noreferrer"
          style={{
            display: "block",
            background: "linear-gradient(135deg, #25d366, #128c7e)",
            color: "#fff",
            borderRadius: 12,
            padding: "14px 24px",
            fontWeight: 700,
            fontSize: 15,
            textDecoration: "none",
            marginBottom: 12,
          }}>
          📱 Contacter M3A sur WhatsApp
        </a>

        <a href="tel:+221770000000"
          style={{
            display: "block",
            background: "var(--sk-surface)",
            color: "#9ca3af",
            borderRadius: 12,
            padding: "12px 24px",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
            marginBottom: 24,
          }}>
          📞 Appeler M3A
        </a>

        <button onClick={() => { localStorage.clear(); window.location.href = "/auth/login"; }}
          style={{
            background: "transparent",
            border: "none",
            color: "#374151",
            fontSize: 12,
            cursor: "pointer",
          }}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

export default function LockedPage() {
  return (
    <Suspense>
      <LockedContent />
    </Suspense>
  );
}
