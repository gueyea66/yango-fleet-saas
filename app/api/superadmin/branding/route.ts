import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const BUCKET = "branding";
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

// Storage client — sans schema fleet
const storageAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getStoredKey(): Promise<string> {
  const { data } = await adminClient.from("superadmin_settings").select("value").eq("key", "access_key").single();
  return data?.value ?? process.env.SUPERADMIN_KEY ?? "";
}

/** Détection du type d'image via magic bytes (jamais le type client) */
function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "image/webp";
  return null;
}

async function ensureBucket() {
  const { data: bucket } = await storageAdmin.storage.getBucket(BUCKET);
  if (!bucket) {
    // Public : les logos sont affichés sur la page de login (avant toute auth)
    await storageAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_LOGO_BYTES,
      allowedMimeTypes: Object.keys(ALLOWED_LOGO_TYPES),
    });
  }
}

/**
 * POST — met à jour le branding d'un tenant (superadmin uniquement).
 * multipart/form-data :
 *   superadminKey, tenantId  (requis)
 *   app_name, primary_color, operator_name, currency  (optionnels)
 *   logo (fichier)           — remplace le logo
 *   removeLogo = "1"         — supprime le logo
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const superadminKey = String(formData.get("superadminKey") ?? "");
    const tenantId = String(formData.get("tenantId") ?? "");

    const storedKey = await getStoredKey();
    if (!checkSuperadminKey(superadminKey, storedKey, getClientIp(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!tenantId) return NextResponse.json({ error: "tenantId requis" }, { status: 400 });

    const { data: tenant } = await adminClient.from("tenants").select("id, slug").eq("id", tenantId).single();
    if (!tenant) return NextResponse.json({ error: "Tenant introuvable" }, { status: 404 });

    const patch: Record<string, string | null> = {};

    const appName = formData.get("app_name");
    if (typeof appName === "string" && appName.trim()) patch.app_name = appName.trim().slice(0, 60);

    const primaryColor = formData.get("primary_color");
    if (typeof primaryColor === "string" && primaryColor) {
      if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
        return NextResponse.json({ error: "Couleur invalide (format #RRGGBB)" }, { status: 400 });
      }
      patch.primary_color = primaryColor.toLowerCase();
    }

    const operatorName = formData.get("operator_name");
    if (typeof operatorName === "string") patch.operator_name = operatorName.trim().slice(0, 80) || null;

    const currency = formData.get("currency");
    if (typeof currency === "string" && currency.trim()) patch.currency = currency.trim().toUpperCase().slice(0, 5);

    // ── Logo ──
    const logo = formData.get("logo") as File | null;
    const removeLogo = formData.get("removeLogo") === "1";

    if (logo && logo.size > 0) {
      const buffer = Buffer.from(await logo.arrayBuffer());
      if (buffer.byteLength > MAX_LOGO_BYTES) {
        return NextResponse.json({ error: "Logo trop volumineux (max 2 MB)" }, { status: 400 });
      }
      const mime = detectImageType(buffer);
      if (!mime || !ALLOWED_LOGO_TYPES[mime]) {
        return NextResponse.json({ error: "Format de logo non supporté (PNG, JPEG ou WebP)" }, { status: 400 });
      }

      await ensureBucket();

      // Nom horodaté pour casser le cache CDN au remplacement
      const path = `${tenantId}/logo-${Date.now()}.${ALLOWED_LOGO_TYPES[mime]}`;
      const { error: uploadError } = await storageAdmin.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: mime, upsert: true });
      if (uploadError) {
        return NextResponse.json({ error: uploadError.message }, { status: 500 });
      }

      // Nettoyer les anciens logos du tenant
      const { data: existing } = await storageAdmin.storage.from(BUCKET).list(tenantId);
      const stale = (existing ?? []).map(f => `${tenantId}/${f.name}`).filter(p => !path.endsWith(p.split("/").pop()!) && p !== path);
      if (stale.length) await storageAdmin.storage.from(BUCKET).remove(stale);

      const { data: pub } = storageAdmin.storage.from(BUCKET).getPublicUrl(path);
      patch.logo_url = pub.publicUrl;
    } else if (removeLogo) {
      const { data: existing } = await storageAdmin.storage.from(BUCKET).list(tenantId);
      const paths = (existing ?? []).map(f => `${tenantId}/${f.name}`);
      if (paths.length) await storageAdmin.storage.from(BUCKET).remove(paths);
      patch.logo_url = null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Aucune modification fournie" }, { status: 400 });
    }

    const { error: updateError } = await adminClient
      .from("tenant_settings")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, updated: patch });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
