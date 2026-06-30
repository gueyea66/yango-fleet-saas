import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = "kyc-documents";

// Service role — bypasses storage RLS
const adminStorage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function sanitizePath(rawPath: string, tenantId: string): string | null {
  // Le path doit commencer par le tenantId pour isoler les documents par tenant
  const normalized = rawPath.replace(/\\/g, "/").replace(/\.{2,}/g, "");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length < 2) return null;

  // Forcer que le premier segment soit le tenantId
  segments[0] = tenantId;

  // Vérifier que chaque segment est safe (alphanumérique, tirets, underscores, points)
  const safe = segments.every(s => /^[\w.\-]+$/.test(s));
  if (!safe) return null;

  return segments.join("/");
}

export async function POST(req: NextRequest) {
  try {
    // Vérifie que l'utilisateur est bien un admin authentifié
    const { tenantId } = await requireAdminAuth();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const rawPath = formData.get("path") as string | null;

    if (!file || !rawPath) {
      return NextResponse.json({ error: "file et path requis" }, { status: 400 });
    }

    // Validation du type MIME côté serveur (pas file.type qui vient du client)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Détection simple du type via les magic bytes
    const detectedType = detectMimeType(buffer, file.type);
    if (!ALLOWED_MIME_TYPES.includes(detectedType)) {
      return NextResponse.json(
        { error: `Type de fichier non autorisé (${detectedType}). Formats acceptés : PDF, JPEG, PNG, WebP` },
        { status: 400 }
      );
    }

    // Validation de la taille
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 10 MB)" }, { status: 400 });
    }

    // Sanitisation du path — garantit l'isolation par tenant
    const safePath = sanitizePath(rawPath, tenantId);
    if (!safePath) {
      return NextResponse.json({ error: "Chemin de fichier invalide" }, { status: 400 });
    }

    // Ensure bucket exists
    const { data: bucket } = await adminStorage.storage.getBucket(BUCKET);
    if (!bucket) {
      await adminStorage.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_FILE_SIZE_BYTES,
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      });
    }

    const { error: uploadError } = await adminStorage.storage
      .from(BUCKET)
      .upload(safePath, buffer, {
        contentType: detectedType,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Signed URL uniquement (pas de public URL pour des documents KYC privés)
    const { data: signed } = await adminStorage.storage
      .from(BUCKET)
      .createSignedUrl(safePath, 1800); // 30 minutes

    return NextResponse.json({ ok: true, path: safePath, signedUrl: signed?.signedUrl });
  } catch (err: any) {
    const status = err.status ?? 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}

/** Détection basique du type MIME via magic bytes */
function detectMimeType(buffer: Buffer, fallback: string): string {
  if (buffer.length < 4) return fallback;

  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  // WebP: RIFF....WEBP
  if (buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return "image/webp";
  }

  return fallback;
}
