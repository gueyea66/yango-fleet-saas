import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import {
  connecter, listerBoitiers, normaliserAdresse, suggererVehicule, GpswoxError,
} from "@/lib/telematics/gpswox";
import { synchroniserGpswox } from "@/lib/telematics/gpswoxSync";

/**
 * Connexion du compte GPSwox d'une organisation, par son gestionnaire.
 *
 *   GET   état de la connexion
 *   POST  { action: "connect", baseUrl, email, password }
 *         { action: "list" }                      boîtiers vus par la plateforme
 *         { action: "enroll", items: [{ imei, vehicleId }] }
 *         { action: "sync" }                      relève immédiate
 *         { action: "disconnect" }
 *
 * Le tenant vient TOUJOURS du compte connecté, jamais de la requête.
 * Le mot de passe GPSwox n'est ni stocké ni journalisé ; la clé d'API qu'il
 * permet d'obtenir ne quitte jamais le serveur.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

type Fail = Error & { status: number };
const fail = (status: number, message: string): never => {
  const e = new Error(message) as Fail;
  e.status = status;
  throw e;
};

const reponseErreur = (err: unknown) => {
  if (err instanceof GpswoxError) {
    return Response.json({ error: err.message }, { status: err.code === "injoignable" ? 502 : 400 });
  }
  const e = err as Fail;
  return Response.json({ error: e.message }, { status: e.status ?? 500 });
};

const SOURCE_COLUMNS = "id, base_url, account, api_hash, active, last_polled_at, last_ok_at, last_error";

async function lireSource(tenantId: string) {
  const { data, error } = await admin.from("telematics_sources")
    .select(SOURCE_COLUMNS).eq("tenant_id", tenantId).eq("kind", "gpswox").maybeSingle();
  // Table absente = migration 086 pas encore appliquée : l'écran masque le bloc.
  if (error) return { disponible: false as const, source: null };
  return { disponible: true as const, source: data as Record<string, any> | null };
}

function etat(source: Record<string, any> | null) {
  const connecte = Boolean(source?.active && source?.api_hash);
  return {
    connecte,
    serveur: source?.base_url ?? null,
    compte: source?.account ?? null,
    nonChiffre: Boolean(source?.base_url?.startsWith("http://")),
    derniereReleve: source?.last_ok_at ?? null,
    erreur: connecte ? source?.last_error ?? null : null,
  };
}

async function sourceConnectee(tenantId: string) {
  const { source } = await lireSource(tenantId);
  if (!source?.active || !source.api_hash) fail(409, "Aucune plateforme GPS connectée.");
  return source as { base_url: string; api_hash: string };
}

/** Boîtiers de la plateforme, avec ce que M3A en sait déjà. */
async function inventaire(tenantId: string) {
  const source = await sourceConnectee(tenantId);
  const boitiers = await listerBoitiers(source.base_url, source.api_hash);

  const imeis = boitiers.map((b) => b.imei).filter((i): i is string => Boolean(i));
  const [{ data: vehicules }, { data: connus }] = await Promise.all([
    admin.from("vehicles").select("id, plate").eq("tenant_id", tenantId).order("plate"),
    imeis.length
      ? admin.from("telematics_devices").select("external_id, tenant_id").in("external_id", imeis)
      : Promise.resolve({ data: [] as { external_id: string; tenant_id: string }[] }),
  ]);

  const parc = (vehicules ?? []).map((v) => ({ id: v.id as string, plate: String(v.plate ?? "").trim() }));
  const statut = new Map((connus ?? []).map((d) => [d.external_id, d.tenant_id === tenantId ? "enrole" : "ailleurs"]));

  return boitiers.map((b) => ({
    imei: b.imei,
    nom: b.nom,
    plaque: b.plaque,
    vuLe: b.vuLe,
    // Ne jamais révéler à quelle organisation appartient un boîtier.
    statut: !b.imei ? "illisible" : statut.get(b.imei) ?? "nouveau",
    vehiculePropose: b.imei && !statut.has(b.imei) ? suggererVehicule(b, parc) : null,
    protocole: b.protocole,
  }));
}

