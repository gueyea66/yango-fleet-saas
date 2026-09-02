"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { loadTenantContext } from "./loader";
import type { TenantContext } from "./types";

const Ctx = createContext<TenantContext | null>(null);

// Après connexion, le tenant du PROFIL fait autorité sur le hostname (retour
// Abdou 03/09 : connecté au compte test depuis l'apex, il voyait le branding
// par défaut). Les pages authentifiées poussent ici les settings de LEUR tenant.
let overrideListener: ((s: Partial<TenantContext["settings"]>) => void) | null = null;
export function applyTenantBrandingOverride(s: Partial<TenantContext["settings"]>) {
  overrideListener?.(s);
}

const FALLBACK: TenantContext = {
  tenant: { id: "", slug: "m3a", name: "Fleet Manager", domain: null, plan: "pro", active: true, created_at: "" },
  settings: { id: "", tenant_id: "", app_name: "Fleet Manager", logo_url: null, primary_color: "#f5a623", currency: "XOF", timezone: "Africa/Dakar", operator_name: null, skin: "midnight" },
  remuneration: { id: "", tenant_id: "", model: "tiered", base_amount: 0, commission_rate: 0, bonus_threshold: 0, bonus_amount: 0, comm_yango: 15, comm_partner: 0.75, salary_tiers: [], target_net: 0, daily_rent: 0 },
};

export function TenantProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TenantContext>(FALLBACK);

  useEffect(() => {
    loadTenantContext()
      .then(setCtx)
      .catch((err) => console.error("Tenant load failed:", err));
    overrideListener = (s) => setCtx((prev) => ({ ...prev, settings: { ...prev.settings, ...s } }));
    return () => { overrideListener = null; };
  }, []);

  // Inject CSS variables + page title from tenant settings
  useEffect(() => {
    const color = ctx.settings.primary_color || "#f5a623";
    // hex → composantes RGB (gère #abc et #aabbcc) pour les rgba(var(--tenant-color-rgb), α)
    const hex = color.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.padEnd(6, "0");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
    const root = document.documentElement.style;
    root.setProperty("--tenant-color", color);
    root.setProperty("--tenant-color-rgb", `${r}, ${g}, ${b}`);
    root.setProperty("--tenant-color-dark", `rgb(${Math.round(r * 0.85)}, ${Math.round(g * 0.85)}, ${Math.round(b * 0.85)})`);
    root.setProperty("--tenant-color-light", `rgba(${r}, ${g}, ${b}, 0.12)`);
    // Skin par tenant (surfaces + texte) — l'accent reste --tenant-color ci-dessus.
    document.documentElement.setAttribute("data-skin", ctx.settings.skin || "midnight");
    if (ctx.settings.app_name) {
      document.title = ctx.settings.app_name;
    }
  }, [ctx.settings.primary_color, ctx.settings.app_name, ctx.settings.skin]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useTenant() {
  const ctx = useContext(Ctx);
  return ctx || FALLBACK;
}
