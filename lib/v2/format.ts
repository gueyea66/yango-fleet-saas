/**
 * Formatage d'affichage de la refonte v2. Pur, sans dépendance à l'Intl du
 * runtime : le séparateur de milliers est une espace insécable (U+00A0), ce qui
 * donne le même rendu sur tous les téléphones (« 412 500 ») et ne coupe jamais
 * un montant en fin de ligne.
 */
const NBSP = " ";

/** 412500 → « 412 500 ». Arrondi à l'unité ; null/NaN → « — ». */
export function formatAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return sign + digits;
}

/** Nombre décimal à la française : 14.2 → « 14,2 ». */
export function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const fixed = Math.abs(value).toFixed(digits);
  const [int, dec] = fixed.split(".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return sign + (dec ? `${grouped},${dec}` : grouped);
}

/** Part d'un montant dans un total, en % (null si le total est nul ou négatif). */
export function sharePct(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return (part / total) * 100;
}

/** 12.345 → « 12,3 % » ; null → « — ». */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatDecimal(value, digits)}${NBSP}%`;
}

/** Initiales pour les avatars : « Moussa Diop » → « MD ». */
export function initials(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Affichage d'une saisie numérique brute (« 41200 », « 12.5 ») groupée à la
 * française (« 41 200 », « 12,5 ») sans changer la valeur stockée.
 */
export function groupInput(raw: string): string {
  if (!raw) return "";
  const [int, dec] = String(raw).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return dec !== undefined ? `${grouped},${dec}` : grouped;
}
