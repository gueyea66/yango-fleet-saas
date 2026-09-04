import { NextResponse } from "next/server";
import { requireAnyAuth } from "@/lib/auth/server";
import { sendNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * Push de test vers SOI-MÊME (bouton 📳 de la cloche) : feedback immédiat sur
 * l'état réel de la chaîne push de l'appareil — la notification reçue EST la
 * preuve. Purge au passage les souscriptions mortes de l'utilisateur.
 */
export async function POST() {
  try {
    const { tenantId, userId } = await requireAnyAuth();
    const stats = await sendNotification(
      tenantId, userId, "push_test",
      "🔔 Test de notification",
      "Les alertes push fonctionnent sur cet appareil.",
      { url: "/admin" }
    );
    return NextResponse.json({ ok: true, sent: stats?.sent ?? 0, purged: stats?.purged ?? 0 });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
