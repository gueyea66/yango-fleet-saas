"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLAN_LIMITS, getTrialStatus, type Plan } from "@/lib/plans";
import Dashboard from "./Dashboard";

// Key is verified server-side via /api/superadmin/verify

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
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState<"dashboard" | "clients" | "payments" | "imports" | "settings">("dashboard");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", app_name: "", plan: "standard", primary_color: "#f5a623", model: "fixed", base_amount: "0", commission_rate: "0", trial_days: "30" });
  const [adminForm, setAdminForm] = useState<Record<string, { email: string; password: string }>>({});
  const [extendDays, setExtendDays] = useState<Record<string, string>>({});
  const [editAdmin, setEditAdmin] = useState<Record<string, { email: string; password: string } | null>>({});
  const [keyForm, setKeyForm] = useState({ current: "", newKey: "", confirm: "" });
  const [globalSettings, setGlobalSettings] = useState({ whatsapp: "", phone: "", companyName: "M3A Solutions", defaultTrialDays: "30", defaultPlan: "standard", wavePhone: "", omPhone: "", priceStandard: "25000", pricePro: "50000", priceEnterprise: "100000" });
  const [settingsLoading, setSettingsLoading] = useState(false);

  const sb = createClient() as any;
  const notify = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };

  async function verifyAndLogin() {
    setAuthError("");
    const res = await fetch("/api/superadmin/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const d = await res.json();
    if (d.ok) { setAuthed(true); } else { setAuthError("Clé incorrecte"); }
  }

  async function changeKey() {
    if (keyForm.newKey !== keyForm.confirm) return notify("Les clés ne correspondent pas", false);
    if (keyForm.newKey.length < 12) return notify("Clé trop courte (12 caractères min)", false);
    const res = await fetch("/api/superadmin/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentKey: keyForm.current, newKey: keyForm.newKey }),
    });
    const d = await res.json();
    if (d.error) return notify(d.error, false);
    notify("✓ Clé d'accès mise à jour — utilisez la nouvelle clé à la prochaine connexion");
    setKeyForm({ current: "", newKey: "", confirm: "" });
    setKey(keyForm.newKey);
  }

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

  useEffect(() => {
    if (authed) {
      load();
      loadGlobalSettings();
    }
  }, [authed]);

  async function loadGlobalSettings() {
    const { data } = await sb.from("superadmin_settings").select("key,value");
    if (!data) return;
    const map: Record<string,string> = {};
    data.forEach((r: any) => { map[r.key] = r.value; });
    setGlobalSettings(prev => ({
      whatsapp: map["whatsapp"] || prev.whatsapp,
      phone: map["phone"] || prev.phone,
      companyName: map["company_name"] || prev.companyName,
      defaultTrialDays: map["default_trial_days"] || prev.defaultTrialDays,
      defaultPlan: map["default_plan"] || prev.defaultPlan,
      wavePhone: map["wave_phone"] || prev.wavePhone,
      omPhone: map["om_phone"] || prev.omPhone,
      priceStandard: map["price_standard"] || prev.priceStandard,
      pricePro: map["price_pro"] || prev.pricePro,
      priceEnterprise: map["price_enterprise"] || prev.priceEnterprise,
    }));
  }

  async function saveGlobalSetting(key: string, value: string) {
    setSettingsLoading(true);
    await sb.from("superadmin_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setSettingsLoading(false);
    notify("✓ Paramètre sauvegardé");
  }

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

  async function updateAdmin(userId: string) {
    const f = editAdmin[userId];
    if (!f) return;
    const body: Record<string, string> = { userId };
    if (f.email) body.email = f.email;
    if (f.password) body.password = f.password;
    const res = await fetch("/api/superadmin/create-admin", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ superadminKey: key, ...body }),
    });
    const d = await res.json();
    if (d.error) return notify(d.error, false);
    notify("✓ Admin mis à jour");
    setEditAdmin(p => ({ ...p, [userId]: null }));
    load();
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
        <input type="password" placeholder="Clé d'accès" value={key} onChange={e => { setKey(e.target.value); setAuthError(""); }}
          style={{ ...S.input, marginBottom: 12 }} onKeyDown={e => e.key === "Enter" && verifyAndLogin()} />
        <button onClick={verifyAndLogin}
          style={{ width: "100%", background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: 10, fontWeight: 700, cursor: "pointer" }}>
          Accéder →
        </button>
        {authError && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>{authError}</p>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#080a0f", padding: "32px 24px", color: "#f0f2f7", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div style={{ background: "#f5a623", borderRadius: 8, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#080a0f" }}>M3</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Superadmin Panel</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Gestion des clients Fleet SaaS</div>
          </div>
          <button onClick={load} style={{ marginLeft: "auto", background: "#1e2330", border: "none", borderRadius: 8, padding: "8px 16px", color: "#9ca3af", cursor: "pointer", fontSize: 13 }}>↻ Rafraîchir</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 28, borderBottom: "0.5px solid #1e2330", paddingBottom: 0 }}>
          {([["dashboard", "📊 Dashboard"], ["clients", "🏢 Clients"], ["payments", "💳 Paiements"], ["imports", "📥 Imports"], ["settings", "⚙ Paramètres"]] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ background: "none", border: "none", padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
                color: activeTab === tab ? "#f5a623" : "#6b7280",
                borderBottom: activeTab === tab ? "2px solid #f5a623" : "2px solid transparent",
                marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Dashboard tab */}
        {activeTab === "dashboard" && <Dashboard />}

        {/* Settings tab */}
        {activeTab === "settings" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {msg && (
              <div style={{ gridColumn: "1/-1", background: msg.ok ? "#f5a62312" : "#ef444412", border: `0.5px solid ${msg.ok ? "#f5a62340" : "#ef444440"}`, borderRadius: 8, padding: "10px 16px", color: msg.ok ? "#f5a623" : "#f87171", fontSize: 13 }}>
                {msg.text}
              </div>
            )}

            {/* Paiements mobile money */}
            <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24, gridColumn: "1/-1" }}>
              <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 18 }}>💳 Paiements — Mobile Money</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {[
                  { label: "Numéro Wave (+221...)", key: "wave_phone", stateKey: "wavePhone" as const, placeholder: "+221 77 000 00 00" },
                  { label: "Numéro Orange Money (+221...)", key: "om_phone", stateKey: "omPhone" as const, placeholder: "+221 77 000 00 00" },
                  { label: "Prix Standard (XOF/mois)", key: "price_standard", stateKey: "priceStandard" as const, placeholder: "25000" },
                  { label: "Prix Pro (XOF/mois)", key: "price_pro", stateKey: "pricePro" as const, placeholder: "50000" },
                  { label: "Prix Enterprise (XOF/mois)", key: "price_enterprise", stateKey: "priceEnterprise" as const, placeholder: "100000" },
                ].map(({ label, key: dbKey, stateKey, placeholder }) => (
                  <div key={dbKey}>
                    <label style={S.label}>{label}</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        placeholder={placeholder}
                        value={globalSettings[stateKey]}
                        onChange={e => setGlobalSettings(p => ({ ...p, [stateKey]: e.target.value }))}
                        style={{ ...S.input, flex: 1 }}
                      />
                      <button onClick={() => saveGlobalSetting(dbKey, globalSettings[stateKey])} disabled={settingsLoading}
                        style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                        ✓
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280" }}>
                Ces valeurs sont affichées sur la page <code style={{ color: "#f5a623" }}>/paiement</code> — lien partageable avec les clients après inscription.
              </div>
            </div>

            {/* Sécurité — clé d'accès */}
            <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 18 }}>🔐 Sécurité — Clé d'accès</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={S.label}>Clé actuelle</label>
                  <input type="password" placeholder="••••••••" value={keyForm.current}
                    onChange={e => setKeyForm(f => ({ ...f, current: e.target.value }))} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Nouvelle clé (12 caractères min)</label>
                  <input type="password" placeholder="Nouvelle clé sécurisée" value={keyForm.newKey}
                    onChange={e => setKeyForm(f => ({ ...f, newKey: e.target.value }))} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Confirmer la nouvelle clé</label>
                  <input type="password" placeholder="••••••••" value={keyForm.confirm}
                    onChange={e => setKeyForm(f => ({ ...f, confirm: e.target.value }))} style={S.input} />
                </div>
                <button onClick={changeKey}
                  style={{ background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: "11px", fontWeight: 700, cursor: "pointer", marginTop: 4 }}>
                  Mettre à jour la clé →
                </button>
                <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>La clé est stockée en base, changeable à tout moment.</div>
              </div>
            </div>

            {/* Contacts */}
            <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 18 }}>📞 Contacts & Support</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={S.label}>Numéro WhatsApp (affiché sur la page de verrouillage)</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input placeholder="+221 77 000 00 00" value={globalSettings.whatsapp}
                      onChange={e => setGlobalSettings(p => ({ ...p, whatsapp: e.target.value }))} style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => saveGlobalSetting("whatsapp", globalSettings.whatsapp)} disabled={settingsLoading}
                      style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                      ✓
                    </button>
                  </div>
                </div>
                <div>
                  <label style={S.label}>Téléphone direct</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input placeholder="+221 33 000 00 00" value={globalSettings.phone}
                      onChange={e => setGlobalSettings(p => ({ ...p, phone: e.target.value }))} style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => saveGlobalSetting("phone", globalSettings.phone)} disabled={settingsLoading}
                      style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                      ✓
                    </button>
                  </div>
                </div>
                <div>
                  <label style={S.label}>Nom de la société (affiché aux clients)</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input placeholder="M3A Solutions" value={globalSettings.companyName}
                      onChange={e => setGlobalSettings(p => ({ ...p, companyName: e.target.value }))} style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => saveGlobalSetting("company_name", globalSettings.companyName)} disabled={settingsLoading}
                      style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                      ✓
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Defaults SaaS */}
            <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 18 }}>⚙ Défauts SaaS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={S.label}>Durée d'essai par défaut (jours)</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="number" min={1} max={90} placeholder="30" value={globalSettings.defaultTrialDays}
                      onChange={e => setGlobalSettings(p => ({ ...p, defaultTrialDays: e.target.value }))} style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => saveGlobalSetting("default_trial_days", globalSettings.defaultTrialDays)} disabled={settingsLoading}
                      style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                      ✓
                    </button>
                  </div>
                </div>
                <div>
                  <label style={S.label}>Plan par défaut pour les nouveaux clients</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={globalSettings.defaultPlan} onChange={e => setGlobalSettings(p => ({ ...p, defaultPlan: e.target.value }))}
                      style={{ ...S.input, flex: 1, cursor: "pointer" }}>
                      <option value="standard">Standard — 35 000 XOF/mois</option>
                      <option value="pro">Pro — 75 000 XOF/mois</option>
                    </select>
                    <button onClick={() => saveGlobalSetting("default_plan", globalSettings.defaultPlan)} disabled={settingsLoading}
                      style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                      ✓
                    </button>
                  </div>
                </div>
                <div style={{ background: "#080a0f", borderRadius: 8, padding: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 6 }}>Horizons de notification (définis dans le système)</div>
                  {["J-14 (vert)","J-7 (jaune)","J-3 (orange)","J-1 (rouge)","Expiration (rouge, verrouillage)"].map((h,i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", background:["#22c55e","#f5a623","#f97316","#ef4444","#ef4444"][i], display:"inline-block" }}/>
                      <span style={{ fontSize:11, color:"#9ca3af" }}>{h}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Infos système */}
            <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 18 }}>ℹ Informations Système</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["Version", "1.0.0 — Yango Fleet SaaS"],
                  ["Base de données", "Supabase · schéma fleet"],
                  ["Hébergement", "Vercel · yango-fleet-saas.vercel.app"],
                  ["Auth", "Supabase Auth — email virtuel drivers"],
                  ["Plans", "Standard 35k XOF · Pro 75k XOF"],
                  ["Devise", "XOF (Franc CFA)"],
                  ["Timezone", "Africa/Dakar (UTC+0)"],
                  ["Session", `Connecté · clé active`],
                ].map(([k,v]) => (
                  <div key={k} style={{ display:"flex", justifyContent:"space-between", borderBottom:"0.5px solid #1e2330", paddingBottom:6 }}>
                    <span style={{ fontSize:11, color:"#6b7280" }}>{k}</span>
                    <span style={{ fontSize:11, color:"#f0f2f7" }}>{v}</span>
                  </div>
                ))}
                <button onClick={() => { setAuthed(false); setKey(""); }}
                  style={{ background:"#ef444412", color:"#ef4444", border:"0.5px solid #ef444430", borderRadius:8, padding:"9px 16px", cursor:"pointer", fontWeight:700, fontSize:12, marginTop:8 }}>
                  Déconnecter →
                </button>
              </div>
            </div>

          </div>
        )}

        {activeTab === "payments" && (
          <PaymentsTab tenants={tenants} superadminKey={key} notify={notify} />
        )}

        {activeTab === "imports" && (
          <ImportsTab superadminKey={key} notify={notify} />
        )}

        {activeTab === "clients" && (<>

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
                          <div key={a.id} style={{ background: "#080a0f", borderRadius: 8, marginBottom: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px" }}>
                              <div style={{ width: 24, height: 24, borderRadius: 5, background: "#1e2330", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>
                                {a.email.slice(0, 1).toUpperCase()}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, color: "#f0f2f7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email}</div>
                              </div>
                              <button onClick={() => setEditAdmin(p => ({ ...p, [a.id]: p[a.id] ? null : { email: a.email, password: "" } }))}
                                style={{ background: "none", border: "none", color: editAdmin[a.id] ? "#f5a623" : "#6b7280", cursor: "pointer", fontSize: 11 }}>✏️</button>
                              <button onClick={() => deleteAdmin(a.id)}
                                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 11 }}>✕</button>
                            </div>
                            {editAdmin[a.id] && (
                              <div style={{ padding: "0 10px 10px" }}>
                                <input placeholder="Nouvel email" value={editAdmin[a.id]!.email}
                                  onChange={e => setEditAdmin(p => ({ ...p, [a.id]: { ...p[a.id]!, email: e.target.value } }))}
                                  style={{ ...S.smallInput, marginBottom: 4 }} />
                                <input type="password" placeholder="Nouveau mot de passe (optionnel)" value={editAdmin[a.id]!.password}
                                  onChange={e => setEditAdmin(p => ({ ...p, [a.id]: { ...p[a.id]!, password: e.target.value } }))}
                                  style={{ ...S.smallInput, marginBottom: 6 }} />
                                <button onClick={() => updateAdmin(a.id)}
                                  style={{ background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 6, padding: "5px 12px", fontWeight: 700, cursor: "pointer", fontSize: 11 }}>
                                  Sauvegarder
                                </button>
                              </div>
                            )}
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

        </>)}

        <div style={{ marginTop: 40, fontSize: 11, color: "#1f2937", textAlign: "center" }}>
          © 2026 M3A Solutions — Superadmin Panel
        </div>
      </div>
    </div>
  );
}

