import { NextRequest, NextResponse } from "next/server";
import { requireAnyAuth } from "@/lib/auth/server";
import { assertServiceRoleKey, storageAdmin, BUCKET, describeStorageError } from "@/lib/storage/kyc";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Construit un chemin de stockage sûr (fix audit V8).
//  - Isolation tenant : le chemin commence TOUJOURS par le tenantId.
//  - Isolation intra-tenant pour les chauffeurs : on force `tenantId/<userId>/…`,
//    quel que soit le chemin envoyé par le client. Un chauffeur ne peut donc
//    plus écrire (ni écraser) le document d'un collègue.
//  - Les admins restent libres dans leur tenant (ils gèrent les KYC de leurs
//    chauffeurs), mais jamais hors de leur tenant.
//
// ⚠️ Le chemin RENVOYÉ diffère de celui envoyé : le 1er segment client est
// remplacé. L'appelant doit donc persister `path` de la réponse, jamais le
// chemin qu'il a construit — sinon le fichier est bien stocké mais la ligne en
// base pointe dans le vide et le document devient illisible.
function sanitizePath(rawPath: string, tenantId: string, opts: { role: string; userId: string }): string | null {
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

  return finalSegments.join("/");
}

export async function POST(req: NextRequest) {
  try {
    // Vérifie que l'utilisateur est authentifié (admin ou driver)
    const { tenantId, userId, role } = await requireAnyAuth();

    // La route écrit avec la clé service role. Si elle est absente ou si c'est
    // en réalité une clé anon/publishable, le Storage répond « Access denied »
    // sans dire pourquoi : on le diagnostique ici, explicitement.
    const keyProblem = assertServiceRoleKey();
    if (keyProblem) return NextResponse.json({ error: keyProblem }, { status: 500 });

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

    // Sanitisation du path — isolation tenant + intra-tenant (chauffeur)
    const safePath = sanitizePath(rawPath, tenantId, { role, userId });
    if (!safePath) {
      return NextResponse.json({ error: "Chemin de fichier invalide" }, { status: 400 });
    }

    const { error: uploadError } = await storageAdmin().storage
      .from(BUCKET)
      .upload(safePath, buffer, {
        contentType: detectedType,
        upsert: true,
      });

    if (uploadError) {
      // Bucket absent au premier upload : on le crée puis on retente une fois.
      if (/not found|does not exist/i.test(uploadError.message)) {
        const { error: bucketError } = await storageAdmin().storage.createBucket(BUCKET, {
          public: false,
          fileSizeLimit: MAX_FILE_SIZE_BYTES,
          allowedMimeTypes: ALLOWED_MIME_TYPES,
        });
        if (bucketError && !/already exists/i.test(bucketError.message)) {
          const d = describeStorageError(bucketError);
          return NextResponse.json({ error: d.message }, { status: d.status });
        }
        const retry = await storageAdmin().storage
          .from(BUCKET)
          .upload(safePath, buffer, { contentType: detectedType, upsert: true });
        if (retry.error) {
          const d = describeStorageError(retry.error);
          return NextResponse.json({ error: d.message }, { status: d.status });
        }
      } else {
        const d = describeStorageError(uploadError);
        return NextResponse.json({ error: d.message }, { status: d.status });
      }
    }

    // Signed URL uniquement (pas de public URL pour des documents KYC privés)
    const { data: signed } = await storageAdmin().storage
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
