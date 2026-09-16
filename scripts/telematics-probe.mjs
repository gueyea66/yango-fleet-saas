#!/usr/bin/env node
/**
 * Sonde de lecture — état de la base avant toute écriture télématique.
 *
 * LECTURE SEULE. Aucun DDL, aucune insertion. Sert à savoir sur quoi on
 * branche le GPS : quels véhicules existent, lesquels déclarent un odomètre,
 * et si les tables télématiques sont déjà présentes.
 *
 * Appels REST directs (PostgREST) plutôt que supabase-js : la v2.106 exige un
 * WebSocket natif indisponible sous Node 20, et une sonde n'a besoin d'aucun
 * temps réel.
 *
 *   node scripts/telematics-probe.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Lit .env.local sans dépendance externe. Les valeurs ne sont jamais affichées. */
function loadEnv(file) {
  const out = {};
  let text;
  try {
    text = readFileSync(resolve(root, file), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absent de .env.local");
  process.exit(1);
}

const SCHEMA = "fleet";

async function rest(path, { count = false } = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: count ? "HEAD" : "GET",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Accept-Profile": SCHEMA,
      ...(count ? { Prefer: "count=exact" } : {}),
    },
  });
  if (count) {
    if (!res.ok) return { error: `${res.status}` };
    const range = res.headers.get("content-range") || "";
    return { count: Number(range.split("/")[1] ?? 0) };
  }
  if (!res.ok) return { error: `${res.status} ${await res.text()}` };
  return { data: await res.json() };
}

console.log(`Projet : ${URL_BASE.replace(/https:\/\/([a-z0-9]{6})[a-z0-9]*/, "https://$1…")}\n`);
const section = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

// ── Organisations ─────────────────────────────────────────────────────────
section("Organisations");
const { data: tenants, error: tErr } = await rest("tenants?select=id,slug,name,plan,active&order=slug");
if (tErr) { console.error("lecture tenants impossible :", tErr); process.exit(1); }
for (const t of tenants) {
  console.log(`  ${t.slug.padEnd(18)} ${String(t.name).padEnd(26)} ${t.plan}${t.active ? "" : "  [inactif]"}`);
}

// ── Véhicules ─────────────────────────────────────────────────────────────
section("Véhicules");
const { data: vehicles = [] } = await rest(
  "vehicles?select=id,plate,make,model,driver_id,tenant_id,status&order=plate",
);
const slugOf = new Map(tenants.map((t) => [t.id, t.slug]));
const byTenant = new Map();
for (const v of vehicles) {
  const slug = slugOf.get(v.tenant_id) ?? "?";
  byTenant.set(slug, (byTenant.get(slug) ?? 0) + 1);
  if (slug === "m3a" || slug === "M3A") {
    console.log(
      `  ${slug.padEnd(6)} ${String(v.plate).padEnd(14)}` +
      ` ${[v.make, v.model].filter(Boolean).join(" ").padEnd(24)}` +
      ` ${v.driver_id ? "affecté" : "sans chauffeur"}`,
    );
  }
}
console.log(`  (détail ci-dessus : tenant M3A uniquement)`);
console.log(`  répartition : ${[...byTenant].map(([s, n]) => `${s}=${n}`).join(", ")}`);
console.log(`  → ${vehicles.length} véhicule(s) au total`);

// ── Déclarations récentes : la matière du croisement km GPS vs km déclarés ─
section("Déclarations avec odomètre (30 derniers jours)");
const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
const { data: reps = [] } = await rest(
  `daily_reports?select=date,vehicle_id,driver_id,start_odometer,end_odometer,status,tenant_id` +
  `&date=gte.${since}&end_odometer=not.is.null&order=date.desc&limit=20`,
);
const plateOf = new Map(vehicles.map((v) => [v.id, v.plate]));
for (const r of reps) {
  const km = r.end_odometer != null && r.start_odometer != null
    ? r.end_odometer - r.start_odometer : null;
  console.log(
    `  ${r.date}  ${String(slugOf.get(r.tenant_id) ?? "?").padEnd(6)}` +
    ` ${String(plateOf.get(r.vehicle_id) ?? "véhicule non lié").padEnd(20)}` +
    ` ${(km === null ? "—" : `${km} km`).padStart(8)}  ${r.status}`,
  );
}
console.log(`  → ${reps.length} déclaration(s) exploitable(s) pour le croisement`);

// ── Tables télématiques ───────────────────────────────────────────────────
section("Socle télématique");
for (const table of [
  "telematics_devices", "telematics_positions", "telematics_trips", "telematics_events",
]) {
  const { count, error } = await rest(`${table}?select=id`, { count: true });
  console.log(`  ${table.padEnd(24)} ${error ? "absente" : `${count} ligne(s)`}`);
}

console.log("\nLecture seule terminée. Aucune écriture effectuée.\n");
