import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyAuth } from "@/lib/auth/server";
import { assertServiceRoleKey, storageAdmin, BUCKET, describeStorageError } from "@/lib/storage/kyc";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL = 3600; // 1 h
const MAX_BATCH = 50;

/**
 * Délivre des URLs signées pour les fichiers du bucket privé `kyc-documents`.
 *
 * Le navigateur ne peut pas lire ce bucket directement : `getPublicUrl()`
 * renvoie une URL morte (le bucket n'est pas public) et `createSignedUrl()`
 * côté client dépend de policies sur storage.objects qui ne sont pas
 * garanties déployées — d'où les « Access denied » à l'affichage des pièces
 * jointes. On signe donc côté serveur, avec la clé service role.
 *
 * Autorisation : le chemin doit appartenir au tenant de l'appelant. Un
 * chauffeur n'accède qu'à ses propres fichiers.
 */
/** Normalise une exception (les helpers d'auth portent un `status` HTTP). */
function errorResponse(err: unknown): { status: number; message: string } {
  const e = err as { status?: number; message?: string };
  return { status: e?.status ?? 500, message: e?.message ?? "Erreur inattendue" };
}

const dbAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    db: { schema: "fleet" },
  });

async function canRead(
  path: string,
  ctx: { tenantId: string; userId: string; role: string }
): Promise<boolean> {
  if (!path || path.includes("..")) return false;

  // Chemin normalisé (écrit par /api/kyc-upload) : `tenantId/…`,
  // et `tenantId/userId/…` pour les fichiers déposés par un chauffeur.
  if (path.startsWith(`${ctx.tenantId}/`)) {
    if (ctx.role === "admin") return true;
    return path.startsWith(`${ctx.tenantId}/${ctx.userId}/`);
  }

  // Chemins hérités (déposés avant la normalisation) : on autorise si une
  // ligne du tenant référence ce fichier.
  const db = dbAdmin();
  const [kyc, up] = await Promise.all([
    db.from("kyc_documents").select("driver_id, tenant_id").eq("file_path", path).limit(1),
    db.from("uploads").select("driver_id, tenant_id").eq("file_path", path).limit(1),
  ]);
  const row = kyc.data?.[0] ?? up.data?.[0];
  if (!row || row.tenant_id !== ctx.tenantId) return false;
  return ctx.role === "admin" || row.driver_id === ctx.userId;
}

async function sign(path: string): Promise<string | null> {
  const { data } = await storageAdmin().storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

/** GET /api/kyc-file?path=… → { url } */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAnyAuth();
    const keyProblem = assertServiceRoleKey();
    if (keyProblem) return NextResponse.json({ error: keyProblem }, { status: 500 });

    const path = req.nextUrl.searchParams.get("path");
    if (!path) return NextResponse.json({ error: "path requis" }, { status: 400 });
    if (!(await canRead(path, ctx))) {
      return NextResponse.json({ error: "Fichier non accessible" }, { status: 403 });
    }

    const url = await sign(path);
    if (!url) return NextResponse.json({ error: "Fichier introuvable dans le stockage" }, { status: 404 });
    return NextResponse.json({ url });
  } catch (err) {
    const { status, message } = errorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

/** POST /api/kyc-file { paths: [...] } → { urls: { path: url } } */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAnyAuth();
    const keyProblem = assertServiceRoleKey();
    if (keyProblem) return NextResponse.json({ error: keyProblem }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const paths: string[] = Array.isArray(body?.paths) ? body.paths.slice(0, MAX_BATCH) : [];
    if (paths.length === 0) return NextResponse.json({ urls: {} });

    const entries = await Promise.all(
      paths.map(async (p) => {
        if (typeof p !== "string" || !(await canRead(p, ctx))) return null;
        const url = await sign(p);
        return url ? ([p, url] as const) : null;
      })
    );

    const urls: Record<string, string> = {};
    for (const e of entries) if (e) urls[e[0]] = e[1];
    return NextResponse.json({ urls });
  } catch (err) {
    const { status, message } = errorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
