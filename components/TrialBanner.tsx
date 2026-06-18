"use client";

import { getTrialStatus, type TrialStatus } from "@/lib/plans";

interface Props {
  trialEndsAt: string | null;
  planExpiresAt: string | null;
  tenantSlug: string;
}

const HORIZON_CONFIG = {
  "14d": { bg: "#1a2a1a", border: "#22c55e40", color: "#22c55e", icon: "🟢", urgency: "Info" },
  "7d":  { bg: "#2a2200", border: "#f5a62340", color: "#f5a623", icon: "🟡", urgency: "Attention" },
  "3d":  { bg: "#2a1500", border: "#f97316 40", color: "#f97316", icon: "🟠", urgency: "Urgent" },
  "1d":  { bg: "#2a0a0a", border: "#ef444440", color: "#ef4444", icon: "🔴", urgency: "Critique" },
};

export default function TrialBanner({ trialEndsAt, planExpiresAt }: Props) {
  const status = getTrialStatus(trialEndsAt, planExpiresAt);

  if (status.state === "active" || status.state === "expired") return null;

  const cfg = HORIZON_CONFIG[status.horizon];
  const dayWord = status.daysLeft <= 1 ? "jour" : "jours";

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 10,
      padding: "12px 18px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 20,
    }}>
      <span style={{ fontSize: 18 }}>{cfg.icon}</span>
      <div style={{ flex: 1 }}>
        <span style={{ color: cfg.color, fontWeight: 600, fontSize: 13 }}>
          {cfg.urgency} — {status.daysLeft} {dayWord} restant{status.daysLeft > 1 ? "s" : ""}
        </span>
        <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: 8 }}>
          Votre accès expire le {new Date(planExpiresAt ?? trialEndsAt ?? "").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}.
          Contactez M3A pour renouveler.
        </span>
      </div>
      <a href="https://wa.me/221770000000?text=Renouvellement+Fleet+SaaS" target="_blank" rel="noreferrer"
        style={{
          background: cfg.color,
          color: "#000",
          borderRadius: 8,
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}>
        Renouveler →
      </a>
    </div>
  );
}
