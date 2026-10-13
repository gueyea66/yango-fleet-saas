"use client";

/**
 * À valider → Déclarations : qui a déclaré quoi, et ce qui manque.
 *
 * Même lecture que l'écran Rendement, du verdict à la preuve :
 *   1. la part des journées en règle, et ce qui reste à régulariser ;
 *   2. UNE grille chauffeur × jour — les compteurs du haut servent de filtre
 *      et font ressortir les cases concernées ;
 *   3. le détail d'une case, avec l'action qui la règle.
 * Un état n'est jamais porté par la couleur seule : chaque case a son signe.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Clock, Fuel, Minus, Moon, X } from "lucide-react";
import { Card, Overline, Segmented } from "@/components/ui";
import { formatAmount } from "@/lib/v2/format";
import { ALERTES, type Alerte, type Case, type EtatRecette, type LigneChauffeur, type SuiviDeclarations } from "@/lib/analytics/declarations";
import { ChiffreAnime, useMouvementReduit } from "./RendementV2";

export type DeclarationsPayload = SuiviDeclarations & { fenetre: number };

const PERIODES = [{ key: "7", label: "7 jours" }, { key: "14", label: "14 jours" }, { key: "31", label: "31 jours" }];
const jourLong = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const jourCourt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "narrow", timeZone: "UTC" }).toUpperCase();

/* ── États : un signe, un libellé, une teinte ───────────────── */

type Ton = "ok" | "wait" | "neg" | "info" | "vide";
const ETATS: Record<EtatRecette, { label: string; ton: Ton; signe: ReactNode }> = {
  declaree: { label: "Recette validée", ton: "ok", signe: <Check size={14} strokeWidth={3} /> },
  attente: { label: "Recette à valider", ton: "wait", signe: <Clock size={13} strokeWidth={2.5} /> },
  repos: { label: "Repos déclaré", ton: "info", signe: <Moon size={13} strokeWidth={2.5} /> },
  sans_chiffre: { label: "Déclaré à zéro, sans repos", ton: "neg", signe: <span style={{ fontWeight: 700, fontSize: 13 }}>0</span> },
  manquante: { label: "Rien de déclaré", ton: "neg", signe: <X size={14} strokeWidth={3} /> },
  en_cours: { label: "Journée en cours", ton: "vide", signe: <Minus size={12} /> },
  hors_contrat: { label: "Hors contrat", ton: "vide", signe: null },
};
const TONS: Record<Ton, CSSProperties> = {
  ok: { background: "var(--v2-ok-bg)", borderColor: "var(--v2-ok-bd)", color: "var(--fleet-positive)" },
  wait: { background: "var(--v2-wait-bg)", borderColor: "var(--v2-wait-bd)", color: "var(--v2-warning-ink)" },
  neg: { background: "var(--v2-neg-bg)", borderColor: "var(--v2-neg-bd)", color: "var(--v2-negative-ink)" },
  info: { background: "var(--v2-info-bg)", borderColor: "var(--v2-info-bd)", color: "var(--fleet-info)" },
  vide: { background: "transparent", borderColor: "var(--sk-surface)", color: "var(--sk-t4)" },
};

function Anneau({ taux }: { taux: number | null }) {
  const reduit = useMouvementReduit();
  const [pret, setPret] = useState(false);
  useEffect(() => { const t = setTimeout(() => setPret(true), 60); return () => clearTimeout(t); }, []);
  const r = 62, c = 2 * Math.PI * r, v = taux ?? 0;
  return (
    <svg viewBox="0 0 160 160" width={168} height={168} role="img" aria-label={taux == null ? "Aucune journée due" : `${Math.round(v * 100)} % des journées en règle`} style={{ flex: "none" }}>
      <circle cx={80} cy={80} r={r} style={{ fill: "none", stroke: "var(--sk-surface)", strokeWidth: 12 }} />
      <circle cx={80} cy={80} r={r} transform="rotate(-90 80 80)"
        style={{ fill: "none", stroke: v >= 0.95 ? "var(--fleet-positive)" : "var(--tenant-color)", strokeWidth: 12, strokeLinecap: "round",
          strokeDasharray: c, strokeDashoffset: c * (1 - (pret || reduit ? v : 0)), transition: reduit ? "none" : "stroke-dashoffset 1.1s cubic-bezier(0.2, 0.8, 0.2, 1)" }} />
      <text x={80} y={84} textAnchor="middle" className="v2-num" style={{ fontSize: 34, fontWeight: 700, fill: "var(--sk-t1)" }}>
        {taux == null ? "—" : Math.round(v * 100)}
      </text>
      <text x={80} y={104} textAnchor="middle" style={{ fontSize: 11, fill: "var(--v2-muted)" }}>% en règle</text>
    </svg>
  );
}

