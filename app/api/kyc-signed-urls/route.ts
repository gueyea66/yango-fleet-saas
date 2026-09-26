/**
 * URLs signées pour les pièces stockées dans `kyc-documents`.
 *
 * Le bucket contenait des pièces d'identité, des permis et des reçus, et il
 * était `public: true` : n'importe qui connaissant l'URL pouvait les ouvrir
 * sans être connecté. Le code prévoyait pourtant des URLs signées — la route
 * d'upload en renvoie une, avec le commentaire « pas de public URL pour des
 * documents KYC privés » — mais six écrans appelaient `getPublicUrl()`, et le
 * bucket avait été créé public pour que ça marche.
 *
 * Cette route est le préalable au passage du bucket en privé : elle signe à la
 * demande, après avoir vérifié que le demandeur a le droit de voir la pièce.
 *
 * L'autorisation se lit en BASE, pas sur le chemin. Le chemin porte bien le
 * tenant depuis `sanitizePath`, mais 95 pièces sur 929 sont antérieures à cette
 * règle et n'ont pas le préfixe : s'appuyer dessus les rendrait illisibles.
 * La ligne `fleet.uploads` fait foi — c'est elle qui porte `tenant_id` et
 * `driver_id`.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyAuth } from "@/lib/auth/server";

const BUCKET = "kyc-documents";
/** 30 minutes : le temps d'ouvrir une pièce, pas de la faire circuler. */
const DUREE_S = 1800;
/** Garde-fou : une page n'affiche jamais des centaines de pièces d'un coup. */
const MAX_PATHS = 100;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { tenantId, userId, role } = await requireAnyAuth();

    const body = await req.json().catch(() => ({}));
    const paths: string[] = Array.isArray(body?.paths)
      ? body.paths.filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
      : [];
    if (paths.length === 0) return NextResponse.json({ urls: {} });
    if (paths.length > MAX_PATHS) {
      return NextResponse.json({ error: `Trop de pièces demandées (max ${MAX_PATHS})` }, { status: 400 });
    }

    const uniques = [...new Set(paths)];

    // Une pièce n'est signée que si une ligne `uploads` du tenant la déclare.
    // Un chemin inventé, ou celui d'un autre tenant, ne remonte simplement pas.
    let q = admin.from("uploads").select("file_path, driver_id")
      .eq("tenant_id", tenantId).in("file_path", uniques);
    // Un chauffeur ne voit que ses propres pièces — même cloisonnement que la
    // migration 069, qui l'a déjà appliqué aux tables de données.
    if (role !== "admin") q = q.eq("driver_id", userId);

    const { data: lignes, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const autorises = [...new Set((lignes ?? []).map((l: { file_path: string }) => l.file_path))];
    if (autorises.length === 0) return NextResponse.json({ urls: {} });

    const { data: signes, error: errSign } = await storage.storage
      .from(BUCKET).createSignedUrls(autorises, DUREE_S);
    if (errSign) return NextResponse.json({ error: errSign.message }, { status: 500 });

    const urls: Record<string, string> = {};
    for (const s of signes ?? []) {
      if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
    }
    return NextResponse.json({ urls });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return NextResponse.json({ error: e.message ?? "Erreur" }, { status: e.status ?? 500 });
  }
}
