import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service role — bypasses storage RLS
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const path = formData.get("path") as string | null;

    if (!file || !path) {
      return NextResponse.json({ error: "file et path requis" }, { status: 400 });
    }

    // Ensure bucket exists
    const { data: bucket } = await admin.storage.getBucket("kyc-documents");
    if (!bucket) {
      await admin.storage.createBucket("kyc-documents", {
        public: false,
        fileSizeLimit: 52428800,
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error } = await admin.storage
      .from("kyc-documents")
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: { publicUrl } } = admin.storage.from("kyc-documents").getPublicUrl(path);

    // Signed URL for private access (1h)
    const { data: signed } = await admin.storage
      .from("kyc-documents")
      .createSignedUrl(path, 3600);

    return NextResponse.json({ ok: true, path, publicUrl, signedUrl: signed?.signedUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
