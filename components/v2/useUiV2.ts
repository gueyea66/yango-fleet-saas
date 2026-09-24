"use client";

import { useEffect, useState } from "react";
import { useTenant } from "@/lib/tenant/context";
import { readStoredUiV2, resolveUiV2 } from "@/lib/v2/flag";

/**
 * Drapeau UI v2 côté client.
 *
 * Premier rendu (SSR + hydratation) toujours à `false` → pas d'écart
 * d'hydratation, et drapeau éteint = UI actuelle à l'identique. Le forçage
 * local est lu après montage ; le drapeau tenant arrive avec les settings.
 * Tient aussi `data-ui="v2"` sur <html> à jour (typo Geist scopée dans
 * globals.css) — le script inline du layout le pose déjà avant le premier rendu.
 */
export function useUiV2(): boolean {
  const { settings } = useTenant();
  // undefined = stockage pas encore lu (premier rendu)
  const [stored, setStored] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture post-montage volontaire (SSR identique)
    setStored(readStoredUiV2());
  }, []);

  const on = resolveUiV2(settings.ui_v2, stored ?? null);

  useEffect(() => {
    if (stored === undefined) return;
    const root = document.documentElement;
    if (on) root.dataset.ui = "v2";
    else if (root.dataset.ui === "v2") delete root.dataset.ui;
  }, [on, stored]);

  return on;
}
