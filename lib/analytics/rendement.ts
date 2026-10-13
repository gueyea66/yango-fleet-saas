/**
 * Rendement de la flotte par créneau, zone et chauffeur, et coupures Yango
 * déduites — à partir des commandes Yango (`yango_orders`) et, quand elles
 * existent, des positions GPS.
 *
 * Fonction PURE : mêmes commandes, même résultat. Rien n'est stocké ; chaque
 * ouverture de l'écran recalcule sur la période choisie, donc les constats
 * évoluent seuls à mesure que les exports et le GPS s'accumulent.
 *
 * Trois partis pris, détaillés dans docs/TELEMATICS/06-… :
 *
 *   1. L'unité est l'HEURE, pas le kilomètre : le temps est la ressource rare.
 *   2. Les « heures d'activité » sont reconstituées : des événements Yango
 *      (course, refus, annulation) espacés de 45 min au plus forment une
 *      session. Une attente sans aucune sollicitation n'y figure pas — les
 *      gains horaires comparent des créneaux, ils ne prévoient pas un revenu.
 *   3. Une COUPURE est déduite, jamais constatée : un long silence de Yango au
 *      milieu d'une journée de travail. Sa vraisemblance vient du rythme
 *      habituel des sollicitations (loi de Poisson) ; le GPS dit ensuite si le
 *      véhicule a roulé pendant ce silence.
 */

export interface OrderRow {
  order_id: string;
  status: string | null;
  cancel_reason: string | null;
  yango_driver_id: string | null;
  driver_name: string | null;
  plate: string | null;
  started_at: string | null;
  ended_at: string | null;
  address_from: string | null;
  address_to: string | null;
  service_class: string | null;
  distance_m: number | null;
  tarif: number | null;
  commission: number | null;
}

/** Trace GPS d'un véhicule, triée par temps. `t` en millisecondes. */
export type Trace = { t: number; lat: number; lon: number }[];

export interface Cellule {
  js: number;            // 0 = lundi
  h: number;
  heures: number;        // heures d'activité observées
  courses: number;
  ca: number;
  /** XOF par heure d'activité, brut puis stabilisé (tiré vers la moyenne de l'heure quand la cellule est peu remplie). */
  xofH: number | null;
  xofHLisse: number | null;
  xofKm: number | null;
  vitesse: number | null;
  majoration: number | null;
  annulClient: number | null;
  fiable: boolean;
}

export interface Zone {
  code: string;
  nom: string;
  courses: number;
  xofKm: number;
  vitesse: number;
  xofHCourse: number;
  /** Minutes médianes entre une dépose dans cette zone et la prise en charge suivante. */
  attenteApres: number | null;
}

export interface Chauffeur {
  id: string;
  nom: string;
  heures: number;
  courses: number;
  ca: number;
  xofH: number;
  xofKm: number | null;
  acceptation: number | null;
  /** Part de ses heures d'activité par heure de la journée (24 valeurs, somme 1). */
  profil: number[];
  /** Ce que son choix d'horaires lui fait gagner ou perdre par heure, face à la flotte. */
  effetHoraires: number;
  /** Écart restant une fois les horaires neutralisés : sa manière de travailler. */
  effetPropre: number;
  coupures: number;
}

export interface Coupure {
  chauffeur: string;
  plaque: string | null;
  debut: string;
  fin: string;
  minutes: number;
  /** Probabilité de n'avoir reçu aucune sollicitation pendant ce temps, application allumée. */
  probaAllumee: number;
  zoneAvant: string | null;
  zoneApres: string | null;
  /** Km roulés pendant le silence d'après le GPS ; null sans trace GPS. */
  kmGps: number | null;
  nature: "roule" | "pause" | "inconnue";
  /** Valeur estimée du roulage, par le modèle de tarif. */
  valeurEstimee: number | null;
}

export interface Constat {
  id: string;
  titre: string;
  chiffre: string;
  detail: string;
  /** Solidité du constat, d'après la quantité de données qui le porte. */
  confiance: "forte" | "moyenne" | "faible";
}

