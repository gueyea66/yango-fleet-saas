"use client";

/**
 * Console d'onboarding — la fiche de mise en service d'un client.
 *
 * Elle remplace la page isolée qui servait jusqu'ici : celle-ci vit dans
 * l'application, donc ce qui est saisi ici est versé dans M3A Fleet par le
 * bouton « Mettre en service ». Un seul point de saisie, aucune reprise à la
 * main.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ETATS_CLIENT, ETATS_KYC, ETATS_M3A, LISTE_BENNES, LISTE_CLIENT, LISTE_M3A, MODES,
  SEGMENTS, SEGMENT_LABELS, etat, ficheVide, segmentDe, slugify, texteRelance,
  type OnbChauffeur, type OnbDoc, type OnbFileRow, type OnbPoint, type OnbVehicule,
} from "@/lib/onboarding-model";

interface ProvisionLigne { quoi: string; etat: "cree" | "maj" | "inchange" | "erreur"; detail?: string }
interface ProvisionResult {
  ok: boolean;
  slug: string;
  identifiants: { nom: string; driverId: string; motDePasse: string }[];
  adminIdentifiants?: { nom: string; email: string; motDePasse: string }[];
  lignes: ProvisionLigne[];
  doc: OnbDoc;
  error?: string;
}

interface Props {
  superadminKey: string;
  notify: (text: string, ok?: boolean) => void;
}

type Onglet = "a" | "v" | "c" | "r" | "b" | "k" | "t" | "m";

const ONGLETS: [Onglet, string][] = [
  ["a", "Préalables client"],
  ["v", "Parc"],
  ["c", "Chauffeurs"],
  ["r", "Règles et formation"],
  ["b", "Côté M3A"],
  ["k", "Cadrage bennes"],
  ["t", "Calendrier"],
  ["m", "Mise en service"],
];

/* ── Jetons visuels, alignés sur le reste de la console ─────── */
const CARTE: React.CSSProperties = {
  background: "var(--sk-bg)", border: "0.5px solid var(--sk-surface)",
  borderRadius: 12, padding: 20,
};
const CHAMP: React.CSSProperties = {
  width: "100%", background: "var(--sk-deep)", border: "0.5px solid var(--sk-surface)",
  borderRadius: 6, padding: "8px 10px", color: "var(--sk-t1)", fontSize: 13, outline: "none",
};
const BTN: React.CSSProperties = {
  background: "var(--sk-surface)", border: "0.5px solid var(--sk-border)", borderRadius: 8,
  padding: "8px 14px", color: "var(--sk-t1)", cursor: "pointer", fontSize: 13, minHeight: 36,
};
const BTN_OR: React.CSSProperties = {
  ...BTN, background: "#f5a623", border: "none", color: "var(--sk-deep)", fontWeight: 700,
};
const TITRE: React.CSSProperties = {
  fontSize: 11, color: "#f5a623", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14,
};
const LEAD: React.CSSProperties = { fontSize: 13, color: "var(--sk-t2)", margin: "0 0 16px", lineHeight: 1.6 };
const TH: React.CSSProperties = {
  textAlign: "left", fontSize: 11, color: "var(--sk-t3)", textTransform: "uppercase",
  letterSpacing: "0.06em", padding: "0 8px 8px", fontWeight: 600,
};

/** Couleur d'un état de checklist : 0 à faire, 1 en cours, 2 fait. */
const TEINTE_ETAT = ["#6b7280", "#f5a623", "#22c55e"];

function uid(): string { return Math.random().toString(36).slice(2, 9); }

