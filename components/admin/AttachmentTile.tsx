"use client";

// Une pièce jointe (photo, reçu, PDF) dans les panneaux de validation /
// historique. Remplace le simple <img> qui, en cas d'échec, affichait une
// vignette cassée ou rien du tout (retour Abdou 01/10 : « je ne vois pas les
// photos ») : signature refusée → « Photo indisponible » + Réessayer ;
// HEIC/HEIF (iPhone) → lien d'ouverture, aucun navigateur hors Safari ne
// l'affiche dans un <img>.
import { useState } from "react";
import { ImageOff, Paperclip, RotateCw, ExternalLink } from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any -- lignes `uploads` non typées (convention du projet) */

const box = { display: "flex", flexDirection: "column", gap: 6, padding: "12px 12px", borderRadius: 10, background: "var(--sk-bg)", border: "1px dashed var(--sk-border)", fontSize: 12, color: "var(--sk-t2)" } as const;
const nameStyle = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--sk-t3)" } as const;
const linkBtn = { display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, color: "var(--tenant-color)", fontSize: 12, cursor: "pointer" } as const;

export function AttachmentTile({ u, onRetry, maxHeight = 220 }: { u: any; onRetry?: () => void; maxHeight?: number }) {
  const [broken, setBroken] = useState(false);

  if (u.signFailed || !u.publicUrl) {
    return (
      <div style={box} role="note">
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><ImageOff size={14} aria-hidden />Photo indisponible</span>
        <span style={nameStyle} title={u.file_name}>{u.file_name || u.file_path}</span>
        {onRetry && <button type="button" onClick={onRetry} className="v2-focus" style={linkBtn}><RotateCw size={12} aria-hidden />Réessayer</button>}
      </div>
    );
  }

  if (u.kind === "heic" || (u.isImg && broken)) {
    return (
      <div style={box}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
          <ImageOff size={14} aria-hidden />{u.kind === "heic" ? "Photo HEIC — aperçu impossible ici" : "Aperçu impossible"}
        </span>
        <span style={nameStyle} title={u.file_name}>{u.file_name}</span>
        <span style={{ display: "flex", gap: 12 }}>
          <a href={u.publicUrl} target="_blank" rel="noopener noreferrer" download={u.file_name || true} style={linkBtn}><ExternalLink size={12} aria-hidden />Ouvrir / télécharger</a>
          {broken && onRetry && <button type="button" onClick={() => { setBroken(false); onRetry(); }} className="v2-focus" style={linkBtn}><RotateCw size={12} aria-hidden />Réessayer</button>}
        </span>
      </div>
    );
  }

  if (u.isImg) {
    return (
      <a href={u.publicUrl} target="_blank" rel="noopener noreferrer" className="v2-focus" style={{ display: "block", borderRadius: 10, overflow: "hidden", border: "1px solid var(--sk-surface)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- URL de stockage signée */}
        <img src={u.publicUrl} alt={u.file_name} onError={() => { console.error("[AttachmentTile] image illisible", u.file_path); setBroken(true); }}
          style={{ width: "100%", maxHeight, objectFit: "cover", display: "block" }} />
      </a>
    );
  }

  return (
    <a href={u.publicUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--sk-t2)", padding: "8px 10px", borderRadius: 8, background: "var(--sk-bg)", border: "1px solid var(--sk-surface)" }}>
      <Paperclip size={13} aria-hidden /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.file_name}</span>
    </a>
  );
}
