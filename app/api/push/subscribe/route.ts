import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

/**
 * Audit du 18/10/2026 (F5) : le serveur poste ensuite vers cette adresse. On n'accepte que les
 * services de push des navigateurs (Chrome/Edge, Firefox, Safari, Windows), en https : sinon un
 * compte pourrait faire appeler par le serveur une adresse de son choix (SSRF aveugle).
 */
const HOTES_PUSH = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
function endpointPushConnu(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && HOTES_PUSH.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, tenantId } = await requireAnyAuth();
    const { endpoint, keys } = await req.json();

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Subscription invalide" }, { status: 400 });
    }
    if (!endpointPushConnu(endpoint)) {
      return NextResponse.json({ error: "Service de notification non reconnu" }, { status: 400 });
    }

    const { error } = await admin.from("push_subscriptions").upsert(
      { tenant_id: tenantId, user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: "user_id,endpoint" }
    );
    if (error) {
      console.error("[push/subscribe] upsert failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAnyAuth();
    const { endpoint } = await req.json();
    await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
