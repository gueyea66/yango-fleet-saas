"use client";

import { useEffect, useState } from "react";
import { useTenant } from "@/lib/tenant/context";
import { readStoredUiV2, readUiV2Hint, resolveUiV2WithHint, writeUiV2Hint } from "@/lib/v2/flag";

/**
 * Drapeau UI v2 côté client.
 *
 * Premier rendu (SSR + hydratation) toujours à `false` → pas d'écart
 * d'hydratation. Après montage on lit deux choses sur l'appareil : le forçage
 * QA (`m3a-ui=v2`) et le dernier drapeau tenant connu (`m3a-ui-tenant`). Ce
 * second point est ce qui stabilise l'affichage : le drapeau en base n'arrive
 * qu'après un aller-retour réseau, et sans mémoire chaque rafraîchissement
 * repartait de « éteint » en attendant — d'où la bascule entre les deux
 * versions. La base reste la source de vérité : dès qu'elle répond, elle
 * tranche et réécrit l'indice.
 *
 * Tient aussi `data-ui="v2"` sur <html> à jour (typo Geist scopée dans
 * globals.css) — le script inline du layout le pose déjà avant le premier rendu.
 */
export function useUiV2(): boolean {
  const { settings } = useTenant();
  // undefined = appareil pas encore lu (premier rendu)
  const [device, setDevice] = useState<{ stored: string | null; hint: boolean | null } | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture post-montage volontaire (SSR identique)
    setDevice({ stored: readStoredUiV2(), hint: readUiV2Hint() });
  }, []);

  const tenantFlag = settings.ui_v2;
  const on = resolveUiV2WithHint(tenantFlag, device?.stored ?? null, device?.hint ?? null);

  // Drapeau tenant connu → mémorisé pour le prochain chargement.
  useEffect(() => {
    if (typeof tenantFlag === "boolean") writeUiV2Hint(tenantFlag);
  }, [tenantFlag]);

  useEffect(() => {
    if (device === undefined) return;
    const root = document.documentElement;
    if (on) root.dataset.ui = "v2";
    else if (root.dataset.ui === "v2") delete root.dataset.ui;
  }, [on, device]);

  return on;
}
