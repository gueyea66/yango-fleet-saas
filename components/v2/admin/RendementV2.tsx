"use client";

/**
 * Performance → Rendement : où, quand et comment la flotte gagne le plus.
 *
 * L'écran se lit en trois temps, du verdict à la preuve :
 *   1. un constat à la fois, en grand, et ce que vaut l'heure qu'il est ;
 *   2. la semaine entière sur une seule grille, dont on change la mesure ;
 *   3. un seul bloc à sélecteur pour le détail : zones, chauffeurs, coupures.
 * Aucun chiffre n'est écrit en dur : tout vient de `calculerRendement`, donc
 * les constats changent d'eux-mêmes quand les données s'accumulent.
 *
 * Une seule teinte pour toutes les intensités (la couleur de marque, du pâle
 * au plein) : la couleur dit « combien », jamais « quoi ». Le mouvement sert
 * à guider l'œil et s'éteint avec `prefers-reduced-motion`.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, MapPin, Pause, Play, Route } from "lucide-react";
import { Card, Overline, Segmented } from "@/components/ui";
import { formatAmount, formatDecimal } from "@/lib/v2/format";
import type { Cellule, Constat, Coupure, Rendement } from "@/lib/analytics/rendement";

/** `fenetre` : nombre de jours demandés (0 = tout l'historique). */
export type RendementPayload = Rendement & { fenetre: number };

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const PERIODES = [
  { key: "30", label: "30 jours" }, { key: "90", label: "90 jours" },
  { key: "365", label: "12 mois" }, { key: "0", label: "Tout" },
];

