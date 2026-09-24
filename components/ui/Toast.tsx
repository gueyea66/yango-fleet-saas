"use client";

import { useEffect } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";

/** Toast v2 : centré en bas, 2,6 s, ombre 0 10px 30px. */
export function Toast({ message, tone = "ok", onDone, duration = 2600 }: {
  message: string | null;
  tone?: "ok" | "neg";
  onDone: () => void;
  duration?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [message, onDone, duration]);
  if (!message) return null;
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div role="status" aria-live="polite"
      style={{
        position: "fixed", left: "50%", bottom: 24, transform: "translate(-50%, 0)", zIndex: 80,
        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 12, maxWidth: "calc(100vw - 32px)",
        background: "var(--sk-bg)", border: "1px solid var(--sk-border)", boxShadow: "var(--v2-toast-shadow)",
        color: "var(--sk-t1)", fontSize: 14, animation: "v2-toast-in .2s ease-out",
      }}>
      <Icon size={18} aria-hidden style={{ color: tone === "ok" ? "var(--fleet-positive)" : "var(--v2-negative-ink)", flex: "none" }} />
      {message}
    </div>
  );
}
