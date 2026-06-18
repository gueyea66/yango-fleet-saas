"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLAN_LIMITS, type Plan } from "@/lib/plans";

const SUPERADMIN_KEY = process.env.NEXT_PUBLIC_SUPERADMIN_KEY || "m3a-super-2026";

const PLAN_COLORS: Record<string, string> = {
  starter: "#6b7280",
  pro: "#f5a623",
  enterprise: "#8b5cf6",
};

interface AdminUser { id: string; email: string; full_name: string; }
interface Tenant {
  id: string; slug: string; name: string; plan: string; active: boolean; created_at: string;
  settings?: { app_name: string; primary_color: string; logo_url: string | null; operator_name: string | null };
  remuneration?: { model: string; base_amount: number; commission_rate: number };
  admins?: AdminUser[];
}

export default function SuperAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [key, setKey] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New tenant form
  const [form, setForm] = useState({ slug: "", name: "", plan: "starter", primary_color: "#f5a623", app_name: "", model: "fixed", base_amount: "0", commission_rate: "0" });
  // New admin form per tenant
  const [adminForm, setAdminForm] = useState<Record<string, { email: string; password: string }>>({});

  const sb = createClient() as any;

  async function load() {
    setLoading(true);
    const { data: ts } = await sb.from("tenants").select("*, settings:tenant_settings(*), remuneration:remuneration_config(*)").order("created_at");
    const tenantList: Tenant[] = (ts || []).map((t: any) => ({
      ...t,
      settings: Array.isArray(t.settings) ? t.settings[0] : t.settings,
      remuneration: Array.isArray(t.remuneration) ? t.remuneration[0] : t.remuneration,
    }));

    // Load admin profiles per tenant
    const { data: profiles } = await sb.from("profiles").select("id, email, full_name, tenant_id").eq("role", "admin");
    const byTenant: Record<string, AdminUser[]> = {};
    (profiles || []).forEach((p: any) => {
      if (!byTenant[p.tenant_id]) byTenant[p.tenant_id] = [];
      byTenant[p.tenant_id].push({ id: p.id, email: p.email, full_name: p.full_name });
    });
    setTenants(tenantList.map(t => ({ ...t, admins: byTenant[t.id] || [] })));
    setLoading(false);
  }

  useEffect(() => { if (authed) load(); }, [authed]);

  const notify = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };

  async function createTenant() {
    if (!form.slug || !form.name) return notify("Slug et nom requis", false);
    const { data: t, error } = await sb.from("tenants").insert({ slug: form.slug, name: form.name, plan: form.plan, active: true }).select().single();
    if (error) return notify("Erreur: " + error.message, false);
    await sb.from("tenant_settings").insert({ tenant_id: t.id, app_name: form.app_name || form.name, primary_color: form.primary_color, currency: "XOF", timezone: "Africa/Dakar" });
    await sb.from("remuneration_config").insert({ tenant_id: t.id, model: form.model, base_amount: parseFloat(form.base_amount) || 0, commission_rate: parseFloat(form.commission_rate) || 0 });
    notify("✓ Client créé : " + t.slug);
    setForm({ slug: "", name: "", plan: "starter", primary_color: "#f5a623", app_name: "", model: "fixed", base_amount: "0", commission_rate: "0" });
    load();
  }

  async function changePlan(tenantId: string, plan: string) {
    const res = await fetch("/api/superadmin/update-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ superadminKey: key, tenantId, plan }),
    });
    const d = await res.json();
    if (d.error) return notify(d.error, false);
    notify("✓ Plan mis à jour → " + plan);
    load();
  }

  async function toggleActive(tenantId: string, current: boolean) {
    const res = await fetch("/api/superadmin/update-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ superadminKey: key, tenantId, active: !current }),
    });
    const d = await res.json();
    if (d.error) return notify(d.error, false);
    notify(current ? "⏸ Tenant suspendu" : "✓ Tenant réactivé");
    load();
  }

  async function createAdmin(tenantId: string) {
    const f = adminForm[tenantId];
    if (!f?.email || !f?.password) return notify("Email et mot de passe requis", false);
    const res = await fetch("/api/superadmin/create-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ superadminKey: key, tenantId, email: f.email, password: f.password }),
    });
    const d = await res.json();
    if (d.error) return notify(d.error, false);
    notify("✓ Admin créé : " + f.email);
    setAdminForm(prev => ({ ...prev, [tenantId]: { email: "", password: "" } }));
    load();
  }

  async function deleteAdmin(userId: string) {
    const res = await fetch("/api/superadmin/create-admin", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ superadminKey: key, userId }),
    });
    const d = await res.json();
    if (d.error) return notify(d.error, false);
    notify("✓ Admin supprimé");
    load();
  }

  if (!authed) return (
    <div style={{ minHeight: "100vh", background: "#080a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 16, padding: 40, width: 340 }}>
        <div style={{ color: "#f5a623", fontWeight: 600, fontSize: 18, marginBottom: 8 }}>M3A · Superadmin</div>
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 24 }}>Accès réservé — M3A Solutions</div>
        <input type="password" placeholder="Clé d'accès" value={key} onChange={e => setKey(e.target.value)}
          style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7", marginBottom: 12, boxSizing: "border-box" }}
          onKeyDown={e => e.key === "Enter" && setAuthed(key === SUPERADMIN_KEY)} />
        <button onClick={() => setAuthed(key === SUPERADMIN_KEY)}
          style={{ width: "100%", background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: 10, fontWeight: 600, cursor: "pointer" }}>
          Accéder →
        </button>
        {key && key !== SUPERADMIN_KEY && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>Clé incorrecte</p>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#080a0f", padding: "32px 24px", color: "#f0f2f7", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
          <div style={{ background: "#f5a623", borderRadius: 8, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#080a0f" }}>M3</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>Superadmin Panel</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Gestion des clients Fleet SaaS</div>
          </div>
          <button onClick={load} style={{ marginLeft: "auto", background: "#1e2330", border: "none", borderRadius: 8, padding: "8px 16px", color: "#9ca3af", cursor: "pointer", fontSize: 13 }}>
            ↻ Rafraîchir
          </button>
        </div>

        {msg && (
          <div style={{ background: msg.ok ? "#f5a62315" : "#ef444415", border: `0.5px solid ${msg.ok ? "#f5a62340" : "#ef444440"}`, borderRadius: 8, padding: "10px 16px", marginBottom: 24, color: msg.ok ? "#f5a623" : "#f87171", fontSize: 13 }}>
            {msg.text}
          </div>
        )}

        {/* Plan legend */}
        <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
          {(Object.entries(PLAN_LIMITS) as [Plan, typeof PLAN_LIMITS[Plan]][]).map(([plan, limits]) => (
            <div key={plan} style={{ background: "#0d1117", border: `0.5px solid ${PLAN_COLORS[plan]}40`, borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PLAN_COLORS[plan], display: "inline-block" }} />
              <span style={{ fontWeight: 600, color: PLAN_COLORS[plan], fontSize: 12 }}>{limits.label}</span>
              <span style={{ color: "#6b7280", fontSize: 11 }}>{limits.price}</span>
              <span style={{ color: "#374151", fontSize: 11 }}>· max {limits.maxDrivers === Infinity ? "∞" : limits.maxDrivers} chauffeurs</span>
            </div>
          ))}
        </div>

        {/* Tenant list */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: "#f5a623", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
            Clients ({tenants.length})
          </div>
          {loading ? <p style={{ color: "#6b7280" }}>Chargement...</p> : tenants.map(t => {
            const planColor = PLAN_COLORS[t.plan] || "#6b7280";
            const limits = PLAN_LIMITS[t.plan as Plan] || PLAN_LIMITS.starter;
            const isExpanded = expandedId === t.id;
            return (
              <div key={t.id} style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
                {/* Summary row */}
                <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 6, background: t.settings?.primary_color || "#f5a623", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#080a0f", flexShrink: 0 }}>
                    {(t.settings?.app_name || t.name).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{t.settings?.app_name || t.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{t.slug} · {t.remuneration?.model}</div>
                  </div>

                  {/* Plan badge + selector */}
                  <select value={t.plan} onChange={e => changePlan(t.id, e.target.value)}
                    style={{ background: planColor + "20", border: `0.5px solid ${planColor}50`, borderRadius: 20, padding: "4px 10px", color: planColor, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>

                  {/* Status */}
                  <span style={{ background: t.active ? "#22c55e15" : "#ef444415", color: t.active ? "#22c55e" : "#ef4444", border: `0.5px solid ${t.active ? "#22c55e40" : "#ef444440"}`, borderRadius: 20, padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                    {t.active ? "Actif" : "Suspendu"}
                  </span>
                  <button onClick={() => toggleActive(t.id, t.active)}
                    style={{ background: "#1e2330", border: "none", borderRadius: 8, padding: "5px 10px", color: "#9ca3af", cursor: "pointer", fontSize: 11 }}>
                    {t.active ? "Suspendre" : "Réactiver"}
                  </button>
                  <button onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    style={{ background: "#f5a62315", border: "0.5px solid #f5a62340", borderRadius: 8, padding: "5px 10px", color: "#f5a623", cursor: "pointer", fontSize: 11 }}>
                    {isExpanded ? "Fermer ▲" : "Gérer ▼"}
                  </button>
                </div>

                {/* Expanded: admin management + plan details */}
                {isExpanded && (
                  <div style={{ borderTop: "0.5px solid #1e2330", padding: "20px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

                      {/* Admin accounts */}
                      <div>
                        <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Comptes Admin</div>
                        {(t.admins || []).length === 0 ? (
                          <p style={{ color: "#6b7280", fontSize: 12 }}>Aucun admin — créez-en un ci-dessous</p>
                        ) : (
                          <div style={{ marginBottom: 12 }}>
                            {(t.admins || []).map(a => (
                              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#080a0f", borderRadius: 8, marginBottom: 6 }}>
                                <div style={{ width: 28, height: 28, borderRadius: 6, background: "#1e2330", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#9ca3af" }}>
                                  {a.email.slice(0, 1).toUpperCase()}
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 12, color: "#f0f2f7" }}>{a.email}</div>
                                  <div style={{ fontSize: 11, color: "#6b7280" }}>{a.full_name}</div>
                                </div>
                                <button onClick={() => deleteAdmin(a.id)}
                                  style={{ background: "#ef444415", border: "0.5px solid #ef444440", borderRadius: 6, padding: "4px 8px", color: "#f87171", cursor: "pointer", fontSize: 11 }}>
                                  Supprimer
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Create admin form */}
                        <div style={{ background: "#080a0f", borderRadius: 8, padding: 12 }}>
                          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Créer un compte admin</div>
                          <input placeholder="email@client.com" value={adminForm[t.id]?.email || ""}
                            onChange={e => setAdminForm(prev => ({ ...prev, [t.id]: { ...prev[t.id], email: e.target.value } }))}
                            style={{ width: "100%", background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 6, padding: "8px 10px", color: "#f0f2f7", fontSize: 12, marginBottom: 6, boxSizing: "border-box" }} />
                          <input placeholder="Mot de passe" type="password" value={adminForm[t.id]?.password || ""}
                            onChange={e => setAdminForm(prev => ({ ...prev, [t.id]: { ...prev[t.id], password: e.target.value } }))}
                            style={{ width: "100%", background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 6, padding: "8px 10px", color: "#f0f2f7", fontSize: 12, marginBottom: 8, boxSizing: "border-box" }} />
                          <button onClick={() => createAdmin(t.id)}
                            style={{ background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>
                            + Créer l'admin
                          </button>
                        </div>
                      </div>

                      {/* Plan details */}
                      <div>
                        <div style={{ fontSize: 11, color: planColor, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                          Plan {limits.label} · {limits.price}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {[
                            ["Chauffeurs max", limits.maxDrivers === Infinity ? "Illimité" : String(limits.maxDrivers)],
                            ["Export CSV", limits.canExportCSV ? "✓" : "✗"],
                            ["Branding custom", limits.canCustomBranding ? "✓" : "✗"],
                            ["Avances salaire", limits.canSalaryAdvance ? "✓" : "✗"],
                            ["Multi-véhicules", limits.canMultiVehicle ? "✓" : "✗"],
                            ["Accès API", limits.canAccessAPI ? "✓" : "✗"],
                          ].map(([label, val]) => (
                            <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 10px", background: "#080a0f", borderRadius: 6 }}>
                              <span style={{ color: "#9ca3af" }}>{label}</span>
                              <span style={{ color: val === "✓" ? "#22c55e" : val === "✗" ? "#6b7280" : "#f0f2f7", fontWeight: 500 }}>{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Create new tenant */}
        <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 11, color: "#f5a623", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>Nouveau client</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {([["Slug (identifiant unique)", "slug", "alpha"], ["Nom du client", "name", "Alpha Transport"], ["Nom de l'app", "app_name", "Alpha Fleet"]] as const).map(([label, field, ph]) => (
              <div key={field}>
                <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>{label}</label>
                <input value={(form as any)[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} placeholder={ph}
                  style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7", boxSizing: "border-box" }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>Plan initial</label>
              <select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}
                style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7" }}>
                <option value="starter">Starter — Gratuit</option>
                <option value="pro">Pro — 25 000 XOF/mois</option>
                <option value="enterprise">Enterprise — Sur devis</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>Modèle rémunération</label>
              <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7" }}>
                <option value="fixed">Salaire fixe</option>
                <option value="percent">% du brut</option>
                <option value="hybrid">Hybride</option>
              </select>
            </div>
          </div>
          <button onClick={createTenant}
            style={{ marginTop: 16, background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: "12px 24px", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
            + Créer le client
          </button>
        </div>

        <div style={{ marginTop: 40, fontSize: 11, color: "#1f2937", textAlign: "center" }}>
          © 2026 M3A Solutions — Superadmin Panel
        </div>
      </div>
    </div>
  );
}
