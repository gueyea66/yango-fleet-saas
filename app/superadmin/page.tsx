"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLAN_LIMITS, getTrialStatus, type Plan } from "@/lib/plans";

const SUPERADMIN_KEY = process.env.NEXT_PUBLIC_SUPERADMIN_KEY || "m3a-super-2026";

const PLAN_COLORS: Record<string, string> = { standard: "#f5a623", pro: "#8b5cf6" };

const HORIZON_COLORS: Record<string, string> = {
  "14d": "#22c55e", "7d": "#f5a623", "3d": "#f97316", "1d": "#ef4444", expired: "#ef4444",
};

interface AdminUser { id: string; email: string; full_name: string; }
interface Tenant {
  id: string; slug: string; name: string; plan: string; active: boolean; created_at: string;
  trial_ends_at: string | null; plan_expires_at: string | null; notifications_sent: Record<string, string>;
  settings?: { app_name: string; primary_color: string; operator_name?: string };
  remuneration?: { model: string; base_amount: number; commission_rate: number };
  admins?: AdminUser[];
}

function daysLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (d <= 0) return "Expiré";
  return `J-${d}`;
}

export default function SuperAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [key, setKey] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", app_name: "", plan: "standard", primary_color: "#f5a623", model: "fixed", base_amount: "0", commission_rate: "0", trial_days: "30" });
  const [adminForm, setAdminForm] = useState<Record<string, { email: string; password: string }>>({});
  const [extendDays, setExtendDays] = useState<Record<string, string>>({});

  const sb = createClient() as any;
  const notify = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };

  async function load() {
    setLoading(true);
    const { data: ts } = await sb.from("tenants")
      .select("*, settings:tenant_settings(*), remuneration:remuneration_config(*)")
      .order("created_at", { ascending: false });
    const list: Tenant[] = (ts || []).map((t: any) => ({
      ...t,
      settings: Array.isArray(t.settings) ? t.settings[0] : t.settings,
      remuneration: Array.isArray(t.remuneration) ? t.remuneration[0] : t.remuneration,
    }));
    const { data: profiles } = await sb.from("profiles").select("id, email, full_name, tenant_id").eq("role", "admin");
    const byTenant: Record<string, AdminUser[]> = {};
    (profiles || []).forEach((p: any) => {
      if (!byTenant[p.tenant_id]) byTenant[p.tenant_id] = [];
      byTenant[p.tenant_id].push({ id: p.id, email: p.email, full_name: p.full_name });
    });
    setTenants(list.map(t => ({ ...t, admins: byTenant[t.id] || [] })));
    setLoading(false);
  }

  useEffect(() => { if (authed) load(); }, [authed]);

  async function apiPost(url: string, body: object) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ superadminKey: key, ...body }) });
    return res.json();
  }
  async function apiDelete(url: string, body: object) {
    const res = await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ superadminKey: key, ...body }) });
    return res.json();
  }

  async function createTenant() {
    if (!form.slug || !form.name) return notify("Slug et nom requis", false);
    const trialDays = parseInt(form.trial_days) || 30;
    const trialEnd = new Date(Date.now() + trialDays * 86400000).toISOString();
    const { data: t, error } = await sb.from("tenants").insert({
      slug: form.slug, name: form.name, plan: form.plan, active: true,
      trial_ends_at: trialEnd, notifications_sent: {},
    }).select().single();
    if (error) return notify(error.message, false);
    await sb.from("tenant_settings").insert({ tenant_id: t.id, app_name: form.app_name || form.name, primary_color: form.primary_color, currency: "XOF", timezone: "Africa/Dakar" });
    await sb.from("remuneration_config").insert({ tenant_id: t.id, model: form.model, base_amount: parseFloat(form.base_amount) || 0, commission_rate: parseFloat(form.commission_rate) || 0 });
    notify(`✓ Client créé — essai de ${trialDays}j jusqu'au ${new Date(trialEnd).toLocaleDateString("fr-FR")}`);
    setForm({ slug: "", name: "", app_name: "", plan: "standard", primary_color: "#f5a623", model: "fixed", base_amount: "0", commission_rate: "0", trial_days: "30" });
    load();
  }

  async function changePlan(tenantId: string, plan: string) {
    const d = await apiPost("/api/superadmin/update-plan", { tenantId, plan });
    if (d.error) return notify(d.error, false);
    notify("✓ Plan → " + plan); load();
  }

  async function toggleActive(tenantId: string, current: boolean) {
    const d = await apiPost("/api/superadmin/update-plan", { tenantId, active: !current });
    if (d.error) return notify(d.error, false);
    notify(current ? "⏸ Suspendu" : "✓ Réactivé"); load();
  }

  async function extendAccess(tenantId: string) {
    const days = parseInt(extendDays[tenantId] || "30");
    const newExpiry = new Date(Date.now() + days * 86400000).toISOString();
    const d = await apiPost("/api/superadmin/update-plan", { tenantId, plan_expires_at: newExpiry, active: true });
    if (d.error) return notify(d.error, false);
    notify(`✓ Accès étendu de ${days}j → jusqu'au ${new Date(newExpiry).toLocaleDateString("fr-FR")}`);
    load();
  }

  async function createAdmin(tenantId: string) {
    const f = adminForm[tenantId];
    if (!f?.email || !f?.password) return notify("Email et mot de passe requis", false);
    const d = await apiPost("/api/superadmin/create-admin", { tenantId, email: f.email, password: f.password });
    if (d.error) return notify(d.error, false);
    notify("✓ Admin créé : " + f.email);
    setAdminForm(prev => ({ ...prev, [tenantId]: { email: "", password: "" } }));
    load();
  }

  async function deleteAdmin(userId: string) {
    const d = await apiDelete("/api/superadmin/create-admin", { userId });
    if (d.error) return notify(d.error, false);
    notify("✓ Admin supprimé"); load();
  }

  const S: Record<string, React.CSSProperties> = {
    input: { width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7", boxSizing: "border-box" as const },
    smallInput: { width: "100%", background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 6, padding: "8px 10px", color: "#f0f2f7", fontSize: 12, boxSizing: "border-box" as const },
    label: { fontSize: 11, color: "#6b7280", display: "block" as const, marginBottom: 4 },
  };

  if (!authed) return (
    <div style={{ minHeight: "100vh", background: "#080a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 16, padding: 40, width: 340 }}>
        <div style={{ color: "#f5a623", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>M3A · Superadmin</div>
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 24 }}>Accès réservé — M3A Solutions</div>
        <input type="password" placeholder="Clé d'accès" value={key} onChange={e => setKey(e.target.value)}
          style={{ ...S.input, marginBottom: 12 }} onKeyDown={e => e.key === "Enter" && setAuthed(key === SUPERADMIN_KEY)} />
        <button onClick={() => setAuthed(key === SUPERADMIN_KEY)}
          style={{ width: "100%", background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: 10, fontWeight: 700, cursor: "pointer" }}>
          Accéder →
        </button>
        {key && key !== SUPERADMIN_KEY && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>Clé incorrecte</p>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#080a0f", padding: "32px 24px", color: "#f0f2f7", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
          <div style={{ background: "#f5a623", borderRadius: 8, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#080a0f" }}>M3</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Superadmin Panel</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Gestion des clients Fleet SaaS</div>
          </div>
          <button onClick={load} style={{ marginLeft: "auto", background: "#1e2330", border: "none", borderRadius: 8, padding: "8px 16px", color: "#9ca3af", cursor: "pointer", fontSize: 13 }}>↻ Rafraîchir</button>
        </div>

        {msg && (
          <div style={{ background: msg.ok ? "#f5a62312" : "#ef444412", border: `0.5px solid ${msg.ok ? "#f5a62340" : "#ef444440"}`, borderRadius: 8, padding: "10px 16px", marginBottom: 24, color: msg.ok ? "#f5a623" : "#f87171", fontSize: 13 }}>
            {msg.text}
          </div>
        )}

        {/* Plans summary */}
        <div style={{ display: "flex", gap: 10, marginBottom: 32, flexWrap: "wrap" }}>
          {(Object.entries(PLAN_LIMITS) as [Plan, typeof PLAN_LIMITS[Plan]][]).map(([plan, l]) => (
            <div key={plan} style={{ background: "#0d1117", border: `0.5px solid ${PLAN_COLORS[plan]}40`, borderRadius: 10, padding: "10px 16px", flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 700, color: PLAN_COLORS[plan], fontSize: 13, marginBottom: 4 }}>{l.label}</div>
              <div style={{ color: "#f5a623", fontSize: 12, marginBottom: 6 }}>{l.price}</div>
              <div style={{ color: "#6b7280", fontSize: 11 }}>
                {l.maxDrivers === Infinity ? "Chauffeurs illimités" : `Max ${l.maxDrivers} chauffeurs`}
                {l.canExportCSV ? " · Export CSV" : ""}
                {l.canCustomBranding ? " · Branding" : ""}
                {l.canAccessAPI ? " · API" : ""}
              </div>
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
            const trialStatus = getTrialStatus(t.trial_ends_at, t.plan_expires_at);
            const expiresAt = t.plan_expires_at ?? t.trial_ends_at;
            const horizonColor = trialStatus.state === "warning" ? HORIZON_COLORS[trialStatus.horizon] : trialStatus.state === "expired" ? "#ef4444" : "#22c55e";
            const isExpanded = expandedId === t.id;

            return (
              <div key={t.id} style={{ background: "#0d1117", border: `0.5px solid ${trialStatus.state === "expired" ? "#ef444430" : "#1e2330"}`, borderRadius: 12, marginBottom: 8 }}>
                <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ width: 30, height: 30, borderRadius: 6, background: t.settings?.primary_color || "#f5a623", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#080a0f", flexShrink: 0 }}>
                    {(t.settings?.app_name || t.name).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 100 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.settings?.app_name || t.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{t.slug}</div>
                  </div>

                  {/* Plan selector */}
                  <select value={t.plan} onChange={e => changePlan(t.id, e.target.value)}
                    style={{ background: planColor + "15", border: `0.5px solid ${planColor}40`, borderRadius: 20, padding: "4px 10px", color: planColor, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    <option value="standard">Standard</option>
                    <option value="pro">Pro</option>
                  </select>

                  {/* Expiry badge */}
                  <span style={{ background: horizonColor + "15", color: horizonColor, border: `0.5px solid ${horizonColor}40`, borderRadius: 20, padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap" }}>
                    {trialStatus.state === "expired" ? "Expiré" : trialStatus.state === "warning" ? `⚠ ${daysLabel(expiresAt)}` : `✓ ${daysLabel(expiresAt)}`}
                  </span>

                  {/* Active status */}
                  <span style={{ background: t.active ? "#22c55e12" : "#ef444412", color: t.active ? "#22c55e" : "#ef4444", border: `0.5px solid ${t.active ? "#22c55e30" : "#ef444430"}`, borderRadius: 20, padding: "4px 10px", fontSize: 11 }}>
                    {t.active ? "Actif" : "Suspendu"}
                  </span>

                  <button onClick={() => toggleActive(t.id, t.active)}
                    style={{ background: "#1e2330", border: "none", borderRadius: 8, padding: "5px 10px", color: "#9ca3af", cursor: "pointer", fontSize: 11 }}>
                    {t.active ? "Suspendre" : "Réactiver"}
                  </button>
                  <button onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    style={{ background: "#f5a62312", border: "0.5px solid #f5a62340", borderRadius: 8, padding: "5px 10px", color: "#f5a623", cursor: "pointer", fontSize: 11 }}>
                    {isExpanded ? "Fermer ▲" : "Gérer ▼"}
                  </button>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: "0.5px solid #1e2330", padding: 20 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>

                      {/* Admin accounts */}
                      <div>
                        <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Comptes Admin</div>
                        {(t.admins || []).map(a => (
                          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#080a0f", borderRadius: 8, marginBottom: 5 }}>
                            <div style={{ width: 24, height: 24, borderRadius: 5, background: "#1e2330", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#9ca3af" }}>
                              {a.email.slice(0, 1).toUpperCase()}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, color: "#f0f2f7" }}>{a.email}</div>
                            </div>
                            <button onClick={() => deleteAdmin(a.id)}
                              style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 11 }}>✕</button>
                          </div>
                        ))}
                        <div style={{ background: "#080a0f", borderRadius: 8, padding: 10, marginTop: 8 }}>
                          <input placeholder="email@client.com" value={adminForm[t.id]?.email || ""}
                            onChange={e => setAdminForm(p => ({ ...p, [t.id]: { ...p[t.id], email: e.target.value } }))}
                            style={{ ...S.smallInput, marginBottom: 5 }} />
                          <input placeholder="Mot de passe" type="password" value={adminForm[t.id]?.password || ""}
                            onChange={e => setAdminForm(p => ({ ...p, [t.id]: { ...p[t.id], password: e.target.value } }))}
                            style={{ ...S.smallInput, marginBottom: 8 }} />
                          <button onClick={() => createAdmin(t.id)}
                            style={{ background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 6, padding: "7px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                            + Créer admin
                          </button>
                        </div>
                      </div>

                      {/* Access / trial */}
                      <div>
                        <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Accès & Expiry</div>
                        <div style={{ background: "#080a0f", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                          {[
                            ["Essai", t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString("fr-FR") : "—"],
                            ["Accès payant", t.plan_expires_at ? new Date(t.plan_expires_at).toLocaleDateString("fr-FR") : "Non défini"],
                            ["Statut", trialStatus.state === "expired" ? "🔴 Expiré" : trialStatus.state === "warning" ? `🟡 J-${(trialStatus as any).daysLeft}` : "🟢 Actif"],
                          ].map(([l, v]) => (
                            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                              <span style={{ color: "#6b7280" }}>{l}</span>
                              <span style={{ color: "#f0f2f7" }}>{v}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input type="number" placeholder="30" value={extendDays[t.id] || ""}
                            onChange={e => setExtendDays(p => ({ ...p, [t.id]: e.target.value }))}
                            style={{ ...S.smallInput, width: 60 }} />
                          <span style={{ color: "#6b7280", fontSize: 11, alignSelf: "center" }}>jours</span>
                          <button onClick={() => extendAccess(t.id)}
                            style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 6, padding: "7px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                            Étendre
                          </button>
                        </div>
                      </div>

                      {/* Notification horizons */}
                      <div>
                        <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Notifications Envoyées</div>
                        <div style={{ background: "#080a0f", borderRadius: 8, padding: 12 }}>
                          {["14d", "7d", "3d", "1d", "expired"].map(h => {
                            const sentAt = t.notifications_sent?.[h];
                            return (
                              <div key={h} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: sentAt ? HORIZON_COLORS[h] : "#1e2330", display: "inline-block", flexShrink: 0 }} />
                                <span style={{ fontSize: 11, color: sentAt ? "#f0f2f7" : "#374151", flex: 1 }}>
                                  {h === "expired" ? "Expiration" : `J-${h.replace("d", "")}`}
                                </span>
                                <span style={{ fontSize: 10, color: sentAt ? "#6b7280" : "#1e2330" }}>
                                  {sentAt ? new Date(sentAt).toLocaleDateString("fr-FR") : "—"}
                                </span>
                              </div>
                            );
                          })}
                          <div style={{ color: "#374151", fontSize: 10, marginTop: 8 }}>
                            Notifié via bannière in-app à chaque connexion
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Create tenant */}
        <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 11, color: "#f5a623", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>Nouveau client</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            {([["Slug", "slug", "alpha"], ["Nom client", "name", "Alpha Transport"], ["Nom app", "app_name", "Alpha Fleet"]] as const).map(([label, field, ph]) => (
              <div key={field}>
                <label style={S.label}>{label}</label>
                <input value={(form as any)[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} placeholder={ph} style={S.input} />
              </div>
            ))}
            <div>
              <label style={S.label}>Plan initial</label>
              <select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}
                style={{ ...S.input, cursor: "pointer" }}>
                <option value="standard">Standard — 35 000 XOF/mois</option>
                <option value="pro">Pro — 75 000 XOF/mois</option>
              </select>
            </div>
            <div>
              <label style={S.label}>Durée d'essai (jours)</label>
              <input type="number" value={form.trial_days} onChange={e => setForm({ ...form, trial_days: e.target.value })} style={S.input} />
            </div>
            <div>
              <label style={S.label}>Rémunération</label>
              <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                style={{ ...S.input, cursor: "pointer" }}>
                <option value="fixed">Salaire fixe</option>
                <option value="percent">% du brut</option>
                <option value="hybrid">Hybride</option>
              </select>
            </div>
          </div>
          <button onClick={createTenant}
            style={{ background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: "12px 24px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
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
