"use client";

import { useRef, useState } from "react";

interface Props {
  tenantId: string;
  superadminKey: string;
  initial: { app_name?: string; primary_color?: string; operator_name?: string; logo_url?: string | null };
  notify: (text: string, ok?: boolean) => void;
  onSaved: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "#080a0f", border: "0.5px solid #1e2330", borderRadius: 6,
  padding: "7px 10px", color: "#f0f2f7", fontSize: 12, outline: "none",
};

export default function BrandingEditor({ tenantId, superadminKey, initial, notify, onSaved }: Props) {
  const [appName, setAppName] = useState(initial.app_name || "");
  const [color, setColor] = useState(initial.primary_color || "#f5a623");
  const [operator, setOperator] = useState(initial.operator_name || "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(initial.logo_url || null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setLogoFile(f);
    setRemoveLogo(false);
    if (f) {
      if (f.size > 2 * 1024 * 1024) { notify("Logo trop volumineux (max 2 MB)", false); setLogoFile(null); return; }
      setPreview(URL.createObjectURL(f));
    }
  }

  async function save() {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("superadminKey", superadminKey);
      fd.set("tenantId", tenantId);
      if (appName.trim()) fd.set("app_name", appName.trim());
      if (color) fd.set("primary_color", color);
      fd.set("operator_name", operator);
      if (logoFile) fd.set("logo", logoFile);
      if (removeLogo && !logoFile) fd.set("removeLogo", "1");

      const res = await fetch("/api/superadmin/branding", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok || d.error) { notify(d.error || "Erreur branding", false); return; }
      notify("✓ Branding mis à jour");
      setLogoFile(null);
      setRemoveLogo(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 20, borderTop: "0.5px solid #1e2330", paddingTop: 16 }}>
      <div style={{ fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
        Branding (white label)
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* Logo preview + upload */}
        <div style={{ width: 150 }}>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              height: 72, borderRadius: 8, background: "#080a0f", border: "1px dashed #343b4f",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              overflow: "hidden", marginBottom: 6,
            }}
            title="Cliquer pour choisir un logo (PNG, JPEG, WebP — max 2 MB)"
          >
            {preview && !removeLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="logo" style={{ maxHeight: 64, maxWidth: 140, objectFit: "contain" }} />
            ) : (
              <span style={{ color: "#555e75", fontSize: 11, textAlign: "center" }}>+ Logo client<br />PNG / JPEG / WebP</span>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={e => pickFile(e.target.files?.[0] ?? null)} />
          {(preview || logoFile) && !removeLogo && (
            <button onClick={() => { setRemoveLogo(true); setLogoFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
              style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 10, padding: 0 }}>
              ✕ Retirer le logo
            </button>
          )}
        </div>

        {/* Fields */}
        <div style={{ flex: 1, minWidth: 220, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 3 }}>Nom de l&apos;app</label>
            <input value={appName} onChange={e => setAppName(e.target.value)} placeholder="Fallou Fleet" style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 3 }}>Opérateur (pied de page)</label>
            <input value={operator} onChange={e => setOperator(e.target.value)} placeholder="Fallou Driver Services" style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#6b7280", display: "block", marginBottom: 3 }}>Couleur primaire</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: 34, height: 30, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
              <input value={color} onChange={e => setColor(e.target.value)} style={{ ...inputStyle, width: 90 }} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={save} disabled={saving}
              style={{
                background: saving ? "#1e2330" : "#f5a623", color: saving ? "#555e75" : "#080a0f",
                border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, cursor: saving ? "default" : "pointer", fontSize: 12,
              }}>
              {saving ? "Enregistrement…" : "Enregistrer le branding"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
