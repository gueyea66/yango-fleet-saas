"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/context";
import { getTrialStatus, type TrialStatus } from "@/lib/plans";

const HORIZON_CONFIG = {
  "14d": { bg: "#1a2a1a", border: "#22c55e40", color: "#22c55e", icon: "🟢", urgency: "Info" },
  "7d":  { bg: "#2a2200", border: "#f5a62340", color: "#f5a623", icon: "🟡", urgency: "Attention" },
  "3d":  { bg: "#2a1500", border: "#f9731640", color: "#f97316", icon: "🟠", urgency: "Urgent" },
  "1d":  { bg: "#2a0a0a", border: "#ef444440", color: "#ef4444", icon: "🔴", urgency: "Critique" },
};

/**
 * Bannière d'alerte avant expiration (essai ou abonnement), auto-chargée.
 * Affichée côté admin dès J-14 avec lien vers la page de paiement.
 * La RLS autorise l'admin à lire son propre tenant.
 */
export default function TrialBanner() {
  const { user } = useAuth();
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const sb = createClient() as any;
      const { data: profile } = await sb.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      if (!profile?.tenant_id) return;
      const { data: tenant } = await sb.from("tenants")
        .select("trial_ends_at, plan_expires_at")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      if (!tenant) return;
      setExpiresAt(tenant.plan_expires_at ?? tenant.trial_ends_at);
      setStatus(getTrialStatus(tenant.trial_ends_at, tenant.plan_expires_at));
    })();
  }, [user]);

  if (!status || status.state === "active" || status.state === "expired") return null;

  const cfg = HORIZON_CONFIG[status.horizon];
  const dayWord = status.daysLeft <= 1 ? "jour" : "jours";
  // Audit UI : bandeau réductible, SAUF quand l'échéance est proche (≤ 3 j) —
  // là il reste toujours visible pour ne pas rater le renouvellement.
  const canDismiss = status.daysLeft > 3;
  if (canDismiss && dismissed) return null;

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 8,
      padding: "7px 14px",   // ~36px de haut (audit : 52 → 36)
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    }}>
      <span style={{ fontSize: 14 }}>{cfg.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: cfg.color, fontWeight: 600, fontSize: 12.5 }}>
          {cfg.urgency} — {status.daysLeft} {dayWord} restant{status.daysLeft > 1 ? "s" : ""}
        </span>
        <span style={{ color: "#9ca3af", fontSize: 11.5, marginLeft: 8 }}>
          Votre accès expire le {expiresAt ? new Date(expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "—"}.
        </span>
      </div>
      <a href="/paiement"
        style={{
          background: cfg.color,
          color: "#000",
          borderRadius: 7,
          padding: "5px 12px",
          fontSize: 11.5,
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}>
        Renouveler →
      </a>
      {canDismiss && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Masquer l'alerte"
          title="Masquer"
          style={{
            background: "none",
            border: "none",
            color: "#9ca3af",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            padding: "0 2px",
            flexShrink: 0,
          }}>
          ×
        </button>
      )}
    </div>
  );
}
