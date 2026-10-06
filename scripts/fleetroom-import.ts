/**
 * Import Fleetroom en ligne de commande (reconstitution d'historique).
 * Même moteur que la page admin : lib/fleetroom/ingest.ts.
 *
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/fleetroom-import.ts \
 *     --tenant nmk [--soldes-jour 2026-09-29] [--confirmer] fichier1.csv fichier2.csv …
 *
 * Sans --confirmer : aperçu jour par jour et alertes, RIEN n'est écrit.
 *
 * Variables lues dans .env.local : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Rejouable : un fichier déjà déposé est ignoré, une ligne déjà connue n'est pas recomptée.
 */
import { readFileSync } from "fs";
import { basename } from "path";
import { createClient } from "@supabase/supabase-js";
import { ingestFleetroom, type FleetroomFile } from "../lib/fleetroom/ingest";
import { analyserDepot } from "../lib/fleetroom/apercu";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const slug = opt("--tenant");
const soldesJour = opt("--soldes-jour");
const confirmer = (() => { const i = args.indexOf("--confirmer"); if (i < 0) return false; args.splice(i, 1); return true; })();
if (!slug || args.length === 0) {
  console.error("usage : --tenant <slug> [--soldes-jour AAAA-MM-JJ] [--confirmer] fichiers.csv…");
  process.exit(1);
}

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    // Node 20 n'a pas de WebSocket natif ; le temps réel n'est pas utilisé ici.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: class {} as any },
  });
  const { data: tenant, error } = await sb.schema("fleet").from("tenants").select("id, name").eq("slug", slug).single();
  if (error || !tenant) throw new Error(`tenant « ${slug} » introuvable`);

  const files: FleetroomFile[] = args.map((p) => ({ name: basename(p), text: readFileSync(p, "utf8"), soldesJour }));
  console.log(`→ ${tenant.name} : ${files.length} fichier(s)`);
  const apercu = await analyserDepot(sb, tenant.id, files, new Date().toISOString().slice(0, 10));
  console.table(apercu.jours.length > 40 ? apercu.jours.slice(-40) : apercu.jours);
  for (const a of apercu.alertes) console.log(`${a.niveau === "bloquant" ? "⛔" : "⚠️ "} ${a.texte}`);
  if (!confirmer) { console.log("Aperçu seulement : rien n'est écrit. Relancer avec --confirmer pour intégrer."); return; }
  const res = await ingestFleetroom(sb, tenant.id, files);
  console.log(JSON.stringify(res, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
