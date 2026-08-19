import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getClientIp, rateLimitOk } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

// Garde-fou mémoire en complément du rate-limit persistant (voir /api/register).
const rateMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

interface LeadBody {
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  fleetSize?: string;
  message?: string;
}

/**
 * POST /api/public/leads
 * Formulaire de contact de la landing page publique — capture un prospect.
 * Rate-limité (5/h/IP). Aucune authentification requise (page publique).
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const persistOk = await rateLimitOk("leads", ip, 5, 3_600);
  if (!persistOk || !checkRateLimit(ip)) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez plus tard." }, { status: 429 });
  }

  let body: LeadBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const name = body.name?.trim().slice(0, 120);
  const phone = body.phone?.trim().slice(0, 40);
  const email = body.email?.trim().slice(0, 160);

  if (!name) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (!phone && !email) {
    return NextResponse.json({ error: "Téléphone ou email requis" }, { status: 400 });
  }

  const { error } = await adminClient.from("leads").insert({
    name,
    company: body.company?.trim().slice(0, 160) || null,
    phone: phone || null,
    email: email || null,
    fleet_size: body.fleetSize?.trim().slice(0, 40) || null,
    message: body.message?.trim().slice(0, 2000) || null,
    source: "landing_m3afleet",
    ip,
  });

  if (error) {
    return NextResponse.json({ error: "Échec de l'enregistrement" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
