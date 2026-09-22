import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { provisionOnboarding, slugify, type OnbDoc } from "@/lib/onboarding";

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
        const [{ data: tenants }, { data: profiles }, { data: addonRow }, { data: premiumRow }] = await Promise.all([
          admin.from("tenants").select("*, settings:tenant_settings(*), remuneration:remuneration_config(*)").order("created_at", { ascending: false }),
          admin.from("profiles").select("id, email, full_name, tenant_id").eq("role", "admin"),
          admin.from("superadmin_settings").select("value").eq("key", "report_addon_tenants").maybeSingle(),
          admin.from("superadmin_settings").select("value").eq("key", "report_premium_tenants").maybeSingle(),
        ]);
        let reportAddonTenants: string[] = [];
        try {
          const v = JSON.parse(addonRow?.value || "[]");
          if (Array.isArray(v)) reportAddonTenants = v;
        } catch { /* liste illisible → vide */ }
        let reportPremiumTenants: string[] = [];
        try {
          const v = JSON.parse(premiumRow?.value || "[]");
          if (Array.isArray(v)) reportPremiumTenants = v;
        } catch { /* liste illisible → vide */ }
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
        return NextResponse.json({ tenants: list, reportAddonTenants, reportPremiumTenants });
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

      /* ── Fiches de mise en service (Onboarding.tsx) ──
         Une fiche prépare un client AVANT qu'il ait un espace : elle vit donc
         ici, dans la console, et non derrière une session de tenant. */
      case "onb-list": {
        const { data, error } = await admin.from("onboarding_files")
          .select("id, nom, tenant_id, provisioned_at, updated_at")
          .order("updated_at", { ascending: false });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ files: data ?? [] });
      }

      case "onb-get": {
        const { id } = payload;
        if (!id) return NextResponse.json({ error: "Fiche non désignée" }, { status: 400 });
        const { data, error } = await admin.from("onboarding_files").select("*").eq("id", id).maybeSingle();
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        if (!data) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
        return NextResponse.json({ file: data });
      }

      case "onb-save": {
        const { id, nom, doc } = payload;
        const key = slugify(id || nom || "");
        if (!key) return NextResponse.json({ error: "Nom de client requis" }, { status: 400 });
        if (!doc || typeof doc !== "object") return NextResponse.json({ error: "Fiche vide" }, { status: 400 });
        const { error } = await admin.from("onboarding_files").upsert({
          id: key,
          nom: String(nom || doc.nom || key),
          doc,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true, id: key });
      }

      /* Supprime la FICHE seule. L'espace client, ses véhicules et ses
         chauffeurs déjà mis en service ne sont jamais touchés ici — la
         suppression d'un client passe par l'onglet Clients, à dessein. */
      case "onb-delete": {
        const { id } = payload;
        if (!id) return NextResponse.json({ error: "Fiche non désignée" }, { status: 400 });
        const { error } = await admin.from("onboarding_files").delete().eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ ok: true });
      }

      /* Verse la fiche dans l'application. Rejouable : voir lib/onboarding.ts. */
      case "onb-provision": {
        const { id } = payload;
        if (!id) return NextResponse.json({ error: "Fiche non désignée" }, { status: 400 });
        const { data: file, error: readError } = await admin.from("onboarding_files")
          .select("*").eq("id", id).maybeSingle();
        if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
        if (!file) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });

        const result = await provisionOnboarding({
          admin,
          fileId: file.id,
          doc: file.doc as OnbDoc,
          tenantId: file.tenant_id ?? null,
          plan: payload.plan,
          trialDays: parseInt(payload.trial_days) || undefined,
        });

        // La fiche garde les identifiants attribués (jamais les mots de passe)
        // et la date de première mise en service : c'est ce qui rend le rejeu
        // sûr la fois suivante.
        const { error: writeError } = await admin.from("onboarding_files").update({
          doc: result.doc,
          tenant_id: result.tenantId,
          provisioned_at: file.provisioned_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", file.id);
        if (writeError) {
          return NextResponse.json({
            ...result,
            ok: false,
            lignes: [...result.lignes, { quoi: "Fiche", etat: "erreur", detail: "Mise en service faite, fiche non mise à jour : " + writeError.message }],
          });
        }
        return NextResponse.json(result);
      }

      /* ── Données brutes du dashboard (Dashboard.tsx → load) ── */
      case "dashboard": {
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
        const since30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
        // Toutes ces lectures sont multi-tenants (agrégées sur TOUTE la base) et
        // dépassent vite le plafond PostgREST de 1000 lignes : sans pagination,
        // les totaux MRR/CA du dashboard étaient silencieusement tronqués.
        // `order` sur une clé stable (`id`) est requis pour paginer sans doublon
        // ni omission ; les sommes côté client sont indépendantes de l'ordre.
        const [tenants, profiles, rMonth, rAll, rDaily, settings] = await Promise.all([
          fetchAllRows(() => admin.from("tenants").select("id,slug,name,plan,active,trial_ends_at,plan_expires_at,created_at").order("id")),
          fetchAllRows(() => admin.from("profiles").select("id,tenant_id,role").order("id")),
          fetchAllRows(() => admin.from("daily_reports").select("tenant_id,driver_id,gross_earnings,net_after_expenses").gte("date", monthStart).order("id")),
          fetchAllRows(() => admin.from("daily_reports").select("gross_earnings,net_after_expenses").order("id")),
          fetchAllRows(() => admin.from("daily_reports").select("date,gross_earnings,net_after_expenses").gte("date", since30).order("date").order("id")),
          fetchAllRows(() => admin.from("tenant_settings").select("tenant_id,app_name,primary_color").order("tenant_id")),
        ]);
        return NextResponse.json({ tenants, profiles, rMonth, rAll, rDaily, settings });
      }

      default:
        return NextResponse.json({ error: "Opération inconnue" }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
