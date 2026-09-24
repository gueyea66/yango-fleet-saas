export type StatusTone = "ok" | "wait" | "neg" | "info" | "accent" | "idle";

export const STATUS_COLOR: Record<StatusTone, string> = {
  ok: "var(--fleet-positive)",
  wait: "var(--fleet-warning)",
  neg: "var(--fleet-negative)",
  info: "var(--fleet-info)",
  accent: "var(--fleet-accent)",
  idle: "var(--sk-t3)",
};

/** Pastille d'état 8 px (rapport à envoyer, signal GPS, KYC…). */
export function StatusDot({ tone, size = 8, label }: { tone: StatusTone; size?: number; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: STATUS_COLOR[tone], flex: "none" }}
    />
  );
}
