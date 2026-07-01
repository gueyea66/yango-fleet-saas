import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export type NotifType =
  | "report_submitted"
  | "report_approved"
  | "report_rejected"
  | "advance_requested"
  | "advance_approved"
  | "advance_rejected"
  | "plan_expiring"
  | "payment_due";

export async function sendNotification(
  tenantId: string,
  recipientId: string,
  type: NotifType,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
) {
  // Insert in DB
  await admin.from("notifications").insert({ tenant_id: tenantId, recipient_id: recipientId, type, title, body, data });

  // Send web push (best-effort)
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("user_id", recipientId)
    .eq("tenant_id", tenantId);

  if (!subs?.length) return;

  const payload = JSON.stringify({ title, body, url: data.url ?? "/admin", tag: type });

  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ).catch(() => {
        // Remove expired/invalid subscription
        admin.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      })
    )
  );
}

/** Find admin user_id for a given tenant */
export async function getTenantAdminId(tenantId: string): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("role", "admin")
    .limit(1)
    .single();
  return data?.id ?? null;
}
