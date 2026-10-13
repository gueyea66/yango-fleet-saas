import type { SupabaseClient } from "@supabase/supabase-js";
import { listerBoitiers } from "./gpswox";
import { toPositionRow } from "./traccar";

/**
 * Relève des plateformes GPSwox connectées : une lecture par compte, la
 * dernière position de chaque boîtier enrôlé rejoint `telematics_positions`.
 *
 * Mêmes garanties que l'ingestion Traccar :
 *   - un boîtier non enrôlé est ignoré — rien n'entre tant que le gestionnaire
 *     ne l'a pas déclaré ;
 *   - l'unicité (device_id, recorded_at) rend la relève rejouable : un boîtier
 *     à l'arrêt, relu dix fois, ne crée qu'une ligne.
 *
 * Une différence, voulue : le boîtier n'est cherché QUE dans l'organisation
 * qui a connecté le compte. Un compte GPSwox ne peut donc jamais écrire dans
 * le parc d'un autre client, même s'il liste un IMEI enrôlé ailleurs.
 */

export interface BilanSource {
  tenantId: string;
  lus: number;
  inseres: number;
  nonEnroles: number;
  sansPosition: number;
  erreur: string | null;
}

interface Source { id: string; tenant_id: string; base_url: string; api_hash: string }

export async function synchroniserGpswox(
  db: SupabaseClient<any, any, any>,
  opts: { tenantId?: string } = {},
): Promise<BilanSource[]> {
  let requete = db.from("telematics_sources")
    .select("id, tenant_id, base_url, api_hash")
    .eq("kind", "gpswox").eq("active", true).not("api_hash", "is", null);
  if (opts.tenantId) requete = requete.eq("tenant_id", opts.tenantId);

  const { data: sources, error } = await requete;
  if (error) throw new Error(error.message);

  // Une plateforme en panne ne doit pas priver les autres clients de leur relève.
  return Promise.all(((sources ?? []) as Source[]).map((s) => releverSource(db, s)));
}

async function releverSource(db: SupabaseClient<any, any, any>, source: Source): Promise<BilanSource> {
  const bilan: BilanSource = {
    tenantId: source.tenant_id, lus: 0, inseres: 0, nonEnroles: 0, sansPosition: 0, erreur: null,
  };
  const maintenant = new Date().toISOString();

  try {
    const boitiers = await listerBoitiers(source.base_url, source.api_hash);
    bilan.lus = boitiers.length;

    const imeis = [...new Set(boitiers.map((b) => b.imei).filter((i): i is string => Boolean(i)))];
    const { data: enroles, error } = imeis.length
      ? await db.from("telematics_devices")
          .select("id, external_id, last_seen_at")
          .eq("tenant_id", source.tenant_id).eq("active", true).in("external_id", imeis)
      : { data: [], error: null };
    if (error) throw new Error(error.message);

    const parImei = new Map((enroles ?? []).map((d) => [d.external_id as string, d]));
    const lignes = [];
    const vus = new Map<string, string>();

    for (const b of boitiers) {
      const device = b.imei ? parImei.get(b.imei) : undefined;
      if (!device) { bilan.nonEnroles++; continue; }
      if (!b.position.ok) { bilan.sansPosition++; continue; }
      lignes.push(toPositionRow(device.id, b.position.position));
      // « Vu » = dernier signal reçu par la plateforme d'origine, pas l'heure de
      // notre relève : sinon un boîtier débranché paraîtrait vivant tant qu'on le relit.
      if (b.vuLe && (!device.last_seen_at || Date.parse(b.vuLe) > Date.parse(device.last_seen_at))) {
        vus.set(device.id, b.vuLe);
      }
    }

    if (lignes.length) {
      const { data: inseres, error: insErr } = await db.from("telematics_positions")
        .upsert(lignes, { onConflict: "device_id,recorded_at", ignoreDuplicates: true })
        .select("id");
      if (insErr) throw new Error(insErr.message);
      bilan.inseres = inseres?.length ?? 0;
    }

    await Promise.all([...vus].map(([id, vuLe]) =>
      db.from("telematics_devices").update({ last_seen_at: vuLe }).eq("id", id)));

    await db.from("telematics_sources")
      .update({ last_polled_at: maintenant, last_ok_at: maintenant, last_error: null })
      .eq("id", source.id);
  } catch (e) {
    bilan.erreur = e instanceof Error ? e.message : "erreur inconnue";
    await db.from("telematics_sources")
      .update({ last_polled_at: maintenant, last_error: bilan.erreur.slice(0, 300) })
      .eq("id", source.id);
  }
  return bilan;
}
