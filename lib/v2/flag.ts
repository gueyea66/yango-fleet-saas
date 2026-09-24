/**
 * Drapeau de la refonte UI v2 (migration 062 : tenant_settings.ui_v2).
 *
 * Actif si le tenant l'a activé en base, ou si l'appareil l'a forcé pour la QA
 * (console : localStorage.setItem("m3a-ui", "v2")). Sinon l'UI actuelle
 * s'affiche à l'identique.
 */
export const UI_V2_STORAGE_KEY = "m3a-ui";
export const UI_V2_STORAGE_VALUE = "v2";

export function resolveUiV2(tenantFlag: boolean | null | undefined, stored: string | null | undefined): boolean {
  return tenantFlag === true || stored === UI_V2_STORAGE_VALUE;
}

/** Lecture sûre du forçage local (SSR, navigation privée, stockage bloqué). */
export function readStoredUiV2(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(UI_V2_STORAGE_KEY);
  } catch {
    return null;
  }
}
