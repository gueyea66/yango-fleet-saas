"use client";

/**
 * Saisie opérateur et validation (migration 075).
 * - SaisieOperateurV2 : l'opérateur (ex. dispatcher) saisit pour un chauffeur
 *   ses recettes hors Yango d'un jour, ou une charge avec preuve obligatoire.
 *   Il corrige ou annule sa saisie tant qu'elle n'est pas validée. Un
 *   décaissement (avance de fonds) ne se saisit que par un admin valideur.
 * - SaisiesAValiderV2 : un admin valideur (pas l'auteur) valide ou rejette.
 * - AdministrateursV2 : un valideur passe un admin en « saisie seule ».
 * - ObjectifFlotteV2 : « chaque chauffeur fait-il l'objectif ? », en un coup d'œil.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Check, Paperclip, ShieldCheck, X } from "lucide-react";
import { Button, Card, Segmented } from "@/components/ui";
import { formatAmount } from "@/lib/v2/format";
import { CATEGORIES_OPERATEUR, MDP_ADMIN_MIN } from "@/lib/operateur";
import { envoyerPieces, messageEchecs } from "@/lib/uploadPieces";
import { obtenirUrlsSignees } from "@/lib/signedUrls";
import { enrichUpload } from "@/lib/v2/history";
import { AttachmentTile } from "@/components/admin/AttachmentTile";
import { statutDe } from "@/lib/analytics/trends";
import { notifyDataChanged, useDataRefresh } from "@/lib/dataRefresh";
import type { SegmentFilter } from "@/lib/analytics/segment";
import { ObjectifControl, STATUS_COLOR, StatusPill, usePerfMeta } from "./perfShared";

type TypeSaisie = "hors_yango" | "charge" | "decaissement";
type Driver = { id: string; full_name?: string | null; driver_id?: string | null; active?: boolean | null; account_type?: string | null };

const field: CSSProperties = { width: "100%", minWidth: 0, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--sk-border)", background: "var(--sk-bg)", color: "inherit", fontSize: 16 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--v2-muted)", minWidth: 0 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10 };
const today = () => new Date().toISOString().slice(0, 10);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const STATUT: Record<string, { txt: string; c: string }> = {
  submitted: { txt: "En attente", c: STATUS_COLOR.proche }, approved: { txt: "Validée", c: STATUS_COLOR.atteint }, rejected: { txt: "Rejetée", c: STATUS_COLOR.sous },
};

function StatutBadge({ s }: { s: string }) {
  const m = STATUT[s] ?? { txt: s, c: "var(--v2-muted)" };
  return <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: `${m.c}26`, boxShadow: `inset 0 0 0 1px ${m.c}66`, whiteSpace: "nowrap" }}>{m.txt}</span>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || `Erreur ${res.status}`), { doublon: j.doublon === true });
  return j as T;
}

interface SaisiesData {
  me: { id: string; peut_valider: boolean };
  horsYango: { id: string; driver_id: string; chauffeur: string; jour: string; montant: number; courses: number; note: string | null; status: string; saisi_par: string | null; valide_par: string | null; entered_by: string | null; rejection_reason: string | null }[];
  charges: { id: string; driver_id: string; chauffeur: string; expense_date: string; category: string; amount: number; description: string | null; status: string; saisi_par: string | null; valide_par: string | null; entered_by: string | null; pieces: number; fichiers: { file_path: string; file_name: string | null }[];
    rejection_reason: string | null; decaissement: boolean; advance_driver_id: string | null; beneficiaire: string | null; doublons: { origine: string; status: string }[] }[];
}

function useSaisies(statut: "submitted" | "all", tick: number) {
  const [data, setData] = useState<SaisiesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const from = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
      setData(await api<SaisiesData>(`/api/admin/saisies?statut=${statut}${statut === "all" ? `&dateFrom=${from}` : ""}`));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [statut]);
  const { tick: auto } = useDataRefresh(); // saisies d'un autre administrateur visibles sans recharger
  useEffect(() => { void Promise.resolve().then(load); }, [load, tick, auto]);
  return { data, error, reload: load };
}

/* ── Saisie (opérateur) ─────────────────────────────────────── */

