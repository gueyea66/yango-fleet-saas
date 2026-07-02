import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyAuth } from "@/lib/auth/server";
import { sendNotification, getTenantAdminId, NotifType } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

const NOTIF_META: Record<string, { title: string; body: (d: any) => string; url: string; recipient: "admin" | "driver" }> = {
  report_submitted:  { title: "📋 Nouveau rapport",     body: (d) => `${d.driverName} a soumis son rapport du ${d.date}`,       url: "/admin",          recipient: "admin" },
  report_approved:   { title: "✅ Rapport validé",       body: (d) => `Votre rapport du ${d.date} a été approuvé`,               url: "/driver",         recipient: "driver" },
  report_rejected:   { title: "❌ Rapport rejeté",       body: (d) => `Votre rapport du ${d.date} a été rejeté`,                 url: "/driver",         recipient: "driver" },
  advance_requested: { title: "💰 Demande d'avance",    body: (d) => `${d.driverName} demande une avance de ${d.amount} FCFA`,  url: "/admin",          recipient: "admin" },
  advance_approved:  { title: "✅ Avance approuvée",     body: (d) => `Votre demande d'avance de ${d.amount} FCFA est acceptée`, url: "/driver",         recipient: "driver" },
  advance_rejected:  { title: "❌ Avance refusée",       body: (d) => `Votre demande d'avance a été refusée`,                   url: "/driver",         recipient: "driver" },
  plan_expiring:     { title: "⚠️ Abonnement bientôt expiré", body: (d) => `Votre abonnement expire dans ${d.days} jours`,      url: "/admin/billing",  recipient: "admin" },
};

export async function POST(req: NextRequest) {
  try {
    // Auth requise — le tenantId vient de la session, jamais du client
    const { tenantId } = await requireAnyAuth();

    const { type, driverId, data } = await req.json();
    if (!type) return NextResponse.json({ error: "type requis" }, { status: 400 });

    const meta = NOTIF_META[type as string];
    if (!meta) return NextResponse.json({ error: "type inconnu" }, { status: 400 });

    let recipientId: string | null = null;

    if (meta.recipient === "admin") {
      recipientId = await getTenantAdminId(tenantId);
    } else if (meta.recipient === "driver" && driverId) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("driver_id", driverId)
        .eq("role", "driver")
        .limit(1)
        .single();
      recipientId = profile?.id ?? null;
    }

    if (!recipientId) return NextResponse.json({ ok: true, skipped: "no recipient" });

    const body = meta.body(data ?? {});
    await sendNotification(tenantId, recipientId, type as NotifType, meta.title, body, { url: meta.url, ...data });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
