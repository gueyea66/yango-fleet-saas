"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { loadTenantContext } from "./loader";
import type { TenantContext } from "./types";

const Ctx = createContext<TenantContext | null>(null);

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
  }, []);

  // Inject CSS variables + page title from tenant settings
  useEffect(() => {
    const color = ctx.settings.primary_color || "#f5a623";
    document.documentElement.style.setProperty("--tenant-color", color);
    // Derive a darker shade for hover states
    document.documentElement.style.setProperty("--tenant-color-dark", color + "cc");
    document.documentElement.style.setProperty("--tenant-color-light", color + "22");
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
