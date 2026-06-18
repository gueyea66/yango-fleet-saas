"use client";
export const dynamic = "force-dynamic";

export default function LockedPage() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #080a0f 0%, #0d1117 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        background: "#0d1117",
        border: "1px solid #ef444430",
        borderRadius: 20,
        padding: 48,
        maxWidth: 420,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h1 style={{ color: "#f0f2f7", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          Accès suspendu
        </h1>
        <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
          Votre période d'accès est terminée.<br />
          Contactez M3A pour renouveler votre abonnement et retrouver l'accès à votre flotte.
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
            background: "#1e2330",
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
