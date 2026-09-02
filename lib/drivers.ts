/**
 * RÈGLE CANONIQUE « chauffeur actif » — source de vérité unique.
 *
 * Un chauffeur est actif à une date donnée si :
 *   - son flag `active` n'est pas explicitement false, ET
 *   - son contrat n'est pas terminé à cette date (contract_end_date), ET
 *   - il n'est pas un compte technique, ET
 *   - il est déjà embauché (hire_date) quand la date de référence l'exige.
 *
 * Retour Abdou 02/09 : la bannière « sans rapport J-1 » relançait un chauffeur
 * dont le contrat était fini — QUATRE moteurs avaient chacun leur logique
 * (brief, recommandations, règles avancées, relance). Tout nouveau code qui
 * filtre des chauffeurs DOIT passer par ici (le pendant côté couche IA est
 * lib/ai/dataReader.ts::isDriverActiveOn, garder les deux alignés).
 */

export interface DriverActivityFields {
  active?: boolean | null;
  account_type?: string | null;
  hire_date?: string | null;
  contract_end_date?: string | null;
}

/** Actif au jour `date` (YYYY-MM-DD). `requireHired` exige hire_date <= date. */
export function isDriverActiveOn(
  d: DriverActivityFields,
  date: string,
  opts: { requireHired?: boolean } = {}
): boolean {
  if (d.account_type === "technical") return false;
  if (d.active === false) return false;
  if (d.contract_end_date && d.contract_end_date < date) return false;
  if (opts.requireHired && d.hire_date && d.hire_date > date) return false;
  return true;
}

/** Actif aujourd'hui (fuseau du serveur/navigateur). */
export function isDriverActiveToday(d: DriverActivityFields): boolean {
  return isDriverActiveOn(d, new Date().toISOString().slice(0, 10));
}
