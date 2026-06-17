"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SUPERADMIN_KEY = process.env.NEXT_PUBLIC_SUPERADMIN_KEY || "m3a-super-2026";

interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: string;
  active: boolean;
  created_at: string;
  settings?: { app_name: string; primary_color: string; logo_url: string | null };
  remuneration?: { model: string; base_amount: number; commission_rate: number };
}

export default function SuperAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [key, setKey] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", plan: "starter", primary_color: "#f5a623", app_name: "", model: "fixed", base_amount: "0", commission_rate: "0" });
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editSettings, setEditSettings] = useState<any>({});

  async function load() {
    setLoading(true);
    const sb = createClient() as any;
    const { data: ts } = await sb.from("tenants").select("*, settings:tenant_settings(*), remuneration:remuneration_config(*)").order("created_at");
    setTenants((ts || []).map((t: any) => ({ ...t, settings: t.settings?.[0] || t.settings, remuneration: t.remuneration?.[0] || t.remuneration })));
    setLoading(false);
  }

  async function createTenant() {
    const sb = createClient() as any;
    const { data: t, error } = await sb.from("tenants").insert({ slug: form.slug, name: form.name, plan: form.plan, active: true }).select().single();
    if (error) { setMsg("Erreur: " + error.message); return; }
    await sb.from("tenant_settings").insert({ tenant_id: t.id, app_name: form.app_name || form.name, primary_color: form.primary_color, currency: "XOF", timezone: "Africa/Dakar" });
    await sb.from("remuneration_config").insert({ tenant_id: t.id, model: form.model, base_amount: parseFloat(form.base_amount) || 0, commission_rate: parseFloat(form.commission_rate) || 0 });
    setMsg("✓ Tenant créé : " + t.slug);
    setForm({ slug: "", name: "", plan: "starter", primary_color: "#f5a623", app_name: "", model: "fixed", base_amount: "0", commission_rate: "0" });
    load();
  }

  async function toggleActive(tenant: Tenant) {
    const sb = createClient() as any;
    await sb.from("tenants").update({ active: !tenant.active }).eq("id", tenant.id);
    load();
  }

  async function saveEdit() {
    const sb = createClient() as any;
    await sb.from("tenant_settings").update(editSettings).eq("tenant_id", editId);
    setEditId(null);
    setMsg("✓ Settings mis à jour");
    load();
  }

  if (!authed) return (
    <div style={{ minHeight: "100vh", background: "#080a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 16, padding: 40, width: 340 }}>
        <div style={{ color: "#f5a623", fontWeight: 500, fontSize: 18, marginBottom: 24 }}>M3A · Superadmin</div>
        <input type="password" placeholder="Clé d'accès" value={key} onChange={e => setKey(e.target.value)}
          style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7", marginBottom: 12 }}
          onKeyDown={e => e.key === "Enter" && setAuthed(key === SUPERADMIN_KEY)}
        />
        <button onClick={() => setAuthed(key === SUPERADMIN_KEY)}
          style={{ width: "100%", background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px", fontWeight: 500, cursor: "pointer" }}>
          Accéder
        </button>
        {key && key !== SUPERADMIN_KEY && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>Clé incorrecte</p>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#080a0f", padding: "32px 24px", color: "#f0f2f7", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40 }}>
          <div style={{ background: "#f5a623", borderRadius: 8, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, color: "#080a0f", fontSize: 16 }}>M3A</div>
          <div>
            <div style={{ fontWeight: 500, fontSize: 18 }}>Superadmin</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Gestion des tenants Fleet SaaS</div>
          </div>
          <button onClick={load} style={{ marginLeft: "auto", background: "#1e2330", border: "none", borderRadius: 8, padding: "8px 16px", color: "#f0f2f7", cursor: "pointer", fontSize: 13 }}>
            ↻ Rafraîchir
          </button>
        </div>

        {msg && <div style={{ background: "#f5a62320", border: "0.5px solid #f5a62340", borderRadius: 8, padding: "10px 16px", marginBottom: 24, color: "#f5a623", fontSize: 13 }}>{msg}</div>}

        {/* Tenant list */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: "#f5a623", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>Tenants actifs</div>
          {loading ? <p style={{ color: "#6b7280" }}>Chargement...</p> : tenants.map(t => (
            <div key={t.id} style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 20, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: t.settings?.primary_color || "#f5a623", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "#080a0f", flexShrink: 0 }}>
                  {(t.settings?.app_name || t.name).slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 15 }}>{t.settings?.app_name || t.name}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{t.slug} · {t.plan} · {t.remuneration?.model}</div>
                </div>
                <span style={{ background: t.active ? "#22c55e20" : "#ef444420", color: t.active ? "#22c55e" : "#ef4444", border: `0.5px solid ${t.active ? "#22c55e40" : "#ef444440"}`, borderRadius: 20, padding: "4px 12px", fontSize: 11 }}>
                  {t.active ? "Actif" : "Suspendu"}
                </span>
                <button onClick={() => toggleActive(t)} style={{ background: "#1e2330", border: "none", borderRadius: 8, padding: "6px 12px", color: "#f0f2f7", cursor: "pointer", fontSize: 12 }}>
                  {t.active ? "Suspendre" : "Activer"}
                </button>
                <button onClick={() => { setEditId(t.id); setEditSettings({ ...t.settings }); }} style={{ background: "#f5a62320", border: "0.5px solid #f5a62340", borderRadius: 8, padding: "6px 12px", color: "#f5a623", cursor: "pointer", fontSize: 12 }}>
                  Modifier
                </button>
              </div>
              {editId === t.id && (
                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: "0.5px solid #1e2330", paddingTop: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "#6b7280" }}>Nom de l'app</label>
                    <input value={editSettings.app_name || ""} onChange={e => setEditSettings({ ...editSettings, app_name: e.target.value })}
                      style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 6, padding: "8px 12px", color: "#f0f2f7", marginTop: 4 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#6b7280" }}>Couleur principale</label>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <input type="color" value={editSettings.primary_color || "#f5a623"} onChange={e => setEditSettings({ ...editSettings, primary_color: e.target.value })}
                        style={{ width: 40, height: 36, border: "none", background: "none", cursor: "pointer" }} />
                      <input value={editSettings.primary_color || ""} onChange={e => setEditSettings({ ...editSettings, primary_color: e.target.value })}
                        style={{ flex: 1, background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 6, padding: "8px 12px", color: "#f0f2f7" }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#6b7280" }}>Logo URL</label>
                    <input value={editSettings.logo_url || ""} onChange={e => setEditSettings({ ...editSettings, logo_url: e.target.value })}
                      style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 6, padding: "8px 12px", color: "#f0f2f7", marginTop: 4 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#6b7280" }}>Nom opérateur</label>
                    <input value={editSettings.operator_name || ""} onChange={e => setEditSettings({ ...editSettings, operator_name: e.target.value })}
                      style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 6, padding: "8px 12px", color: "#f0f2f7", marginTop: 4 }} />
                  </div>
                  <button onClick={saveEdit} style={{ background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: "10px", fontWeight: 500, cursor: "pointer", gridColumn: "1 / -1" }}>
                    Sauvegarder
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Create new tenant */}
        <div style={{ background: "#0d1117", border: "0.5px solid #1e2330", borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 11, color: "#f5a623", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>Nouveau client</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              ["Slug (identifiant unique)", "slug", "alpha"],
              ["Nom du client", "name", "Alpha Transport"],
              ["Nom de l'app", "app_name", "Alpha Fleet"],
              ["Couleur principale", "primary_color", "#f5a623"],
            ].map(([label, field, ph]) => (
              <div key={field}>
                <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>{label}</label>
                <input value={(form as any)[field]} onChange={e => setForm({ ...form, [field]: e.target.value })} placeholder={ph}
                  style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7" }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>Plan</label>
              <select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}
                style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7" }}>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
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
            {(form.model === "fixed" || form.model === "hybrid") && (
              <div>
                <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>Salaire fixe (XOF)</label>
                <input type="number" value={form.base_amount} onChange={e => setForm({ ...form, base_amount: e.target.value })}
                  style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7" }} />
              </div>
            )}
            {(form.model === "percent" || form.model === "hybrid") && (
              <div>
                <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>Taux commission (ex: 0.15 = 15%)</label>
                <input type="number" step="0.01" value={form.commission_rate} onChange={e => setForm({ ...form, commission_rate: e.target.value })}
                  style={{ width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 8, padding: "10px 14px", color: "#f0f2f7" }} />
              </div>
            )}
          </div>
          <button onClick={createTenant} style={{ marginTop: 16, background: "#f5a623", color: "#080a0f", border: "none", borderRadius: 8, padding: "12px 24px", fontWeight: 500, cursor: "pointer", fontSize: 14 }}>
            + Créer le client
          </button>
        </div>

        <div style={{ marginTop: 40, fontSize: 11, color: "#374151", textAlign: "center" }}>
          © 2026 M3A Solutions — Superadmin Panel
        </div>
      </div>
    </div>
  );
}
