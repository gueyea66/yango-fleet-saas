import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function POST(req: NextRequest) {
  try {
    const { userId, tenantId } = await requireAdminAuth();
    const { endpoint, keys } = await req.json();

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Subscription invalide" }, { status: 400 });
    }

    await admin.from("push_subscriptions").upsert(
      { tenant_id: tenantId, user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: "user_id,endpoint" }
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAdminAuth();
    const { endpoint } = await req.json();
    await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
