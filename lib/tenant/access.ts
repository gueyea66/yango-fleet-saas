/**
 * Règle d'accès d'un tenant — SOURCE UNIQUE.
 *
 * Pourquoi ce fichier existe : la même expression
 * `plan_expires_at ?? trial_ends_at` était recopiée dans le middleware, dans
 * l'API (`assertTenantActive`), dans le cron du soir, dans la bannière et dans
 * la console super admin. Cinq copies d'une règle de facturation = cinq
 * occasions de diverger, et un admin qui se retrouve dehors sans que personne
 * sache pourquoi. Tout passe désormais par `tenantAccessState`.
 *
 * La règle, dans l'ordre :
 *   1. `active = false`         → suspendu par le super admin.
 *   2. `never_expires = true`   → accès permanent, aucune échéance (tenant de
 *      l'opérateur, compte interne, partenaire). C'est le SEUL moyen de ne
 *      jamais expirer : plus de « pas de date = accès illimité » implicite.
 *   3. `plan_expires_at` si présent, sinon `trial_ends_at` → échéance.
 *   4. aucune date → pas d'échéance (tenant créé hors des parcours normaux).
 */

export interface TenantAccessRow {
  active?: boolean | null;
  never_expires?: boolean | null;
  trial_ends_at?: string | null;
  plan_expires_at?: string | null;
}

export type LockReason = "inactive" | "expired";

export interface TenantAccessState {
  /** true → l'accès applicatif doit être refusé (page /locked, API 402). */
  locked: boolean;
  reason: LockReason | null;
  /** Échéance qui fait foi, ou null si l'accès n'expire pas. */
  expiresAt: string | null;
  /** Jours restants (négatif = dépassé), null si pas d'échéance. */
  daysLeft: number | null;
}

/** Échéance qui fait foi pour ce tenant, ou null s'il n'en a pas. */
export function accessExpiresAt(t: TenantAccessRow): string | null {
  if (t.never_expires) return null;
  return t.plan_expires_at ?? t.trial_ends_at ?? null;
}

/** État d'accès complet. `now` injectable pour les tests. */
export function tenantAccessState(t: TenantAccessRow, now: number = Date.now()): TenantAccessState {
  if (t.active === false) {
    return { locked: true, reason: "inactive", expiresAt: accessExpiresAt(t), daysLeft: null };
  }

  const expiresAt = accessExpiresAt(t);
  if (!expiresAt) return { locked: false, reason: null, expiresAt: null, daysLeft: null };

  const end = new Date(expiresAt).getTime();
  // Date illisible : on n'enferme personne sur une valeur qu'on ne comprend pas.
  if (!Number.isFinite(end)) return { locked: false, reason: null, expiresAt, daysLeft: null };

  const daysLeft = Math.ceil((end - now) / 86_400_000);
  if (end < now) return { locked: true, reason: "expired", expiresAt, daysLeft };
  return { locked: false, reason: null, expiresAt, daysLeft };
}
