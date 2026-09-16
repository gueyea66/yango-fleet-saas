#!/usr/bin/env node
/**
 * Enrôle un boîtier télématique et le rattache à un véhicule.
 *
 * Tant qu'un boîtier n'est pas enrôlé, l'ingestion REJETTE ses positions :
 * une position dont on ignore le véhicule et l'organisation n'a aucune valeur
 * métier, et accepter un émetteur inconnu ouvrirait la porte à l'injection de
 * fausses données par quiconque connaît la clé.
 *
 *   node scripts/telematics-enroll.mjs --plate AB-872-JG --device 9170258210 \
 *        --tenant M3A --vendor sinotrack --model ST-901-868L --label "Kia K3"
 *
 *   node scripts/telematics-enroll.mjs --list        # boîtiers déjà enrôlés
 *
 * Idempotent : relancer avec le même identifiant de boîtier met à jour le
 * rattachement au lieu d'en créer un second.
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
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents de .env.local");
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "Accept-Profile": "fleet",
  "Content-Profile": "fleet",
};

async function rest(path, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...H, ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ── Liste ────────────────────────────────────────────────────────────────
if (argv.includes("--list")) {
  const devices = await rest(
    "telematics_devices?select=external_id,vendor,model,label,active,last_seen_at,vehicle_id,tenant_id",
  );
  const vehicles = await rest("vehicles?select=id,plate");
  const plateOf = new Map(vehicles.map((v) => [v.id, v.plate]));
  if (devices.length === 0) {
    console.log("Aucun boîtier enrôlé.");
  } else {
    console.log("Boîtiers enrôlés :\n");
    for (const d of devices) {
      console.log(
        `  ${d.external_id.padEnd(14)} ${String(d.vendor).padEnd(11)}` +
        ` ${String(plateOf.get(d.vehicle_id) ?? "non rattaché").padEnd(14)}` +
        ` ${d.active ? "actif" : "inactif"}` +
        ` ${d.last_seen_at ? `· vu ${d.last_seen_at}` : "· jamais vu"}`,
      );
    }
  }
  process.exit(0);
}

// ── Enrôlement ───────────────────────────────────────────────────────────
const plate = arg("plate");
const deviceId = arg("device");
const tenantSlug = arg("tenant", "M3A");
const vendor = arg("vendor", "sinotrack");
const model = arg("model", "ST-901-868L");
const label = arg("label");
const protocol = arg("protocol", "h02");

if (!plate || !deviceId) {
  console.error(
    "Usage : --plate <immatriculation> --device <id boîtier> [--tenant M3A]\n" +
    "        [--vendor sinotrack] [--model ST-901-868L] [--label \"Kia K3\"]\n" +
    "        --list  pour voir les boîtiers déjà enrôlés",
  );
  process.exit(1);
}

const tenants = await rest(`tenants?select=id,slug,name&slug=eq.${encodeURIComponent(tenantSlug)}`);
if (!tenants.length) {
  console.error(`Organisation « ${tenantSlug} » introuvable.`);
  process.exit(1);
}
const tenant = tenants[0];

const vehicles = await rest(
  `vehicles?select=id,plate,make,model,tenant_id&plate=eq.${encodeURIComponent(plate)}` +
  `&tenant_id=eq.${tenant.id}`,
);
if (!vehicles.length) {
  console.error(`Véhicule « ${plate} » introuvable dans l'organisation ${tenant.slug}.`);
  process.exit(1);
}
const vehicle = vehicles[0];

const existing = await rest(
  `telematics_devices?select=id,vehicle_id&vendor=eq.${encodeURIComponent(vendor)}` +
  `&external_id=eq.${encodeURIComponent(deviceId)}`,
);

const payload = {
  tenant_id: tenant.id,
  vehicle_id: vehicle.id,
  vendor,
  model,
  external_id: deviceId,
  protocol,
  label: label ?? [vehicle.make, vehicle.model].filter(Boolean).join(" ") ?? plate,
  active: true,
};

if (existing.length) {
  await rest(`telematics_devices?id=eq.${existing[0].id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  console.log(`Boîtier ${deviceId} mis à jour → ${plate} (${tenant.name}).`);
} else {
  await rest("telematics_devices", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  console.log(`Boîtier ${deviceId} enrôlé → ${plate} (${tenant.name}).`);
}

console.log(
  "\nLe boîtier est prêt à être reçu. Il reste sur sa plateforme actuelle tant que\n" +
  "le SMS de bascule n'est pas envoyé (voir docs/TELEMATICS/01-RUNBOOK.md §5).",
);
