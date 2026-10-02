import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Déconnexion côté serveur. Le bouton « Se déconnecter » ne vidait que le
 * localStorage : le cookie de session Supabase restait, et les routes /api/*
 * (qui s'authentifient par cookie) répondaient encore — risque réel sur un
 * téléphone partagé entre chauffeurs. Ici : révocation locale + suppression
 * des cookies sb-* restants. POST seulement (pas de déconnexion par simple lien).
 */
export async function POST() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // session déjà invalide : on nettoie quand même les cookies
  }
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) res.cookies.set(c.name, "", { maxAge: 0, path: "/" });
  }
  return res;
}
