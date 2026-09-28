/**
 * Retrait d'un fichier du bucket `kyc-documents`.
 *
 * Existe parce que la suppression côté client ne pouvait pas fonctionner :
 * aucune policy DELETE n'a jamais été posée sur `storage.objects`, et l'appel
 * était enveloppé dans un `.catch(() => {})`. La ligne disparaissait de la
 * base, le fichier restait dans le bucket — et personne ne le voyait.
 *
 * Le fichier n'est retiré que si plus aucune ligne ne le référence. La ligne
 * est supprimée avant l'appel à cette route : si deux enregistrements
 * pointaient vers le même objet, effacer l'objet dès le premier casserait le
 * second.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyAuth } from "@/lib/auth/server";

const BUCKET = "kyc-documents";

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
    const { tenantId, role } = await requireAnyAuth();
    // Réservé au gestionnaire, comme la suppression d'un véhicule : un
    // chauffeur peut ajouter une preuve, jamais en retirer une.
    if (role !== "admin") {
      return NextResponse.json({ error: "Réservé au gestionnaire" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const path: string | undefined = typeof body?.path === "string" ? body.path : undefined;
    if (!path) return NextResponse.json({ error: "path requis" }, { status: 400 });

    // Le chemin doit rester dans le tenant de l'appelant. Vérifié sur les
    // lignes qui le référencent encore, toutes tables confondues : un chemin
    // d'un autre tenant ne peut pas être visé, même en le devinant.
    const [encoreUploads, encoreKyc, ailleurs] = await Promise.all([
      admin.from("uploads").select("id", { count: "exact", head: true }).eq("file_path", path),
      admin.from("kyc_documents").select("id", { count: "exact", head: true }).eq("file_path", path),
      admin.from("uploads").select("id", { count: "exact", head: true })
        .eq("file_path", path).neq("tenant_id", tenantId),
    ]);
    if ((ailleurs.count ?? 0) > 0) {
      return NextResponse.json({ error: "Pièce hors de votre périmètre" }, { status: 403 });
    }
    if ((encoreUploads.count ?? 0) > 0 || (encoreKyc.count ?? 0) > 0) {
      // Encore référencé : on garde l'objet, la ligne restante doit s'ouvrir.
      return NextResponse.json({ ok: true, removed: false });
    }

    const { error } = await storage.storage.from(BUCKET).remove([path]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: true });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return NextResponse.json({ error: e.message ?? "Erreur" }, { status: e.status ?? 500 });
  }
}