export interface Rendement {
  periode: {
    du: string | null; au: string | null;
    courses: number; evenements: number; ca: number; km: number;
    heuresCourse: number; heuresActivite: number;
    journees: number; amplitudeMediane: number | null; partEnCourse: number | null;
    xofParHeureAmplitude: number | null; tauxCommission: number | null;
    xofH: number | null; sollicitationsParHeure: number | null;
  };
  modeleTarif: { base: number; parKm: number; parMinute: number; r2: number; n: number } | null;
  grille: Cellule[];
  heures: { h: number; heures: number; xofH: number | null; xofKm: number | null; vitesse: number | null; majoration: number | null }[];
  jours: { js: number; heures: number; xofH: number | null; vitesse: number | null }[];
  zones: Zone[];
  chauffeurs: Chauffeur[];
  coupures: Coupure[];
  coupuresResume: { nombre: number; heures: number; avecGps: number; roulees: number; kmRoules: number; parHeure: number[] };
  mois: { mois: string; courses: number; ca: number; xofHCourse: number | null }[];
  constats: Constat[];
}

// ── Outils ───────────────────────────────────────────────────────────────

const H = 3_600_000;
const SEUIL_SESSION = 45 * 60_000;
const COUPURE_MIN = 60 * 60_000;
const COUPURE_MAX = 5 * H;
/** Heures d'activité en dessous desquelles une cellule jour × heure n'est pas lue seule. */
const HEURES_FIABLES = 12;
/** Poids de la moyenne de l'heure dans une cellule : à 15 h observées, moitié-moitié. */
const POIDS_A_PRIORI = 15;

const mediane = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
/** Dakar vit en UTC toute l'année : jour de semaine (0 = lundi) et heure se lisent en UTC. */
const jsDe = (t: number) => (new Date(t).getUTCDay() + 6) % 7;
const hDe = (t: number) => new Date(t).getUTCHours();
const jourDe = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Répartit l'intervalle [a, b] sur les heures d'horloge qu'il traverse. */
function parHeure(a: number, b: number, f: (js: number, h: number, heures: number) => void) {
  let t = a;
  while (t < b) {
    const fin = Math.min(Math.floor(t / H) * H + H, b);
    f(jsDe(t), hDe(t), (fin - t) / H);
    t = fin;
  }
}

/** Code de rue de l'adresse Yango (« Rue GY-39 » → GY) : il désigne la commune. */
export function codeZone(adresse: string | null): string | null {
  return adresse?.match(/Rue ([A-Z]{2,4})-/)?.[1] ?? null;
}

/**
 * Apprend le nom de chaque code sur les adresses elles-mêmes : certaines
 * portent à la fois le code et la commune (« Rue GY-39, Grand Yoff, … »).
 */
export function apprendreZones(adresses: (string | null)[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const a of adresses) {
    const m = a?.match(/Rue ([A-Z]{2,4})-[^,]*,\s*([^,]+),\s*[^,]+,\s*Département/);
    if (!m) continue;
    const v = votes.get(m[1]) ?? new Map<string, number>();
    v.set(m[2].trim(), (v.get(m[2].trim()) ?? 0) + 1);
    votes.set(m[1], v);
  }
  const noms = new Map<string, string>();
  for (const [code, v] of votes) noms.set(code, [...v].sort((a, b) => b[1] - a[1])[0][0]);
  return noms;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(s));
}

/**
 * Km roulés entre deux instants. Les sauts de plus de 3 km (fix aberrant) et
 * la dérive à l'arrêt (moins de 3 km/h) ne comptent pas. null si la trace ne
 * couvre pas l'intervalle.
 */
export function kmSurTrace(trace: Trace | undefined, debut: number, fin: number): number | null {
  if (!trace?.length) return null;
  const pts = trace.filter((p) => p.t >= debut && p.t <= fin);
  if (pts.length < 2 || pts[pts.length - 1].t - pts[0].t < (fin - debut) * 0.5) return null;
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineKm(pts[i - 1], pts[i]);
    const h = (pts[i].t - pts[i - 1].t) / H;
    if (d > 3 || h <= 0 || d / h < 3) continue;
    km += d;
  }
  return km;
}

