#!/usr/bin/env node
/**
 * Simulateur de boîtier H02 — rejoue un vrai trajet dakarois en trames
 * *HQ,…# sur une connexion TCP, exactement comme le ferait le K3.
 *
 * Sert à valider toute la chaîne (passerelle → ingestion → base → écran)
 * SANS toucher au boîtier réel, qui reste sur la plateforme SinoTrack tant
 * qu'Abdou n'a pas donné son go.
 *
 * Usage :
 *   node scripts/h02-simulator.mjs --host 127.0.0.1 --port 5013
 *   node scripts/h02-simulator.mjs --host xxx.proxy.rlwy.net --port 12345 \
 *        --device 9170258210 --speed 20
 *
 *   --host    hôte du serveur (passerelle maison ou Traccar)   [127.0.0.1]
 *   --port    port TCP du protocole H02                        [5013]
 *   --device  numéro de série du boîtier                       [9170258210]
 *   --speed   facteur d'accélération du temps (20 = 20× plus vite) [1]
 *   --loop    reboucle le trajet indéfiniment
 *
 * Le trajet : Almadies → Ouakam → Mermoz → Plateau, ~14 km, le parcours
 * typique d'une journée Yango à Dakar.
 */

import net from "node:net";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const HOST = arg("host", "127.0.0.1");
const PORT = Number(arg("port", "5013"));
const DEVICE = arg("device", "9170258210");
const SPEED_FACTOR = Number(arg("speed", "1"));
const LOOP = args.includes("--loop");
const INTERVAL_S = 30; // le ST-901 du K3 est configuré à 30 s

/** Itinéraire Almadies → Plateau (latitude, longitude). */
const ROUTE = [
  [14.7447, -17.5133], // Almadies
  [14.7365, -17.4989], // Ngor
  [14.7218, -17.4905], // Ouakam
  [14.7061, -17.4757], // Mermoz
  [14.6937, -17.4614], // Fann
  [14.6812, -17.4494], // Point E
  [14.6737, -17.4407], // Médina
  [14.6685, -17.4340], // Plateau
  [14.6650, -17.4290], // Place de l'Indépendance
];

/** Interpole l'itinéraire en points espacés d'environ `stepM` mètres. */
function buildTrack(stepM = 250) {
  const pts = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const [lat1, lon1] = ROUTE[i];
    const [lat2, lon2] = ROUTE[i + 1];
    const d = haversine(lat1, lon1, lat2, lon2);
    const n = Math.max(1, Math.round(d / stepM));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t, bearing(lat1, lon1, lat2, lon2)]);
    }
  }
  pts.push([...ROUTE[ROUTE.length - 1], 0]);
  return pts;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const rad = (x) => (x * Math.PI) / 180;
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return Math.round((((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360);
}

/** Degrés décimaux → DDMM.MMMM (ou DDDMM.MMMM pour une longitude). */
function toDdm(value, degDigits) {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return String(deg).padStart(degDigits, "0") +
    min.toFixed(4).padStart(7, "0");
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

function buildFrame(lat, lon, knots, heading, when) {
  const time = pad(when.getUTCHours()) + pad(when.getUTCMinutes()) + pad(when.getUTCSeconds());
  const date = pad(when.getUTCDate()) + pad(when.getUTCMonth() + 1) + pad(when.getUTCFullYear() % 100);
  return [
    `*HQ`, DEVICE, "V1", time, "A",
    toDdm(lat, 2), lat >= 0 ? "N" : "S",
    toDdm(lon, 3), lon >= 0 ? "E" : "W",
    knots.toFixed(2).padStart(6, "0"),
    pad(heading, 3),
    date,
    "FFFFFBFF",
  ].join(",") + "#";
}

const track = buildTrack();
console.log(`Trajet simulé : ${track.length} points, boîtier ${DEVICE} → ${HOST}:${PORT}`);
console.log(`Cadence ${INTERVAL_S} s réelles, accélérée ×${SPEED_FACTOR}\n`);

const socket = net.createConnection({ host: HOST, port: PORT }, () => {
  console.log("Connecté. Émission des trames…\n");
  let i = 0;
  const started = Date.now();

  const tick = () => {
    if (i >= track.length) {
      if (!LOOP) {
        console.log(`\n${track.length} trames envoyées. Fin du trajet.`);
        socket.end();
        return;
      }
      i = 0;
    }

    const [lat, lon, heading] = track[i];
    // Vitesse plausible : arrêt aux deux extrémités, ~40 km/h en route.
    const moving = i > 1 && i < track.length - 2;
    const kmh = moving ? 30 + Math.random() * 25 : 0;
    const knots = kmh / 1.852;
    // Horodatage cohérent avec la cadence réelle du boîtier, pas avec
    // l'accélération du simulateur : la base doit voir un trajet crédible.
    const when = new Date(started + i * INTERVAL_S * 1000);

    const frame = buildFrame(lat, lon, knots, heading, when);
    socket.write(frame);
    console.log(`${pad(i + 1, 3)}/${track.length}  ${frame}`);
    i++;
    setTimeout(tick, (INTERVAL_S * 1000) / SPEED_FACTOR);
  };

  tick();
});

socket.on("error", (err) => {
  console.error(`\nConnexion impossible vers ${HOST}:${PORT} — ${err.message}`);
  console.error("La passerelle (ou Traccar) est-elle démarrée et le port ouvert ?");
  process.exit(1);
});

socket.on("close", () => process.exit(0));
