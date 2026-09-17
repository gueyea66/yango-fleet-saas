#!/usr/bin/env node
/**
 * Importe un « Travel Report » exporté depuis la plateforme SinoTrack.
 *
 *   node scripts/import-sinotrack-travel.mjs --file "C:/.../Travel Report.csv" --device 9170258210
 *   node scripts/import-sinotrack-travel.mjs --file ... --device ... --dry
 *
 * Pourquoi : un client arrive avec des mois d'historique chez son fournisseur.
 * Croisé aux déclarations des chauffeurs, cet historique montre les écarts
 * AVANT toute bascule de boîtier.
 *
 * Ce que l'import NE fait PAS : prétendre que ces trajets ont été calculés par
 * M3A. Ils portent `method_version = import-sinotrack/1.0`, la vue de
 * rapprochement les distingue, et nos propres calculs priment sur une journée
 * couverte par les deux.
 *
 * Limite assumée : l'export ne contient pas les points bruts, donc ni tracé,
 * ni temps d'arrêt, ni couverture réelle. Seuls les trajets et leurs
 * kilomètres sont importés.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const METHOD = "import-sinotrack/1.0";

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const FILE = arg("file");
const DEVICE = arg("device");
const DRY = argv.includes("--dry");

if (!FILE || !DEVICE) {
  console.error('Usage : --file "<chemin du CSV>" --device <identifiant du boîtier> [--dry]');
  process.exit(1);
}

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(resolve(root, file), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* absent */ }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const REST = env.NEXT_PUBLIC_SUPABASE_URL;
const SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT = (REST ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

const H = {
  apikey: SRV, Authorization: `Bearer ${SRV}`,
  "Accept-Profile": "fleet", "Content-Profile": "fleet", "Content-Type": "application/json",
};
const rest = async (path, init = {}) => {
  const r = await fetch(`${REST}/rest/v1/${path}`, { ...init, headers: { ...H, ...init.headers } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 300));
  return t ? JSON.parse(t) : null;
};

/** Découpe une ligne CSV en respectant les guillemets. */
function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  // L'export préfixe chaque champ d'une tabulation.
  return out.map((s) => s.replace(/\uFEFF/g, "").replace(/\t/g, "").trim());
}

const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");

/** « 1H 12M 30S », « 7M 22S », « 5M » → secondes. */
function parseDuration(text) {
  if (!text) return null;
  const h = text.match(/(\d+)\s*H/i)?.[1] ?? 0;
  const m = text.match(/(\d+)\s*M/i)?.[1] ?? 0;
  const s = text.match(/(\d+)\s*S/i)?.[1] ?? 0;
  const total = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return total > 0 ? total : null;
}

/** Le boîtier est réglé sur TIME ZONE:E00, et Dakar est à UTC+0 toute l'année. */
function parseTime(text) {
  const m = String(text).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

// ── Lecture du fichier ────────────────────────────────────────────────────
const lines = readFileSync(FILE, "utf8").split(/\r?\n/).filter((l) => l.trim());
if (lines.length < 2) { console.error("Fichier vide ou illisible."); process.exit(1); }

const header = splitCsv(lines[0]).map(norm);
const col = (...names) => {
  for (const n of names) {
    const i = header.indexOf(norm(n));
    if (i !== -1) return i;
  }
  return -1;
};

const iStart = col("Start time");
const iEnd = col("End time");
const iKm = col("Drive mileage(km)", "Drive mileage");
const iDrive = col("Drive time");
const iMax = col("Max speed(km/h)", "Max speed");
const iAvg = col("Average speed(km/h)", "Average speed");
const iSLon = col("Start longitude(°)", "Start longitude");
const iSLat = col("Start latitude(°)", "Start latitude");
const iELon = col("End longitude(°)", "End longitude");
const iELat = col("End latitude(°)", "End latitude");

if ([iStart, iEnd, iKm, iSLat, iSLon, iELat, iELon].some((i) => i === -1)) {
  console.error("Colonnes attendues introuvables. En-tête lu :\n  " + header.join(" | "));
  process.exit(1);
}

const trips = [];
const rejets = [];
for (const line of lines.slice(1)) {
  const f = splitCsv(line);
  const start = parseTime(f[iStart]);
  const end = parseTime(f[iEnd]);
  const km = Number(f[iKm]);
  const lat1 = Number(f[iSLat]), lon1 = Number(f[iSLon]);
  const lat2 = Number(f[iELat]), lon2 = Number(f[iELon]);

  if (!start || !end || !Number.isFinite(km)) { rejets.push("horodatage ou distance illisible"); continue; }
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) { rejets.push("coordonnées illisibles"); continue; }
  if (end <= start) { rejets.push("fin avant début"); continue; }

  const durationS = Math.round((end - start) / 1000);
  const movingS = parseDuration(f[iDrive]) ?? durationS;

  trips.push({
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    start_latitude: lat1, start_longitude: lon1,
    end_latitude: lat2, end_longitude: lon2,
    distance_m: Math.round(km * 1000),
    duration_s: durationS,
    moving_s: Math.min(movingS, durationS),
    idle_s: Math.max(0, durationS - Math.min(movingS, durationS)),
    max_speed_kmh: Number(f[iMax]) || null,
    avg_moving_speed_kmh: Number(f[iAvg]) || null,
    points: 0,
    gaps_s: 0,
    jumps_dropped: 0,
    // Trajets calculés par le fournisseur sur la totalité de ses points : on
    // les tient pour fiables, sans les confondre avec nos propres mesures.
    confidence: 0.9,
    evidence: { source: "SinoTrack Travel Report", fichier: basename(FILE) },
    method_version: METHOD,
  });
}