const dateFr = (iso: string | null) =>
  (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—");
const heureMin = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const duree = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}`);
const signe = (v: number) => `${v >= 0 ? "+" : "−"}${formatAmount(Math.abs(v))}`;

/* ── Mouvement ──────────────────────────────────────────────── */

export function useMouvementReduit() {
  const [reduit, setReduit] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const maj = () => setReduit(m.matches);
    maj();
    m.addEventListener("change", maj);
    return () => m.removeEventListener("change", maj);
  }, []);
  return reduit;
}

/** Fait monter le premier nombre d'un texte (« +36 % », « 5 195 XOF/h ») de zéro à sa valeur. */
export function ChiffreAnime({ texte, style }: { texte: string; style?: CSSProperties }) {
  const reduit = useMouvementReduit();
  const m = texte.match(/^([^\d]*)(\d(?:[\d\s  ]*\d)?)(.*)$/);
  const cible = m ? Number(m[2].replace(/[^\d]/g, "")) : 0;
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!m || reduit) return;
    let raf = 0;
    const t0 = performance.now();
    const pas = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setV(Math.round(cible * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relancé quand le texte change
  }, [texte, reduit]);
  return (
    <span className="v2-num" style={style} aria-label={texte}>
      {m ? <>{m[1]}{formatAmount(reduit ? cible : v)}<span style={{ fontSize: "0.42em", fontWeight: 600, marginLeft: "0.12em" }}>{m[3].trim()}</span></> : texte}
    </span>
  );
}

/* ── 1. Le constat ──────────────────────────────────────────── */

const CONFIANCE: Record<Constat["confiance"], string> = {
  forte: "constat solide", moyenne: "à confirmer avec plus de données", faible: "encore peu de données",
};

function Verdict({ constats }: { constats: Constat[] }) {
  const reduit = useMouvementReduit();
  const [i, setI] = useState(0);
  const [pause, setPause] = useState(false);
  const n = constats.length;
  useEffect(() => { setI(0); }, [n]);
  useEffect(() => {
    if (n < 2 || pause || reduit) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), 9000);
    return () => clearTimeout(t);
  }, [i, n, pause, reduit]);

  if (!n) {
    return (
      <div style={{ padding: "28px 4px" }}>
        <Overline>Constat</Overline>
        <p style={{ fontSize: 22, fontWeight: 600, color: "var(--sk-t1)", margin: "10px 0 6px" }}>Pas encore assez de données sur cette période</p>
        <p style={{ fontSize: 14, color: "var(--sk-t2)", maxWidth: 520 }}>
          Les constats apparaissent dès une cinquantaine d&apos;heures d&apos;activité. Élargissez la période ou chargez d&apos;autres exports Yango.
        </p>
      </div>
    );
  }
  const c = constats[Math.min(i, n - 1)];
  return (
    <div onMouseEnter={() => setPause(true)} onMouseLeave={() => setPause(false)}
         onFocus={() => setPause(true)} onBlur={() => setPause(false)}
         style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
      <Overline>Constat {i + 1} sur {n} · {CONFIANCE[c.confiance]}</Overline>
      <div key={c.id} className="rdt-entree" aria-live="polite" style={{ marginTop: 10, minHeight: 190 }}>
        <ChiffreAnime texte={c.chiffre}
          style={{ display: "block", fontSize: "clamp(44px, 7vw, 76px)", lineHeight: 1, fontWeight: 700, color: "var(--tenant-color)", letterSpacing: "-0.02em" }} />
        <h2 style={{ fontSize: "clamp(18px, 2.2vw, 24px)", fontWeight: 600, color: "var(--sk-t1)", margin: "14px 0 8px", lineHeight: 1.25, maxWidth: 620 }}>
          {c.titre}
        </h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--sk-t2)", maxWidth: 600, margin: 0 }}>{c.detail}</p>
      </div>
      {n > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <button type="button" className="v2-btn v2-focus rdt-rond" aria-label="Constat précédent" onClick={() => setI((x) => (x - 1 + n) % n)}><ChevronLeft size={16} /></button>
          <div role="tablist" aria-label="Constats" style={{ display: "flex", gap: 6, flex: 1, maxWidth: 320 }}>
            {constats.map((k, j) => (
              <button key={k.id} type="button" role="tab" aria-selected={j === i} aria-label={k.titre} onClick={() => setI(j)}
                className="v2-focus rdt-jalon" style={{ flex: 1 }}>
                <span className={j === i && !pause && !reduit ? "rdt-jalon-plein rdt-jalon-anime" : "rdt-jalon-plein"}
                      style={{ transform: j < i || (j === i && (pause || reduit)) ? "scaleX(1)" : j === i ? undefined : "scaleX(0)" }} />
              </button>
            ))}
          </div>
          <button type="button" className="v2-btn v2-focus rdt-rond" aria-label="Constat suivant" onClick={() => setI((x) => (x + 1) % n)}><ChevronRight size={16} /></button>
          <button type="button" className="v2-btn v2-focus rdt-rond" aria-label={pause ? "Reprendre le défilement" : "Mettre en pause"} onClick={() => setPause((p) => !p)}>
            {pause ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── 1 bis. L'heure qu'il est ───────────────────────────────── */

/** Dakar vit en UTC : jour (0 = lundi) et heure courants, rafraîchis chaque minute. */
function useMaintenant() {
  const lire = () => { const d = new Date(); return { js: (d.getUTCDay() + 6) % 7, h: d.getUTCHours(), m: d.getUTCMinutes() }; };
  const [t, setT] = useState<{ js: number; h: number; m: number } | null>(null);
  useEffect(() => {
    setT(lire());
    const id = setInterval(() => setT(lire()), 60000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function secteur(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

function Cadran({ data }: { data: Rendement }) {
  const now = useMaintenant();
  const ref = data.periode.xofH;
  const jour = now ? data.grille.filter((c) => c.js === now.js) : [];
  const vals = data.grille.map((c) => c.xofHLisse).filter((v): v is number => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const cell = now ? jour.find((c) => c.h === now.h) : undefined;
  const ecart = cell?.xofHLisse && ref ? cell.xofHLisse / ref - 1 : null;

  // Prochain créneau nettement au-dessus de la moyenne, dans les 48 h.
  const prochain = useMemo(() => {
    if (!now || !ref) return null;
    for (let k = 1; k <= 48; k++) {
      const h = (now.h + k) % 24, js = (now.js + Math.floor((now.h + k) / 24)) % 7;
      const c = data.grille.find((x) => x.js === js && x.h === h);
      if (c?.fiable && c.xofHLisse && c.xofHLisse >= ref * 1.1) return { c, k, gain: c.xofHLisse / ref - 1 };
    }
    return null;
  }, [now, ref, data.grille]);

  const angle = now ? ((now.h + now.m / 60) / 24) * 360 : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: 250, flex: "none" }}>
      <Overline>Maintenant</Overline>
      <svg viewBox="0 0 220 220" width={210} height={210} role="img"
           aria-label={cell?.xofHLisse ? `${JOURS[now!.js]} ${now!.h} h : ${formatAmount(cell.xofHLisse)} XOF par heure habituellement` : "Cadran des 24 heures"}>
        {jour.map((c) => {
          const v = c.xofHLisse != null && hi > lo ? (c.xofHLisse - lo) / (hi - lo) : 0;
          const a0 = (c.h / 24) * Math.PI * 2 + 0.015, a1 = ((c.h + 1) / 24) * Math.PI * 2 - 0.015;
          return (
            <path key={c.h} d={secteur(110, 110, 62, 70 + 30 * v, a0, a1)} className="rdt-secteur"
                  style={{ fill: "var(--tenant-color)", opacity: c.heures > 0 ? 0.22 + 0.78 * v : 0.08, animationDelay: `${c.h * 28}ms` }} />
          );
        })}
        {[0, 6, 12, 18].map((h) => {
          const a = (h / 24) * Math.PI * 2;
          return <text key={h} x={110 + 106 * Math.sin(a)} y={110 - 106 * Math.cos(a) + 4} textAnchor="middle"
                       style={{ fontSize: 10, fill: "var(--v2-muted)" }}>{h} h</text>;
        })}
        {now && (
          <g className="rdt-aiguille" style={{ transform: `rotate(${angle}deg)`, transformOrigin: "110px 110px" }}>
            <line x1={110} y1={110} x2={110} y2={14} style={{ stroke: "var(--sk-t1)", strokeWidth: 2, strokeLinecap: "round" }} />
            <circle cx={110} cy={14} r={4} style={{ fill: "var(--sk-t1)" }} />
          </g>
        )}
        <circle cx={110} cy={110} r={54} style={{ fill: "var(--sk-bg)" }} />
        <text x={110} y={98} textAnchor="middle" style={{ fontSize: 11, fill: "var(--v2-muted)" }}>
          {now ? `${JOURS[now.js]} ${now.h} h` : ""}
        </text>
        <text x={110} y={120} textAnchor="middle" className="v2-num" style={{ fontSize: 19, fontWeight: 700, fill: "var(--sk-t1)" }}>
          {cell?.xofHLisse ? formatAmount(cell.xofHLisse) : "—"}
        </text>
        <text x={110} y={136} textAnchor="middle" style={{ fontSize: 10, fill: "var(--v2-muted)" }}>XOF par heure</text>
      </svg>
      <p style={{ fontSize: 13, color: "var(--sk-t2)", textAlign: "center", margin: 0, lineHeight: 1.45, minHeight: 56 }}>
        {ecart != null && (
          <>Créneau habituellement <strong style={{ color: "var(--sk-t1)" }}>
            {Math.abs(ecart) < 0.05 ? "dans la moyenne" : ecart > 0 ? `${Math.round(ecart * 100)} % au-dessus de la moyenne` : `${Math.round(-ecart * 100)} % sous la moyenne`}
          </strong>.<br /></>
        )}
        {prochain && (
          <>Prochain bon créneau : {prochain.k < 24 - (now?.h ?? 0) ? "aujourd'hui" : JOURS[prochain.c.js].toLowerCase()} {prochain.c.h} h
            {" "}(+{Math.round(prochain.gain * 100)} %).</>
        )}
      </p>
    </div>
  );
}

/* ── 2. La semaine ──────────────────────────────────────────── */

type Mesure = "xofH" | "xofKm" | "vitesse" | "heures" | "annul";
const MESURES: { key: Mesure; label: string; phrase: string; lire: (c: Cellule) => number | null; dire: (v: number) => string }[] = [
  { key: "xofH", label: "Gain par heure", phrase: "XOF par heure d'activité", lire: (c) => c.xofHLisse, dire: (v) => `${formatAmount(v)} XOF/h` },
  { key: "xofKm", label: "Prix au km", phrase: "XOF par km, médiane des courses", lire: (c) => c.xofKm, dire: (v) => `${formatAmount(v)} XOF/km` },
  { key: "vitesse", label: "Vitesse", phrase: "km/h en course", lire: (c) => c.vitesse, dire: (v) => `${formatDecimal(v, 0)} km/h` },
  { key: "heures", label: "Présence", phrase: "heures d'activité de la flotte", lire: (c) => (c.heures > 0 ? c.heures : null), dire: (v) => `${formatDecimal(v, 0)} h` },
  { key: "annul", label: "Annulations", phrase: "part des demandes annulées par le client", lire: (c) => c.annulClient, dire: (v) => `${Math.round(v * 100)} %` },
];

function Semaine({ data }: { data: Rendement }) {
  const [mesure, setMesure] = useState<Mesure>("xofH");
  const now = useMaintenant();
  const [survol, setSurvol] = useState<number | null>(null);
  const [epingle, setEpingle] = useState<number | null>(null);
  const def = MESURES.find((m) => m.key === mesure)!;

  const { lo, hi } = useMemo(() => {
    // bornes sur les cellules fiables, extrêmes écartés : une heure presque vide ne doit pas écraser l'échelle
    const v = data.grille.filter((c) => c.fiable || mesure === "heures").map(def.lire).filter((x): x is number => x != null).sort((a, b) => a - b);
    if (!v.length) return { lo: 0, hi: 1 };
    return { lo: v[Math.floor(v.length * 0.04)], hi: v[Math.min(v.length - 1, Math.floor(v.length * 0.97))] };
  }, [data.grille, def, mesure]);
  const intensite = (x: number | null) => (x == null || hi <= lo ? 0 : Math.max(0, Math.min(1, (x - lo) / (hi - lo))));

  // Marges : la même mesure, résumée par heure (en haut) et par jour (à droite).
  const marge = (cells: Cellule[]) => {
    let s = 0, w = 0;
    for (const c of cells) {
      const x = def.lire(c);
      if (x == null) continue;
      const p = mesure === "heures" ? 1 : c.heures;
      s += x * p; w += p;
    }
    return w > 0 ? (mesure === "heures" ? s : s / w) : null;
  };
  const parHeure = Array.from({ length: 24 }, (_, h) => marge(data.grille.filter((c) => c.h === h)));
  const parJour = Array.from({ length: 7 }, (_, js) => marge(data.grille.filter((c) => c.js === js)));
  const maxH = Math.max(1, ...parHeure.map((v) => v ?? 0)), maxJ = Math.max(1, ...parJour.map((v) => v ?? 0));

  const idx = epingle ?? survol;
  const vu = idx != null ? data.grille[idx] : null;

  return (
    <Card as="section" padding="20px 22px 18px">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--sk-t1)", margin: 0 }}>La semaine en un regard</h2>
          <p style={{ fontSize: 13, color: "var(--v2-muted)", margin: "3px 0 0" }}>{def.phrase}, heure par heure. Plus la case est pleine, plus la valeur est haute.</p>
        </div>
        <Segmented ariaLabel="Mesure affichée" options={MESURES.map((m) => ({ key: m.key, label: m.label }))} value={mesure} onChange={setMesure} />
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div className="rdt-grille" style={{ minWidth: 620 }} onMouseLeave={() => setSurvol(null)}>
          <span />
          {parHeure.map((v, h) => (
            <div key={`m${h}`} style={{ height: 34, display: "flex", alignItems: "flex-end" }} aria-hidden="true">
              <div className="rdt-barre" style={{ width: "100%", height: `${Math.max(6, ((v ?? 0) / maxH) * 100)}%`, background: "var(--sk-border)", borderRadius: "3px 3px 0 0" }} />
            </div>
          ))}
          <span />
          {Array.from({ length: 7 }, (_, js) => (
            <Ligne key={js}>
              <span style={{ fontSize: 12, color: "var(--sk-t2)", alignSelf: "center" }}>{JOURS_COURTS[js]}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const i = js * 24 + h, c = data.grille[i], x = def.lire(c), v = intensite(x);
                const ici = now?.js === js && now.h === h;
                return (
                  <button key={h} type="button"
                    className={`rdt-case v2-focus${ici ? " rdt-case-ici" : ""}${epingle === i ? " rdt-case-epingle" : ""}`}
                    aria-label={`${JOURS[js]} ${h} h : ${x == null ? "aucune donnée" : def.dire(x)}${c.fiable ? "" : ", peu de données"}`}
                    onMouseEnter={() => setSurvol(i)} onFocus={() => setSurvol(i)}
                    onClick={() => setEpingle((e) => (e === i ? null : i))}
                    style={{
                      animationDelay: `${h * 14 + js * 10}ms`,
                      background: x == null ? "transparent"
                        : `color-mix(in oklab, var(--tenant-color) ${Math.round(8 + 92 * v)}%, var(--sk-surface))`,
                      border: x == null ? "1px dashed var(--sk-border)" : "1px solid transparent",
                      opacity: x != null && !c.fiable && mesure !== "heures" ? 0.45 : 1,
                    }} />
                );
              })}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }} aria-hidden="true">
                <div className="rdt-barre" style={{ height: 8, width: `${Math.max(6, ((parJour[js] ?? 0) / maxJ) * 46)}px`, background: "var(--sk-border)", borderRadius: 3 }} />
                <span className="v2-num" style={{ fontSize: 11, color: "var(--v2-muted)" }}>{parJour[js] == null ? "" : def.dire(parJour[js]!).replace(/ XOF.*/, "")}</span>
              </div>
            </Ligne>
          ))}
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={`h${h}`} className="v2-num" style={{ fontSize: 10, color: "var(--v2-muted)", textAlign: "center" }}>{h % 3 === 0 ? h : ""}</span>
          ))}
          <span />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 14, minHeight: 44 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} aria-hidden="true">
          <span className="v2-num" style={{ fontSize: 11, color: "var(--v2-muted)" }}>{def.dire(lo)}</span>
          <span style={{ width: 90, height: 8, borderRadius: 4, background: "linear-gradient(90deg, color-mix(in oklab, var(--tenant-color) 8%, var(--sk-surface)), var(--tenant-color))" }} />
          <span className="v2-num" style={{ fontSize: 11, color: "var(--v2-muted)" }}>{def.dire(hi)}</span>
        </div>
        <p aria-live="polite" style={{ flex: 1, minWidth: 260, margin: 0, fontSize: 13, color: "var(--sk-t2)", lineHeight: 1.5 }}>
          {vu ? (
            <>
              <strong style={{ color: "var(--sk-t1)" }}>{JOURS[vu.js]} {vu.h} h – {(vu.h + 1) % 24} h</strong>
              {vu.heures <= 0 ? " · aucune activité observée" : (
                <> · {vu.xofH != null ? `${formatAmount(vu.xofH)} XOF/h` : "—"}
                  {vu.xofKm != null && ` · ${formatAmount(vu.xofKm)} XOF/km`}
                  {vu.vitesse != null && ` · ${formatDecimal(vu.vitesse, 0)} km/h`}
                  {vu.majoration != null && ` · tarif ×${formatDecimal(vu.majoration, 2)}`}
                  {vu.annulClient != null && ` · ${Math.round(vu.annulClient * 100)} % d'annulations`}
                  {` · ${vu.courses} courses sur ${formatDecimal(vu.heures, 0)} h`}
                  {!vu.fiable && " · peu de données, à lire avec prudence"}
                </>
              )}
            </>
          ) : "Survolez une case pour lire le créneau ; cliquez pour la garder affichée. La case cerclée est l'heure qu'il est."}
        </p>
      </div>
    </Card>
  );
}
const Ligne = ({ children }: { children: ReactNode }) => <>{children}</>;

