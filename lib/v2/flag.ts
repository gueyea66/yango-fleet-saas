/**
 * Drapeau de la refonte UI v2 (migration 062 : tenant_settings.ui_v2).
 *
 * Actif si le tenant l'a activé en base, ou si l'appareil l'a forcé pour la QA
 * (console : localStorage.setItem("m3a-ui", "v2")). Sinon l'UI actuelle
 * s'affiche à l'identique.
 */
export const UI_V2_STORAGE_KEY = "m3a-ui";
export const UI_V2_STORAGE_VALUE = "v2";
/**
 * Dernier drapeau tenant CONNU sur cet appareil ("1" / "0").
 *
 * Le drapeau en base n'arrive qu'après un aller-retour réseau : sans mémoire,
 * chaque rafraîchissement repartait de « éteint » le temps de la réponse.
 * Cet indice n'est qu'un point de départ — la base reste la source de vérité
 * et réécrit la valeur à chaque chargement.
 */
export const UI_V2_HINT_KEY = "m3a-ui-tenant";

export function resolveUiV2(tenantFlag: boolean | null | undefined, stored: string | null | undefined): boolean {
  return tenantFlag === true || stored === UI_V2_STORAGE_VALUE;
}

/**
 * Drapeau effectif, indice d'appareil compris.
 * `tenantFlag` connu (true/false) → il tranche. Inconnu → l'indice répond à sa
 * place ; le forçage QA reste prioritaire dans tous les cas.
 */
export function resolveUiV2WithHint(
  tenantFlag: boolean | null | undefined,
  stored: string | null | undefined,
  hint: boolean | null | undefined,
): boolean {
  if (stored === UI_V2_STORAGE_VALUE) return true;
  if (typeof tenantFlag === "boolean") return tenantFlag;
  return hint === true;
}

/** Lecture sûre de l'indice d'appareil. `null` = jamais écrit. */
export function readUiV2Hint(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(UI_V2_HINT_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

export function writeUiV2Hint(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UI_V2_HINT_KEY, on ? "1" : "0");
  } catch {
    // stockage bloqué (navigation privée) — l'app reste correcte, sans mémoire
  }
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