const jours = [...new Set(trips.map((t) => t.started_at.slice(0, 10)))].sort();
console.log(`Fichier  : ${basename(FILE)}`);
console.log(`Trajets  : ${trips.length} retenus, ${rejets.length} écartés`);
console.log(`Période  : ${jours[0]} → ${jours[jours.length - 1]} (${jours.length} journées)`);
console.log(`Distance : ${(trips.reduce((s, t) => s + t.distance_m, 0) / 1000).toFixed(1)} km au total`);
if (DRY) { console.log("\nSimulation : rien n'a été écrit."); process.exit(0); }

// ── Boîtier ───────────────────────────────────────────────────────────────
const devices = await rest(`telematics_devices?select=id,tenant_id,vehicle_id,external_id&external_id=eq.${DEVICE}`);
if (!devices.length) { console.error(`Boîtier ${DEVICE} non enrôlé.`); process.exit(1); }
const device = devices[0];

// ── Écriture des trajets ──────────────────────────────────────────────────
const rows = trips.map((t) => ({
  ...t,
  tenant_id: device.tenant_id,
  device_id: device.id,
  vehicle_id: device.vehicle_id,
}));

await sql(`delete from fleet.telematics_trips
  where device_id = '${device.id}' and method_version = '${METHOD}'
    and started_at >= '${jours[0]}'::date and started_at < ('${jours[jours.length - 1]}'::date + 1)`);

for (let i = 0; i < rows.length; i += 200) {
  await rest("telematics_trips", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows.slice(i, i + 200)),
  });
}
console.log(`\n${rows.length} trajets importés.`);

// ── Agrégat journalier ────────────────────────────────────────────────────
// Reconstruit depuis les trajets importés. `points` reste à 0 : l'export ne
// fournit pas les positions, et prétendre le contraire fausserait la lecture
// de fiabilité.
//
// La couverture vaut la PART DE LA JOURNÉE réellement contenue dans le
// fichier. Un export commence et se termine au milieu d'une journée : sans ce
// calcul, une journée tronquée affiche un déficit de kilomètres spectaculaire
// qui n'existe pas. Constaté dès le premier import réel : un fichier arrêté à
// 01h58 faisait apparaître −85 % sur la journée coupée.
const fenetreDebut = trips.reduce((m, t) => (t.started_at < m ? t.started_at : m), trips[0].started_at);
const fenetreFin = trips.reduce((m, t) => (t.ended_at > m ? t.ended_at : m), trips[0].ended_at);
console.log(`Fenêtre  : ${fenetreDebut} → ${fenetreFin}`);

await sql(`delete from fleet.telematics_daily
  where device_id = '${device.id}' and method_version = '${METHOD}'`);

await sql(`insert into fleet.telematics_daily
   (tenant_id, device_id, vehicle_id, day, distance_m, moving_s, idle_s, trips,
    points, gaps_s, jumps_dropped, coverage, first_movement_at, last_movement_at,
    max_speed_kmh, method_version)
 select '${device.tenant_id}', '${device.id}', ${device.vehicle_id ? `'${device.vehicle_id}'` : "null"},
        j.jour,
        sum(t.distance_m), sum(t.moving_s), sum(t.idle_s), count(*),
        0, 0, 0,
        round((
          extract(epoch from (
            least(j.jour::timestamptz + interval '1 day', '${fenetreFin}'::timestamptz)
            - greatest(j.jour::timestamptz, '${fenetreDebut}'::timestamptz)
          )) / 86400.0
        )::numeric, 2),
        min(t.started_at), max(t.ended_at), max(t.max_speed_kmh), '${METHOD}'
   from fleet.telematics_trips t
   cross join lateral (select (t.started_at at time zone 'UTC')::date as jour) j
  where t.device_id = '${device.id}' and t.method_version = '${METHOD}'
  group by j.jour`);

const res = await sql(`select day::text as jour, round((distance_m/1000)::numeric,1) as km_gps, trips
  from fleet.telematics_daily where device_id='${device.id}' and method_version='${METHOD}' order by 1`);
console.log("\nJournées reconstituées :");
for (const r of res) console.log(`  ${r.jour}  ${String(r.km_gps).padStart(6)} km  ${r.trips} trajets`);