// ── Imports Tab ───────────────────────────────────────────────────────────────
function ImportsTab({ superadminKey, notify }: { superadminKey: string; notify: (msg: string, ok?: boolean) => void }) {
  const [imports, setImports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"admin_confirmed" | "injected" | "rejected">("admin_confirmed");
  const [detail, setDetail] = useState<Record<string, any>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  async function load(status: string) {
    setLoading(true);
    const res = await fetch(`/api/superadmin/imports?status=${status}`, {
      headers: { "x-superadmin-key": superadminKey },
    });
    const d = await res.json();
    setImports(d.imports ?? []);
    setLoading(false);
  }

  async function loadDetail(id: string) {
    if (detail[id]) { setDetail(p => ({ ...p, [id]: null })); return; }
    const res = await fetch(`/api/superadmin/imports/${id}`, {
      headers: { "x-superadmin-key": superadminKey },
    });
    const d = await res.json();
    setDetail(p => ({ ...p, [id]: d.batch }));
  }

  async function act(id: string, action: "inject" | "reject") {
    setActing(id);
    const res = await fetch(`/api/superadmin/imports/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-superadmin-key": superadminKey },
      body: JSON.stringify({ action, reason: rejectReason[id] ?? "" }),
    });
    const d = await res.json();
    if (d.ok) {
      notify(action === "inject"
        ? `✓ ${d.injectedCount} rapports injectés (${d.skippedDuplicates ?? 0} doublons ignorés)`
        : "Import rejeté — l'admin sera informé");
      load(statusFilter);
    } else {
      notify(d.error || "Erreur", false);
    }
    setActing(null);
  }

  useEffect(() => { load(statusFilter); }, [statusFilter]);

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString("fr-FR") : "—";

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {(["admin_confirmed", "injected", "rejected"] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ background: statusFilter === s ? "#f5a623" : "#1e2330", color: statusFilter === s ? "#080a0f" : "#9ca3af", border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {s === "admin_confirmed" ? "En attente" : s === "injected" ? "Injectés" : "Rejetés"}
          </button>
        ))}
        <button onClick={() => load(statusFilter)} style={{ marginLeft: "auto", background: "#1e2330", border: "none", borderRadius: 8, padding: "6px 14px", color: "#9ca3af", cursor: "pointer", fontSize: 12 }}>↻</button>
      </div>

      {loading && <div style={{ color: "#6b7280", fontSize: 13 }}>Chargement…</div>}

      {!loading && imports.length === 0 && (
        <div style={{ color: "#6b7280", fontSize: 13, padding: "32px", textAlign: "center" }}>
          {statusFilter === "admin_confirmed" ? "Aucun import en attente d'injection." : "Aucun import dans ce statut."}
        </div>
      )}

      {imports.map((imp) => {
        const d = detail[imp.id];
        const tenant = imp.tenants as { slug: string; name: string; plan: string } | null;
        return (
          <div key={imp.id} style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, marginBottom: 10 }}>
            <div style={{ padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#f0f2f7", marginBottom: 3 }}>
                  {tenant?.name || imp.tenant_id} — {tenant?.plan ?? ""}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Période : <strong style={{ color: "#9ca3af" }}>{imp.date_from} → {imp.date_to}</strong>
                  &nbsp;·&nbsp; {imp.valid_count}/{imp.row_count} lignes valides
                  {imp.duplicate_count > 0 && ` · ${imp.duplicate_count} doublons`}
                  {imp.error_count > 0 && ` · ${imp.error_count} erreurs`}
                </div>
                {imp.drivers_found?.length > 0 && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
                    Chauffeurs : {imp.drivers_found.join(", ")}
                  </div>
                )}
                {imp.admin_notes && (
                  <div style={{ fontSize: 11, color: "#f5a623", marginTop: 5, fontStyle: "italic" }}>
                    Note admin : « {imp.admin_notes} »
                  </div>
                )}
                {imp.status === "injected" && (
                  <div style={{ fontSize: 11, color: "#22c55e", marginTop: 4 }}>
                    ✓ {imp.injected_count} injectés le {fmtDate(imp.injected_at)}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <div style={{ fontSize: 10, color: "#374151" }}>Confirmé le {fmtDate(imp.admin_confirmed_at)}</div>

                <button onClick={() => loadDetail(imp.id)}
                  style={{ background: "#1e2330", border: "none", borderRadius: 6, padding: "5px 12px", color: "#9ca3af", fontSize: 11, cursor: "pointer" }}>
                  {d ? "Masquer ▲" : "Voir données ▼"}
                </button>

                {statusFilter === "admin_confirmed" && (
                  <div style={{ display: "flex", gap: 6, flexDirection: "column", alignItems: "flex-end" }}>
                    <button onClick={() => act(imp.id, "inject")} disabled={acting === imp.id}
                      style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {acting === imp.id ? "Injection…" : "⟳ Injecter"}
                    </button>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input placeholder="Motif rejet…" value={rejectReason[imp.id] ?? ""}
                        onChange={e => setRejectReason(p => ({ ...p, [imp.id]: e.target.value }))}
                        style={{ background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 6, padding: "5px 8px", color: "#f0f2f7", fontSize: 11, width: 140 }} />
                      <button onClick={() => act(imp.id, "reject")} disabled={acting === imp.id}
                        style={{ background: "#ef444420", color: "#ef4444", border: "0.5px solid #ef444430", borderRadius: 6, padding: "5px 10px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                        Rejeter
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Detail rows */}
            {d && (
              <div style={{ borderTop: "0.5px solid #1e2330", padding: "12px 18px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#080a0f" }}>
                      {["#", "Date", "Chauffeur", "CA Brut", "KM", "Courses", "Statut"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", color: "#6b7280", fontWeight: 600, textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(d.parsed_rows ?? []).slice(0, 50).map((r: any) => (
                      <tr key={r.row} style={{ background: r.has_error ? "#1a0808" : r.is_duplicate ? "#1a1400" : "transparent" }}>
                        <td style={{ padding: "5px 10px", color: "#555e75" }}>{r.row}</td>
                        <td style={{ padding: "5px 10px", color: "#f0f2f7" }}>{r.date}</td>
                        <td style={{ padding: "5px 10px", color: "#f0f2f7" }}>{r.driver_name}</td>
                        <td style={{ padding: "5px 10px", color: "#f5a623" }}>{r.ca_brut != null ? new Intl.NumberFormat("fr-FR").format(r.ca_brut) : "—"}</td>
                        <td style={{ padding: "5px 10px", color: "#9ca3af" }}>{r.km_parcourus ?? "—"}</td>
                        <td style={{ padding: "5px 10px", color: "#9ca3af" }}>{r.nombre_courses ?? "—"}</td>
                        <td style={{ padding: "5px 10px" }}>
                          {r.has_error && <span style={{ color: "#ef4444", fontWeight: 700 }}>Erreur</span>}
                          {!r.has_error && r.is_duplicate && <span style={{ color: "#f5a623" }}>Doublon</span>}
                          {!r.has_error && !r.is_duplicate && <span style={{ color: "#22c55e" }}>OK</span>}
                        </td>
                      </tr>
                    ))}
                    {(d.parsed_rows ?? []).length > 50 && (
                      <tr><td colSpan={7} style={{ padding: "8px 10px", color: "#6b7280", textAlign: "center" }}>
                        + {d.parsed_rows.length - 50} lignes supplémentaires
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Payments Tab ───────────────────────────────────────────────────────────────
function PaymentsTab({ tenants, superadminKey, notify }: {
  tenants: Array<{ id: string; slug: string; name: string; plan: string; active: boolean; trial_ends_at: string | null; settings?: { app_name: string } }>;
  superadminKey: string;
  notify: (msg: string, ok?: boolean) => void;
}) {
  const [validating, setValidating] = useState<string | null>(null);
  const [planOverride, setPlanOverride] = useState<Record<string, string>>({});
  const [months, setMonths] = useState<Record<string, string>>({});

  const pending = tenants.filter(t =>
    t.plan === "trial" || t.plan === "pending_payment" || !t.active
  );
  const active = tenants.filter(t => t.active && t.plan !== "trial" && t.plan !== "pending_payment");

  async function confirmPayment(tenantId: string) {
    setValidating(tenantId);
    try {
      const res = await fetch("/api/superadmin/validate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          superadminKey,
          tenantId,
          plan: planOverride[tenantId] || "standard",
          months: parseInt(months[tenantId] || "1"),
        }),
      });
      const d = await res.json();
      if (d.ok) {
        notify(`✓ Paiement validé — plan ${d.plan} jusqu'au ${new Date(d.expiresAt).toLocaleDateString("fr-FR")}`);
      } else {
        notify(d.error || "Erreur validation", false);
      }
    } finally {
      setValidating(null);
    }
  }

  const rowStyle: React.CSSProperties = { background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 10, padding: "14px 18px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" };
  const badgeStyle = (color: string): React.CSSProperties => ({ background: color + "20", color, border: `0.5px solid ${color}40`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 });

  return (
    <div>
      <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 20 }}>
        En attente de paiement ({pending.length})
      </div>

      {pending.length === 0 && (
        <div style={{ color: "#6b7280", fontSize: 13, padding: "24px", textAlign: "center" }}>
          Aucun client en attente de paiement.
        </div>
      )}

      {pending.map(t => (
        <div key={t.id} style={rowStyle}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "#f5a623", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#080a0f", flexShrink: 0 }}>
            {(t.settings?.app_name || t.name).slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.settings?.app_name || t.name}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>{t.slug}</div>
          </div>
          <span style={badgeStyle(t.active ? "#f5a623" : "#ef4444")}>{t.plan}</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={planOverride[t.id] || "standard"}
              onChange={e => setPlanOverride(p => ({ ...p, [t.id]: e.target.value }))}
              style={{ background: "#1a1f2e", border: "0.5px solid #343b4f", color: "#f0f2f7", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}
            >
              <option value="standard">Standard</option>
              <option value="pro">Pro</option>
            </select>
            <input
              type="number" min={1} max={12}
              placeholder="mois"
              value={months[t.id] || "1"}
              onChange={e => setMonths(p => ({ ...p, [t.id]: e.target.value }))}
              style={{ background: "#1a1f2e", border: "0.5px solid #343b4f", color: "#f0f2f7", borderRadius: 6, padding: "6px 10px", fontSize: 12, width: 60 }}
            />
            <button
              onClick={() => confirmPayment(t.id)}
              disabled={validating === t.id}
              style={{ background: "#22c55e", color: "#080a0f", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {validating === t.id ? "..." : "✓ Valider paiement"}
            </button>
            <a
              href={`/paiement?slug=${t.slug}&plan=${planOverride[t.id] || "standard"}&ref=M3A-${t.slug.toUpperCase()}-2026`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#f5a623", fontSize: 11, textDecoration: "none" }}
            >
              Voir page →
            </a>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: "#22c55e", textTransform: "uppercase", letterSpacing: "0.08em", margin: "32px 0 16px" }}>
        Abonnements actifs ({active.length})
      </div>
      {active.map(t => (
        <div key={t.id} style={{ ...rowStyle, opacity: 0.6 }}>
          <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{t.settings?.app_name || t.name}</div>
          <span style={badgeStyle("#22c55e")}>{t.plan}</span>
          <span style={{ fontSize: 11, color: "#6b7280" }}>actif</span>
        </div>
      ))}
    </div>
  );
}