function CaseJour({ c, estompee, choisie, delai, etiquette, onClick }: {
  c: Case; estompee: boolean; choisie: boolean; delai: number; etiquette: string; onClick: () => void;
}) {
  const e = ETATS[c.recette];
  if (c.recette === "hors_contrat") return <span aria-hidden="true" />;
  const carburantSignale = c.alertes.includes("carburant_manquant");
  return (
    <button type="button" onClick={onClick} aria-pressed={choisie} className={`dcl-case v2-focus${choisie ? " dcl-case-choisie" : ""}`}
      aria-label={`${etiquette} : ${e.label}${c.carburant === "absent" ? ", pas de carburant déclaré" : ""}${c.alertes.length ? ", à régulariser" : ""}`}
      style={{ ...TONS[e.ton], animationDelay: `${delai}ms`, opacity: estompee ? 0.22 : 1 }}>
      {e.signe}
      {c.carburant === "absent" && (
        <span className="dcl-carburant" style={{ background: carburantSignale ? "var(--v2-negative-ink)" : "var(--sk-t3)" }} aria-hidden="true" />
      )}
    </button>
  );
}

function Detail({ ligne, c, onRepos, occupe }: { ligne: LigneChauffeur; c: Case; onRepos: () => void; occupe: boolean }) {
  const e = ETATS[c.recette];
  // Un repos ne se pose que sur un jour vide : une déclaration à zéro existe déjà et se corrige par la saisie.
  const reposPossible = c.recette === "manquante" && !c.coursesYango;
  return (
    <div className="rdt-entree" key={`${ligne.id}${c.jour}`} style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sk-t1)" }}>{ligne.nom}</div>
        <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>{jourLong(c.jour)}{ligne.plaque ? ` · ${ligne.plaque}` : ""}</div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, padding: "5px 10px", borderRadius: 8, border: "1px solid", fontSize: 13, ...TONS[e.ton] }}>
          {e.signe}<span style={{ color: "var(--sk-t1)" }}>{e.label}</span>
        </div>
      </div>
      <dl style={{ margin: 0, display: "grid", gap: 5, fontSize: 13, color: "var(--sk-t2)" }}>
        <Ligne terme="Recette déclarée">{c.ca == null ? (c.rejetee ? "rapport rejeté, à refaire" : "—") : `${formatAmount(c.ca)} XOF${c.source === "fleetroom" ? " · import Yango" : ""}`}</Ligne>
        <Ligne terme="Dépenses du jour">{c.depenses.nombre ? `${c.depenses.nombre} pour ${formatAmount(c.depenses.montant)} XOF${c.depenses.enAttente ? ` · ${c.depenses.enAttente} à valider` : ""}` : "aucune"}</Ligne>
        <Ligne terme="Carburant">{c.carburant === "ok" ? "déclaré" : c.carburant === "attente" ? "déclaré, à valider" : c.carburant === "absent" ? "rien de déclaré ce jour" : "sans objet"}</Ligne>
        {c.coursesYango != null && <Ligne terme="Courses Yango">{c.coursesYango}</Ligne>}
      </dl>
      <div style={{ display: "grid", gap: 8 }}>
        {c.alertes.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--sk-t2)" }}>Rien à régulariser pour cette journée.</p>
        ) : c.alertes.map((a) => (
          <p key={a} style={{ margin: 0, fontSize: 13, color: "var(--sk-t1)" }}>
            <strong>{ALERTES.find((x) => x.key === a)!.label}</strong> : {ALERTES.find((x) => x.key === a)!.phrase}.
          </p>
        ))}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {reposPossible && (
            <button type="button" className="v2-btn v2-btn-outline v2-focus" disabled={occupe} onClick={onRepos}
              style={{ height: 36, padding: "0 12px", borderRadius: 9, border: "1px solid var(--sk-border)", background: "transparent", color: "var(--sk-t1)", fontSize: 13, cursor: "pointer" }}>
              C&apos;était un repos
            </button>
          )}
          {c.alertes.length > 0 && (
            <a href="/admin?tab=saisie" className="v2-btn v2-btn-fill v2-focus"
              style={{ height: 36, padding: "0 14px", borderRadius: 9, background: "var(--tenant-color)", color: "var(--sk-deep)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              Saisir à sa place
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
const Ligne = ({ terme, children }: { terme: string; children: ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
    <dt style={{ color: "var(--v2-muted)" }}>{terme}</dt><dd style={{ margin: 0, color: "var(--sk-t1)", textAlign: "right" }}>{children}</dd>
  </div>
);

export function DeclarationsV2({ data, jours, onJours, loading, error, onRecharger }: {
  data: DeclarationsPayload | null;
  jours: number;
  onJours: (j: number) => void;
  loading: boolean;
  error: string | null;
  /** Après une action (repos, relance) : relire les données. */
  onRecharger: () => void | Promise<void>;
}) {
  const [filtre, setFiltre] = useState<Alerte | null>(null);
  const [choix, setChoix] = useState<{ id: string; jour: string } | null>(null);
  const [tout, setTout] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const presentes = useMemo(() => ALERTES.filter((a) => (data?.total.alertes[a.key] ?? 0) > 0), [data]);
  useEffect(() => { if (filtre && !presentes.some((a) => a.key === filtre)) setFiltre(null); }, [presentes, filtre]);

  const ligneChoisie = data?.chauffeurs.find((l) => l.id === choix?.id);
  const caseChoisie = ligneChoisie?.cases.find((c) => c.jour === choix?.jour);
  const aTraiter = (data?.aTraiter ?? []).filter((a) => !filtre || a.alerte === filtre);
  const nbAlertes = data ? Object.values(data.total.alertes).reduce((s, v) => s + v, 0) : 0;
  const hier = data ? new Date(Date.parse(`${data.aujourdhui}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : "";
  const manquantsHier = data?.chauffeurs.filter((l) => l.cases.some((c) => c.jour === hier && c.recette === "manquante")).length ?? 0;

  async function agir(url: string, corps: unknown, succes: (j: Record<string, unknown>) => string) {
    setOccupe(true); setMessage(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`);
      setMessage({ ok: true, texte: succes(j) });
      await onRecharger();
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : "Action impossible" });
    } finally { setOccupe(false); }
  }

  return (
    <div className="rdt" style={{ display: "grid", gap: 18, maxWidth: 1180, margin: "0 auto", opacity: loading && data ? 0.55 : 1, transition: "opacity .2s" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--sk-t1)", margin: 0, letterSpacing: "-0.01em" }}>Déclarations</h1>
          <p style={{ fontSize: 13.5, color: "var(--v2-muted)", margin: "4px 0 0" }}>
            {data ? <>Du {jourLong(data.du)} au {jourLong(data.au)} · {data.chauffeurs.length} chauffeur{data.chauffeurs.length > 1 ? "s" : ""} sous contrat</>
              : "Recettes, repos et carburant : qui a déclaré, et ce qui manque"}
          </p>
        </div>
        <Segmented ariaLabel="Période suivie" options={PERIODES} value={String(jours)} onChange={(k) => { setChoix(null); onJours(Number(k)); }} />
      </header>

      {error && <Card tone="neg"><p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--sk-t1)" }}>{error}</p></Card>}
      {!data && !error && <div className="v2-skeleton" style={{ height: 420, borderRadius: 14 }} aria-busy="true" aria-label="Lecture en cours" />}

      {data && data.chauffeurs.length === 0 && <Card><p style={{ margin: 0, fontSize: 14, color: "var(--sk-t2)" }}>Aucun chauffeur sous contrat sur cette période.</p></Card>}

      {data && data.chauffeurs.length > 0 && (
        <>
          <Card as="section" padding="24px 26px" className="rdt-hero">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
              <Anneau taux={data.total.taux} />
              <div style={{ flex: 1, minWidth: 260 }}>
                <Overline>{data.total.dus} journées dues · {data.total.enRegle} en règle</Overline>
                {nbAlertes === 0 ? (
                  <h2 style={{ fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 700, color: "var(--sk-t1)", margin: "10px 0 6px" }}>Tout est déclaré</h2>
                ) : (
                  <h2 style={{ fontSize: "clamp(20px, 2.6vw, 28px)", fontWeight: 600, color: "var(--sk-t1)", margin: "10px 0 6px", lineHeight: 1.25 }}>
                    <ChiffreAnime texte={String(nbAlertes)} style={{ color: "var(--tenant-color)", fontWeight: 700 }} /> point{nbAlertes > 1 ? "s" : ""} à régulariser,
                    chez {data.total.chauffeursConcernes} chauffeur{data.total.chauffeursConcernes > 1 ? "s" : ""}
                  </h2>
                )}
                <p style={{ fontSize: 14, color: "var(--sk-t2)", margin: 0, maxWidth: 560, lineHeight: 1.5 }}>
                  Chaque journée échue doit porter une recette ou un repos, et les journées travaillées du carburant.
                  {data.temoinYango ? " Les courses Yango importées servent de témoin." : ""} La journée en cours n&apos;est pas encore due.
                </p>
                {presentes.length > 0 && (
                  <div role="group" aria-label="Filtrer par type de manque" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                    {presentes.map((a) => {
                      const actif = filtre === a.key;
                      return (
                        <button key={a.key} type="button" aria-pressed={actif} onClick={() => setFiltre(actif ? null : a.key)} className="v2-btn v2-focus"
                          style={{ display: "inline-flex", alignItems: "baseline", gap: 8, height: 40, padding: "0 13px", borderRadius: 10, cursor: "pointer", fontSize: 13,
                            border: `1px solid ${actif ? "var(--tenant-color)" : "var(--sk-border)"}`, background: actif ? "var(--v2-select-bg)" : "var(--sk-bg)", color: "var(--sk-t1)" }}>
                          <strong className="v2-num" style={{ fontSize: 16 }}>{data.total.alertes[a.key]}</strong>{a.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {manquantsHier > 0 && (
                <button type="button" disabled={occupe} className="v2-btn v2-btn-fill v2-focus"
                  onClick={() => agir("/api/admin/remind-drivers", {}, (j) => `${j.reminded ?? 0} chauffeur(s) relancé(s) pour hier.`)}
                  style={{ height: 44, padding: "0 18px", borderRadius: 11, border: "none", background: "var(--tenant-color)", color: "var(--sk-deep)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  Relancer {manquantsHier} chauffeur{manquantsHier > 1 ? "s" : ""} pour hier
                </button>
              )}
            </div>
            {message && <p role="status" aria-live="polite" style={{ margin: "14px 0 0", fontSize: 13, color: message.ok ? "var(--fleet-positive)" : "var(--v2-negative-ink)" }}>{message.texte}</p>}
          </Card>

          <Card as="section" padding="20px 22px 18px">
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
              <h2 style={{ flex: 1, minWidth: 200, fontSize: 17, fontWeight: 600, color: "var(--sk-t1)", margin: 0 }}>
                {filtre ? ALERTES.find((a) => a.key === filtre)!.label : "Jour par jour"}
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--v2-muted)" }}>
                {filtre ? "Les autres cases sont estompées. Cliquez de nouveau sur le compteur pour tout revoir." : "Cliquez une case pour le détail et l'action."}
              </p>
            </div>
            <div style={{ overflowX: "auto", paddingBottom: 4 }}>
              <div className="dcl-grille" style={{ gridTemplateColumns: `minmax(130px, 190px) repeat(${data.jours.length}, minmax(30px, 1fr)) 74px`, minWidth: 220 + data.jours.length * 34 }}>
                <span />
                {data.jours.map((j) => (
                  <div key={j} style={{ textAlign: "center", lineHeight: 1.15, paddingBottom: 4, color: j === data.aujourdhui ? "var(--sk-t1)" : "var(--v2-muted)" }}>
                    <div style={{ fontSize: 10 }}>{jourCourt(j)}</div>
                    <div className="v2-num" style={{ fontSize: 12, fontWeight: j === data.aujourdhui ? 700 : 400 }}>{Number(j.slice(8))}</div>
                  </div>
                ))}
                <span />
                {data.chauffeurs.map((l, li) => (
                  <Rangee key={l.id}>
                    <div className="dcl-nom">
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--sk-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.nom}</div>
                      {l.plaque && <div className="v2-num" style={{ fontSize: 11, color: "var(--v2-muted)" }}>{l.plaque}</div>}
                    </div>
                    {l.cases.map((c, ci) => (
                      <CaseJour key={c.jour} c={c} delai={li * 30 + ci * 14} etiquette={`${l.nom}, ${jourLong(c.jour)}`}
                        estompee={Boolean(filtre) && !c.alertes.includes(filtre!)} choisie={choix?.id === l.id && choix.jour === c.jour}
                        onClick={() => setChoix(choix?.id === l.id && choix.jour === c.jour ? null : { id: l.id, jour: c.jour })} />
                    ))}
                    <div className="v2-num" style={{ fontSize: 12, color: l.enRegle === l.dus ? "var(--fleet-positive)" : "var(--sk-t2)", textAlign: "right", alignSelf: "center" }}
                         aria-label={`${l.enRegle} journées en règle sur ${l.dus}`}>
                      {l.enRegle}/{l.dus}
                    </div>
                  </Rangee>
                ))}
              </div>
            </div>

            <ul aria-label="Légende" style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: "6px 16px", margin: "14px 0 0", padding: 0, fontSize: 12, color: "var(--v2-muted)" }}>
              {(["declaree", "attente", "repos", "sans_chiffre", "manquante"] as EtatRecette[]).map((k) => (
                <li key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 20, height: 20, borderRadius: 5, border: "1px solid", display: "inline-flex", alignItems: "center", justifyContent: "center", ...TONS[ETATS[k].ton] }}>{ETATS[k].signe}</span>
                  {ETATS[k].label}
                </li>
              ))}
              <li style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Fuel size={13} aria-hidden="true" /> point en coin : pas de carburant déclaré ce jour (rouge dès la 2ᵉ journée travaillée de suite)
              </li>
            </ul>

            <div aria-live="polite" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--sk-surface)", minHeight: 96 }}>
              {ligneChoisie && caseChoisie ? (
                <Detail ligne={ligneChoisie} c={caseChoisie} occupe={occupe}
                  onRepos={() => agir("/api/admin/repos", { driver_id: ligneChoisie.id, date: caseChoisie.jour }, () => `Repos enregistré pour ${ligneChoisie.nom}.`)} />
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--v2-muted)" }}>Aucune case sélectionnée.</p>
              )}
            </div>
          </Card>

          {aTraiter.length > 0 && (
            <Card as="section" padding="20px 22px">
              <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--sk-t1)", margin: "0 0 12px" }}>À régulariser, du plus récent au plus ancien</h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
                {(tout ? aTraiter : aTraiter.slice(0, 10)).map((a, k) => (
                  <li key={`${a.chauffeurId}${a.jour}${a.alerte}`}>
                    <button type="button" className="v2-row v2-focus rdt-entree" onClick={() => { setChoix({ id: a.chauffeurId, jour: a.jour }); document.querySelector(".dcl-grille")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                      style={{ animationDelay: `${Math.min(k, 10) * 30}ms`, width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: "minmax(110px, 170px) minmax(0, 1fr) auto", gap: 12, alignItems: "center", padding: "10px 8px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer" }}>
                      <span style={{ fontSize: 13, color: "var(--v2-muted)" }}>{jourLong(a.jour)}</span>
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 14, color: "var(--sk-t1)" }}>{a.nom}</strong>
                        <span style={{ fontSize: 13, color: "var(--sk-t2)" }}> · {a.detail}</span>
                      </span>
                      <span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 7, border: "1px solid var(--sk-border)", color: "var(--sk-t2)", whiteSpace: "nowrap" }}>
                        {ALERTES.find((x) => x.key === a.alerte)!.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {aTraiter.length > 10 && (
                <button type="button" className="v2-link v2-focus" onClick={() => setTout((t) => !t)} style={{ marginTop: 10, background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                  {tout ? "Réduire la liste" : `Voir les ${aTraiter.length}`}
                </button>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
const Rangee = ({ children }: { children: ReactNode }) => <>{children}</>;
