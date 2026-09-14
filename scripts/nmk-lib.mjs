/**
 * Accès Supabase en REST pur (pas de supabase-js : Node 20 sans WebSocket natif
 * casse realtime-js). Schéma fleet via Accept-Profile / Content-Profile.
 */
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.local");
export const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function call(url, opts = {}) {
  const res = await fetch(url, opts);
  const txt = await res.text();
  let body = txt;
  try { body = txt ? JSON.parse(txt) : null; } catch { /* texte brut */ }
  if (!res.ok) throw new Error(`${res.status} ${url.replace(URL_BASE, "")} → ${txt.slice(0, 400)}`);
  return body;
}

/** SELECT — query = chaîne PostgREST, ex. "select=*&limit=1" */
export const select = (table, query = "select=*") =>
  call(`${URL_BASE}/rest/v1/${table}?${query}`, {
    headers: { ...H, "Accept-Profile": "fleet" },
  });

/** INSERT — rows = objet ou tableau ; renvoie les lignes créées */
export const insert = (table, rows, { upsert = false, onConflict = "" } = {}) =>
  call(`${URL_BASE}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
    method: "POST",
    headers: {
      ...H,
      "Content-Profile": "fleet",
      "Accept-Profile": "fleet",
      Prefer: `return=representation${upsert ? ",resolution=merge-duplicates" : ""}`,
    },
    body: JSON.stringify(rows),
  });

/** UPDATE — filter = chaîne PostgREST, ex. "id=eq.xxx" */
export const update = (table, filter, patch) =>
  call(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...H, "Content-Profile": "fleet", "Accept-Profile": "fleet", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });

export const remove = (table, filter) =>
  call(`${URL_BASE}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: { ...H, "Content-Profile": "fleet", "Accept-Profile": "fleet", Prefer: "return=representation" },
  });

/** Crée un utilisateur auth (email confirmé) ; renvoie l'id. Idempotent. */
export async function createAuthUser({ email, password, meta = {} }) {
  try {
    const u = await call(`${URL_BASE}/auth/v1/admin/users`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: meta }),
    });
    return u.id;
  } catch (e) {
    if (!/already been registered|already exists|email_exists/i.test(e.message)) throw e;
    const list = await call(`${URL_BASE}/auth/v1/admin/users?page=1&per_page=1000`, { headers: H });
    const found = (list.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!found) throw new Error(`Utilisateur ${email} existant mais introuvable`);
    // remet le mot de passe connu
    await call(`${URL_BASE}/auth/v1/admin/users/${found.id}`, {
      method: "PUT", headers: H, body: JSON.stringify({ password, email_confirm: true }),
    });
    return found.id;
  }
}
