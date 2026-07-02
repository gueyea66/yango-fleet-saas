import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Toutes les lectures/écritures de la console superadmin passent par ici
// (service_role, côté serveur) — la page n'a plus besoin d'accès anon direct,
// ce qui est indispensable depuis l'activation de la RLS (migrations 020/025).
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

async function getStoredKey(): Promise<string> {
  const { data } = await admin.from("superadmin_settings").select("value").eq("key", "access_key").single();
  return data?.value ?? process.env.SUPERADMIN_KEY ?? "";
}

export async function POST(req: NextRequest) {
  let payload: any;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const { superadminKey, op } = payload;
  const storedKey = await getStoredKey();
  if (!checkSuperadminKey(superadminKey ?? "", storedKey, getClientIp(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    switch (op) {
      /* ── Liste des clients enrichie (page → load) ── */
      case "tenants-full": {
        const [{ data: tenants }, { data: profiles }] = await Promise.all([
          admin.from("tenants").select("*, settings:tenant_settings(*), remuneration:remuneration_config(*)").order("created_at", { ascending: false }),
          admin.from("profiles").select("id, email, full_name, tenant_id").eq("role", "admin"),
        ]);
        const byTenant: Record<string, any[]> = {};
        (profiles || []).forEach((p: any) => {
          (byTenant[p.tenant_id] ||= []).push({ id: p.id, email: p.email, full_name: p.full_name });
        });
        const list = (tenants || []).map((t: any) => ({
          ...t,
          settings: Array.isArray(t.settings) ? t.settings[0] : t.settings,
          remuneration: Array.isArray(t.remuneration) ? t.remuneration[0] : t.remuneration,
          admins: byTenant[t.id] || [],
        }));
        return NextResponse.json({ tenants: list });
      }

      /* ── Réglages globaux (page → loadGlobalSettings) ── */
      case "global-settings": {
        const { data } = await admin.from("superadmin_settings").select("key, value");
        // La clé d'accès n'est jamais renvoyée au client
        const rows = (data || []).filter((r: any) => r.key !== "access_key");
        return NextResponse.json({ settings: rows });
      }

      /* ── Sauvegarde d'un réglage (page → saveGlobalSetting) ── */
      case "save-setting": {
        const { key, value } = payload;
        if (!key || key === "access_key") return NextResponse.json({ error: "Clé invalide" }, { status: 400 });
        const { error } = await admin.from("superadmin_settings")
          .upsert({ key, value: String(value ?? ""), updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
      }

      /* ── Création d'un client (page → createTenant) ── */
      case "create-tenant": {
        const f = payload.form ?? {};
        if (!f.slug || !f.name) return NextResponse.json({ error: "Slug et nom requis" }, { status: 400 });

        const slug = String(f.slug).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
        const { data: existing } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
        if (existing) return NextResponse.json({ error: `Le slug "${slug}" est déjà pris` }, { status: 409 });

        const trialDays = parseInt(f.trial_days) || 14;
        const trialEnd = new Date(Date.now() + trialDays * 86400000).toISOString();

        const { data: t, error } = await admin.from("tenants").insert({
          slug, name: f.name, plan: f.plan || "standard", active: true,
          trial_ends_at: trialEnd, notifications_sent: {},
        }).select().single();
        if (error || !t) return NextResponse.json({ error: error?.message || "Création échouée" }, { status: 400 });

        await admin.from("tenant_settings").insert({
          tenant_id: t.id, app_name: f.app_name || f.name,
          primary_color: f.primary_color || "#f5a623", currency: "XOF", timezone: "Africa/Dakar",
        });
        await admin.from("remuneration_config").insert({
          tenant_id: t.id, model: f.model || "fixed",
          base_amount: parseFloat(f.base_amount) || 0, commission_rate: parseFloat(f.commission_rate) || 0,
        });
        return NextResponse.json({ ok: true, slug, trialDays, trialEnd });
      }

      /* ── Données brutes du dashboard (Dashboard.tsx → load) ── */
      case "dashboard": {
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
        const since30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
        const [
          { data: tenants }, { data: profiles }, { data: rMonth }, { data: rAll }, { data: rDaily }, { data: settings },
        ] = await Promise.all([
          admin.from("tenants").select("id,slug,name,plan,active,trial_ends_at,plan_expires_at,created_at"),
          admin.from("profiles").select("id,tenant_id,role"),
          admin.from("daily_reports").select("tenant_id,driver_id,gross_earnings,net_after_expenses").gte("date", monthStart),
          admin.from("daily_reports").select("gross_earnings,net_after_expenses"),
          admin.from("daily_reports").select("date,gross_earnings,net_after_expenses").gte("date", since30).order("date"),
          admin.from("tenant_settings").select("tenant_id,app_name,primary_color"),
        ]);
        return NextResponse.json({ tenants: tenants ?? [], profiles: profiles ?? [], rMonth: rMonth ?? [], rAll: rAll ?? [], rDaily: rDaily ?? [], settings: settings ?? [] });
      }

      default:
        return NextResponse.json({ error: "Opération inconnue" }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
