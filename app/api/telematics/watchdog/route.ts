import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { surveiller } from "@/lib/telematics/watchdog";

/**
 * Surveillance des boîtiers : alerte quand un traceur se tait, et prévient
 * quand il revient.
 *
 * Né d'une panne réelle : la passerelle est restée hors service douze heures
 * sans que personne ne le sache. L'écran le disait, mais personne ne regarde
 * un écran la nuit. Un flux GPS coupé, c'est une flotte qu'on ne suit plus et
 * des kilomètres perdus pour toujours — ils ne se rattrapent pas après coup.
 *
 *   GET  (cron)  → seuil par défaut
 *   POST         → { "heures": 3 }
 *
 * Une seule alerte par épisode de silence : un boîtier muet trois jours ne
 * doit pas envoyer trois cents notifications, sinon plus personne ne les lit.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorise(req: NextRequest): boolean {
  const fourni = req.headers.get("x-telematics-key")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  for (const ref of [process.env.TELEMATICS_INGEST_KEY, process.env.CRON_SECRET]) {
    if (!ref) continue;
    const a = Buffer.from(fourni);
    const b = Buffer.from(ref);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!autorise(req)) return Response.json({ error: "non autorisé" }, { status: 401 });
  try {
    return Response.json(await surveiller(3));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!autorise(req)) return Response.json({ error: "non autorisé" }, { status: 401 });
  let heures = 3;
  try {
    const t = await req.text();
    if (t) heures = Math.min(Math.max(Number(JSON.parse(t).heures) || 3, 1), 72);
  } catch { /* corps facultatif */ }
  try {
    return Response.json(await surveiller(heures));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
  }
}
