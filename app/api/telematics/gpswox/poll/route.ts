import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { synchroniserGpswox } from "@/lib/telematics/gpswoxSync";

/**
 * Relève planifiée des plateformes GPSwox connectées.
 *
 * Chaque appel lit la dernière position de chaque boîtier : la finesse des
 * trajets dépend donc de la cadence d'appel (une fois par minute visée — voir
 * docs/TELEMATICS/04-LECTURE-API-GPSWOX.md). Rejouable sans risque : une
 * position déjà connue n'est pas réécrite.
 *
 * Authentification : `x-telematics-key`, ou `Authorization: Bearer <CRON_SECRET>`.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "fleet" } },
  );

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

async function relever(req: NextRequest) {
  if (!autorise(req)) return Response.json({ error: "non autorisé" }, { status: 401 });
  try {
    const sources = await synchroniserGpswox(db());
    return Response.json({ sources });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
  }
}

export const GET = relever;
export const POST = relever;
