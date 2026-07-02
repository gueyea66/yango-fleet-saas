import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";

const serviceClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/* ── PATCH — admin confirme que les données sont correctes ── */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { tenantId } = await requireAdminAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const notes: string = body.notes ?? "";

    // Vérifier que le batch appartient au tenant et est en pending_admin_review
    const { data: batch, error: fetchErr } = await serviceClient
      .schema("fleet")
      .from("import_batches")
      .select("id, status, tenant_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (fetchErr || !batch) {
      return NextResponse.json({ error: "Import introuvable" }, { status: 404 });
    }
    if (batch.status !== "pending_admin_review") {
      return NextResponse.json({ error: `Impossible de confirmer un import au statut "${batch.status}"` }, { status: 409 });
    }

    const { error: updateErr } = await serviceClient
      .schema("fleet")
      .from("import_batches")
      .update({
        status: "admin_confirmed",
        admin_notes: notes,
        admin_confirmed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateErr) throw updateErr;

    // Le superadmin voit les imports "admin_confirmed" dans son dashboard (pas de
    // notification push : le superadmin n'a pas de profil destinataire)
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

/* ── DELETE — admin annule un import en attente ── */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { tenantId } = await requireAdminAuth();
    const { id } = await params;

    const { data: batch } = await serviceClient
      .schema("fleet")
      .from("import_batches")
      .select("id, status, tenant_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();

    if (!batch) return NextResponse.json({ error: "Import introuvable" }, { status: 404 });
    if (batch.status === "injected") {
      return NextResponse.json({ error: "Impossible de supprimer un import déjà injecté" }, { status: 409 });
    }

    await serviceClient.schema("fleet").from("import_batches").delete().eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
