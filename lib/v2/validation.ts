/**
 * Contrôles d'affichage du panneau « À valider » v2 (lecture seule).
 */
import { REVIEW_CONFIDENCE } from "./driver";

/** Km déclarés sur la journée = compteur du rapport − compteur du rapport validé précédent. */
export function kmDeclared(endOdometer: number | null | undefined, prevOdometer: number | null | undefined): number | null {
  if (endOdometer == null || prevOdometer == null) return null;
  if (!Number.isFinite(endOdometer) || !Number.isFinite(prevOdometer) || endOdometer < prevOdometer) return null;
  return endOdometer - prevOdometer;
}

export const GPS_GAP_ALERT_PCT = 15;

/**
 * Écart km déclarés vs GPS, avec la même règle d'exploitabilité que
 * v_telematics_reconciliation : journée GPS couverte (≥ 80 %, ≥ 100 points)
 * et delta déclaré portant sur un seul jour. Sinon on montre les deux
 * chiffres, jamais leur différence.
 */
export function gpsGap(input: {
  kmDecl: number | null;
  kmGps: number | null;
  coverage?: number | null;
  points?: number | null;
  daysCovered?: number | null;
}): { pct: number | null; exploitable: boolean; alert: boolean } {
  const { kmDecl, kmGps, coverage, points, daysCovered } = input;
  const exploitable = kmDecl != null && kmGps != null && kmDecl > 0 && (coverage ?? 0) >= 0.8 && (points ?? 0) >= 100 && daysCovered === 1;
  if (!exploitable) return { pct: null, exploitable: false, alert: false };
  const pct = (100 * ((kmGps as number) - (kmDecl as number))) / (kmDecl as number);
  return { pct, exploitable: true, alert: Math.abs(pct) > GPS_GAP_ALERT_PCT };
}

/** Jours entre deux dates AAAA-MM-JJ (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Confiance d'une extraction : plus faible score et champs sous le seuil. */
export function extractionConfidence(conf: Record<string, number | null | undefined> | null | undefined): { min: number | null; low: string[] } {
  if (!conf) return { min: null, low: [] };
  const entries = Object.entries(conf).filter(([, v]) => typeof v === "number") as [string, number][];
  if (entries.length === 0) return { min: null, low: [] };
  return {
    min: Math.min(...entries.map(([, v]) => v)),
    low: entries.filter(([, v]) => v < REVIEW_CONFIDENCE).map(([k]) => k),
  };
}

/**
 * « Valider et suivant » : quand l'élément sélectionné quitte la liste, on
 * prend celui qui occupe désormais sa place (ou le dernier), sinon rien.
 */
export function nextSelection(ids: string[], currentId: string | null, previousIndex: number): string | null {
  if (currentId && ids.includes(currentId)) return currentId;
  if (ids.length === 0) return null;
  return ids[Math.min(Math.max(previousIndex, 0), ids.length - 1)];
}

/** Tag « NOUVEAU » : soumis il y a moins d'une heure. */
export function isNew(createdAt: string | null | undefined, now: Date, minutes = 60): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now.getTime() - t >= 0 && now.getTime() - t < minutes * 60_000;
}
