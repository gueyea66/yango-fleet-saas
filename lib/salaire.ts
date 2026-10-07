/**
 * Part du chauffeur sur le chiffre d'affaires (modèles « % du CA » et « fixe + % »).
 *
 * Règle NMK (Abdou, 07/10/2026, après la formation) : le bonus d'objectif versé
 * par Yango n'est pas partagé au même taux que le reste. Le chauffeur touche
 * 50 % du bonus d'objectif et 20 % de tout le reste :
 *
 *     part = (CA brut − bonus d'objectif) × taux + bonus d'objectif × taux du bonus
 *
 * Sans taux propre au bonus d'objectif (tenant qui ne fait pas la différence),
 * le bonus est partagé au taux général : le résultat est alors brut × taux,
 * comme avant.
 */
export function partSurCA(p: { brut: number; bonusObjectif?: number | null; taux: number; tauxBonusObjectif?: number | null }): number {
  const brut = Number(p.brut) || 0, taux = Number(p.taux) || 0;
  // le bonus d'objectif fait partie du brut : il ne peut ni être négatif ni le dépasser
  const bonus = Math.min(Math.max(0, Number(p.bonusObjectif) || 0), Math.max(0, brut));
  const tauxBonus = p.tauxBonusObjectif == null ? taux : Number(p.tauxBonusObjectif) || 0;
  return (brut - bonus) * taux + bonus * tauxBonus;
}