/** Message lisible d'une erreur, quelle que soit sa forme. */
function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fmtDate(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v + "T00:00:00") : v;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function addDays(iso: string, n: number): Date {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Une liste de controle. Definie au niveau module, et non dans le composant :
 * une fonction recreee a chaque rendu est un type neuf pour React, qui
 * demonterait puis remonterait les champs — le curseur sauterait a chaque
 * frappe.
 */
function Checklist({ doc, groupe, liste, labels, onCycle, onNote }: {
  doc: OnbDoc | null;
  groupe: "a" | "b" | "c";
  liste: OnbPoint[];
  labels: readonly string[];
  onCycle: (groupe: "a" | "b" | "c", id: string) => void;
  onNote: (groupe: "a" | "b" | "c", id: string, note: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {liste.map((x) => {
        const e = etat(doc, groupe, x.id);
        return (
          <div key={x.id} style={{
            display: "grid", gridTemplateColumns: "44px 1fr 132px 200px", gap: 12, alignItems: "start",
            background: "var(--sk-deep)", border: "0.5px solid var(--sk-surface)", borderRadius: 8, padding: "10px 12px",
          }}>
            <span style={{ fontSize: 12, color: "var(--sk-t3)", fontVariantNumeric: "tabular-nums", paddingTop: 8 }}>{x.id}</span>
            <div style={{ paddingTop: 6 }}>
              <div style={{ fontSize: 13, color: "var(--sk-t1)", fontWeight: 500 }}>
                {x.t}
                {x.blk && (
                  <span style={{
                    marginLeft: 8, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "#f87171", border: "0.5px solid #ef444455", borderRadius: 4, padding: "1px 6px",
                  }}>Bloquant</span>
                )}
              </div>
              {x.w && <div style={{ fontSize: 12, color: "var(--sk-t3)", marginTop: 3, lineHeight: 1.5 }}>{x.w}</div>}
            </div>
            <button type="button" onClick={() => onCycle(groupe, x.id)}
              aria-label={`${x.t} : ${labels[e.s]}, changer l'état`}
              style={{
                ...BTN, background: TEINTE_ETAT[e.s] + "1f", borderColor: TEINTE_ETAT[e.s] + "55",
                color: TEINTE_ETAT[e.s], fontWeight: 600, fontSize: 12, padding: "7px 10px",
              }}>
              {labels[e.s]}
            </button>
            <input type="text" value={e.n} placeholder="Note"
              aria-label={`Note pour ${x.t}`}
              onChange={(ev) => onNote(groupe, x.id, ev.target.value)}
              style={{ ...CHAMP, fontSize: 12, padding: "7px 9px" }} />
          </div>
        );
      })}
    </div>
  );
}

/** Un champ de la fiche. Hors du composant, meme raison que `Checklist`. */
function Champ({ chemin, label, valeur, type, aide, pleine, set }: {
  chemin: string; label: string; valeur: string; type?: string; aide?: string; pleine?: boolean;
  set: (chemin: string, valeur: string) => void;
}) {
  const id = "onb-" + chemin.replace(/\./g, "-");
  return (
    <div style={{ gridColumn: pleine ? "1/-1" : undefined }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 12, color: "var(--sk-t2)", marginBottom: 5 }}>{label}</label>
      {type === "mode" ? (
        <select id={id} value={valeur} onChange={(e) => set(chemin, e.target.value)} style={CHAMP}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      ) : type === "zone" ? (
        <textarea id={id} rows={3} value={valeur} onChange={(e) => set(chemin, e.target.value)}
          style={{ ...CHAMP, resize: "vertical", fontFamily: "inherit" }} />
      ) : (
        <input id={id} type={type || "text"} value={valeur} onChange={(e) => set(chemin, e.target.value)} style={CHAMP} />
      )}
      {aide && <div style={{ fontSize: 11, color: "var(--sk-t3)", marginTop: 4 }}>{aide}</div>}
    </div>
  );
}

/** Une cellule de tableau editable. Hors du composant, meme raison. */
function CelluleTexte({ valeur, onChange, label, placeholder, type }: {
  valeur: string; onChange: (v: string) => void; label: string; placeholder?: string; type?: string;
}) {
  return (
    <td style={{ padding: "4px 4px" }}>
      <input type={type || "text"} value={valeur} placeholder={placeholder} aria-label={label}
        onChange={(e) => onChange(e.target.value)} style={{ ...CHAMP, fontSize: 12, padding: "7px 9px" }} />
    </td>
  );
}

export default function Onboarding({ superadminKey, notify }: Props) {
  const [fiches, setFiches] = useState<OnbFileRow[]>([]);
  const [ficheId, setFicheId] = useState<string | null>(null);
  const [doc, setDoc] = useState<OnbDoc | null>(null);
  const [meta, setMeta] = useState<{ tenant_id: string | null; provisioned_at: string | null }>({ tenant_id: null, provisioned_at: null });
  const [onglet, setOnglet] = useState<Onglet>("a");
  const [statut, setStatut] = useState("");
  const [chargement, setChargement] = useState(true);
  const [nouveauNom, setNouveauNom] = useState("");
  const [miseEnService, setMiseEnService] = useState(false);
  const [rapport, setRapport] = useState<ProvisionResult | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<OnbDoc | null>(null);
  const idRef = useRef<string | null>(null);
  docRef.current = doc;
  idRef.current = ficheId;

  const appel = useCallback(async (op: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/superadmin/console", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ superadminKey, op, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Requête refusée");
    return data;
  }, [superadminKey]);

  const listerFiches = useCallback(async () => {
    const d = await appel("onb-list");
    setFiches(d.files || []);
    return (d.files || []) as OnbFileRow[];
  }, [appel]);

  const ouvrir = useCallback(async (id: string) => {
    const d = await appel("onb-get", { id });
    const f = d.file;
    setFicheId(f.id);
    setDoc({ ...ficheVide(f.nom), ...(f.doc || {}) });
    setMeta({ tenant_id: f.tenant_id ?? null, provisioned_at: f.provisioned_at ?? null });
    setRapport(null);
    setStatut("");
    try { localStorage.setItem("onb-fiche", f.id); } catch { /* navigation privée */ }
  }, [appel]);

  useEffect(() => {
    (async () => {
      try {
        const liste = await listerFiches();
        let voulu: string | null = null;
        try { voulu = localStorage.getItem("onb-fiche"); } catch { /* idem */ }
        const cible = liste.find((f) => f.id === voulu) || liste[0];
        if (cible) await ouvrir(cible.id);
      } catch (e) {
        notify(messageErreur(e), false);
      }
      setChargement(false);
    })();
    // Au montage seulement : la console ne recharge pas la liste à chaque frappe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Enregistrement différé ─────────────────────────────── */

  const enregistrer = useCallback(async () => {
    const d = docRef.current, id = idRef.current;
    if (!d || !id) return;
    try {
      await appel("onb-save", { id, nom: d.nom, doc: { ...d, maj: new Date().toISOString() } });
      setStatut("Enregistré");
      setFiches((prev) => prev.map((f) => f.id === id ? { ...f, nom: d.nom, updated_at: new Date().toISOString() } : f));
    } catch (e) {
      setStatut("Non enregistré : " + messageErreur(e));
    }
  }, [appel]);

  /** Toute modification passe par ici : l'écran change tout de suite, la base suit. */
  const modifier = useCallback((maj: (d: OnbDoc) => OnbDoc) => {
    setDoc((prev) => (prev ? maj(structuredClone(prev)) : prev));
    setStatut("Modification en cours…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void enregistrer(); }, 800);
  }, [enregistrer]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setChamp = (chemin: string, valeur: string) => modifier((d) => {
    const parts = chemin.split(".");
    let cible = d as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) cible = cible[parts[i]] as Record<string, unknown>;
    cible[parts[parts.length - 1]] = valeur;
    return d;
  });

  const cyclerEtat = (groupe: "a" | "b" | "c", id: string) => modifier((d) => {
    const courant = (d[groupe] as Record<string, { s: number; n: string }>)[id] ?? { s: 0, n: "" };
    (d[groupe] as Record<string, { s: number; n: string }>)[id] = { ...courant, s: (courant.s + 1) % 3 };
    return d;
  });

  const setNote = (groupe: "a" | "b" | "c", id: string, note: string) => modifier((d) => {
    const courant = (d[groupe] as Record<string, { s: number; n: string }>)[id] ?? { s: 0, n: "" };
    (d[groupe] as Record<string, { s: number; n: string }>)[id] = { ...courant, n: note };
    return d;
  });

  /* ── Fiches ─────────────────────────────────────────────── */

  async function creerFiche() {
    const nom = nouveauNom.trim();
    if (!nom) return;
    const id = slugify(nom);
    if (!id) { notify("Ce nom ne donne aucun identifiant utilisable", false); return; }
    if (fiches.some((f) => f.id === id)) { notify("Une fiche porte déjà ce nom", false); return; }
    try {
      await appel("onb-save", { id, nom, doc: ficheVide(nom) });
      setNouveauNom("");
      await listerFiches();
      await ouvrir(id);
      notify("Fiche créée");
    } catch (e) { notify(messageErreur(e), false); }
  }

  async function supprimerFiche() {
    if (!ficheId) return;
    const nom = doc?.nom || ficheId;
    const avertissement = meta.tenant_id
      ? `Supprimer la fiche « ${nom} » ?\n\nL'espace client déjà mis en service, ses véhicules et ses chauffeurs ne sont PAS touchés — seule la fiche de préparation disparaît.`
      : `Supprimer la fiche « ${nom} » ? Cette fiche n'a pas encore été mise en service.`;
    if (!confirm(avertissement)) return;
    try {
      await appel("onb-delete", { id: ficheId });
      const reste = await listerFiches();
      setFicheId(null); setDoc(null); setRapport(null);
      if (reste[0]) await ouvrir(reste[0].id);
      notify("Fiche supprimée");
    } catch (e) { notify(messageErreur(e), false); }
  }

  async function mettreEnService() {
    if (!ficheId || !doc) return;
    const bloquants = LISTE_CLIENT.filter((x) => x.blk && etat(doc, "a", x.id).s !== 2).length;
    const resume = [
      `Verser « ${doc.nom} » dans M3A Fleet ?`,
      "",
      `• ${doc.vehicules.filter((v) => v.plaque.trim()).length} véhicule(s)`,
      `• ${doc.chauffeurs.filter((c) => c.nom.trim()).length} chauffeur(s), avec leurs comptes`,
      `• Règle de versement : ${doc.regle.mode}`,
      meta.tenant_id ? "\nL'espace existe déjà : il sera mis à jour, sans doublon." : "\nL'espace client sera créé.",
      bloquants ? `\n⚠ ${bloquants} préalable(s) bloquant(s) encore non reçu(s).` : "",
    ].join("\n");
    if (!confirm(resume)) return;

    if (timer.current) clearTimeout(timer.current);
    setMiseEnService(true);
    setRapport(null);
    try {
      await enregistrer();
      const r: ProvisionResult = await appel("onb-provision", { id: ficheId });
      setRapport(r);
      setOnglet("m");
      if (r.doc) setDoc({ ...ficheVide(r.doc.nom), ...r.doc });
      await listerFiches();
      const d = await appel("onb-get", { id: ficheId });
      setMeta({ tenant_id: d.file.tenant_id ?? null, provisioned_at: d.file.provisioned_at ?? null });
      notify(r.ok ? "Client en service dans M3A Fleet" : "Mise en service terminée avec des erreurs", r.ok);
    } catch (e) {
      notify(messageErreur(e), false);
    }
    setMiseEnService(false);
  }

  /* ── Synthèse ───────────────────────────────────────────── */

  const synthese = useMemo(() => {
    if (!doc) return null;
    const blkA = LISTE_CLIENT.filter((x) => x.blk);
    const okA = blkA.filter((x) => etat(doc, "a", x.id).s === 2).length;
    const blkB = LISTE_M3A.filter((x) => x.blk);
    const okBb = blkB.filter((x) => etat(doc, "b", x.id).s === 2).length;
    const okB = LISTE_M3A.filter((x) => etat(doc, "b", x.id).s === 2).length;
    const vs = doc.vehicules.filter((v) => (v.plaque || "").trim()).length;
    const prevus = Number(doc.vehiculesPrevus) || 0;
    const cs = doc.chauffeurs.filter((c) => (c.nom || "").trim()).length;
    const kc = doc.chauffeurs.filter((c) => c.kyc === ETATS_KYC[2]).length;
    return {
      manquants: (blkA.length - okA) + (blkB.length - okBb),
      okA, totalA: blkA.length, okB, totalB: LISTE_M3A.length,
      vs, prevus: prevus || vs, cs, kc,
      totalClient: LISTE_CLIENT.filter((x) => etat(doc, "a", x.id).s === 2).length,
      totalBennes: LISTE_BENNES.filter((x) => etat(doc, "c", x.id).s === 2).length,
    };
  }, [doc]);

  /* ── Fragments d'interface ──────────────────────────────── */




  /* ── Panneaux ───────────────────────────────────────────── */

  function PanneauClient() {
    if (!doc) return null;
    const relance = texteRelance(doc);
    return (
      <>
        <p style={LEAD}>
          Touchez l&apos;état pour le faire avancer : à demander, demandé, reçu.
          Les éléments bloquants conditionnent le J0.
        </p>
        <Checklist doc={doc} groupe="a" liste={LISTE_CLIENT} labels={ETATS_CLIENT} onCycle={cyclerEtat} onNote={setNote} />
        <div style={{ ...CARTE, marginTop: 20, background: "var(--sk-deep)" }}>
          <div style={TITRE}>Message de relance</div>
          <textarea readOnly rows={7} value={relance} aria-label="Message de relance généré"
            style={{ ...CHAMP, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
            <button type="button" style={BTN}
              onClick={() => { navigator.clipboard?.writeText(relance).then(() => notify("Message copié")); }}>
              Copier le message
            </button>
            <span style={{ fontSize: 12, color: "var(--sk-t3)" }}>Généré à partir des éléments encore attendus.</span>
          </div>
        </div>
      </>
    );
  }

  function PanneauParc() {
    if (!doc) return null;
    const majVeh = (id: string, k: keyof OnbVehicule, v: string) => modifier((d) => {
      const ligne = d.vehicules.find((x) => x.id === id);
      if (ligne) (ligne[k] as string) = v;
      return d;
    });
    return (
      <>
        <p style={LEAD}>
          Un véhicule par ligne. La plaque sert de clé : c&apos;est elle que les chauffeurs
          retrouvent dans l&apos;application, et elle qui évite les doublons à la mise en service.
          La colonne <strong>Flotte</strong> distingue les véhicules du client de ceux qu&apos;il
          héberge pour un tiers : sans elle, le compte de résultat additionne des recettes
          qui ne sont pas les siennes.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={TH}>Plaque</th><th style={TH}>Marque et modèle</th><th style={TH}>Année</th>
                <th style={TH}>Flotte</th>
                <th style={TH}>Propriétaire</th><th style={TH}>Mise en service</th><th style={TH} />
              </tr>
            </thead>
            <tbody>
              {doc.vehicules.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 16, fontSize: 13, color: "var(--sk-t3)", textAlign: "center" }}>
                  Aucun véhicule saisi pour l&apos;instant.
                </td></tr>
              )}
              {doc.vehicules.map((v) => (
                <tr key={v.id}>
                  <CelluleTexte valeur={v.plaque} label="Plaque" placeholder="DK-0000-AA" onChange={(x) => majVeh(v.id, "plaque", x)} />
                  <CelluleTexte valeur={v.modele} label="Marque et modèle" onChange={(x) => majVeh(v.id, "modele", x)} />
                  <CelluleTexte valeur={v.annee} label="Année" type="number" onChange={(x) => majVeh(v.id, "annee", x)} />
                  <td style={{ padding: "4px 4px" }}>
                    <select aria-label={`Flotte du véhicule ${v.plaque || "sans plaque"}`}
                      value={segmentDe(v)} onChange={(e) => majVeh(v.id, "segment", e.target.value)}
                      style={{ ...CHAMP, fontSize: 12, padding: "7px 8px" }}>
                      {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <CelluleTexte valeur={v.proprio} label="Propriétaire" onChange={(x) => majVeh(v.id, "proprio", x)} />
                  <CelluleTexte valeur={v.service} label="Mise en service" type="date" onChange={(x) => majVeh(v.id, "service", x)} />
                  <td style={{ padding: "4px 4px", width: 44 }}>
                    <button type="button" aria-label={`Supprimer le véhicule ${v.plaque || "sans plaque"}`}
                      onClick={() => modifier((d) => { d.vehicules = d.vehicules.filter((x) => x.id !== v.id); return d; })}
                      style={{ ...BTN, padding: "7px 10px", color: "var(--sk-t3)", background: "transparent", borderColor: "transparent" }}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" style={BTN_OR}
            onClick={() => modifier((d) => {
              d.vehicules.push({ id: uid(), plaque: "", modele: "", annee: "", proprio: "", service: "", segment: "interne" });
              return d;
            })}>
            Ajouter un véhicule
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="onb-prevus" style={{ fontSize: 12, color: "var(--sk-t2)" }}>Véhicules prévus au devis</label>
            <input id="onb-prevus" type="number" min={0} value={String(doc.vehiculesPrevus ?? 0)}
              onChange={(e) => setChamp("vehiculesPrevus", e.target.value)}
              style={{ ...CHAMP, width: 90, fontSize: 12, padding: "7px 9px" }} />
          </div>
        </div>
      </>
    );
  }

  function PanneauChauffeurs() {
    if (!doc) return null;
    const plaques = doc.vehicules.map((v) => v.plaque).filter(Boolean);
    const majChf = (id: string, k: keyof OnbChauffeur, v: string) => modifier((d) => {
      const ligne = d.chauffeurs.find((x) => x.id === id);
      if (ligne) (ligne[k] as string) = v;
      return d;
    });
    return (
      <>
        <p style={LEAD}>
          Le téléphone sert au rappel de 20 h. Saisissez d&apos;abord le parc pour pouvoir
          attribuer les véhicules : c&apos;est cette attribution qui sera reprise dans l&apos;application.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr>
                <th style={TH}>Nom</th><th style={TH}>Téléphone</th><th style={TH}>Permis</th>
                <th style={TH}>Véhicule</th><th style={TH}>Entrée</th><th style={TH}>Dossier</th>
                <th style={TH}>Compte</th><th style={TH} />
              </tr>
            </thead>
            <tbody>
              {doc.chauffeurs.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 16, fontSize: 13, color: "var(--sk-t3)", textAlign: "center" }}>
                  Aucun chauffeur saisi pour l&apos;instant.
                </td></tr>
              )}
              {doc.chauffeurs.map((c) => (
                <tr key={c.id}>
                  <CelluleTexte valeur={c.nom} label="Nom" onChange={(x) => majChf(c.id, "nom", x)} />
                  <CelluleTexte valeur={c.tel} label="Téléphone" type="tel" onChange={(x) => majChf(c.id, "tel", x)} />
                  <CelluleTexte valeur={c.permis} label="Numéro de permis" onChange={(x) => majChf(c.id, "permis", x)} />
                  <td style={{ padding: "4px 4px" }}>
                    <select value={c.vehicule} aria-label="Véhicule attribué"
                      onChange={(e) => majChf(c.id, "vehicule", e.target.value)}
                      style={{ ...CHAMP, fontSize: 12, padding: "7px 9px" }}>
                      <option value="">—</option>
                      {plaques.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <CelluleTexte valeur={c.entree} label="Date d'entrée" type="date" onChange={(x) => majChf(c.id, "entree", x)} />
                  <td style={{ padding: "4px 4px" }}>
                    <select value={c.kyc || ETATS_KYC[0]} aria-label="État du dossier"
                      onChange={(e) => majChf(c.id, "kyc", e.target.value)}
                      style={{ ...CHAMP, fontSize: 12, padding: "7px 9px" }}>
                      {ETATS_KYC.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "4px 8px", fontSize: 12, color: c.driverId ? "#22c55e" : "var(--sk-t3)", whiteSpace: "nowrap" }}>
                    {c.driverId || "—"}
                  </td>
                  <td style={{ padding: "4px 4px", width: 44 }}>
                    <button type="button" aria-label={`Retirer le chauffeur ${c.nom || "sans nom"} de la fiche`}
                      onClick={() => modifier((d) => { d.chauffeurs = d.chauffeurs.filter((x) => x.id !== c.id); return d; })}
                      style={{ ...BTN, padding: "7px 10px", color: "var(--sk-t3)", background: "transparent", borderColor: "transparent" }}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={BTN_OR}
            onClick={() => modifier((d) => {
              d.chauffeurs.push({ id: uid(), nom: "", tel: "", permis: "", vehicule: "", entree: "", kyc: ETATS_KYC[0] });
              return d;
            })}>
            Ajouter un chauffeur
          </button>
          <span style={{ fontSize: 12, color: "var(--sk-t3)" }}>
            La colonne « Compte » se remplit à la mise en service. Retirer une ligne ici ne supprime
            pas le compte déjà créé dans l&apos;application.
          </span>
        </div>
      </>
    );
  }

  function PanneauRegles() {
    if (!doc) return null;
    const grille: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 };
    return (
      <>
        <p style={LEAD}>Ce que l&apos;espace doit calculer, et quand on forme l&apos;équipe.</p>

        <div style={TITRE}>Le client</div>
        <div style={grille}>
          <Champ chemin="nom" label="Nom du client" valeur={doc.nom} set={setChamp} />
          <Champ chemin="contact" label="Interlocuteur (prénom)" valeur={doc.contact} aide="Utilisé dans le message de relance" set={setChamp} />
          <Champ chemin="sousDomaine" label="Sous-domaine" valeur={doc.sousDomaine} aide="Par exemple nmktransports.m3afleet.com" set={setChamp} />
          <Champ chemin="gestionnaire" label="Gestionnaire qui valide" valeur={doc.gestionnaire} set={setChamp} />
          <Champ chemin="gestionnaireEmail" label="Son adresse e-mail" valeur={doc.gestionnaireEmail || ""} type="email"
            aide="Préférer une boîte de rôle (exploitation@…) : le poste survit à la personne" set={setChamp} />
          <Champ chemin="direction" label="Direction" valeur={doc.direction || ""}
            aide="Second compte administrateur — celui qui regarde les chiffres" set={setChamp} />
          <Champ chemin="directionEmail" label="Son adresse e-mail" valeur={doc.directionEmail || ""} type="email"
            aide="Laisser vide n'empêche rien : la mise en service se rejoue" set={setChamp} />
          <Champ chemin="j0" label="Date du J0" valeur={doc.j0} type="date" aide="Le jour de l'acceptation et du premier versement" set={setChamp} />
        </div>

        <div style={{ ...TITRE, marginTop: 24 }}>La règle de versement</div>
        <div style={grille}>
          <Champ chemin="regle.mode" label="Modèle de rémunération" valeur={doc.regle.mode} type="mode" set={setChamp} />
          <Champ chemin="regle.versement" label="Versement attendu par véhicule et par jour (XOF)" valeur={doc.regle.versement} type="number" set={setChamp} />
          {doc.regle.mode === "Commission sur le brut" && (
            <Champ chemin="regle.commission" label="Taux de commission (% du brut)" valeur={doc.regle.commission || ""} type="number"
              aide="Le taux, pas le montant : c'est lui qui part dans le calcul de l'application" set={setChamp} />
          )}
          <Champ chemin="regle.repos" label="Jours de repos" valeur={doc.regle.repos} aide="Par exemple : un jour par semaine, le dimanche" set={setChamp} />
          <Champ chemin="regle.immobilise" label="Véhicule immobilisé" valeur={doc.regle.immobilise} aide="Ce qui est dû quand le véhicule ne roule pas" set={setChamp} />
          <Champ chemin="regle.carburant" label="Ce que la direction fournit" valeur={doc.regle.carburant} set={setChamp} />
          <Champ chemin="regle.seuilCarb" label="Seuil d'alerte carburant (% du chiffre d'affaires)" valeur={doc.regle.seuilCarb} type="number" set={setChamp} />
          <Champ chemin="regle.objectif" label="Objectif de flotte" valeur={doc.regle.objectif} pleine set={setChamp} />
        </div>

        <div style={{ ...TITRE, marginTop: 24 }}>La formation</div>
        <div style={grille}>
          <Champ chemin="formation.date" label="Date" valeur={doc.formation.date} type="date" set={setChamp} />
          <Champ chemin="formation.lieu" label="Lieu" valeur={doc.formation.lieu} set={setChamp} />
          <Champ chemin="formation.participants" label="Participants" valeur={doc.formation.participants} type="zone"
            aide="Gestionnaire, direction, chauffeurs — trois séances le même jour" pleine set={setChamp} />
        </div>

        <div style={{ ...TITRE, marginTop: 24 }}>Notes</div>
        <div style={grille}>
          <Champ chemin="notes" label="Notes libres" valeur={doc.notes} type="zone" pleine set={setChamp} />
        </div>
      </>
    );
  }

  function PanneauCalendrier() {
    if (!doc) return null;
    if (!doc.j0) {
      return <p style={LEAD}>
        Fixez la date du J0 dans « Règles et formation » : le calendrier se calcule à partir d&apos;elle.
      </p>;
    }
    const etapes: [number, number, string, string, string][] = [
      [0, 0, "J0", "Acceptation et premier versement", "Les préalables bloquants sont reçus"],
      [1, 3, "J1–J3", "Installation", "Espace aux couleurs du client, véhicules, chauffeurs, règle de versement, seuils d'alerte, reprise de l'historique"],
      [3, 3, "J3", "Formation et second versement", "Chauffeurs, gestionnaire, direction" + (doc.formation.date ? " — prévue le " + fmtDate(doc.formation.date) : "")],
      [4, 4, "J4", "Mise en service", "Déclarations et validations chaque jour, point hebdomadaire avec la direction"],
      [10, 10, "J10", "Première semaine complète validée", "L'engagement écrit du devis"],
      [30, 30, "J30", "Bilan", "Résultat par véhicule et par chauffeur, écarts à l'objectif, trois actions prioritaires"],
    ];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return (
      <>
        <p style={LEAD}>Calculé à partir du J0 du {fmtDate(doc.j0)}, selon le déroulé du devis.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {etapes.map((s) => {
            const d1 = addDays(doc.j0, s[0]), d2 = addDays(doc.j0, s[1]);
            const passe = d2 < today, encours = d1 <= today && today <= d2;
            const teinte = encours ? "#f5a623" : passe ? "#22c55e" : "var(--sk-t3)";
            return (
              <div key={s[2]} style={{
                display: "grid", gridTemplateColumns: "72px 190px 1fr", gap: 12, alignItems: "baseline",
                background: "var(--sk-deep)", border: `0.5px solid ${encours ? "#f5a62355" : "var(--sk-surface)"}`,
                borderRadius: 8, padding: "12px 14px",
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: teinte }}>{s[2]}</span>
                <span style={{ fontSize: 12, color: "var(--sk-t2)", fontVariantNumeric: "tabular-nums" }}>
                  {s[0] === s[1] ? fmtDate(d1) : `${fmtDate(d1)} → ${fmtDate(d2)}`}
                </span>
                <div>
                  <div style={{ fontSize: 13, color: "var(--sk-t1)", fontWeight: 500 }}>{s[3]}</div>
                  <div style={{ fontSize: 12, color: "var(--sk-t3)", marginTop: 2, lineHeight: 1.5 }}>{s[4]}</div>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  function PanneauMiseEnService() {
    if (!doc) return null;
    const veh = doc.vehicules.filter((v) => v.plaque.trim()).length;
    const chf = doc.chauffeurs.filter((c) => c.nom.trim()).length;
    const bloquants = LISTE_CLIENT.filter((x) => x.blk && etat(doc, "a", x.id).s !== 2);
    const teinteEtat: Record<ProvisionLigne["etat"], string> = {
      cree: "#22c55e", maj: "#f5a623", inchange: "var(--sk-t3)", erreur: "#ef4444",
    };
    const motEtat: Record<ProvisionLigne["etat"], string> = {
      cree: "Créé", maj: "Mis à jour", inchange: "Inchangé", erreur: "Erreur",
    };
    return (
      <>
        <p style={LEAD}>
          Verse la fiche dans M3A Fleet : l&apos;espace client, sa règle de versement, ses véhicules
          et les comptes de ses chauffeurs. L&apos;opération est rejouable — relancez-la après avoir
          ajouté une ligne, rien ne sera dupliqué et aucun mot de passe déjà remis ne changera.
        </p>

        <div style={{ ...CARTE, background: "var(--sk-deep)", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
            <div><div style={{ fontSize: 11, color: "var(--sk-t3)" }}>Espace</div>
              <div style={{ fontSize: 14, color: "var(--sk-t1)", marginTop: 3 }}>{slugify(ficheId || doc.nom) || "—"}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--sk-t3)" }}>Véhicules</div>
              <div style={{ fontSize: 14, color: "var(--sk-t1)", marginTop: 3 }}>{veh}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--sk-t3)" }}>Chauffeurs</div>
              <div style={{ fontSize: 14, color: "var(--sk-t1)", marginTop: 3 }}>{chf}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--sk-t3)" }}>Règle</div>
              <div style={{ fontSize: 14, color: "var(--sk-t1)", marginTop: 3 }}>{doc.regle.mode}</div></div>
            <div><div style={{ fontSize: 11, color: "var(--sk-t3)" }}>État</div>
              <div style={{ fontSize: 14, color: meta.provisioned_at ? "#22c55e" : "var(--sk-t2)", marginTop: 3 }}>
                {meta.provisioned_at ? "En service" : "Jamais mise en service"}
              </div></div>
          </div>
        </div>

        {bloquants.length > 0 && (
          <div style={{
            background: "#f5a62312", border: "0.5px solid #f5a62340", borderRadius: 8,
            padding: "12px 16px", fontSize: 13, color: "#f5a623", marginBottom: 16, lineHeight: 1.6,
          }}>
            {bloquants.length} préalable(s) bloquant(s) encore non reçu(s) :{" "}
            {bloquants.map((x) => x.id).join(", ")}. La mise en service reste possible — c&apos;est
            votre appel, pas celui de l&apos;outil.
          </div>
        )}

        <button type="button" onClick={mettreEnService} disabled={miseEnService || !doc.nom.trim()}
          style={{
            ...BTN_OR, padding: "11px 20px", fontSize: 14,
            opacity: miseEnService || !doc.nom.trim() ? 0.5 : 1,
            cursor: miseEnService || !doc.nom.trim() ? "not-allowed" : "pointer",
          }}>
          {miseEnService ? "Mise en service…" : meta.provisioned_at ? "Rejouer la mise en service" : "Mettre en service"}
        </button>

        {rapport && (
          <div style={{ marginTop: 20 }}>
            <div style={TITRE}>Ce qui a été fait</div>
            <div style={{ display: "grid", gap: 6 }}>
              {rapport.lignes.map((l, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "1fr 110px 1fr", gap: 12, alignItems: "baseline",
                  background: "var(--sk-deep)", border: "0.5px solid var(--sk-surface)", borderRadius: 6, padding: "9px 12px",
                }}>
                  <span style={{ fontSize: 13, color: "var(--sk-t1)" }}>{l.quoi}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: teinteEtat[l.etat] }}>{motEtat[l.etat]}</span>
                  <span style={{ fontSize: 12, color: "var(--sk-t3)" }}>{l.detail || ""}</span>
                </div>
              ))}
            </div>

            {(rapport.identifiants.length > 0 || (rapport.adminIdentifiants?.length ?? 0) > 0) && (
              <div style={{ ...CARTE, marginTop: 18, borderColor: "#f5a62355" }}>
                <div style={TITRE}>Identifiants à remettre — affichés une seule fois</div>
                <p style={{ ...LEAD, marginBottom: 12 }}>
                  Ces mots de passe ne sont stockés nulle part et ne seront plus jamais affichés.
                  Copiez-les maintenant.
                </p>
                <pre style={{
                  ...CHAMP, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.7, margin: 0,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}>{texteIdentifiants(rapport)}</pre>
                <button type="button" style={{ ...BTN, marginTop: 10 }}
                  onClick={() => { navigator.clipboard?.writeText(texteIdentifiants(rapport)).then(() => notify("Identifiants copiés")); }}>
                  Copier les identifiants
                </button>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  function texteIdentifiants(r: ProvisionResult): string {
    const lignes: string[] = [`Accès — ${doc?.nom || r.slug}`, `Adresse : https://${r.slug}.m3afleet.com`, ""];
    (r.adminIdentifiants || []).forEach((a) => {
      lignes.push(a.nom, `  Identifiant : ${a.email}`, `  Mot de passe : ${a.motDePasse}`, "");
    });
    if (r.identifiants.length) {
      lignes.push("Chauffeurs");
      r.identifiants.forEach((i) => lignes.push(`  ${i.nom} — identifiant ${i.driverId} — mot de passe ${i.motDePasse}`));
    }
    return lignes.join("\n");
  }

  /* ── Rendu ──────────────────────────────────────────────── */

  if (chargement) {
    return <div style={{ ...CARTE, color: "var(--sk-t2)", fontSize: 13 }}>Chargement des fiches…</div>;
  }

  const compteurs: Record<Onglet, string> = {
    a: synthese ? `${synthese.totalClient}/${LISTE_CLIENT.length}` : "",
    v: synthese ? `${synthese.vs}${synthese.prevus ? "/" + synthese.prevus : ""}` : "",
    c: synthese ? String(synthese.cs) : "",
    r: "", b: synthese ? `${synthese.okB}/${synthese.totalB}` : "",
    k: synthese ? `${synthese.totalBennes}/${LISTE_BENNES.length}` : "",
    t: "", m: "",
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>

      {/* Barre : choix de la fiche */}
      <div style={{ ...CARTE, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <label htmlFor="onb-fiche" style={{ fontSize: 12, color: "var(--sk-t2)" }}>Fiche client</label>
        <select id="onb-fiche" value={ficheId || ""} onChange={(e) => { void ouvrir(e.target.value); }}
          style={{ ...CHAMP, width: "auto", minWidth: 200 }}>
          {fiches.length === 0 && <option value="">Aucune fiche</option>}
          {fiches.map((f) => (
            <option key={f.id} value={f.id}>{f.nom}{f.provisioned_at ? " — en service" : ""}</option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <input type="text" value={nouveauNom} placeholder="Nom d'un nouveau client" aria-label="Nom d'un nouveau client"
            onChange={(e) => setNouveauNom(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void creerFiche(); }}
            style={{ ...CHAMP, width: 210 }} />
          <button type="button" style={BTN} onClick={creerFiche}>Créer la fiche</button>
          {ficheId && <button type="button" style={{ ...BTN, color: "#f87171" }} onClick={supprimerFiche}>Supprimer</button>}
        </div>
        <div style={{ width: "100%", fontSize: 12, color: "var(--sk-t3)", minHeight: 16 }} aria-live="polite">{statut}</div>
      </div>

      {!doc && (
        <div style={{ ...CARTE, fontSize: 13, color: "var(--sk-t2)" }}>
          Aucune fiche ouverte. Créez-en une avec le nom du client : elle servira de point de saisie
          unique jusqu&apos;à sa mise en service.
        </div>
      )}

      {doc && synthese && (
        <>
          {/* Synthèse */}
          <div style={{ ...CARTE, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
            <div style={{ gridColumn: "1/-1", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{doc.nom || "—"}</span>
              <span style={{ fontSize: 12, color: "var(--sk-t3)" }}>
                {[doc.j0 ? "J0 le " + fmtDate(doc.j0) : "J0 non fixé",
                  doc.gestionnaire && "gestionnaire : " + doc.gestionnaire,
                  doc.sousDomaine].filter(Boolean).join(" · ")}
              </span>
              <span style={{
                marginLeft: "auto", fontSize: 12, fontWeight: 600, borderRadius: 6, padding: "5px 12px",
                background: synthese.manquants === 0 ? "#22c55e1f" : "#f5a6231f",
                color: synthese.manquants === 0 ? "#22c55e" : "#f5a623",
              }}>
                {synthese.manquants === 0 ? "Prêt pour le J0"
                  : `${synthese.manquants} élément${synthese.manquants > 1 ? "s" : ""} bloquant${synthese.manquants > 1 ? "s" : ""}`}
              </span>
            </div>
            <Kpi label="Préalables bloquants" valeur={`${synthese.okA} / ${synthese.totalA}`} />
            <Kpi label="Parc saisi" valeur={`${synthese.vs} / ${synthese.prevus || "—"}`} />
            <Kpi label="Chauffeurs" valeur={`${synthese.cs}`} note={`${synthese.kc} dossier(s) complet(s)`} />
            <Kpi label="Côté M3A" valeur={`${synthese.okB} / ${synthese.totalB}`} />
            <Kpi label="Espace client" valeur={meta.provisioned_at ? "En service" : "À créer"} />
          </div>

          {/* Onglets internes */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, borderBottom: "0.5px solid var(--sk-surface)" }}>
            {ONGLETS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => setOnglet(id)}
                aria-current={onglet === id ? "page" : undefined}
                style={{
                  background: "none", border: "none", padding: "9px 14px", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, minHeight: 38,
                  color: onglet === id ? "#f5a623" : "var(--sk-t3)",
                  borderBottom: onglet === id ? "2px solid #f5a623" : "2px solid transparent",
                  marginBottom: -1,
                }}>
                {label}
                {compteurs[id] && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: "var(--sk-t3)", fontVariantNumeric: "tabular-nums" }}>
                    {compteurs[id]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div style={CARTE}>
            {onglet === "a" && PanneauClient()}
            {onglet === "v" && PanneauParc()}
            {onglet === "c" && PanneauChauffeurs()}
            {onglet === "r" && PanneauRegles()}
            {onglet === "b" && (<>
              <p style={LEAD}>À boucler avant l&apos;installation, sans attendre le client.</p>
              <Checklist doc={doc} groupe="b" liste={LISTE_M3A} labels={ETATS_M3A} onCycle={cyclerEtat} onNote={setNote} />
            </>)}
            {onglet === "k" && (<>
              <p style={LEAD}>
                Hors déploiement Yango : les pièces à réunir pour le cadrage du module bennes, facturé à part.
              </p>
              <Checklist doc={doc} groupe="c" liste={LISTE_BENNES} labels={ETATS_CLIENT} onCycle={cyclerEtat} onNote={setNote} />
            </>)}
            {onglet === "t" && PanneauCalendrier()}
            {onglet === "m" && PanneauMiseEnService()}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, valeur, note }: { label: string; valeur: string; note?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--sk-t3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{valeur}</div>
      {note && <div style={{ fontSize: 11, color: "var(--sk-t3)", marginTop: 2 }}>{note}</div>}
    </div>
  );
}
