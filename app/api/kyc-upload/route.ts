import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyAuth } from "@/lib/auth/server";

// HEIC/HEIF ajoutés le 26/09 : c'est le format par défaut de nombreux
// téléphones, et une photo de reçu prise avec l'appareil natif était refusée
// sans que le chauffeur comprenne pourquoi. Mieux vaut stocker la preuve dans
// un format que tous les navigateurs n'affichent pas que ne pas l'avoir.
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = "kyc-documents";
const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
};

// Service role — bypasses storage RLS
const adminStorage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Construit un chemin de stockage sûr (fix audit V8).
//  - Isolation tenant : le chemin commence TOUJOURS par le tenantId.
//  - Isolation intra-tenant pour les chauffeurs : on force `tenantId/<userId>/…`,
//    quel que soit le chemin envoyé par le client. Un chauffeur ne peut donc
//    plus écrire (ni écraser) le document d'un collègue.
//  - Les admins restent libres dans leur tenant (ils gèrent les KYC de leurs
//    chauffeurs), mais jamais hors de leur tenant.
function sanitizePath(rawPath: string, tenantId: string, opts: { role: string; userId: string; type: string }): string | null {
  const normalized = rawPath.replace(/\\/g, "/").replace(/\.{2,}/g, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  // Le 1er segment fourni par le client (propriétaire ou catégorie) n'est pas
  // fiable : on le remplace par un préfixe dérivé de l'identité authentifiée.
  const rest = segments.slice(1);
  const prefix = opts.role === "admin" ? [tenantId] : [tenantId, opts.userId];
  const finalSegments = [...prefix, ...rest];

  const safe = finalSegments.every(s => /^[\w.\-]+$/.test(s));
  if (!safe) return null;

  // Audit du 18/10/2026 (F4) : le nom du fichier est fixé ici, unique, avec l'extension du type
  // réellement lu. Un envoi ne peut donc jamais écraser une pièce existante (déjà validée).
  const dernier = finalSegments.pop()!;
  const radical = dernier.replace(/\.[^.]*$/, "").slice(0, 80) || "piece";
  finalSegments.push(`${radical}_${randomUUID().slice(0, 8)}.${EXTENSION[opts.type] ?? "bin"}`);
  return finalSegments.join("/");
}

export async function POST(req: NextRequest) {
  try {
    // Vérifie que l'utilisateur est authentifié (admin ou driver)
    const { tenantId, userId, role } = await requireAnyAuth();

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
    // Audit du 18/10/2026 (F4) : un type non reconnu dans les octets est refusé, jamais repris du navigateur.
    const detectedType = detectMimeType(buffer);
    if (!detectedType || !ALLOWED_MIME_TYPES.includes(detectedType)) {
      return NextResponse.json(
        { error: "Type de fichier non autorisé. Formats acceptés : PDF, JPEG, PNG, WebP, HEIC" },
        { status: 400 }
      );
    }

    // Validation de la taille
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      const mo = (buffer.byteLength / 1024 / 1024).toFixed(1);
      return NextResponse.json({ error: `Fichier de ${mo} Mo, maximum 10 Mo` }, { status: 400 });
    }

    // Sanitisation du path — isolation tenant + intra-tenant (chauffeur)
    const safePath = sanitizePath(rawPath, tenantId, { role, userId, type: detectedType });
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
        upsert: false,
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
function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

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

  // HEIC / HEIF : boîte ISO-BMFF « ftyp » à l'offset 4, marque à l'offset 8.
  if (buffer.length >= 12 &&
      buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    const marque = buffer.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "heim", "heis"].includes(marque)) return "image/heic";
    if (["mif1", "msf1"].includes(marque)) return "image/heif";
  }

  return null;
}
