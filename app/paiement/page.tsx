"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

interface PaymentSettings {
  wavePhone: string;
  omPhone: string;
  companyName: string;
  prices: { standard: number; pro: number; enterprise: number };
}

const PLANS: Record<string, { label: string; features: string[] }> = {
  standard: { label: "Standard", features: ["Jusqu'à 20 chauffeurs", "Rapports journaliers", "Gestion des paiements", "Avances sur salaire"] },
  pro: { label: "Pro", features: ["Chauffeurs illimités", "Export CSV", "Branding personnalisé", "Multi-véhicules", "Accès API"] },
  enterprise: { label: "Enterprise", features: ["Tout Pro", "Support prioritaire", "Formation incluse", "SLA garanti"] },
};

function fmt(n: number) { return n.toLocaleString("fr-FR") + " XOF"; }

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function QRCode({ url, size = 180 }: { url: string; size?: number }) {
  const encoded = encodeURIComponent(url);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}&margin=2&bgcolor=1a1f2e&color=f0f2f7`;
  return (
    <img src={src} width={size} height={size} alt="QR Code paiement"
      style={{ borderRadius: 12, border: "1px solid var(--sk-border)", display: "block" }} />
  );
}

function PaymentPageInner() {
  const params = useSearchParams();
  const slug = params.get("slug") || "";
  const plan = (params.get("plan") || "standard") as keyof typeof PLANS;
  const ref = params.get("ref") || `M3A-${slug.toUpperCase()}-${new Date().getFullYear()}`;

  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [mobile, setMobile] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setMobile(isMobile());
    fetch("/api/public/payment-settings").then(r => r.json()).then(setSettings);
  }, []);

  const planInfo = PLANS[plan] || PLANS.standard;
  const amount = settings?.prices[plan as keyof typeof settings.prices] ?? 25000;
  const note = encodeURIComponent(`${ref} - Abonnement ${planInfo.label} Fleet Manager`);

  const waveLink = settings?.wavePhone
    ? `wave://send?to=${encodeURIComponent(settings.wavePhone)}&amount=${amount}&note=${note}`
    : null;
  const waveLinkWeb = settings?.wavePhone
    ? `https://wave.senegal/pay?to=${encodeURIComponent(settings.wavePhone)}&amount=${amount}`
    : null;

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  const S = {
    card: { background: "#1a1f2e", border: "1px solid #2a3147", borderRadius: 16, padding: 24 } as React.CSSProperties,
    label: { color: "#8892a4", fontSize: 12, fontWeight: 600, marginBottom: 4, display: "block" } as React.CSSProperties,
    btn: (color: string): React.CSSProperties => ({ background: color, color: "#000", border: "none", borderRadius: 10, padding: "14px 20px", fontWeight: 700, fontSize: 15, cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }),
    ghost: { background: "#252b3b", color: "var(--sk-t1)", border: "1px solid var(--sk-border)", borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer", width: "100%" } as React.CSSProperties,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "var(--sk-t1)", padding: "32px 16px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 8px" }}>Finaliser votre abonnement</h1>
          <p style={{ color: "#8892a4", margin: 0 }}>
            Plan <strong style={{ color: "#f5a623" }}>{planInfo.label}</strong> — <strong>{settings ? fmt(amount) : "..."}/mois</strong>
          </p>
        </div>

        {/* Plan recap */}
        <div style={{ ...S.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Ce que vous obtenez</div>
          {planInfo.features.map(f => (
            <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span style={{ color: "#22c55e", fontSize: 14 }}>✓</span>
              <span style={{ fontSize: 13, color: "#d1d9e6" }}>{f}</span>
            </div>
          ))}
        </div>

        {/* Référence */}
        <div style={{ ...S.card, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Référence de paiement</div>
          <p style={{ color: "#8892a4", fontSize: 12, margin: "0 0 10px" }}>
            Indiquez cette référence dans la <strong>note/objet</strong> de votre paiement pour faciliter la validation.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ background: "#0f1117", border: "1px solid var(--sk-border)", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#f5a623", flex: 1, fontFamily: "monospace" }}>
              {ref}
            </code>
            <button onClick={() => copy(ref, "ref")} style={S.ghost}>
              {copied === "ref" ? "✓" : "Copier"}
            </button>
          </div>
        </div>

        {/* Wave */}
        {settings?.wavePhone && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#22d3ee", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
              💙 Payer via Wave
            </div>

            {mobile ? (
              <a href={waveLink!} style={{ ...S.btn("#00B8FF"), textDecoration: "none" }}>
                <span style={{ fontSize: 20 }}>🌊</span>
                Ouvrir Wave — {fmt(amount)}
              </a>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <p style={{ color: "#8892a4", fontSize: 13, margin: 0, textAlign: "center" }}>
                  Scannez ce QR code avec votre téléphone pour ouvrir Wave
                </p>
                <QRCode url={waveLink!} size={180} />
                <p style={{ color: "#6b7280", fontSize: 11, margin: 0 }}>
                  Ou copiez le numéro Wave :
                </p>
                <div style={{ display: "flex", gap: 8, width: "100%" }}>
                  <code style={{ background: "#0f1117", border: "1px solid var(--sk-border)", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#22d3ee", flex: 1, fontFamily: "monospace" }}>
                    {settings.wavePhone}
                  </code>
                  <button onClick={() => copy(settings!.wavePhone, "wave")} style={S.ghost}>
                    {copied === "wave" ? "✓" : "Copier"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Orange Money */}
        {settings?.omPhone && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#f97316", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
              🟠 Payer via Orange Money
            </div>

            {mobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a href={`tel:*144*1*${settings.omPhone.replace(/\D/g, "")}*${amount}%23`}
                  style={{ ...S.btn("#FF6600"), textDecoration: "none" }}>
                  <span style={{ fontSize: 20 }}>🟠</span>
                  Lancer le paiement OM
                </a>
                <p style={{ color: "#6b7280", fontSize: 11, textAlign: "center", margin: 0 }}>
                  Ou utilisez le code USSD : <code style={{ color: "#f97316" }}>*144*1*{settings.omPhone.replace(/\D/g, "")}*{amount}#</code>
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <p style={{ color: "#8892a4", fontSize: 13, margin: 0, textAlign: "center" }}>
                  Scannez ce QR code ou composez le code USSD
                </p>
                <QRCode url={`*144*1*${settings.omPhone.replace(/\D/g, "")}*${amount}#`} size={180} />
                <div style={{ display: "flex", gap: 8, width: "100%" }}>
                  <code style={{ background: "#0f1117", border: "1px solid var(--sk-border)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f97316", flex: 1, fontFamily: "monospace" }}>
                    {settings.omPhone}
                  </code>
                  <button onClick={() => copy(settings!.omPhone, "om")} style={S.ghost}>
                    {copied === "om" ? "✓" : "Copier"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notice */}
        <div style={{ background: "#1a1f2e", border: "1px solid #2a3147", borderRadius: 12, padding: 16, marginBottom: 24, textAlign: "center" }}>
          <p style={{ color: "#8892a4", fontSize: 13, margin: "0 0 8px" }}>
            Après votre paiement, notre équipe valide votre compte sous <strong style={{ color: "var(--sk-t1)" }}>24h ouvrées</strong>.
          </p>
          <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>
            Votre essai gratuit continue pendant ce délai.
          </p>
        </div>

        {/* Footer links */}
        <div style={{ textAlign: "center", fontSize: 12, color: "#6b7280" }}>
          <Link href="/legal/cgu" style={{ color: "#6b7280", marginRight: 16 }}>CGU</Link>
          <Link href="/legal/confidentialite" style={{ color: "#6b7280" }}>Confidentialité</Link>
        </div>

      </div>
    </div>
  );
}

export default function PaiementPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", color: "#8892a4" }}>Chargement...</div>}>
      <PaymentPageInner />
    </Suspense>
  );
}
