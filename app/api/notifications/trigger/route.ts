import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAnyAuth } from "@/lib/auth/server";
import { sendNotification, sendTelegramToTenant, getTenantAdminIds, NotifType } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

const NOTIF_META: Record<string, { title: string; body: (d: any) => string; url: string; recipient: "admin" | "driver" }> = {
  report_submitted:  { title: "📋 Nouveau rapport",     body: (d) => `${d.driverName} a soumis son rapport du ${d.date}`,       url: "/admin",          recipient: "admin" },
  expense_submitted: { title: "🧾 Nouvelle dépense",     body: (d) => `${d.driverName} a déclaré ${d.amount} FCFA (${d.category})`, url: "/admin",       recipient: "admin" },
  report_approved:   { title: "✅ Rapport validé",       body: (d) => `Votre rapport du ${d.date} a été approuvé`,               url: "/driver",         recipient: "driver" },
  report_rejected:   { title: "❌ Rapport rejeté",       body: (d) => `Votre rapport du ${d.date} a été rejeté`,                 url: "/driver",         recipient: "driver" },
  advance_requested: { title: "💰 Demande d'avance",    body: (d) => `${d.driverName} demande une avance de ${d.amount} FCFA`,  url: "/admin",          recipient: "admin" },
  advance_approved:  { title: "✅ Avance approuvée",     body: (d) => `Votre demande d'avance de ${d.amount} FCFA est acceptée`, url: "/driver",         recipient: "driver" },
  advance_rejected:  { title: "❌ Avance refusée",       body: (d) => `Votre demande d'avance a été refusée`,                   url: "/driver",         recipient: "driver" },
  plan_expiring:     { title: "⚠️ Abonnement bientôt expiré", body: (d) => `Votre abonnement expire dans ${d.days} jours`,      url: "/admin/billing",  recipient: "admin" },
};

// Types qu'un chauffeur a le droit de déclencher (fix audit V7) : uniquement
// ceux qui le concernent lui-même et sont destinés à SON gestionnaire. Tout le
// reste (avance approuvée, rapport validé/rejeté…) est réservé aux admins —
// sinon un chauffeur pouvait forger « votre avance de 900 000 FCFA est acceptée »
// à destination d'un collègue.
const DRIVER_ALLOWED_TYPES = new Set(["report_submitted", "expense_submitted", "advance_requested"]);

export async function POST(req: NextRequest) {
  try {
    // Auth requise — le tenantId vient de la session, jamais du client
    const { tenantId, userId, role } = await requireAnyAuth();

    const { type, driverId, data } = await req.json();
    if (!type) return NextResponse.json({ error: "type requis" }, { status: 400 });

    const meta = NOTIF_META[type as string];
    if (!meta) return NextResponse.json({ error: "type inconnu" }, { status: 400 });

    // Autorisation par rôle : un chauffeur ne peut émettre que des types le
    // concernant, destinés à l'admin. Les types à destinataire "driver" sont
    // strictement réservés aux admins.
    const safeData = { ...(data ?? {}) };
    if (role !== "admin") {
      if (!DRIVER_ALLOWED_TYPES.has(type as string) || meta.recipient !== "admin") {
        return NextResponse.json({ error: "Action non autorisée" }, { status: 403 });
      }
      // Le chauffeur ne peut pas usurper le nom d'un tiers : on force le sien.
      const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
      if (me?.full_name) safeData.driverName = me.full_name;
    }

    // Destinataires : TOUS les admins du tenant (pas seulement le premier).
    let recipientIds: string[] = [];

    if (meta.recipient === "admin") {
      recipientIds = await getTenantAdminIds(tenantId);
    } else if (meta.recipient === "driver" && driverId) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("driver_id", driverId)
        .eq("role", "driver")
        .limit(1)
        .single();
      if (profile?.id) recipientIds = [profile.id];
    }

    if (!recipientIds.length) return NextResponse.json({ ok: true, skipped: "no recipient" });

    const body = meta.body(safeData);
    await Promise.allSettled(recipientIds.map((rid) =>
      sendNotification(tenantId, rid, type as NotifType, meta.title, body, { url: meta.url, ...safeData })));
    // Relais Telegram du tenant — UNE fois par événement admin (canal garanti,
    // indépendant des souscriptions navigateur qui expirent).
    if (meta.recipient === "admin") await sendTelegramToTenant(tenantId, meta.title, body);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
