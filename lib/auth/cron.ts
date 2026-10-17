import { timingSafeEqual } from "node:crypto";

/**
 * Vrai si la requête porte `Authorization: Bearer <CRON_SECRET>`. Comparaison en temps constant
 * (audit du 18/10/2026, F1), comme `app/api/conteneur/gps/route.ts` ; un secret absent ferme la route.
 */
export function cronAutorise(req: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const recu = (req.headers.get("authorization") ?? "").trim();
  if (!secret || !recu) return false;
  const a = Buffer.from(recu);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
