import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";

// Service role client — pas de schema fleet pour le storage
const storageAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    await requireAdminAuth();

    // Créer le bucket s'il n'existe pas
    const { data: existing } = await storageAdmin.storage.getBucket("kyc-documents");

    if (!existing) {
      const { error } = await storageAdmin.storage.createBucket("kyc-documents", {
        public: false,
        fileSizeLimit: 52428800, // 50 MB
        allowedMimeTypes: undefined, // tous les types
      });
      if (error && !error.message.includes("already exists")) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, bucket: "kyc-documents", existed: !!existing });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
