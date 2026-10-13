"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { loadTenantContext } from "./loader";
import type { TenantContext } from "./types";

const Ctx = createContext<TenantContext | null>(null);

// Après connexion, le tenant du PROFIL fait autorité sur le hostname (retour
// Abdou 03/09 : connecté au compte test depuis l'apex, il voyait le branding
// par défaut). Les pages authentifiées poussent ici les settings de LEUR tenant.
//
// L'override est ACCUMULÉ au niveau module, pas seulement transmis : le
// chargement par hostname (loadTenantContext) remplaçait tout l'état à son
// arrivée et effaçait l'override quand il arrivait en second. Un aller-retour
// réseau plus lent d'un rafraîchissement à l'autre suffisait donc à perdre
// `ui_v2` — l'app basculait entre l'ancienne et la nouvelle UI au hasard.
// Conservé ici, l'override est réappliqué par-dessus, quel que soit l'ordre.
let pendingOverride: Partial<TenantContext["settings"]> = {};
let overrideListener: ((s: Partial<TenantContext["settings"]>) => void) | null = null;
export function applyTenantBrandingOverride(s: Partial<TenantContext["settings"]>) {
  pendingOverride = { ...pendingOverride, ...s };
  ecrireMarque(pendingOverride);
  overrideListener?.(pendingOverride);
}

// La marque du profil est MÉMORISÉE sur l'appareil (demande d'Abdou, 13/10/2026).
// Elle n'arrive qu'après la session puis une lecture en base : à chaque
// rechargement, un client connecté depuis l'adresse commune voyait donc la
// marque M3A une seconde avant la sienne — et la gardait sur les pages qui ne
// la redemandent pas (suivi GPS, boîtiers, rendement). Relue au démarrage, elle
// sert d'override provisoire ; le script du layout pose les mêmes couleurs
// avant le premier affichage. La base reste la source de vérité : sa réponse
// réécrit la mémoire, et la déconnexion l'efface.
export const CLE_MARQUE = "m3a-marque";
function lireMarque(): Partial<TenantContext["settings"]> | null {
  try {
    const m = JSON.parse(localStorage.getItem(CLE_MARQUE) || "null");
    return m && typeof m === "object" ? m : null;
  } catch { return null; }
}
function ecrireMarque(s: Partial<TenantContext["settings"]>) {
  try { localStorage.setItem(CLE_MARQUE, JSON.stringify(s)); } catch { /* stockage indisponible : on retombe sur l'ancien comportement */ }
}
/** À la déconnexion : le prochain visiteur de cet appareil ne doit pas hériter de la marque. */
export function oublierMarque() {
  pendingOverride = {};
  try { localStorage.removeItem(CLE_MARQUE); } catch { /* idem */ }
}

const FALLBACK: TenantContext = {
  tenant: { id: "", slug: "m3a", name: "Fleet Manager", domain: null, plan: "pro", active: true, created_at: "" },
  settings: { id: "", tenant_id: "", app_name: "Fleet Manager", logo_url: null, primary_color: "#f5a623", currency: "XOF", timezone: "Africa/Dakar", operator_name: null, skin: "midnight" },
  remuneration: { id: "", tenant_id: "", model: "tiered", base_amount: 0, commission_rate: 0, bonus_threshold: 0, bonus_amount: 0, comm_yango: 15, comm_partner: 0.75, salary_tiers: [], target_net: 0, daily_rent: 0 },
};

export function TenantProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TenantContext>(FALLBACK);

  useEffect(() => {
    let alive = true;
    overrideListener = (s) => { if (alive) setCtx((prev) => ({ ...prev, settings: { ...prev.settings, ...s } })); };
    // Rien de poussé encore : la marque mémorisée tient lieu d'override en attendant la base.
    if (!Object.keys(pendingOverride).length) pendingOverride = lireMarque() ?? {};
    // Un override déjà poussé (effet enfant monté avant celui du provider) est
    // repris immédiatement plutôt que perdu.
    if (Object.keys(pendingOverride).length) overrideListener(pendingOverride);
    loadTenantContext()
      .then((loaded) => {
        // L'override du profil garde la main sur le chargement par hostname.
        if (alive) setCtx({ ...loaded, settings: { ...loaded.settings, ...pendingOverride } });
      })
      .catch((err) => console.error("Tenant load failed:", err));
    return () => { alive = false; overrideListener = null; };
  }, []);

  // Inject CSS variables + page title from tenant settings
  useEffect(() => {
    // Tant qu'aucune donnée n'est arrivée, on ne touche à rien : réécrire ici les
    // valeurs par défaut effacerait la marque posée par le script du layout.
    if (ctx === FALLBACK) return;
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
  }, [ctx, ctx.settings.primary_color, ctx.settings.app_name, ctx.settings.skin]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useTenant() {
  const ctx = useContext(Ctx);
  return ctx || FALLBACK;
}
