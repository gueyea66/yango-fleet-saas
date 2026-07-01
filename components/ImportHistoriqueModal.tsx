"use client";

import { useState, useRef, useCallback } from "react";

/* ─── Types ─────────────────────────────────────────────── */
interface ParsedRow {
  row: number;
  date: string;
  driver_name: string;
  ca_brut: number | null;
  km_parcourus: number | null;
  nombre_courses: number | null;
  frais_carburant: number | null;
  notes: string;
  is_duplicate: boolean;
  has_error: boolean;
}
interface ValidationError {
  row: number;
  field: string;
  message: string;
}
interface ParseResult {
  batchId: string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  driversFound: string[];
  parsedRows: ParsedRow[];
  validationErrors: ValidationError[];
}

type Step = "upload" | "preview" | "confirm" | "submitted";

interface Props {
  onClose: () => void;
}

const fmtXOF = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("fr-FR").format(n) + " XOF";

/* ─── Template CSV ─────────────────────────────────────── */
const CSV_TEMPLATE =
  "date,chauffeur,ca_brut,km_parcourus,nombre_courses,frais_carburant,notes\n" +
  "2026-01-15,Ibrahim Diallo,185000,220,12,25000,\n" +
  "2026-01-16,Mamadou Sow,210000,245,14,28000,Journée chargée\n";

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "template_import_historique.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Component ────────────────────────────────────────── */
export default function ImportHistoriqueModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [filterRow, setFilterRow] = useState<"all" | "errors" | "duplicates">("all");
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Upload + parse ── */
  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur lors du parsing");
      setResult(data);
      setStep("preview");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }, [file]);

  /* ── Confirmation admin ── */
  const handleConfirm = useCallback(async () => {
    if (!result) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/import/${result.batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur lors de la confirmation");
      setStep("submitted");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }, [result, notes]);

  /* ── Filtered rows ── */
  const filteredRows = result
    ? result.parsedRows.filter((r) => {
        if (filterRow === "errors") return r.has_error;
        if (filterRow === "duplicates") return r.is_duplicate && !r.has_error;
        return true;
      })
    : [];

  /* ─── Styles inline (pas de dépendance Tailwind pour le modal) ─── */
  const s = {
    overlay: {
      position: "fixed" as const,
      inset: 0,
      background: "rgba(10,18,32,.75)",
      zIndex: 9000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
    },
    modal: {
      background: "#fff",
      borderRadius: 16,
      width: "100%",
      maxWidth: step === "preview" ? 860 : 520,
      maxHeight: "90vh",
      display: "flex",
      flexDirection: "column" as const,
      overflow: "hidden",
      boxShadow: "0 24px 80px rgba(0,0,0,.35)",
    },
    header: {
      padding: "18px 24px",
      borderBottom: "1px solid #e8e4de",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexShrink: 0,
    },
    title: { fontSize: 16, fontWeight: 700, color: "#0a1220" },
    sub: { fontSize: 12, color: "#7a839a", marginTop: 2 },
    close: {
      background: "none",
      border: "none",
      fontSize: 20,
      cursor: "pointer",
      color: "#7a839a",
      lineHeight: 1,
      padding: "0 4px",
    },
    body: { padding: "24px", overflow: "auto" as const, flex: 1 },
    footer: {
      padding: "16px 24px",
      borderTop: "1px solid #e8e4de",
      display: "flex",
      gap: 10,
      justifyContent: "flex-end",
      flexShrink: 0,
    },
    btn: (primary: boolean, danger = false) => ({
      padding: "9px 20px",
      borderRadius: 8,
      fontWeight: 600,
      fontSize: 13,
      cursor: "pointer",
      border: "none",
      background: danger ? "#ef4444" : primary ? "#0a1220" : "#f0ece4",
      color: danger ? "#fff" : primary ? "#fff" : "#1a2230",
    }),
    dropzone: {
      border: "2px dashed #c8c2b8",
      borderRadius: 12,
      padding: "36px 24px",
      textAlign: "center" as const,
      cursor: "pointer",
      background: "#faf9f7",
      marginBottom: 20,
      transition: "border-color .15s",
    },
    stat: (color: string) => ({
      flex: 1,
      background: "#f5f4f0",
      border: `1px solid ${color}33`,
      borderTop: `3px solid ${color}`,
      borderRadius: 10,
      padding: "12px 14px",
      textAlign: "center" as const,
    }),
    statNum: (color: string) => ({
      fontSize: 24,
      fontWeight: 800,
      color,
      lineHeight: 1,
      marginBottom: 4,
    }),
    statLbl: {
      fontSize: 10,
      color: "#7a839a",
      textTransform: "uppercase" as const,
      letterSpacing: "0.08em",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse" as const,
      fontSize: 12,
    },
    th: {
      padding: "7px 10px",
      background: "#0a1220",
      color: "rgba(255,255,255,.7)",
      fontWeight: 600,
      fontSize: 10,
      textTransform: "uppercase" as const,
      letterSpacing: "0.08em",
      textAlign: "left" as const,
    },
    td: (highlight?: string) => ({
      padding: "6px 10px",
      borderBottom: "1px solid #e8e4de",
      color: "#1a2230",
      background: highlight ?? "transparent",
      verticalAlign: "top" as const,
    }),
    badge: (color: string, bg: string) => ({
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 100,
      fontSize: 10,
      fontWeight: 700,
      color,
      background: bg,
    }),
    errBox: {
      background: "#fef2f2",
      border: "1px solid #fecaca",
      borderRadius: 8,
      padding: "10px 14px",
      color: "#dc2626",
      fontSize: 13,
      marginBottom: 16,
    },
    infoBox: {
      background: "#f0f9ff",
      border: "1px solid #bae6fd",
      borderRadius: 8,
      padding: "12px 16px",
      color: "#0369a1",
      fontSize: 12.5,
      marginBottom: 16,
      lineHeight: 1.6,
    },
    filterBtns: {
      display: "flex",
      gap: 8,
      marginBottom: 12,
    },
    filterBtn: (active: boolean) => ({
      padding: "5px 14px",
      borderRadius: 100,
      fontSize: 12,
      fontWeight: 600,
      border: "1px solid",
      cursor: "pointer",
      background: active ? "#0a1220" : "transparent",
      color: active ? "#fff" : "#7a839a",
      borderColor: active ? "#0a1220" : "#c8c2b8",
    }),
  };

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.header}>
          <div>
            <div style={s.title}>
              {step === "upload" && "Import d'historique"}
              {step === "preview" && "Vérification des données"}
              {step === "confirm" && "Confirmation avant envoi"}
              {step === "submitted" && "Import soumis"}
            </div>
            <div style={s.sub}>
              {step === "upload" && "Importez vos données historiques depuis un fichier CSV"}
              {step === "preview" && "Vérifiez que vos données sont correctes avant de soumettre"}
              {step === "confirm" && "Un message sera envoyé à M3A pour injection"}
              {step === "submitted" && "M3A Group procédera à l'injection dans les 24h"}
            </div>
          </div>
          <button style={s.close} onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div style={s.body}>

          {/* ── ÉTAPE 1 : UPLOAD ── */}
          {step === "upload" && (
            <>
              <div style={s.infoBox}>
                <strong>Comment ça marche :</strong><br />
                1. Téléchargez le template CSV ci-dessous<br />
                2. Remplissez-le avec votre historique (Excel → Enregistrer sous → CSV)<br />
                3. Uploadez le fichier — les données sont analysées automatiquement<br />
                4. Vérifiez et confirmez — M3A injecte dans les 24h
              </div>

              <button
                style={{ ...s.btn(false), marginBottom: 20, width: "100%", padding: "11px", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}
                onClick={downloadTemplate}
              >
                ⬇ Télécharger le template CSV
              </button>

              <div
                style={s.dropzone}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) setFile(f);
                }}
              >
                {file ? (
                  <>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                    <div style={{ fontWeight: 700, color: "#0a1220", marginBottom: 4 }}>{file.name}</div>
                    <div style={{ fontSize: 12, color: "#7a839a" }}>
                      {(file.size / 1024).toFixed(1)} KB — cliquez pour changer
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>📂</div>
                    <div style={{ fontWeight: 600, color: "#1a2230", marginBottom: 6 }}>
                      Glissez votre fichier CSV ici
                    </div>
                    <div style={{ fontSize: 12, color: "#7a839a" }}>ou cliquez pour sélectionner</div>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {error && <div style={s.errBox}>{error}</div>}
            </>
          )}

          {/* ── ÉTAPE 2 : PRÉVISUALISATION ── */}
          {step === "preview" && result && (
            <>
              {/* Stats */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <div style={s.stat("#0a1220")}>
                  <div style={s.statNum("#0a1220")}>{result.rowCount}</div>
                  <div style={s.statLbl}>Lignes total</div>
                </div>
                <div style={s.stat("#22c55e")}>
                  <div style={s.statNum("#22c55e")}>{result.validCount}</div>
                  <div style={s.statLbl}>Valides</div>
                </div>
                <div style={s.stat(result.errorCount > 0 ? "#ef4444" : "#22c55e")}>
                  <div style={s.statNum(result.errorCount > 0 ? "#ef4444" : "#22c55e")}>{result.errorCount}</div>
                  <div style={s.statLbl}>Erreurs</div>
                </div>
                <div style={s.stat(result.duplicateCount > 0 ? "#f59e0b" : "#94a3b8")}>
                  <div style={s.statNum(result.duplicateCount > 0 ? "#f59e0b" : "#94a3b8")}>{result.duplicateCount}</div>
                  <div style={s.statLbl}>Doublons</div>
                </div>
              </div>

              {/* Résumé */}
              {result.dateFrom && (
                <div style={{ fontSize: 12.5, color: "#7a839a", marginBottom: 14 }}>
                  Période : <strong style={{ color: "#0a1220" }}>{result.dateFrom}</strong> → <strong style={{ color: "#0a1220" }}>{result.dateTo}</strong>
                  &nbsp;·&nbsp; Chauffeurs : <strong style={{ color: "#0a1220" }}>{result.driversFound.join(", ") || "aucun reconnu"}</strong>
                </div>
              )}

              {result.errorCount > 0 && (
                <div style={{ ...s.errBox, marginBottom: 14 }}>
                  <strong>{result.errorCount} ligne(s) contiennent des erreurs</strong> — elles ne seront pas injectées.
                  Corrigez votre CSV et re-uploadez si vous souhaitez les inclure.
                </div>
              )}

              {result.duplicateCount > 0 && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", color: "#92400e", fontSize: 12.5, marginBottom: 14 }}>
                  <strong>{result.duplicateCount} ligne(s) déjà présentes</strong> en base (même chauffeur + même date) — elles seront ignorées lors de l'injection.
                </div>
              )}

              {/* Filtre */}
              <div style={s.filterBtns}>
                {(["all", "errors", "duplicates"] as const).map((f) => (
                  <button key={f} style={s.filterBtn(filterRow === f)} onClick={() => setFilterRow(f)}>
                    {f === "all" ? `Tout (${result.rowCount})` : f === "errors" ? `Erreurs (${result.errorCount})` : `Doublons (${result.duplicateCount})`}
                  </button>
                ))}
              </div>

              {/* Table preview */}
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e8e4de" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>#</th>
                      <th style={s.th}>Date</th>
                      <th style={s.th}>Chauffeur</th>
                      <th style={s.th}>CA Brut</th>
                      <th style={s.th}>KM</th>
                      <th style={s.th}>Courses</th>
                      <th style={s.th}>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 100).map((r) => (
                      <tr key={r.row}>
                        <td style={s.td(r.has_error ? "#fef2f2" : r.is_duplicate ? "#fffbeb" : undefined)}>{r.row}</td>
                        <td style={s.td(r.has_error ? "#fef2f2" : r.is_duplicate ? "#fffbeb" : undefined)}>{r.date || <span style={{ color: "#ef4444" }}>manquant</span>}</td>
                        <td style={s.td(r.has_error ? "#fef2f2" : r.is_duplicate ? "#fffbeb" : undefined)}>{r.driver_name || <span style={{ color: "#ef4444" }}>—</span>}</td>
                        <td style={s.td(r.has_error ? "#fef2f2" : r.is_duplicate ? "#fffbeb" : undefined)}>{fmtXOF(r.ca_brut)}</td>
                        <td style={s.td(r.has_error ? "#fef2f2" : r.is_duplicate ? "#fffbeb" : undefined)}>{r.km_parcourus ?? "—"}</td>
                        <td style={s.td(r.has_error ? "#fef2f2" : r.is_duplicate ? "#fffbeb" : undefined)}>{r.nombre_courses ?? "—"}</td>
                        <td style={s.td(r.has_error ? "#fef2f2" : r.is_duplicate ? "#fffbeb" : undefined)}>
                          {r.has_error && <span style={s.badge("#dc2626", "#fee2e2")}>Erreur</span>}
                          {!r.has_error && r.is_duplicate && <span style={s.badge("#92400e", "#fef3c7")}>Doublon</span>}
                          {!r.has_error && !r.is_duplicate && <span style={s.badge("#15803d", "#dcfce7")}>OK</span>}
                        </td>
                      </tr>
                    ))}
                    {filteredRows.length > 100 && (
                      <tr>
                        <td colSpan={7} style={{ ...s.td(), textAlign: "center", color: "#7a839a", padding: 12 }}>
                          + {filteredRows.length - 100} lignes supplémentaires
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {error && <div style={{ ...s.errBox, marginTop: 12 }}>{error}</div>}
            </>
          )}

          {/* ── ÉTAPE 3 : CONFIRM ── */}
          {step === "confirm" && result && (
            <>
              <div style={s.infoBox}>
                Vous allez soumettre cet import à <strong>M3A Group</strong> pour injection.
                Les <strong>{result.validCount - result.duplicateCount} lignes valides</strong> seront ajoutées à votre historique.
                Les {result.errorCount} erreurs et {result.duplicateCount} doublons seront ignorés.
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontWeight: 600, fontSize: 13, color: "#0a1220", marginBottom: 8 }}>
                  Note pour M3A (optionnel)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex : Données Yango K3 Janvier–Juin 2026. Les frais carburant sont en XOF."
                  style={{
                    width: "100%", padding: "10px 12px",
                    border: "1.5px solid #c8c2b8", borderRadius: 8,
                    fontSize: 13, color: "#0a1220",
                    resize: "vertical", minHeight: 80,
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ background: "#f5f4f0", border: "1px solid #e2ddd5", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0a1220", marginBottom: 10 }}>Récapitulatif</div>
                {[
                  ["Période", `${result.dateFrom} → ${result.dateTo}`],
                  ["Chauffeurs", result.driversFound.join(", ") || "—"],
                  ["Lignes à injecter", `${result.validCount - result.duplicateCount} sur ${result.rowCount}`],
                  ["Doublons ignorés", result.duplicateCount],
                  ["Lignes avec erreur ignorées", result.errorCount],
                ].map(([k, v]) => (
                  <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #e2ddd5", fontSize: 13 }}>
                    <span style={{ color: "#7a839a" }}>{k}</span>
                    <strong style={{ color: "#0a1220" }}>{String(v)}</strong>
                  </div>
                ))}
              </div>

              {error && <div style={{ ...s.errBox, marginTop: 14 }}>{error}</div>}
            </>
          )}

          {/* ── ÉTAPE 4 : SOUMIS ── */}
          {step === "submitted" && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0a1220", marginBottom: 10 }}>
                Import soumis avec succès
              </div>
              <div style={{ fontSize: 13.5, color: "#7a839a", lineHeight: 1.7, maxWidth: 360, margin: "0 auto 24px" }}>
                M3A Group a été notifié. L'équipe va vérifier le format et procéder à l'injection dans votre base de données sous <strong style={{ color: "#0a1220" }}>24h ouvrées</strong>.
              </div>
              <div style={{ background: "#f5f4f0", border: "1px solid #e2ddd5", borderRadius: 10, padding: "14px 16px", fontSize: 12.5, color: "#7a839a", textAlign: "left" }}>
                Une fois injecté, vos données historiques apparaîtront dans le dashboard, les KPIs et les exports comme des rapports normaux, avec la mention <em>importé</em>.
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={s.footer}>
          {step === "upload" && (
            <>
              <button style={s.btn(false)} onClick={onClose}>Annuler</button>
              <button
                style={{ ...s.btn(true), opacity: !file || uploading ? 0.5 : 1 }}
                onClick={handleUpload}
                disabled={!file || uploading}
              >
                {uploading ? "Analyse en cours…" : "Analyser le fichier →"}
              </button>
            </>
          )}
          {step === "preview" && (
            <>
              <button style={s.btn(false)} onClick={() => { setStep("upload"); setResult(null); setFile(null); }}>
                ← Recommencer
              </button>
              <button
                style={{ ...s.btn(true), opacity: result && result.validCount - result.duplicateCount === 0 ? 0.4 : 1 }}
                disabled={!result || result.validCount - result.duplicateCount === 0}
                onClick={() => setStep("confirm")}
              >
                Ces données sont correctes →
              </button>
            </>
          )}
          {step === "confirm" && (
            <>
              <button style={s.btn(false)} onClick={() => setStep("preview")}>← Retour</button>
              <button
                style={{ ...s.btn(true), opacity: confirming ? 0.5 : 1 }}
                onClick={handleConfirm}
                disabled={confirming}
              >
                {confirming ? "Envoi…" : "Soumettre à M3A pour injection"}
              </button>
            </>
          )}
          {step === "submitted" && (
            <button style={s.btn(true)} onClick={onClose}>Fermer</button>
          )}
        </div>

      </div>
    </div>
  );
}