export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const { disponible, source } = await lireSource(tenantId);
    return Response.json({ disponible, ...etat(source) });
  } catch (err) {
    return reponseErreur(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const body = await req.json().catch(() => fail(400, "Requête illisible."));

    switch (body.action) {
      case "connect": {
        const email = String(body.email ?? "").trim();
        const password = String(body.password ?? "");
        if (!email || !password) fail(400, "Identifiant et mot de passe requis.");
        const baseUrl = normaliserAdresse(String(body.baseUrl ?? ""));
        const cle = await connecter(baseUrl, email, password);

        const { error } = await admin.from("telematics_sources").upsert({
          tenant_id: tenantId, kind: "gpswox", base_url: baseUrl, account: email.slice(0, 120),
          api_hash: cle, active: true, last_error: null,
        }, { onConflict: "tenant_id,kind" });
        if (error) fail(500, error.message);

        const { source } = await lireSource(tenantId);
        return Response.json({ ...etat(source), boitiers: await inventaire(tenantId) });
      }

      case "list":
        return Response.json({ boitiers: await inventaire(tenantId) });

      case "enroll": {
        const demandes: { imei: string; vehicleId: string | null }[] = (Array.isArray(body.items) ? body.items : [])
          .map((i: any) => ({ imei: String(i?.imei ?? ""), vehicleId: i?.vehicleId ? String(i.vehicleId) : null }));
        if (!demandes.length) fail(400, "Aucun boîtier sélectionné.");

        const vehicules = demandes.map((d) => d.vehicleId).filter((v): v is string => Boolean(v));
        if (new Set(vehicules).size !== vehicules.length) {
          fail(400, "Un même véhicule est rattaché à deux boîtiers.");
        }
        if (vehicules.length) {
          const { data: miens } = await admin.from("vehicles").select("id")
            .eq("tenant_id", tenantId).in("id", vehicules);
          if ((miens ?? []).length !== vehicules.length) fail(400, "Un véhicule n'appartient pas à votre flotte.");
        }

        // On n'enrôle que ce que la plateforme connectée liste réellement :
        // l'IMEI n'est pas cru sur la seule foi de la requête.
        const nouveaux = new Map((await inventaire(tenantId))
          .filter((b) => b.statut === "nouveau").map((b) => [b.imei as string, b]));
        const lignes = demandes.filter((d) => nouveaux.has(d.imei)).map((d) => {
          const b = nouveaux.get(d.imei)!;
          return {
            tenant_id: tenantId,
            vehicle_id: d.vehicleId,
            vendor: "gpswox",
            external_id: d.imei,
            protocol: b.protocole ?? "gpswox",
            label: (b.nom ?? b.plaque ?? "").slice(0, 80) || null,
            active: true,
          };
        });
        if (!lignes.length) fail(409, "Ces boîtiers sont déjà enrôlés ou absents de la plateforme.");

        const { error } = await admin.from("telematics_devices").insert(lignes);
        if (error) fail(500, error.message);

        const [bilan] = await synchroniserGpswox(admin, { tenantId });
        return Response.json({ enroles: lignes.length, releve: bilan ?? null });
      }

      case "sync": {
        await sourceConnectee(tenantId);
        const [bilan] = await synchroniserGpswox(admin, { tenantId });
        if (bilan?.erreur) fail(502, bilan.erreur);
        return Response.json({ releve: bilan ?? null });
      }

      case "disconnect": {
        // La clé est effacée ; boîtiers et positions déjà reçues restent en place.
        const { error } = await admin.from("telematics_sources")
          .update({ api_hash: null, active: false, last_error: null })
          .eq("tenant_id", tenantId).eq("kind", "gpswox");
        if (error) fail(500, error.message);
        return Response.json({ connecte: false });
      }

      default:
        return fail(400, "Action inconnue.");
    }
  } catch (err) {
    return reponseErreur(err);
  }
}
