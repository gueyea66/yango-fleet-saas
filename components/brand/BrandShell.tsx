"use client";

import { useTenant } from "@/lib/tenant/context";

export function BrandLogo({ size = 32 }: { size?: number }) {
  const { settings } = useTenant();

  if (settings.logo_url) {
    return (
      <img
        src={settings.logo_url}
        alt={settings.app_name}
        style={{ height: size, width: "auto", objectFit: "contain" }}
      />
    );
  }

  return (
    <div
      style={{
        height: size,
        width: size,
        background: settings.primary_color,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.4,
        fontWeight: 600,
        color: "var(--sk-deep)",
        flexShrink: 0,
      }}
    >
      {settings.app_name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function BrandName({ className }: { className?: string }) {
  const { settings } = useTenant();
  return <span className={className}>{settings.app_name}</span>;
}

export function PoweredBy() {
  const { settings } = useTenant();
  return (
    <div
      style={{
        fontSize: 10,
        color: "#6b7280",
        textAlign: "center",
        padding: "6px 0",
        letterSpacing: "0.04em",
      }}
    >
      {/* White-label : jamais de marque M3A chez un client (« vos équipes ne voient jamais M3A »). */}
      <span style={{ color: "var(--tenant-color)", fontWeight: 500 }}>{settings.operator_name || settings.app_name || ""}</span>
    </div>
  );
}