export function SaisieOperateurV2({ drivers, tenantId }: { drivers: Driver[]; tenantId: string }) {
  const [type, setType] = useState<TypeSaisie>("hors_yango");
  const [benef, setBenef] = useState("");
  // saisie en cours de correction (la sienne, encore en attente)
  const [edit, setEdit] = useState<{ id: string; pieces: number } | null>(null);
  const [driverId, setDriverId] = useState("");
  const [jour, setJour] = useState(today());
  const [montant, setMontant] = useState("");
  const [courses, setCourses] = useState("");
  const [categorie, setCategorie] = useState<string>(CATEGORIES_OPERATEUR[0]);
  const [texte, setTexte] = useState("");
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [tick, setTick] = useState(0);
  const { data, error } = useSaisies("all", tick);
  const chauffeurs = drivers.filter((d) => d.account_type !== "technical" && d.active !== false);
  const techniques = drivers.filter((d) => d.account_type === "technical" && d.active !== false);
  const valideur = data?.me.peut_valider === true;
  const avecPreuve = type !== "hors_yango";
  const comptes = type === "decaissement" ? techniques : chauffeurs;

  const reset = () => { setMontant(""); setCourses(""); setTexte(""); setFichiers([]); setBenef(""); setEdit(null); };
  const changerType = (t: TypeSaisie) => { setType(t); setMsg(null); setDriverId(""); setBenef(""); setEdit(null); };
  const submit = async () => {
    setMsg(null);
    if (!driverId) return setMsg({ ok: false, t: type === "decaissement" ? "Choisissez le compte de décaissement." : "Choisissez le chauffeur." });
    if (!(Number(montant) > 0)) return setMsg({ ok: false, t: "Montant requis." });
    if (type === "decaissement" && !texte.trim()) return setMsg({ ok: false, t: "Motif du décaissement obligatoire." });
    if (avecPreuve && fichiers.length + (edit?.pieces ?? 0) === 0) return setMsg({ ok: false, t: "Preuve obligatoire : ajoutez une photo du reçu." });
    setBusy(true);
    try {
      const champs = type === "hors_yango"
        ? { type, driver_id: driverId, jour, montant: Number(montant), courses: courses ? Number(courses) : 0, note: texte }
        : type === "charge"
          ? { type, driver_id: driverId, date: jour, categorie, montant: Number(montant), description: texte }
          : { type, driver_id: driverId, date: jour, montant: Number(montant), description: texte, advance_driver_id: benef || null };
      let id: string;
      if (edit) {
        // correction : un décaissement est une ligne « charge » côté API
        await api("/api/admin/saisies", { method: "PUT", body: JSON.stringify({ ...champs, type: type === "hors_yango" ? type : "charge", id: edit.id }) });
        id = edit.id;
      } else {
        const envoyer = (extra?: object) => api<{ id: string }>("/api/admin/saisies", { method: "POST", body: JSON.stringify({ ...champs, ...extra }) });
        try { ({ id } = await envoyer()); }
        catch (e) {
          // même dépense déjà déclarée (par le chauffeur ou l'exploitation) : on demande avant de doubler
          if (!(e as { doublon?: boolean }).doublon) throw e;
          if (!confirm(`${(e as Error).message}\n\nEnregistrer quand même cette charge ?`)) return;
          ({ id } = await envoyer({ confirmer_doublon: true }));
        }
      }
      if (avecPreuve && fichiers.length) {
        // preuve rattachée au chauffeur concerné (driver_id) et à la charge (ref_id)
        const r = await envoyerPieces({ fichiers, driverId, tenantId, fileType: "expense", refId: id });
        const m = messageEchecs(r);
        if (m) { setMsg({ ok: false, t: `Saisie enregistrée mais preuve incomplète :\n${m}` }); setFichiers([]); setEdit({ id, pieces: (edit?.pieces ?? 0) + r.reussies }); setTick((t) => t + 1); return; }
      }
      setMsg({ ok: true, t: edit ? "Saisie corrigée." : type === "charge" ? "Charge envoyée en validation." : type === "decaissement" ? "Décaissement envoyé en validation." : "Hors Yango envoyé en validation." });
      reset(); setTick((t) => t + 1); notifyDataChanged();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  // sa propre saisie, encore en attente : corrigeable et annulable
  const aMoi = (x: { entered_by: string | null; status: string }) => x.status === "submitted" && !!data && x.entered_by === data.me.id;
  const corriger = (l: Ligne) => {
    setMsg(null); setFichiers([]);
    if (l.h) {
      setType("hors_yango"); setDriverId(l.h.driver_id); setJour(l.h.jour); setMontant(String(l.h.montant)); setCourses(l.h.courses ? String(l.h.courses) : ""); setTexte(l.h.note ?? "");
      setEdit({ id: l.h.id, pieces: 0 });
    } else if (l.c) {
      setType(l.c.decaissement ? "decaissement" : "charge"); setDriverId(l.c.driver_id); setJour(l.c.expense_date); setMontant(String(l.c.amount)); setTexte(l.c.description ?? "");
      if (l.c.decaissement) setBenef(l.c.advance_driver_id ?? ""); else setCategorie(l.c.category);
      setEdit({ id: l.c.id, pieces: l.c.pieces });
    }
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const annuler = async (l: Ligne) => {
    if (!confirm("Annuler cette saisie ? Elle est supprimée, avec sa preuve.")) return;
    setBusy(true);
    try {
      await api(`/api/admin/saisies?type=${l.h ? "hors_yango" : "charge"}&id=${(l.h ?? l.c)!.id}`, { method: "DELETE" });
      if (edit?.id === (l.h ?? l.c)!.id) reset();
      setMsg({ ok: true, t: "Saisie annulée." }); setTick((t) => t + 1); notifyDataChanged();
    } catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };

  type Ligne = { k: string; date: string; chauffeur: string; quoi: string; montant: number; status: string; info: string; mine: boolean; h?: SaisiesData["horsYango"][number]; c?: SaisiesData["charges"][number] };
  const lignes: Ligne[] = [
    ...(data?.horsYango ?? []).map((s) => ({ k: `h${s.id}`, date: s.jour, chauffeur: s.chauffeur, quoi: `Hors Yango${s.courses ? ` · ${s.courses} course(s)` : ""}`, montant: s.montant, status: s.status, info: s.rejection_reason ? `Motif : ${s.rejection_reason}` : s.valide_par ? `par ${s.valide_par}` : "", mine: aMoi(s), h: s })),
    ...(data?.charges ?? []).map((c) => ({ k: `c${c.id}`, date: c.expense_date, chauffeur: c.decaissement && c.beneficiaire ? `${c.chauffeur} → ${c.beneficiaire}` : c.chauffeur, quoi: `${c.decaissement ? "Décaissement" : c.category}${c.pieces ? ` · 📎 ${c.pieces}` : " · sans preuve"}`, montant: c.amount, status: c.status, info: c.rejection_reason ? `Motif : ${c.rejection_reason}` : c.valide_par ? `par ${c.valide_par}` : "", mine: aMoi(c), c })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{edit ? "Corriger la saisie" : "Nouvelle saisie"}</div>
              <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>{type === "decaissement"
                ? "Sortie de fonds du compte de décaissement. Elle part en validation chez un autre administrateur valideur."
                : "Saisie pour le compte d\u2019un chauffeur. Elle part en validation chez un autre administrateur."}</div>
            </div>
            {!edit && (
              <Segmented options={[{ key: "hors_yango" as const, label: "Recette hors Yango" }, { key: "charge" as const, label: "Charge" },
                // décaissement : administrateurs valideurs seulement (un profil « saisie seule » ne le voit pas)
                ...(valideur ? [{ key: "decaissement" as const, label: "Décaissement" }] : [])]} value={type} onChange={changerType} ariaLabel="Type de saisie" />
            )}
          </div>
          {type === "decaissement" && techniques.length === 0 && (
            <div style={{ fontSize: 13, color: STATUS_COLOR.sous }}>Aucun compte de décaissement : créez un compte technique dans Équipe (type de compte « Compte technique »).</div>
          )}
          <div style={grid}>
            <label style={label}>{type === "decaissement" ? "Compte de décaissement" : `Chauffeur${type === "charge" ? " concerné" : ""}`}
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)} style={field}>
                <option value="">— Choisir —</option>
                {comptes.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.driver_id}</option>)}
              </select>
            </label>
            {type === "decaissement" && (
              <label style={label}>Remis à (facultatif)
                <select value={benef} onChange={(e) => setBenef(e.target.value)} style={field}>
                  <option value="">— Aucun chauffeur —</option>
                  {chauffeurs.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.driver_id}</option>)}
                </select>
              </label>
            )}
            <label style={label}>{type === "hors_yango" ? "Jour" : type === "charge" ? "Date de la dépense" : "Date du décaissement"}
              <input type="date" value={jour} max={today()} onChange={(e) => setJour(e.target.value)} style={field} />
            </label>
            {type === "charge" && (
              <label style={label}>Catégorie
                <select value={categorie} onChange={(e) => setCategorie(e.target.value)} style={field}>
                  {CATEGORIES_OPERATEUR.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            <label style={label}>Montant (XOF)
              <input inputMode="numeric" value={montant} onChange={(e) => setMontant(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" style={field} />
            </label>
            {type === "hors_yango" && (
              <label style={label}>Courses (facultatif)
                <input inputMode="numeric" value={courses} onChange={(e) => setCourses(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" style={field} />
              </label>
            )}
          </div>
          <label style={label}>{type === "charge" ? `Commentaire${categorie === "Autre" ? " (obligatoire)" : " (facultatif)"}` : type === "decaissement" ? "Motif (obligatoire)" : "Commentaire (facultatif)"}
            <input value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={500} style={field} placeholder={type === "charge" ? "Ex. plein station Total VDN" : type === "decaissement" ? "Ex. avance réparation embrayage" : "Ex. course privée aéroport"} />
          </label>
          {avecPreuve && (
            <label style={{ ...label, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, border: "1px dashed var(--sk-border)", cursor: "pointer", color: "var(--sk-t1, inherit)" }}>
                <Paperclip size={14} aria-hidden /> {edit?.pieces ? "Ajouter une preuve" : "Preuve (photo du reçu) — obligatoire"}
              </span>
              <input type="file" accept="image/*,application/pdf" capture="environment" multiple style={{ display: "none" }}
                onChange={(e) => setFichiers(Array.from(e.target.files || []))} />
              <span style={{ fontSize: 12 }}>{fichiers.length ? `${fichiers.length} fichier(s) : ${fichiers.map((f) => f.name).join(", ")}` : edit?.pieces ? `${edit.pieces} preuve(s) déjà jointe(s)` : "Aucun fichier"}</span>
            </label>
          )}
          {msg && <div role="status" style={{ fontSize: 13, whiteSpace: "pre-line", color: msg.ok ? STATUS_COLOR.atteint : STATUS_COLOR.sous }}>{msg.t}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => void submit()} disabled={busy}>{busy ? "Envoi…" : edit ? "Enregistrer la correction" : "Envoyer en validation"}</Button>
            {edit && <Button variant="outline" disabled={busy} onClick={() => { reset(); setMsg(null); }}>Abandonner la correction</Button>}
          </div>
        </div>
      </Card>

      <Card flush>
        <div style={{ padding: "14px 16px 4px", fontSize: 15, fontWeight: 600 }}>Saisies récentes (45 jours)</div>
        {error ? <div style={{ padding: 16, color: STATUS_COLOR.sous, fontSize: 13 }}>{error}</div>
          : !data ? <div className="v2-skeleton" style={{ height: 80, margin: 16 }} aria-hidden />
          : lignes.length === 0 ? <div style={{ padding: 16, fontSize: 13, color: "var(--v2-muted)" }}>Aucune saisie.</div>
          : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {lignes.map((l) => (
                <div key={l.k} style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--sk-border)" }}>
                  <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>{ddmm(l.date)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.chauffeur}</div>
                    <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>{l.quoi}{l.info ? ` · ${l.info}` : ""}</div>
                    {l.mine && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => corriger(l)}>{l.c && l.c.pieces === 0 ? "Corriger / ajouter la preuve" : "Corriger"}</Button>
                        <Button size="sm" variant="outline" icon={X} disabled={busy} onClick={() => void annuler(l)}>Annuler</Button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <span className="v2-num" style={{ fontWeight: 600 }}>{formatAmount(l.montant)}</span>
                    <StatutBadge s={l.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  );
}

/* ── Validation (admin valideur) ────────────────────────────── */

function Preuves({ fichiers }: { fichiers: { file_path: string; file_name: string | null }[] }) {
  const [items, setItems] = useState<ReturnType<typeof enrichUpload>[] | null>(null);
  const load = useCallback(async () => {
    const urls = await obtenirUrlsSignees(fichiers.map((f) => f.file_path));
    setItems(fichiers.map((f) => enrichUpload(f, urls[f.file_path])));
  }, [fichiers]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  if (!fichiers.length) return <div style={{ fontSize: 12, color: STATUS_COLOR.sous }}>Aucune preuve jointe : validation impossible.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 160px), 1fr))", gap: 8 }}>
      {(items ?? []).map((u, i) => <AttachmentTile key={i} u={u} onRetry={() => void load()} maxHeight={160} />)}
    </div>
  );
}

export function SaisiesAValiderV2({ onChanged }: { onChanged?: () => void }) {
  const [tick, setTick] = useState(0);
  const { data, error } = useSaisies("submitted", tick);
  const [busy, setBusy] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  if (error) return error.includes("migration") ? null : <Card><div style={{ fontSize: 13, color: STATUS_COLOR.sous }}>{error}</div></Card>;
  if (!data) return null;
  const total = data.horsYango.length + data.charges.length;
  if (!total) return null;

  const decide = async (type: "hors_yango" | "charge", id: string, decision: "approved" | "rejected") => {
    let motif: string | null = null;
    if (decision === "rejected") { motif = prompt("Motif du rejet (visible par l'opérateur) :") ?? null; if (motif === null) return; }
    setBusy(id);
    try {
      await api("/api/admin/saisies", { method: "PATCH", body: JSON.stringify({ type, id, decision, motif }) });
      setTick((t) => t + 1); onChanged?.();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const actions = (type: "hors_yango" | "charge", id: string, auteur: string | null, sansPreuve = false) => {
    if (!data.me.peut_valider) return <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>Validation par un autre admin</span>;
    if (auteur && auteur === data.me.id) return <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>Votre saisie : un autre admin valide</span>;
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="sm" icon={Check} disabled={busy === id || sansPreuve} title={sansPreuve ? "Preuve manquante" : undefined} onClick={() => void decide(type, id, "approved")}>Valider</Button>
        <Button size="sm" variant="outline" icon={X} disabled={busy === id} onClick={() => void decide(type, id, "rejected")}>Rejeter</Button>
      </div>
    );
  };

  return (
    <Card flush>
      <div style={{ padding: "14px 16px 6px", display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldCheck size={16} aria-hidden />
        <div style={{ fontSize: 15, fontWeight: 600 }}>Saisies opérateur à valider</div>
        <span style={{ fontSize: 12, color: "var(--v2-muted)" }}>{total}</span>
      </div>
      {data.horsYango.map((s) => (
        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--sk-border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{s.chauffeur} · Hors Yango du {ddmm(s.jour)}</div>
            <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>{formatAmount(s.montant)} XOF{s.courses ? ` · ${s.courses} course(s)` : ""}{s.note ? ` · ${s.note}` : ""} · saisi par {s.saisi_par ?? "—"}</div>
          </div>
          {actions("hors_yango", s.id, s.entered_by)}
        </div>
      ))}
      {data.charges.map((c) => (
        <div key={c.id} style={{ padding: "10px 16px", borderTop: "1px solid var(--sk-border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => setOuvert(ouvert === c.id ? null : c.id)} style={{ textAlign: "left", background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{c.decaissement ? `Décaissement · ${c.chauffeur}${c.beneficiaire ? ` → ${c.beneficiaire}` : ""}` : `${c.chauffeur} · ${c.category}`} du {ddmm(c.expense_date)}</div>
              <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>{formatAmount(c.amount)} XOF{c.description ? ` · ${c.description}` : ""} · saisi par {c.saisi_par ?? "—"} · 📎 {c.pieces} {ouvert === c.id ? "▲" : "▼ voir la preuve"}</div>
            </button>
            {actions("charge", c.id, c.entered_by, c.pieces === 0)}
          </div>
          {c.doublons.length > 0 && (
            <div role="alert" style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, background: `${STATUS_COLOR.proche}26`, boxShadow: `inset 0 0 0 1px ${STATUS_COLOR.proche}66` }}>
              Doublon possible : même chauffeur, même jour, même catégorie et même montant — {c.doublons.map((d) => `${d.origine === "chauffeur" ? "déclarée par le chauffeur" : "saisie par l\u2019exploitation"} (${STATUT[d.status]?.txt.toLowerCase() ?? d.status})`).join(", ")}. Vérifiez avant de valider.
            </div>
          )}
          {ouvert === c.id && <Preuves fichiers={c.fichiers} />}
        </div>
      ))}
    </Card>
  );
}

/* ── Administrateurs : droit de valider ─────────────────────── */

export function AdministrateursV2() {
  const [data, setData] = useState<{ me: { id: string; peut_valider: boolean }; admins: { id: string; full_name: string | null; email: string | null; peut_valider: boolean }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api("/api/admin/administrateurs")); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const toggle = async (id: string, v: boolean) => {
    setBusy(id);
    try { await api("/api/admin/administrateurs", { method: "PATCH", body: JSON.stringify({ id, peut_valider: v }) }); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  // création / modification d'un compte gestionnaire (valideur seulement)
  const vide = { id: "", full_name: "", email: "", password: "", profil: "operateur" as "operateur" | "valideur" };
  const [fiche, setFiche] = useState<typeof vide | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const enregistrer = async () => {
    if (!fiche) return;
    setBusy("fiche"); setMsg(null);
    try {
      await api("/api/admin/administrateurs", { method: fiche.id ? "PUT" : "POST", body: JSON.stringify(fiche) });
      setMsg({ ok: true, t: fiche.id ? "Compte modifié." : "Compte créé. Transmettez-lui son adresse et son mot de passe provisoire." });
      setFiche(null); await load();
    } catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) }); } finally { setBusy(null); }
  };
  return (
    <Card flush>
      <div style={{ padding: "14px 16px 6px" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Administrateurs et validation</div>
        <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>Un administrateur « saisie seule » voit tout et saisit, mais ne valide rien. Personne ne valide sa propre saisie, ni ne modifie son propre droit ; il reste toujours au moins un valideur.</div>
      </div>
      {error ? <div style={{ padding: 16, fontSize: 13, color: STATUS_COLOR.sous }}>{error}</div> : !data ? <div className="v2-skeleton" style={{ height: 60, margin: 16 }} aria-hidden /> : data.admins.map((a) => (
        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 16px", borderTop: "1px solid var(--sk-border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{a.full_name || "—"}{a.id === data.me.id ? " (vous)" : ""}</div>
            <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>{a.email}</div>
          </div>
          {data.me.peut_valider && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setMsg(null); setFiche({ id: a.id, full_name: a.full_name ?? "", email: a.email ?? "", password: "", profil: a.peut_valider ? "valideur" : "operateur" }); }}>Modifier</Button>}
          {a.id === data.me.id ? (
            // son propre droit ne se modifie pas : ni se le retirer (compte bloqué), ni se le rendre
            <span style={{ fontSize: 12, color: "var(--v2-muted)", textAlign: "right" }}>
              <b style={{ color: "inherit" }}>{a.peut_valider ? "Valideur" : "Saisie seule"}</b> · votre droit est modifié par un autre valideur
            </span>
          ) : (
            <Segmented options={[{ key: "1", label: "Valideur" }, { key: "0", label: "Saisie seule" }]} value={a.peut_valider ? "1" : "0"}
              onChange={(k) => { if (!data.me.peut_valider || busy || (k === "1") === a.peut_valider) return; void toggle(a.id, k === "1"); }} ariaLabel={`Droit de valider de ${a.full_name}`} />
          )}
        </div>
      ))}
      {data && !data.me.peut_valider && <div style={{ padding: "8px 16px 14px", fontSize: 12, color: "var(--v2-muted)" }}>Seul un administrateur valideur peut créer un compte ou modifier ces droits.</div>}
      {data?.me.peut_valider && (
        <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--sk-border)", display: "flex", flexDirection: "column", gap: 10 }}>
          {!fiche ? (
            <div><Button size="sm" onClick={() => { setMsg(null); setFiche(vide); }}>Ajouter un compte</Button></div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{fiche.id ? "Modifier le compte" : "Nouveau compte"}</div>
              <div style={grid}>
                <label style={label}>Nom
                  <input value={fiche.full_name} maxLength={80} onChange={(e) => setFiche({ ...fiche, full_name: e.target.value })} style={field} />
                </label>
                <label style={label}>Adresse e-mail (identifiant de connexion)
                  <input type="email" value={fiche.email} maxLength={120} autoComplete="off" onChange={(e) => setFiche({ ...fiche, email: e.target.value })} style={field} />
                </label>
                {!fiche.id && (
                  <label style={label}>Mot de passe provisoire ({MDP_ADMIN_MIN} caractères minimum)
                    <input type="text" value={fiche.password} autoComplete="off" onChange={(e) => setFiche({ ...fiche, password: e.target.value })} style={field} />
                  </label>
                )}
                <label style={label}>Profil
                  <select value={fiche.profil} disabled={fiche.id === data.me.id} onChange={(e) => setFiche({ ...fiche, profil: e.target.value as "operateur" | "valideur" })} style={field}>
                    <option value="operateur">Opérateur — saisie seule, ne valide rien</option>
                    <option value="valideur">Administrateur — valide, crée les comptes</option>
                  </select>
                </label>
              </div>
              {fiche.id === data.me.id && <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>Votre propre profil est modifié par un autre valideur.</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button size="sm" disabled={busy === "fiche"} onClick={() => void enregistrer()}>{busy === "fiche" ? "Enregistrement…" : fiche.id ? "Enregistrer" : "Créer le compte"}</Button>
                <Button size="sm" variant="outline" disabled={busy === "fiche"} onClick={() => setFiche(null)}>Annuler</Button>
              </div>
            </>
          )}
          {msg && <div role="status" style={{ fontSize: 13, color: msg.ok ? STATUS_COLOR.atteint : STATUS_COLOR.sous }}>{msg.t}</div>}
        </div>
      )}
    </Card>
  );
}

/* ── Objectif flotte (vue dirigeant) ────────────────────────── */

export function ObjectifFlotteV2({ range, driverIds, segment, periodLabel }: { range: { from: string; to: string }; driverIds: string[]; segment: SegmentFilter; periodLabel: string }) {
  const { meta, reload } = usePerfMeta();
  const [rows, setRows] = useState<{ id: string; name: string; caParJour: number | null; jours: number }[] | null>(null);
  const [tick, setTick] = useState(0);
  const { tick: auto } = useDataRefresh();
  useEffect(() => {
    const p = new URLSearchParams({ report: "classement", dateFrom: range.from, dateTo: range.to, statut: "approved", segment, hors: "1" });
    if (driverIds.length) p.set("driverIds", driverIds.join(","));
    let stop = false;
    fetch(`/api/admin/analytics?${p}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (stop || !Array.isArray(j.rows)) return;
      setRows(j.rows.filter((r: { jours: number }) => r.jours > 0).map((r: { driverId: string; name: string; caParJour: number | null; jours: number }) => ({ id: r.driverId, name: r.name, caParJour: r.caParJour, jours: r.jours })));
    }).catch(() => undefined);
    return () => { stop = true; };
  }, [range.from, range.to, driverIds.join(","), segment, tick, auto]); // eslint-disable-line react-hooks/exhaustive-deps
  const objectif = meta?.objectif ?? 40_000;
  if (!rows || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.caParJour ?? 0) - (a.caParJour ?? 0));
  const atteints = sorted.filter((r) => statutDe(r.caParJour, objectif) === "atteint").length;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>Objectif {formatAmount(objectif)} XOF / jour / chauffeur · {periodLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }} className="v2-num">{atteints} / {sorted.length} chauffeurs à l&apos;objectif</div>
        </div>
        <ObjectifControl meta={meta} onSaved={() => { void reload(); setTick((t) => t + 1); }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))", gap: 8 }}>
        {sorted.map((r) => {
          const st = statutDe(r.caParJour, objectif);
          return (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, background: "var(--sk-surface)", borderLeft: `4px solid ${st ? STATUS_COLOR[st] : "var(--sk-border)"}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "var(--v2-muted)" }}>{r.jours} j · {r.caParJour != null ? formatAmount(r.caParJour) : "—"} / jour</div>
              </div>
              <StatusPill statut={st} compact />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
