#!/usr/bin/env node
/**
 * Génère un historique de démonstration et l'injecte par la VRAIE chaîne
 * d'ingestion (trames H02 → /api/telematics/ingest), afin de valider le
 * produit de bout en bout sans toucher au boîtier physique.
 *
 *   node scripts/telematics-demo.mjs --device 8800000001 --url http://localhost:3100
 *   node scripts/telematics-demo.mjs --device 8800000001 --purge   # tout retirer
 *
 * ⚠️  Les positions produites sont FICTIVES. Elles portent un boîtier dont le
 * libellé le dit, sur un tenant de démonstration, et `--purge` les retire
 * intégralement. Aucune donnée réelle n'est modifiée.
 *
 * Le trajet suit le corridor Dakar → Thiès → carrière de Diack, cohérent avec
 * l'activité d'un transporteur de granulats, et vise chaque jour un kilométrage
 * calé sur les déclarations réellement présentes en base — pour que le
 * rapprochement ait du sens au lieu d'opposer deux chiffres sans rapport.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(resolve(root, file), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* fichier absent */ }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const DEVICE = arg("device", "8800000001");
const APP = arg("url", "http://localhost:3100");
const PURGE = argv.includes("--purge");

const REST = env.NEXT_PUBLIC_SUPABASE_URL;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const INGEST_KEY = env.TELEMATICS_INGEST_KEY;
const PROJECT_REF = (REST ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

const H = { apikey: SRV, Authorization: `Bearer ${SRV}`, "Accept-Profile": "fleet",
            "Content-Profile": "fleet", "Content-Type": "application/json" };

const rest = async (path, init = {}) => {
  const r = await fetch(`${REST}/rest/v1/${path}`, { ...init, headers: { ...H, ...init.headers } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 300));
  return t ? JSON.parse(t) : null;
};

// ── Boîtier ──────────────────────────────────────────────────────────────
const devices = await rest(`telematics_devices?select=id,vehicle_id,tenant_id,label&external_id=eq.${DEVICE}`);
if (!devices.length) {
  console.error(`Boîtier ${DEVICE} non enrôlé. Lancer d'abord scripts/telematics-enroll.mjs`);
  process.exit(1);
}
const device = devices[0];

if (PURGE) {
  const del = await sql(
    `WITH d AS (SELECT id FROM fleet.telematics_devices WHERE external_id = '${DEVICE}')
     SELECT
       (SELECT count(*) FROM fleet.telematics_positions WHERE device_id IN (SELECT id FROM d)) AS positions,
       (SELECT count(*) FROM fleet.telematics_trips     WHERE device_id IN (SELECT id FROM d)) AS trajets`);
  console.log("À retirer :", JSON.stringify(del?.[0] ?? {}));
  await sql(`DELETE FROM fleet.telematics_events WHERE device_id = '${device.id}'`);
  await sql(`DELETE FROM fleet.telematics_trips  WHERE device_id = '${device.id}'`);
  await sql(`DELETE FROM fleet.telematics_daily  WHERE device_id = '${device.id}'`);
  await sql(`DELETE FROM fleet.telematics_positions WHERE device_id = '${device.id}'`);
  console.log("Données de démonstration retirées.");
  process.exit(0);
}

// ── Kilométrages déclarés, pour caler la simulation sur le réel ──────────
const reports = await rest(
  `daily_reports?select=date,end_odometer,status&vehicle_id=eq.${device.vehicle_id}` +
  `&end_odometer=not.is.null&order=date.asc`,
);

const declared = new Map();
let prev = null;
for (const r of reports) {
  if (prev && r.status === "approved") {
    const km = r.end_odometer - prev.odo;
    const jours = Math.round((Date.parse(r.date) - Date.parse(prev.date)) / 86400_000);
    if (km > 0 && km < 2000) declared.set(r.date, { km, jours });
  }
  prev = { date: r.date, odo: r.end_odometer };
}

const FROM = arg("from", "2026-09-01");
const TO = arg("to", "2026-09-13");
const days = [];
for (let t = Date.parse(FROM); t <= Date.parse(TO); t += 86400_000) {
  days.push(new Date(t).toISOString().slice(0, 10));
}

/**
 * Scénarios volontaires, pour que l'écran soit jugé sur des cas difficiles
 * et pas seulement sur le cas idéal.
 */
const SCENARIOS = {
  "2026-09-09": { ratio: 1.18, note: "écart réel : le véhicule a roulé plus que déclaré" },
  "2026-09-05": { ratio: 1.01, coverage: 0.45, note: "boîtier hors réseau une partie du jour" },
  "2026-09-07": { ratio: 1.0, km: 260, note: "aucune déclaration ce jour-là" },
};

// ── Corridor Dakar → Thiès → carrière de Diack ───────────────────────────
const CORRIDOR = [
  [14.6690, -17.4260], // Port de Dakar
  [14.7180, -17.3620], // Pikine
  [14.7620, -17.2400], // Rufisque
  [14.7940, -17.0500], // Bargny / Diamniadio
  [14.8300, -16.9200], // Sébikotane
  [14.7900, -16.9260], // Thiès entrée
  [14.8830, -16.7260], // Khombole
  [14.8420, -16.3740], // Carrière de Diack
];

const R = 6371000;
const rad = (x) => (x * Math.PI) / 180;
const haversine = (a, b, c, d) =>
  2 * R * Math.asin(Math.sqrt(
    Math.sin(rad(c - a) / 2) ** 2 +
    Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2));

/** Générateur déterministe : deux exécutions produisent le même historique. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
const toDdm = (v, dd) => {
  const abs = Math.abs(v), deg = Math.floor(abs);
  return String(deg).padStart(dd, "0") + ((abs - deg) * 60).toFixed(4).padStart(7, "0");
};

function frame(lat, lon, kmh, heading, when) {
  const time = pad(when.getUTCHours()) + pad(when.getUTCMinutes()) + pad(when.getUTCSeconds());
  const date = pad(when.getUTCDate()) + pad(when.getUTCMonth() + 1) + pad(when.getUTCFullYear() % 100);
  return `*HQ,${DEVICE},V1,${time},A,${toDdm(lat, 2)},N,${toDdm(lon, 3)},W,` +
         `${(kmh / 1.852).toFixed(2).padStart(6, "0")},${pad(Math.round(heading), 3)},${date},FFFFFBFF#`;
}

/** Construit une journée : aller chargé, déchargement, retour, jusqu'à la cible. */
function buildDay(day, targetKm, rnd, coverage = 1) {
  const frames = [];
  const start = Date.parse(`${day}T06:30:00Z`) + Math.floor(rnd() * 40) * 60_000;
  let clock = start;
  let done = 0;
  let leg = 0;

  while (done < targetKm * 1000 && frames.length < 3000) {
    const forward = leg % 2 === 0;
    const path = forward ? CORRIDOR : [...CORRIDOR].reverse();

    for (let i = 0; i < path.length - 1 && done < targetKm * 1000; i++) {
      const [lat1, lon1] = path[i];
      const [lat2, lon2] = path[i + 1];
      const segM = haversine(lat1, lon1, lat2, lon2);
      // Ville lente en début de corridor, route ouverte ensuite.
      const kmh = (i <= 1 ? 26 : 62) + rnd() * 14;
      const steps = Math.max(1, Math.round(segM / ((kmh / 3.6) * 30)));

      for (let s = 0; s < steps && done < targetKm * 1000; s++) {
        const t = s / steps;
        const lat = lat1 + (lat2 - lat1) * t;
        const lon = lon1 + (lon2 - lon1) * t;
        const heading = forward ? 78 : 258;
        clock += 30_000;
        done += segM / steps;
        if (rnd() <= coverage) frames.push(frame(lat, lon, kmh, heading, new Date(clock)));
      }
    }

    // Chargement ou déchargement : 25 à 45 minutes à l'arrêt.
    const stopMin = 25 + Math.floor(rnd() * 20);
    const [slat, slon] = leg % 2 === 0 ? CORRIDOR[CORRIDOR.length - 1] : CORRIDOR[0];
    for (let m = 0; m < stopMin * 2; m++) {
      clock += 30_000;
      if (rnd() <= coverage) frames.push(frame(slat, slon, 0, 0, new Date(clock)));
    }
    leg++;
    if (leg > 6) break;
  }
  return { frames, km: done / 1000 };
}

// ── Envoi par la vraie route d'ingestion ─────────────────────────────────
async function send(frames) {
  let inserted = 0, duplicates = 0, rejected = 0;
  for (let i = 0; i < frames.length; i += 400) {
    const lot = frames.slice(i, i + 400);
    const res = await fetch(`${APP}/api/telematics/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telematics-key": INGEST_KEY },
      body: JSON.stringify({ frames: lot }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`ingestion ${res.status} : ${JSON.stringify(body).slice(0, 200)}`);
    inserted += body.inserted ?? 0;
    duplicates += body.duplicates ?? 0;
    rejected += (body.rejected ?? []).length;
  }
  return { inserted, duplicates, rejected };
}

console.log(`Boîtier ${DEVICE} — ${device.label}`);
console.log(`Ingestion : ${APP}/api/telematics/ingest\n`);
console.log("jour         déclaré   simulé   scénario");

let total = { inserted: 0, duplicates: 0, rejected: 0 };

for (const [index, day] of days.entries()) {
  const decl = declared.get(day);
  const sc = SCENARIOS[day] ?? {};
  const baseKm = sc.km ?? (decl ? decl.km : 240);
  // Bruit déterministe ±3 % : un GPS ne retrouve jamais l'odomètre au mètre.
  const rnd = mulberry32(1000 + index);
  const ratio = sc.ratio ?? 0.97 + rnd() * 0.06;
  const target = baseKm * ratio;

  const { frames, km } = buildDay(day, target, rnd, sc.coverage ?? 1);
  const res = await send(frames);
  total = {
    inserted: total.inserted + res.inserted,
    duplicates: total.duplicates + res.duplicates,
    rejected: total.rejected + res.rejected,
  };

  console.log(
    `${day}   ${(decl ? `${decl.km} km` : "—").padStart(8)}` +
    `  ${km.toFixed(0).padStart(4)} km  ${sc.note ?? ""}` +
    `${res.rejected ? `  [${res.rejected} trames refusées]` : ""}`,
  );
}

console.log(`\nPositions insérées : ${total.inserted}` +
  `${total.duplicates ? ` · ${total.duplicates} doublons ignorés` : ""}` +
  `${total.rejected ? ` · ${total.rejected} trames refusées` : ""}`);
console.log("\nÉtape suivante : POST /api/telematics/rebuild pour calculer trajets et agrégats.");