/* ── 3. Le détail, un bloc à sélecteur ──────────────────────── */

function Zones({ data }: { data: Rendement }) {
  const z = data.zones;
  const [vu, setVu] = useState<string | null>(null);
  if (z.length < 3) return <Vide>Les adresses de cette période ne permettent pas encore de comparer les zones.</Vide>;
  const W = 640, Hh = 340, m = { g: 56, d: 20, h: 18, b: 40 };
  const xs = z.map((a) => a.xofKm), ys = z.map((a) => a.xofHCourse);
  const borne = (v: number[]) => { const a = Math.min(...v), b = Math.max(...v), p = (b - a) * 0.12 || 1; return [a - p, b + p] as const; };
  const [x0, x1] = borne(xs), [y0, y1] = borne(ys);
  const X = (v: number) => m.g + ((v - x0) / (x1 - x0)) * (W - m.g - m.d);
  const Y = (v: number) => Hh - m.b - ((v - y0) / (y1 - y0)) * (Hh - m.h - m.b);
  const maxN = Math.max(...z.map((a) => a.courses));
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const mx = med(xs), my = med(ys);
  const rayon = (n: number) => 5 + 15 * Math.sqrt(n / maxN);
  // Étiquettes posées des zones les plus fréquentées aux moins fréquentées, au-dessus
  // de la bulle puis en dessous ; celle qui chevaucherait une autre attend le survol.
  const etiquettes = new Map<string, number>();
  const prises: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const a of [...z].sort((p, q) => q.courses - p.courses)) {
    const cx = X(a.xofKm), cy = Y(a.xofHCourse), r = rayon(a.courses), l = a.nom.length * 3.3 + 4;
    for (const y of [cy - r - 5, cy + r + 13]) {
      const b = { x0: cx - l, x1: cx + l, y0: y - 11, y1: y + 3 };
      if (b.x0 < m.g || b.x1 > W - m.d || b.y0 < 0 || b.y1 > Hh - m.b) continue;
      if (prises.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0)) continue;
      prises.push(b); etiquettes.set(a.code, y);
      break;
    }
  }
  const cible = z.find((a) => a.code === vu);
  const attente = z.filter((a) => a.attenteApres != null).sort((a, b) => a.attenteApres! - b.attenteApres!);
  const maxAtt = Math.max(1, ...attente.map((a) => a.attenteApres!));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, alignItems: "start" }}>
      <figure style={{ margin: 0, minWidth: 0, gridColumn: "span 2" }}>
        <figcaption style={{ fontSize: 13, color: "var(--v2-muted)", marginBottom: 8 }}>
          Chaque zone de départ selon ce qu&apos;elle paie au kilomètre (vers la droite) et à l&apos;heure en course (vers le haut). En haut à gauche, les zones
          rapides, payées à l&apos;heure ; en bas à droite, les zones denses, payées au kilomètre. La taille suit le nombre de courses.
        </figcaption>
        <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", height: "auto", display: "block" }} role="img"
             aria-label="Zones de départ : prix au kilomètre et gain par heure en course" onMouseLeave={() => setVu(null)}>
          <line x1={X(mx)} x2={X(mx)} y1={m.h} y2={Hh - m.b} style={{ stroke: "var(--sk-border)", strokeDasharray: "3 4" }} />
          <line x1={m.g} x2={W - m.d} y1={Y(my)} y2={Y(my)} style={{ stroke: "var(--sk-border)", strokeDasharray: "3 4" }} />
          <text x={(m.g + W - m.d) / 2} y={Hh - 8} textAnchor="middle" style={{ fontSize: 11, fill: "var(--v2-muted)" }}>XOF par km →</text>
          <text x={14} y={(m.h + Hh - m.b) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(m.h + Hh - m.b) / 2})`} style={{ fontSize: 11, fill: "var(--v2-muted)" }}>XOF par heure en course →</text>
          {[x0, x1].map((v, k) => <text key={`x${k}`} x={X(v)} y={Hh - m.b + 14} textAnchor={k ? "end" : "start"} className="v2-num" style={{ fontSize: 10, fill: "var(--v2-muted)" }}>{formatAmount(v)}</text>)}
          {[y0, y1].map((v, k) => <text key={`y${k}`} x={m.g - 6} y={Y(v) + (k ? 10 : 0)} textAnchor="end" className="v2-num" style={{ fontSize: 10, fill: "var(--v2-muted)" }}>{formatAmount(v)}</text>)}
          {z.map((a, k) => {
            const r = rayon(a.courses), actif = vu === a.code;
            const yEtiquette = etiquettes.get(a.code) ?? (actif ? Y(a.xofHCourse) - r - 5 : null);
            return (
              <g key={a.code} className="rdt-bulle" style={{ animationDelay: `${k * 35}ms`, transformOrigin: `${X(a.xofKm)}px ${Y(a.xofHCourse)}px` }}
                 onMouseEnter={() => setVu(a.code)} onFocus={() => setVu(a.code)} tabIndex={0}
                 aria-label={`${a.nom} : ${formatAmount(a.xofKm)} XOF par km, ${formatAmount(a.xofHCourse)} XOF par heure, ${a.courses} courses`}>
                <circle cx={X(a.xofKm)} cy={Y(a.xofHCourse)} r={r + 6} style={{ fill: "transparent" }} />
                <circle cx={X(a.xofKm)} cy={Y(a.xofHCourse)} r={r}
                        style={{ fill: "var(--tenant-color)", fillOpacity: actif ? 0.95 : 0.55, stroke: "var(--sk-bg)", strokeWidth: 2, transition: "fill-opacity .15s" }} />
                {yEtiquette != null && (
                  <text x={X(a.xofKm)} y={yEtiquette} textAnchor="middle"
                        style={{ fontSize: 11, fontWeight: actif ? 600 : 400, fill: "var(--sk-t1)", paintOrder: "stroke", stroke: "var(--sk-bg)", strokeWidth: 3 }}>{a.nom}</text>
                )}
              </g>
            );
          })}
        </svg>
        <p aria-live="polite" style={{ fontSize: 13, color: "var(--sk-t2)", margin: "6px 0 0", minHeight: 20 }}>
          {cible ? (
            <><strong style={{ color: "var(--sk-t1)" }}>{cible.nom}</strong> · {formatAmount(cible.xofKm)} XOF/km · {formatAmount(cible.xofHCourse)} XOF/h en course · {formatDecimal(cible.vitesse, 0)} km/h · {formatAmount(cible.courses)} courses</>
          ) : "Survolez une zone pour ses chiffres."}
        </p>
      </figure>

      {attente.length >= 3 && (
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--sk-t1)", margin: "0 0 4px" }}>Où l&apos;on retrouve vite un client</h3>
          <p style={{ fontSize: 12.5, color: "var(--v2-muted)", margin: "0 0 12px" }}>Minutes entre une dépose dans la zone et la course suivante.</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 7 }}>
            {attente.map((a, k) => (
              <li key={a.code} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 46px", gap: 8, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "var(--sk-t2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.nom}</div>
                  <div style={{ height: 4, borderRadius: 2, background: "var(--sk-surface)", marginTop: 3 }}>
                    <div className="rdt-barre-l" style={{ height: 4, borderRadius: 2, width: `${(a.attenteApres! / maxAtt) * 100}%`, background: "var(--tenant-color)", animationDelay: `${k * 40}ms` }} />
                  </div>
                </div>
                <span className="v2-num" style={{ fontSize: 12.5, color: "var(--sk-t1)", textAlign: "right" }}>{formatDecimal(a.attenteApres, 1)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Chauffeurs({ data }: { data: Rendement }) {
  const c = data.chauffeurs, ref = data.periode.xofH ?? 0;
  if (!c.length) return <Vide>Aucun chauffeur n&apos;a assez d&apos;heures d&apos;activité sur cette période.</Vide>;
  const max = Math.max(...c.map((x) => x.xofH), ref) * 1.05;
  const maxProfil = Math.max(...c.flatMap((x) => x.profil));
  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--v2-muted)", margin: "0 0 14px", maxWidth: 760 }}>
        Gain par heure d&apos;activité face à la moyenne de la flotte (le trait). L&apos;écart se sépare en deux : ce que rapportent ou coûtent les
        horaires choisis, et ce qui reste, qui tient à la manière de travailler. La frise montre quand chacun roule, de 0 h à 23 h.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
        {c.map((x, k) => (
          <li key={x.id} className="v2-row rdt-chauffeur" style={{ alignItems: "center", padding: "10px 8px", borderRadius: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sk-t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.nom}</div>
              <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>
                {formatAmount(x.heures)} h · {x.acceptation == null ? "—" : `${Math.round(x.acceptation * 100)} % acceptées`}
              </div>
            </div>
            <div style={{ position: "relative", height: 26 }} role="img" aria-label={`${formatAmount(x.xofH)} XOF par heure, moyenne de la flotte ${formatAmount(ref)}`}>
              <div style={{ position: "absolute", inset: "9px 0", borderRadius: 4, background: "var(--sk-surface)" }} />
              <div className="rdt-barre-l" style={{ position: "absolute", top: 9, bottom: 9, left: 0, borderRadius: 4, width: `${(x.xofH / max) * 100}%`, background: "var(--tenant-color)", animationDelay: `${k * 60}ms` }} />
              <div style={{ position: "absolute", top: 5, bottom: 3, left: `${(ref / max) * 100}%`, width: 2, background: "var(--sk-t1)", borderRadius: 1 }} />
              <span className="v2-num" style={{ position: "absolute", right: 0, top: -10, fontSize: 12.5, fontWeight: 600, color: "var(--sk-t1)", background: "var(--sk-bg)", paddingLeft: 6 }}>{formatAmount(x.xofH)}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 1.5 }} role="img"
                 aria-label={`Heures travaillées : surtout ${x.profil.indexOf(Math.max(...x.profil))} h`}>
              {x.profil.map((p, h) => (
                <span key={h} style={{ height: 16, borderRadius: 2, background: `color-mix(in oklab, var(--tenant-color) ${Math.round(6 + 94 * (maxProfil ? p / maxProfil : 0))}%, var(--sk-surface))` }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Pastille titre="Horaires" valeur={x.effetHoraires} />
              <Pastille titre="Manière" valeur={x.effetPropre} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pastille({ titre, valeur }: { titre: string; valeur: number }) {
  const neutre = Math.abs(valeur) < 50;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "4px 9px", borderRadius: 8, border: "1px solid var(--sk-surface)", background: "var(--sk-bg)", fontSize: 12, color: "var(--v2-muted)", whiteSpace: "nowrap" }}>
      {titre}
      <strong className="v2-num" style={{ color: neutre ? "var(--sk-t2)" : valeur > 0 ? "var(--fleet-positive)" : "var(--v2-negative-ink)" }}>
        {neutre ? "≈ 0" : signe(valeur)}
      </strong>
    </span>
  );
}

function vraisemblance(c: Coupure): { texte: string; ton: "fort" | "moyen" | "faible" } {
  if (c.probaAllumee < 0.01) return { texte: "application très probablement éteinte", ton: "fort" };
  if (c.probaAllumee < 0.05) return { texte: "application probablement éteinte", ton: "moyen" };
  return { texte: "silence possible application allumée", ton: "faible" };
}

function Coupures({ data }: { data: Rendement }) {
  const r = data.coupuresResume;
  const [tout, setTout] = useState(false);
  if (!r.nombre) return <Vide>Aucun silence d&apos;une à cinq heures entre deux périodes d&apos;activité sur cette période.</Vide>;
  const max = Math.max(1, ...r.parHeure);
  const liste = tout ? data.coupures : data.coupures.slice(0, 8);
  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--v2-muted)", margin: "0 0 16px", maxWidth: 780 }}>
        Une coupure est un silence de Yango d&apos;une à cinq heures au milieu d&apos;une journée de travail : aucune course, aucun refus, aucune annulation.
        {data.periode.sollicitationsParHeure != null && <> La flotte reçoit d&apos;ordinaire {formatDecimal(data.periode.sollicitationsParHeure, 1)} sollicitations par heure : un long silence, application allumée, est improbable.</>}
        {" "}C&apos;est une déduction, pas un constat ; le GPS dit ensuite si le véhicule roulait ou s&apos;il était à l&apos;arrêt.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 18 }}>
        <Chiffre titre="Coupures déduites" valeur={formatAmount(r.nombre)} />
        <Chiffre titre="Heures de silence" valeur={`${formatAmount(r.heures)} h`} />
        <Chiffre titre="Vérifiées par le GPS" valeur={formatAmount(r.avecGps)} note={r.avecGps ? undefined : "le suivi vient de démarrer"} />
        <Chiffre titre="Roulées pendant le silence" valeur={r.avecGps ? `${formatAmount(r.roulees)} · ${formatAmount(r.kmRoules)} km` : "—"} fort={r.roulees > 0} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, alignItems: "end", height: 64 }} role="img"
           aria-label={`Coupures par heure de début, pic à ${r.parHeure.indexOf(max)} h`}>
        {r.parHeure.map((n, h) => (
          <div key={h} title={`${h} h : ${n}`} className="rdt-barre" style={{ height: `${Math.max(3, (n / max) * 100)}%`, background: "var(--tenant-color)", opacity: 0.35 + 0.65 * (n / max), borderRadius: "3px 3px 0 0", animationDelay: `${h * 18}ms` }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, marginBottom: 18 }} aria-hidden="true">
        {r.parHeure.map((_, h) => <span key={h} className="v2-num" style={{ fontSize: 10, color: "var(--v2-muted)", textAlign: "center" }}>{h % 3 === 0 ? h : ""}</span>)}
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {liste.map((c, k) => {
          const v = vraisemblance(c), jour = c.debut.slice(0, 10);
          return (
            <li key={`${c.debut}${c.chauffeur}`} className="rdt-entree" style={{ animationDelay: `${Math.min(k, 8) * 40}ms`, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, border: `1px solid ${c.nature === "roule" ? "var(--tenant-color)" : "var(--sk-surface)"}`, background: c.nature === "roule" ? "var(--v2-select-bg)" : "transparent" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "var(--sk-t1)" }}>
                  <strong>{c.chauffeur}</strong>
                  <span style={{ color: "var(--v2-muted)" }}> · {new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--sk-t2)", marginTop: 3, lineHeight: 1.5 }}>
                  Silence de <span className="v2-num">{heureMin(c.debut)}</span> à <span className="v2-num">{heureMin(c.fin)}</span> ({duree(c.minutes)})
                  {(c.zoneAvant || c.zoneApres) && (
                    <> · <MapPin size={12} style={{ display: "inline", verticalAlign: "-1px" }} aria-hidden="true" /> {c.zoneAvant ?? "lieu inconnu"} → {c.zoneApres ?? "lieu inconnu"}</>
                  )}
                </div>
                <div style={{ fontSize: 12.5, marginTop: 4, display: "flex", flexWrap: "wrap", gap: "2px 12px", color: "var(--v2-muted)" }}>
                  <span style={{ color: v.ton === "fort" ? "var(--sk-t1)" : undefined, fontWeight: v.ton === "fort" ? 600 : 400 }}>{v.texte}</span>
                  <span>
                    {c.nature === "roule" ? <strong style={{ color: "var(--sk-t1)" }}>{formatDecimal(c.kmGps, 1)} km roulés d&apos;après le GPS</strong>
                      : c.nature === "pause" ? "véhicule à l'arrêt d'après le GPS" : "pas de trace GPS sur ce créneau"}
                  </span>
                  {c.valeurEstimee != null && <span>valeur estimée du roulage : {formatAmount(c.valeurEstimee)} XOF</span>}
                </div>
              </div>
              {c.nature !== "inconnue" && (
                <a href={`/admin/suivi?date=${jour}`} className="v2-btn v2-focus" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 9, border: "1px solid var(--sk-border)", color: "var(--sk-t1)", fontSize: 13, textDecoration: "none" }}>
                  <Route size={14} aria-hidden="true" /> Voir le trajet
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {data.coupures.length > 8 && (
        <button type="button" className="v2-link v2-focus" onClick={() => setTout((t) => !t)} style={{ marginTop: 12, background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          {tout ? "Réduire la liste" : `Voir les ${data.coupures.length} plus récentes`}
        </button>
      )}
    </div>
  );
}

function Chiffre({ titre, valeur, note, fort }: { titre: string; valeur: string; note?: string; fort?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--v2-muted)" }}>{titre}</div>
      <div className="v2-num" style={{ fontSize: 24, fontWeight: 700, color: fort ? "var(--tenant-color)" : "var(--sk-t1)", marginTop: 2 }}>{valeur}</div>
      {note && <div style={{ fontSize: 11.5, color: "var(--v2-muted)" }}>{note}</div>}
    </div>
  );
}
const Vide = ({ children }: { children: ReactNode }) => <p style={{ fontSize: 14, color: "var(--sk-t2)", padding: "18px 0" }}>{children}</p>;

/* ── Écran ──────────────────────────────────────────────────── */

type Detail = "zones" | "chauffeurs" | "coupures";

export function RendementV2({ data, jours, onJours, loading, error }: {
  data: RendementPayload | null;
  jours: number;
  onJours: (j: number) => void;
  loading: boolean;
  error: string | null;
}) {
  const [detail, setDetail] = useState<Detail>("zones");
  const premiere = useRef(true);
  useEffect(() => {
    // Des coupures confirmées par le GPS priment : on ouvre dessus, une seule fois.
    if (data && premiere.current) { premiere.current = false; if (data.coupuresResume.roulees > 0) setDetail("coupures"); }
  }, [data]);
  const p = data?.periode;

  return (
    <div className="rdt" style={{ display: "grid", gap: 18, maxWidth: 1180, margin: "0 auto", opacity: loading && data ? 0.55 : 1, transition: "opacity .2s" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--sk-t1)", margin: 0, letterSpacing: "-0.01em" }}>Rendement</h1>
          <p style={{ fontSize: 13.5, color: "var(--v2-muted)", margin: "4px 0 0" }}>
            {p?.du ? <>Du {dateFr(p.du)} au {dateFr(p.au)} · {formatAmount(p.courses)} courses · {formatAmount(p.heuresActivite)} h d&apos;activité</>
              : "Où, quand et comment la flotte gagne le plus"}
          </p>
        </div>
        <Segmented ariaLabel="Période analysée" options={PERIODES} value={String(jours)} onChange={(k) => onJours(Number(k))} />
      </header>

      {error && <Card tone="neg"><p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--sk-t1)" }}>{error}</p></Card>}

      {!data && !error && (
        <div style={{ display: "grid", gap: 18 }} aria-busy="true" aria-label="Calcul en cours">
          <div className="v2-skeleton" style={{ height: 300, borderRadius: 14 }} />
          <div className="v2-skeleton" style={{ height: 340, borderRadius: 14 }} />
        </div>
      )}

      {data && p && p.evenements === 0 && (
        <Card><Vide>Aucune commande Yango sur cette période. Chargez les exports dans Paramètres › Import Fleetroom, ou élargissez la période.</Vide></Card>
      )}

      {data && p && p.evenements > 0 && (
        <>
          <Card as="section" padding="24px 26px" className="rdt-hero">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center", justifyContent: "space-between" }}>
              <Verdict constats={data.constats} />
              <Cadran data={data} />
            </div>
          </Card>

          <Semaine data={data} />

          <Card as="section" padding="20px 22px">
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <h2 style={{ flex: 1, minWidth: 200, fontSize: 17, fontWeight: 600, color: "var(--sk-t1)", margin: 0 }}>
                {detail === "zones" ? "Les zones qui paient" : detail === "chauffeurs" ? "Ce qui sépare les chauffeurs" : "Les coupures Yango"}
              </h2>
              <Segmented ariaLabel="Détail affiché" value={detail} onChange={setDetail}
                options={[{ key: "zones", label: "Zones" }, { key: "chauffeurs", label: "Chauffeurs" },
                  { key: "coupures", label: `Coupures${data.coupuresResume.roulees ? ` · ${data.coupuresResume.roulees}` : ""}` }]} />
            </div>
            <div key={detail} className="rdt-entree">
              {detail === "zones" ? <Zones data={data} /> : detail === "chauffeurs" ? <Chauffeurs data={data} /> : <Coupures data={data} />}
            </div>
          </Card>

          <details className="v2-details" style={{ fontSize: 13, color: "var(--sk-t2)", lineHeight: 1.6, padding: "0 4px" }}>
            <summary className="v2-focus" style={{ cursor: "pointer", color: "var(--v2-muted)", listStyle: "none" }}>Comment lire ces chiffres</summary>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "grid", gap: 6, maxWidth: 860 }}>
              <li><strong>Heure d&apos;activité</strong> : des événements Yango (course, refus, annulation) espacés de 45 minutes au plus forment une période d&apos;activité. Une attente sans aucune sollicitation n&apos;y figure pas : ces gains comparent des créneaux, ils ne prévoient pas un revenu.</li>
              <li><strong>Cases pâles</strong> : moins de 12 heures observées. Le gain affiché y est rapproché de la moyenne de l&apos;heure pour ne pas couronner un coup de chance.</li>
              {data.modeleTarif && (
                <li><strong>Tarif attendu</strong> : {formatAmount(data.modeleTarif.base)} XOF + {formatAmount(data.modeleTarif.parKm)} par km + {formatAmount(data.modeleTarif.parMinute)} par minute, appris sur {formatAmount(data.modeleTarif.n)} courses (explique {Math.round(data.modeleTarif.r2 * 100)} % des prix). « Tarif ×1,10 » veut dire 10 % au-dessus.</li>
              )}
              {p.partEnCourse != null && p.amplitudeMediane != null && (
                <li><strong>Journée type</strong> : {formatDecimal(p.amplitudeMediane, 1)} h entre la première prise en charge et la dernière dépose, dont {Math.round(p.partEnCourse * 100)} % en course{p.xofParHeureAmplitude != null && <>, soit {formatAmount(p.xofParHeureAmplitude)} XOF par heure d&apos;amplitude</>}.</li>
              )}
              <li><strong>Ce sont des constats, pas des causes</strong> : les chauffeurs choisissent leurs horaires. Un créneau qui paie mieux le fait peut-être parce que les meilleurs y roulent.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
