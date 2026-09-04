"use client";
import { useEffect, useState } from "react";
import { enablePushOnThisDevice, pushSupported } from "@/lib/push";

const DISMISS_KEY = "m3a-push-invite-done";

/**
 * Invite d'activation des alertes au premier login (retour Abdou 04/09 :
 * « une notification simple sur téléphone fera l'affaire » — le vrai gap était
 * que l'activation restait cachée dans la cloche). Une carte, un bouton, une
 * fois par appareil ; après activation, l'auto-réparation (PR #93) prend le
 * relais à vie. N'apparaît que si le push est supporté ET que la permission
 * n'a jamais été demandée (ni accordée ni refusée).
 */
export default function PushOnboarding({ role }: { role: "admin" | "driver" }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
      if (!pushSupported()) return;
      if (Notification.permission !== "default") return; // déjà accordée (auto-réparation) ou refusée
      setVisible(true);
    } catch { /* stockage indisponible → pas d'invite */ }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* best-effort */ }
    setVisible(false);
  };

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await enablePushOnThisDevice();
      if (res.ok) dismiss();
      else setError(res.reason || "Activation impossible.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activation impossible.");
    } finally { setBusy(false); }
  };

  if (!visible) return null;
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-[360px] z-[1100] rounded-2xl p-4 shadow-2xl"
      style={{ background: "var(--sk-bg)", border: "1px solid var(--sk-border)", boxShadow: "0 12px 40px rgba(0,0,0,.45)" }}>
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none">🔔</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: "var(--sk-t1)" }}>Activer les alertes sur ce téléphone</div>
          <div className="text-xs mt-1" style={{ color: "var(--sk-t2)" }}>
            {role === "admin"
              ? "Soyez prévenu dès qu'un chauffeur soumet un rapport ou une dépense — même app fermée."
              : "Recevez les validations de vos rapports et les rappels du soir — même app fermée."}
          </div>
          {error && <div className="text-xs mt-2" style={{ color: "#ef4444" }}>{error}</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={activate} disabled={busy}
              className="text-xs font-bold px-4 py-2 rounded-xl"
              style={{ background: "var(--tenant-color)", color: "#000", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Activation…" : "Activer"}
            </button>
            <button onClick={dismiss}
              className="text-xs px-3 py-2 rounded-xl"
              style={{ background: "transparent", color: "var(--sk-t3)" }}>
              Plus tard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