/** tarif ≈ base + parKm × km + parMinute × minutes, par moindres carrés. */
function regressionTarif(c: { km: number; min: number; tarif: number }[]) {
  if (c.length < 200) return null;
  // équations normales 3 × 3
  const s = { n: c.length, k: 0, m: 0, kk: 0, km: 0, mm: 0, y: 0, ky: 0, my: 0, yy: 0 };
  for (const r of c) {
    s.k += r.km; s.m += r.min; s.kk += r.km * r.km; s.km += r.km * r.min; s.mm += r.min * r.min;
    s.y += r.tarif; s.ky += r.km * r.tarif; s.my += r.min * r.tarif; s.yy += r.tarif * r.tarif;
  }
  const A = [[s.n, s.k, s.m], [s.k, s.kk, s.km], [s.m, s.km, s.mm]], B = [s.y, s.ky, s.my];
  const det = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
    + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A);
  if (!d) return null;
  const col = (i: number) => det(A.map((l, r) => l.map((v, j) => (j === i ? B[r] : v)))) / d;
  const [base, parKm, parMinute] = [col(0), col(1), col(2)];
  let sce = 0;
  for (const r of c) sce += (r.tarif - (base + parKm * r.km + parMinute * r.min)) ** 2;
  const sct = s.yy - (s.y * s.y) / s.n;
  return { base, parKm, parMinute, r2: sct > 0 ? 1 - sce / sct : 0, n: s.n };
}

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const xof = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`;

// ── Calcul ───────────────────────────────────────────────────────────────

export function calculerRendement(
  orders: OrderRow[],
  opts: { traces?: Map<string, Trace>; maxCoupures?: number } = {},
): Rendement {
  type Evt = {
    o: OrderRow; t: number; fin: number; fait: boolean; chauffeur: string; nom: string;
    km: number; min: number; tarif: number; exploitable: boolean;
  };
  const evts: Evt[] = [];
  for (const o of orders) {
    const t0 = o.started_at ? Date.parse(o.started_at) : NaN;
    const t1 = o.ended_at ? Date.parse(o.ended_at) : NaN;
    const t = Math.min(Number.isNaN(t0) ? Infinity : t0, Number.isNaN(t1) ? Infinity : t1);
    if (!Number.isFinite(t)) continue;
    const fait = o.status === "Terminé" && !Number.isNaN(t0) && !Number.isNaN(t1) && t1 > t0;
    const km = (o.distance_m ?? 0) / 1000, min = fait ? (t1 - t0) / 60000 : 0, tarif = o.tarif ?? 0;
    evts.push({
      o, t, fin: fait ? t1 : t, fait,
      chauffeur: o.yango_driver_id ?? o.driver_name ?? "?", nom: o.driver_name ?? "Chauffeur",
      km, min, tarif,
      // bornes : écarter les durées et distances manifestement fausses de l'export
      exploitable: fait && min > 1 && min < 180 && km > 0.3 && km < 80 && tarif > 0,
    });
  }
  evts.sort((a, b) => a.t - b.t);
  const courses = evts.filter((e) => e.exploitable);

  const modele = regressionTarif(courses);
  const attendu = (e: { km: number; min: number }) =>
    (modele ? modele.base + modele.parKm * e.km + modele.parMinute * e.min : 0);

  // ── Sessions d'activité par chauffeur, et coupures entre deux sessions ──
  const parChauffeur = new Map<string, Evt[]>();
  for (const e of evts) (parChauffeur.get(e.chauffeur) ?? parChauffeur.set(e.chauffeur, []).get(e.chauffeur)!).push(e);

  const cle = (js: number, h: number) => js * 24 + h;
  const act = new Float64Array(168), actH = new Float64Array(24), actJ = new Float64Array(7);
  const evtH = new Float64Array(24);
  const actChauffeur = new Map<string, { heures: number; profil: Float64Array; grille: Float64Array }>();
  const trous: { a: Evt; b: Evt }[] = [];

  for (const [id, liste] of parChauffeur) {
    const c = { heures: 0, profil: new Float64Array(24), grille: new Float64Array(168) };
    actChauffeur.set(id, c);
    let debut = liste[0].t, fin = liste[0].fin;
    const clore = () => parHeure(debut, fin, (js, h, d) => {
      act[cle(js, h)] += d; actH[h] += d; actJ[js] += d; c.heures += d; c.profil[h] += d; c.grille[cle(js, h)] += d;
    });
    for (let i = 1; i < liste.length; i++) {
      const e = liste[i], silence = e.t - fin;
      if (silence > SEUIL_SESSION) {
        clore();
        if (silence >= COUPURE_MIN && silence <= COUPURE_MAX) trous.push({ a: liste[i - 1], b: e });
        debut = e.t; fin = e.fin;
      } else fin = Math.max(fin, e.fin);
    }
    clore();
  }
  for (const e of evts) evtH[hDe(e.t)]++;

  // ── Grille jour × heure ──
  const cel = Array.from({ length: 168 }, () => ({
    courses: 0, ca: 0, km: 0, hCourse: 0, xofKm: [] as number[], maj: [] as number[], evts: 0, annul: 0,
  }));
  let ca = 0, kmTot = 0, hCourse = 0, commission = 0;
  for (const e of courses) {
    const c = cel[cle(jsDe(e.t), hDe(e.t))];
    c.courses++; c.ca += e.tarif; c.km += e.km; c.hCourse += e.min / 60;
    c.xofKm.push(e.tarif / e.km);
    if (modele) c.maj.push(e.tarif / attendu(e));
    ca += e.tarif; kmTot += e.km; hCourse += e.min / 60; commission += Math.abs(e.o.commission ?? 0);
  }
  for (const e of evts) {
    const c = cel[cle(jsDe(e.t), hDe(e.t))];
    c.evts++;
    if (/client/i.test(e.o.cancel_reason ?? "")) c.annul++;
  }
  const heuresActivite = act.reduce((s, v) => s + v, 0);
  const xofHGlobal = ratio(ca, heuresActivite);

  const agregerHeure = (h: number) => {
    const idx = Array.from({ length: 7 }, (_, js) => cel[cle(js, h)]);
    const som = (f: (c: (typeof cel)[number]) => number) => idx.reduce((s, c) => s + f(c), 0);
    return {
      h, heures: actH[h],
      xofH: ratio(som((c) => c.ca), actH[h]),
      xofKm: mediane(idx.flatMap((c) => c.xofKm)),
      vitesse: ratio(som((c) => c.km), som((c) => c.hCourse)),
      majoration: mediane(idx.flatMap((c) => c.maj)),
    };
  };
  const heures = Array.from({ length: 24 }, (_, h) => agregerHeure(h));
  const jours = Array.from({ length: 7 }, (_, js) => {
    const idx = Array.from({ length: 24 }, (_, h) => cel[cle(js, h)]);
    return {
      js, heures: actJ[js],
      xofH: ratio(idx.reduce((s, c) => s + c.ca, 0), actJ[js]),
      vitesse: ratio(idx.reduce((s, c) => s + c.km, 0), idx.reduce((s, c) => s + c.hCourse, 0)),
    };
  });

  const grille: Cellule[] = cel.map((c, i) => {
    const js = Math.floor(i / 24), h = i % 24, hAct = act[i];
    const aPriori = heures[h].xofH ?? xofHGlobal ?? 0;
    return {
      js, h, heures: hAct, courses: c.courses, ca: c.ca,
      xofH: ratio(c.ca, hAct),
      xofHLisse: hAct > 0 ? (c.ca + POIDS_A_PRIORI * aPriori) / (hAct + POIDS_A_PRIORI) : null,
      xofKm: mediane(c.xofKm),
      vitesse: ratio(c.km, c.hCourse),
      majoration: mediane(c.maj),
      annulClient: ratio(c.annul, c.evts),
      fiable: hAct >= HEURES_FIABLES,
    };
  });

  // ── Zones ──
  const noms = apprendreZones(evts.flatMap((e) => [e.o.address_from, e.o.address_to]));
  // Plusieurs codes de rue désignent la même commune (MZ, SC, KA → Mermoz-Sacré-Cœur) : on regroupe.
  const zoneDe = (adresse: string | null) => {
    const c = codeZone(adresse);
    return c ? noms.get(c) ?? c : null;
  };
  const zd = new Map<string, { n: number; ca: number; km: number; h: number; xofKm: number[] }>();
  for (const e of courses) {
    const z = zoneDe(e.o.address_from);
    if (!z) continue;
    const s = zd.get(z) ?? zd.set(z, { n: 0, ca: 0, km: 0, h: 0, xofKm: [] }).get(z)!;
    s.n++; s.ca += e.tarif; s.km += e.km; s.h += e.min / 60; s.xofKm.push(e.tarif / e.km);
  }
  const attentes = new Map<string, number[]>();
  for (const liste of parChauffeur.values()) {
    const faites = liste.filter((e) => e.exploitable);
    for (let i = 0; i + 1 < faites.length; i++) {
      const z = zoneDe(faites[i].o.address_to), att = (faites[i + 1].t - faites[i].fin) / 60000;
      if (z && att >= 0 && att <= 45) (attentes.get(z) ?? attentes.set(z, []).get(z)!).push(att);
    }
  }
  const seuilZone = Math.max(30, Math.round(courses.length / 250));
  const zones: Zone[] = [...zd].filter(([, s]) => s.n >= seuilZone).map(([code, s]) => ({
    code, nom: code, courses: s.n,
    xofKm: mediane(s.xofKm) ?? 0, vitesse: s.km / s.h, xofHCourse: s.ca / s.h,
    attenteApres: (attentes.get(code)?.length ?? 0) >= 30 ? mediane(attentes.get(code)!) : null,
  })).sort((a, b) => b.xofHCourse - a.xofHCourse);

  // ── Coupures déduites ──
  // Rythme des sollicitations par heure de la journée, pendant l'activité.
  const lambdaGlobal = ratio(evts.length, heuresActivite) ?? 0;
  const lambda = Array.from({ length: 24 }, (_, h) => (actH[h] >= 20 ? evtH[h] / actH[h] : lambdaGlobal));
  const coupuresToutes: Coupure[] = trous.map(({ a, b }) => {
    let attendues = 0;
    parHeure(a.fin, b.t, (_js, h, d) => { attendues += lambda[h] * d; });
    const plaque = (b.o.plate ?? a.o.plate)?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
    const kmGps = plaque ? kmSurTrace(opts.traces?.get(plaque), a.fin, b.t) : null;
    const minutes = (b.t - a.fin) / 60000;
    return {
      chauffeur: a.nom, plaque,
      debut: new Date(a.fin).toISOString(), fin: new Date(b.t).toISOString(), minutes,
      probaAllumee: Math.exp(-attendues),
      zoneAvant: zoneDe(a.fait ? a.o.address_to : a.o.address_from),
      zoneApres: zoneDe(b.o.address_from),
      kmGps,
      nature: kmGps === null ? "inconnue" : kmGps >= 2 ? "roule" : "pause",
      // roulage valorisé comme une course de même distance, à la vitesse habituelle de la flotte
      valeurEstimee: kmGps !== null && kmGps >= 2 && modele
        ? modele.base + modele.parKm * kmGps + modele.parMinute * (kmGps / Math.max(8, ratio(kmTot, hCourse) ?? 14)) * 60
        : null,
    };
  });
  const coupuresParHeure = Array.from({ length: 24 }, () => 0);
  const coupuresChauffeur = new Map<string, number>();
  for (const c of coupuresToutes) {
    coupuresParHeure[hDe(Date.parse(c.debut))]++;
    coupuresChauffeur.set(c.chauffeur, (coupuresChauffeur.get(c.chauffeur) ?? 0) + 1);
  }
  const roulees = coupuresToutes.filter((c) => c.nature === "roule");
  const coupures = [...coupuresToutes]
    // d'abord ce que le GPS confirme, puis le plus récent
    .sort((x, y) => Number(y.nature === "roule") - Number(x.nature === "roule") || y.debut.localeCompare(x.debut))
    .slice(0, opts.maxCoupures ?? 40);

  // ── Chauffeurs ──
  const partFlotte = Array.from(act, (v) => (heuresActivite > 0 ? v / heuresActivite : 0));
  const rendementCellule = grille.map((g) => g.xofHLisse ?? xofHGlobal ?? 0);
  const chauffeurs: Chauffeur[] = [...parChauffeur].map(([id, liste]) => {
    const a = actChauffeur.get(id)!;
    const faites = liste.filter((e) => e.exploitable);
    const caC = faites.reduce((s, e) => s + e.tarif, 0);
    const proposees = liste.filter((e) => e.fait || /accept|refus/i.test(e.o.cancel_reason ?? "")).length;
    const xofH = a.heures > 0 ? caC / a.heures : 0;
    let effet = 0;
    if (a.heures > 0) for (let i = 0; i < 168; i++) effet += (a.grille[i] / a.heures - partFlotte[i]) * rendementCellule[i];
    return {
      id, nom: liste[liste.length - 1].nom, heures: a.heures, courses: faites.length, ca: caC, xofH,
      xofKm: mediane(faites.map((e) => e.tarif / e.km)),
      acceptation: ratio(liste.filter((e) => e.fait).length, proposees),
      profil: Array.from(a.profil, (v) => (a.heures > 0 ? v / a.heures : 0)),
      effetHoraires: effet,
      effetPropre: xofH - (xofHGlobal ?? 0) - effet,
      coupures: coupuresChauffeur.get(liste[liste.length - 1].nom) ?? 0,
    };
  }).filter((c) => c.heures >= Math.max(20, heuresActivite * 0.02)).sort((a, b) => b.xofH - a.xofH);

  // ── Journées et mois ──
  const journees = new Map<string, { a: number; b: number; h: number; ca: number }>();
  for (const e of courses) {
    const k = `${e.chauffeur}|${jourDe(e.t)}`;
    const j = journees.get(k) ?? journees.set(k, { a: e.t, b: e.fin, h: 0, ca: 0 }).get(k)!;
    j.a = Math.min(j.a, e.t); j.b = Math.max(j.b, e.fin); j.h += e.min / 60; j.ca += e.tarif;
  }
  const jr = [...journees.values()].map((j) => ({ ...j, amp: (j.b - j.a) / H })).filter((j) => j.amp > 1 && j.amp < 24);
  const ampTot = jr.reduce((s, j) => s + j.amp, 0);
  const parMois = new Map<string, { n: number; ca: number; h: number }>();
  for (const e of courses) {
    const m = jourDe(e.t).slice(0, 7);
    const s = parMois.get(m) ?? parMois.set(m, { n: 0, ca: 0, h: 0 }).get(m)!;
    s.n++; s.ca += e.tarif; s.h += e.min / 60;
  }
  const mois = [...parMois].sort().map(([m, s]) => ({ mois: m, courses: s.n, ca: s.ca, xofHCourse: ratio(s.ca, s.h) }));

  const periode = {
    du: evts.length ? jourDe(evts[0].t) : null, au: evts.length ? jourDe(evts[evts.length - 1].t) : null,
    courses: courses.length, evenements: evts.length, ca, km: kmTot, heuresCourse: hCourse, heuresActivite,
    journees: jr.length, amplitudeMediane: mediane(jr.map((j) => j.amp)),
    partEnCourse: ratio(jr.reduce((s, j) => s + j.h, 0), ampTot),
    xofParHeureAmplitude: ratio(jr.reduce((s, j) => s + j.ca, 0), ampTot),
    tauxCommission: ratio(commission, ca), xofH: xofHGlobal, sollicitationsParHeure: lambdaGlobal || null,
  };

  return {
    periode, modeleTarif: modele, grille, heures, jours, zones, chauffeurs, coupures,
    coupuresResume: {
      nombre: coupuresToutes.length, heures: coupuresToutes.reduce((s, c) => s + c.minutes, 0) / 60,
      avecGps: coupuresToutes.filter((c) => c.nature !== "inconnue").length,
      roulees: roulees.length, kmRoules: roulees.reduce((s, c) => s + (c.kmGps ?? 0), 0),
      parHeure: coupuresParHeure,
    },
    mois,
    constats: constats({ periode, grille, heures, jours, zones, chauffeurs, coupuresToutes, roulees }),
  };
}

// ── Constats : ce que les chiffres disent, rangé par ce que cela peut rapporter ──

function constats(d: {
  periode: Rendement["periode"]; grille: Cellule[]; heures: Rendement["heures"]; jours: Rendement["jours"];
  zones: Zone[]; chauffeurs: Chauffeur[]; coupuresToutes: Coupure[]; roulees: Coupure[];
}): Constat[] {
  const out: Constat[] = [];
  const ref = d.periode.xofH;
  if (!ref || d.periode.heuresActivite < 50) return out;
  const conf = (h: number): Constat["confiance"] => (h >= 400 ? "forte" : h >= 100 ? "moyenne" : "faible");
  const partH = (h: number) => h / d.periode.heuresActivite;

  // 1. Le jour le plus rentable est-il le moins travaillé ?
  const jv = d.jours.filter((j) => j.xofH && j.heures >= 30);
  if (jv.length >= 5) {
    const meilleur = [...jv].sort((a, b) => b.xofH! - a.xofH!)[0];
    const moyHeures = jv.reduce((s, j) => s + j.heures, 0) / jv.length;
    const gain = meilleur.xofH! / ref - 1;
    if (gain >= 0.05 && meilleur.heures < moyHeures * 0.8) {
      out.push({
        id: "jour-sous-exploite", titre: `Le ${JOURS[meilleur.js]} rapporte le plus, et c'est le jour le moins travaillé`,
        chiffre: pct(gain),
        detail: `${xof(meilleur.xofH!)} XOF par heure d'activité le ${JOURS[meilleur.js]}, contre ${xof(ref)} en moyenne. La flotte y passe ${Math.round((1 - meilleur.heures / moyHeures) * 100)} % d'heures en moins qu'un jour ordinaire.`,
        confiance: conf(meilleur.heures),
      });
    }
  }

  // 2. Le meilleur créneau de deux heures, et la place qu'on lui donne.
  const hv = d.heures.filter((h) => h.xofH && h.heures >= 20);
  if (hv.length >= 12) {
    const paires = hv.map((h) => {
      const s = d.heures[(h.h + 1) % 24];
      const heures = h.heures + s.heures;
      return { h: h.h, heures, xofH: (h.xofH! * h.heures + (s.xofH ?? h.xofH!) * s.heures) / heures };
    }).filter((p) => p.heures >= Math.max(60, d.periode.heuresActivite * 0.015));
    const top = [...paires].sort((a, b) => b.xofH - a.xofH)[0];
    if (top && top.xofH / ref - 1 >= 0.08) {
      out.push({
        id: "meilleur-creneau", titre: `${top.h} h – ${(top.h + 2) % 24} h est le créneau le mieux payé`,
        chiffre: pct(top.xofH / ref - 1),
        detail: `${xof(top.xofH)} XOF par heure d'activité entre ${top.h} h et ${(top.h + 2) % 24} h. La flotte n'y consacre que ${Math.round(partH(top.heures) * 100)} % de ses heures.`,
        confiance: conf(top.heures),
      });
    }
    // 3. Le piège : l'heure où le km est le mieux payé sans que l'heure le soit.
    const cher = [...hv].filter((h) => h.xofKm).sort((a, b) => b.xofKm! - a.xofKm!)[0];
    if (cher && cher.xofH! < ref * 1.02 && cher.vitesse) {
      out.push({
        id: "piege", titre: `À ${cher.h} h, le kilomètre est le mieux payé mais l'heure ne l'est pas`,
        chiffre: `${cher.vitesse.toFixed(0)} km/h`,
        detail: `${xof(cher.xofKm!)} XOF par km à ${cher.h} h, le plus haut de la journée, mais on y roule à ${cher.vitesse.toFixed(0)} km/h : le gain horaire retombe à ${xof(cher.xofH!)} XOF.`,
        confiance: conf(cher.heures),
      });
    }
  }

  // 4. Le temps qui n'est pas en course.
  if (d.periode.partEnCourse && d.periode.amplitudeMediane) {
    const hors = 1 - d.periode.partEnCourse;
    out.push({
      id: "hors-course", titre: "Une part de chaque journée n'est pas en course",
      chiffre: `${Math.round(hors * 100)} %`,
      detail: `Sur ${d.periode.amplitudeMediane.toFixed(1).replace(".", ",")} h d'amplitude, ${(d.periode.amplitudeMediane * hors).toFixed(1).replace(".", ",")} h ne sont pas en course. Yango ne dit pas ce qui s'y passe ; le GPS le mesure.`,
      confiance: d.periode.journees >= 100 ? "forte" : "moyenne",
    });
  }

  // 5. Coupures.
  if (d.coupuresToutes.length) {
    const tres = d.coupuresToutes.filter((c) => c.probaAllumee < 0.01).length;
    if (d.roulees.length) {
      const km = d.roulees.reduce((s, c) => s + (c.kmGps ?? 0), 0);
      out.unshift({
        id: "coupures-roulees", titre: "Des véhicules ont roulé pendant un silence de Yango",
        chiffre: `${Math.round(km)} km`,
        detail: `${d.roulees.length} coupure${d.roulees.length > 1 ? "s" : ""} où le GPS montre le véhicule en mouvement sans aucune sollicitation Yango. À rapprocher des recettes hors Yango déclarées.`,
        confiance: d.roulees.length >= 5 ? "forte" : "moyenne",
      });
    } else {
      out.push({
        id: "coupures", titre: "Des silences de Yango en pleine journée de travail",
        chiffre: xof(d.coupuresToutes.length),
        detail: `${xof(d.coupuresToutes.length)} silences d'une à cinq heures entre deux périodes d'activité, dont ${xof(tres)} quasi impossibles application allumée. Le GPS dira si le véhicule roulait.`,
        confiance: "moyenne",
      });
    }
  }

  // 6. Écart entre chauffeurs, et ce que les horaires en expliquent.
  if (d.chauffeurs.length >= 3) {
    const haut = d.chauffeurs[0], bas = d.chauffeurs[d.chauffeurs.length - 1];
    const ecart = haut.xofH / bas.xofH - 1;
    if (ecart >= 0.08) {
      const horaires = haut.effetHoraires - bas.effetHoraires;
      out.push({
        id: "ecart-chauffeurs", titre: "L'écart de gain horaire entre chauffeurs",
        chiffre: pct(ecart),
        detail: `De ${xof(bas.xofH)} à ${xof(haut.xofH)} XOF par heure d'activité. Les horaires choisis expliquent ${xof(Math.abs(horaires))} XOF de cet écart ; le reste tient à la manière de travailler.`,
        confiance: conf(Math.min(haut.heures, bas.heures) * 2),
      });
    }
  }

  // 7. Zones : le km contre l'heure.
  if (d.zones.length >= 6) {
    const parH = d.zones[0], parKm = [...d.zones].sort((a, b) => b.xofKm - a.xofKm)[0];
    if (parH.code !== parKm.code) {
      out.push({
        id: "zones", titre: `${parH.nom} paie le mieux à l'heure, ${parKm.nom} au kilomètre`,
        chiffre: `${xof(parH.xofHCourse)} XOF/h`,
        detail: `Au départ de ${parH.nom} : ${xof(parH.xofHCourse)} XOF par heure en course à ${parH.vitesse.toFixed(0)} km/h. Au départ de ${parKm.nom} : ${xof(parKm.xofKm)} XOF par km, mais ${xof(parKm.xofHCourse)} XOF par heure.`,
        confiance: parH.courses >= 300 ? "forte" : "moyenne",
      });
    }
  }
  return out;
}
