import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { entryPathFor, LOGIN_PATH } from "@/lib/auth/entry";

export const dynamic = "force-dynamic";

/**
 * Ouverture de l'app installée (manifest start_url, et vitrine ouverte en mode
 * standalone) : session valide → espace du rôle (/admin, /driver), sinon →
 * connexion. Redirection relative à l'hôte de la requête : un sous-domaine
 * client reste sur son sous-domaine (branding tenant).
 */
export async function GET(request: NextRequest) {
  let path = LOGIN_PATH;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // select("*") : tolère l'absence de `active` (avant migration 029), comme le middleware
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      path = entryPathFor(profile);
    }
  } catch {
    // Supabase indisponible : la page de connexion reste la destination sûre
  }
  const res = NextResponse.redirect(new URL(path, request.url), 307);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
