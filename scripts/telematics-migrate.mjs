#!/usr/bin/env node
/**
 * Applique des migrations SQL sur la base.
 *
 *   node scripts/telematics-migrate.mjs                    # 049 puis 050
 *   node scripts/telematics-migrate.mjs migrations/051-x.sql
 *   node scripts/telematics-migrate.mjs --dry              # montre sans exécuter
 *   node scripts/telematics-migrate.mjs --check            # état actuel en base
 *
 * Deux chemins d'accès, dans cet ordre de préférence :
 *
 *   1. SUPABASE_ACCESS_TOKEN (sbp_…) — API de gestion, même moteur que le SQL
 *      Editor du dashboard. Ne touche ni au mot de passe de la base ni aux
 *      connexions existantes, et fonctionne depuis un réseau IPv4.
 *   2. DATABASE_URL — connexion Postgres directe, pour les cas où l'API n'est
 *      pas disponible.
 *
 * Les migrations sont écrites idempotentes : les rejouer est sans effet de bord.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(resolve(root, file), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* fichier absent : on se rabat sur l'environnement */ }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const dry = process.argv.includes("--dry");
const check = process.argv.includes("--check");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const targets = files.length
  ? files
  : ["migrations/049-telematics-core.sql", "migrations/050-telematics-analytics.sql"];

const projectRef =
  env.SUPABASE_PROJECT_REF ||
  (env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

// ── Simulation ───────────────────────────────────────────────────────────
if (dry) {
  for (const t of targets) {
    const sql = readFileSync(resolve(root, t), "utf8");
    console.log(
      `${basename(t)} : ${sql.split(/\r?\n/).length} lignes, ` +
      `${(sql.match(/CREATE TABLE/gi) ?? []).length} tables, ` +
      `${(sql.match(/CREATE (OR REPLACE )?VIEW/gi) ?? []).length} vues, ` +
      `${(sql.match(/CREATE TRIGGER/gi) ?? []).length} triggers`,
    );
  }
  console.log("\nSimulation : rien n'a été appliqué.");
  process.exit(0);
}

// ── Exécuteur : API de gestion ───────────────────────────────────────────
function apiRunner(token, ref) {
  return async (sql) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 500);
      try { msg = JSON.parse(text).message ?? msg; } catch { /* texte brut */ }
      throw new Error(msg);
    }
    return text ? JSON.parse(text) : null;
  };
}

// ── Exécuteur : connexion Postgres directe ───────────────────────────────
async function pgRunner(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  });
  await client.connect();
  const run = async (sql) => (await client.query(sql)).rows;
  run.close = () => client.end();
  return run;
}

let run;
let via;
if (env.SUPABASE_ACCESS_TOKEN && projectRef) {
  run = apiRunner(env.SUPABASE_ACCESS_TOKEN, projectRef);
  via = `API de gestion · projet ${projectRef}`;
} else if (env.DATABASE_URL) {
  run = await pgRunner(env.DATABASE_URL);
  via = `connexion directe · ${env.DATABASE_URL.replace(/:\/\/([^:]+):[^@]+@/, "://$1:••••@")}`;
} else {
  console.error(
    "Aucun accès configuré dans .env.local.\n\n" +
    "  SUPABASE_ACCESS_TOKEN=sbp_…   (Account > Access Tokens, permission Database read-write)\n" +
    "  ou DATABASE_URL=postgresql://…  (Settings > Database > Session pooler)",
  );
  process.exit(1);
}

console.log(`Accès : ${via}\n`);

async function state() {
  const rows = await run(`
    SELECT table_name AS nom, 'table' AS genre,
           (SELECT count(*) FROM information_schema.columns c
             WHERE c.table_schema = 'fleet' AND c.table_name = t.table_name)::int AS colonnes
    FROM information_schema.tables t
    WHERE table_schema = 'fleet' AND table_name LIKE 'telematics%'
    UNION ALL
    SELECT table_name, 'vue', 0
    FROM information_schema.views
    WHERE table_schema = 'fleet' AND table_name LIKE 'v_telematics%'
    ORDER BY 2, 1
  `);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    console.log("Socle télématique : absent de la base.");
  } else {
    console.log("Socle télématique en base :");
    for (const r of list) {
      console.log(`  ${String(r.nom).padEnd(28)} ${r.genre}${r.colonnes ? ` · ${r.colonnes} colonnes` : ""}`);
    }
  }
}

try {
  if (check) {
    await state();
  } else {
    for (const target of targets) {
      const sql = readFileSync(resolve(root, target), "utf8");
      process.stdout.write(`${basename(target)} … `);
      try {
        await run(sql);
        console.log("appliquée");
      } catch (err) {
        console.log("ÉCHEC");
        console.error(`\n  ${err.message}\n`);
        process.exitCode = 1;
        break;
      }
    }
    console.log("");
    await state();
  }
} finally {
  if (typeof run.close === "function") await run.close();
}
