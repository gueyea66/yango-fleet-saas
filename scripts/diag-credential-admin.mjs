#!/usr/bin/env node
/**
 * Pourquoi cet identifiant admin ne passe plus ?
 *
 * Répond en une commande, en parcourant les portes DANS L'ORDRE où elles se
 * referment. Une connexion admin traverse quatre portes, et trois d'entre
 * elles échouent sans jamais dire « mot de passe incorrect » :
 *
 *   1. compte Auth      — existe, confirmé, non banni, mot de passe valide
 *   2. profil fleet     — ligne présente, role='admin', tenant_id renseigné
 *   3. tenant           — active, et pas au-delà de son échéance
 *   4. connexion réelle — reproduite avec la clé anon (si mot de passe fourni)
 *
 * Usage :
 *   node scripts/diag-credential-admin.mjs admin@m3a.sn [motdepasse]
 *   node scripts/diag-credential-admin.mjs --tenant m3a      # liste les admins
 *
 * Variables attendues (mêmes noms que .env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  (facultatif — pour l'étape 4)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/* ── env : process.env, complété par .env.local s'il est là ─────────── */
function loadEnv() {
  const env = { ...process.env };
  for (const f of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* fichier absent : on se contente de process.env */ }
  }
  return env;
}

const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !SERVICE) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
  console.error("  Renseignez .env.local, ou exportez-les avant de lancer le script.");
  process.exit(2);
}

const db = createClient(URL, SERVICE, { db: { schema: "fleet" }, auth: { persistSession: false } });

const fmt = (d) => (d ? new Date(d).toLocaleString("fr-FR") : "—");
const jours = (d) => Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const ko = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

/**
 * Même règle que lib/tenant/access.ts (tenantAccessState) — gardée ici en
 * clair pour que le diagnostic tourne sans build. Si vous touchez à l'une,
 * touchez à l'autre.
 */
function etatAcces(t) {
  if (t.active === false) return { locked: true, reason: "inactive", expiresAt: null };
  if (t.never_expires) return { locked: false, reason: null, expiresAt: null };
  const expiresAt = t.plan_expires_at ?? t.trial_ends_at ?? null;
  if (!expiresAt) return { locked: false, reason: null, expiresAt: null };
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return { locked: false, reason: null, expiresAt };
  return end < Date.now()
    ? { locked: true, reason: "expired", expiresAt }
    : { locked: false, reason: null, expiresAt };
}

async function trouverUtilisateur(email) {
  const cible = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers : ${error.message}`);
    const hit = (data.users || []).find((u) => (u.email || "").toLowerCase() === cible);
    if (hit) return hit;
    if (!data.users || data.users.length < 200) return null;
  }
  return null;
}

async function listerAdmins(slug) {
  const { data: tenant } = await db.from("tenants").select("*").eq("slug", slug).maybeSingle();
  if (!tenant) return console.log(`Tenant '${slug}' introuvable.`);
  const { data: admins } = await db.from("profiles")
    .select("id, email, full_name, role, active").eq("tenant_id", tenant.id).eq("role", "admin");
  titre(`Admins du tenant '${slug}' (${tenant.name})`);
  if (!admins?.length) return ko("Aucun profil role='admin' sur ce tenant.");
  for (const a of admins) info(`${a.email}   (${a.full_name || "sans nom"}, id ${a.id})`);
  info("");
  info("Ces adresses sont celles que la base connaît — une faute de frappe");
  info("sur l'email donne exactement la même erreur qu'un mauvais mot de passe.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--tenant") return listerAdmins(args[1] || "m3a");

  const email = args[0];
  const motDePasse = args[1];
  if (!email) {
    console.error("Usage : node scripts/diag-credential-admin.mjs <email> [motdepasse]");
    console.error("        node scripts/diag-credential-admin.mjs --tenant m3a");
    process.exit(2);
  }

  const causes = [];
  console.log(`\nDiagnostic de \x1b[1m${email}\x1b[0m sur ${URL}`);

  /* ── 1. compte Auth ───────────────────────────────────────────────── */
  titre("1. Compte Supabase Auth");
  const user = await trouverUtilisateur(email);
  if (!user) {
    ko("Aucun compte Auth pour cette adresse.");
    info("→ soit l'email n'est pas celui-là (voir --tenant <slug>),");
    info("→ soit le compte a été supprimé : le recréer depuis /superadmin.");
    causes.push("compte Auth inexistant");
  } else {
    ok(`Compte trouvé — id ${user.id}`);
    info(`créé le ${fmt(user.created_at)} · modifié le ${fmt(user.updated_at)}`);
    info(`dernière connexion réussie : ${fmt(user.last_sign_in_at)}`);

    if (!user.email_confirmed_at && !user.confirmed_at) {
      ko("Email NON confirmé — Supabase refusera la connexion si la confirmation est exigée.");
      info("→ corriger : admin.updateUserById(id, { email_confirm: true }), ou /superadmin.");
      causes.push("email non confirmé");
    } else ok(`Email confirmé le ${fmt(user.email_confirmed_at || user.confirmed_at)}`);

    if (user.new_email) {
      ko(`Changement d'email EN ATTENTE vers « ${user.new_email} ».`);
      info(`→ la connexion se fait encore avec « ${user.email} », pas avec la nouvelle.`);
      causes.push("changement d'email en attente");
    }
    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      ko(`Compte banni jusqu'au ${fmt(user.banned_until)}.`);
      causes.push("compte banni");
    }
    if (user.deleted_at) { ko(`Compte supprimé le ${fmt(user.deleted_at)}.`); causes.push("compte supprimé"); }
  }

  /* ── 2. profil fleet ──────────────────────────────────────────────── */
  titre("2. Profil applicatif (fleet.profiles)");
  let profil = null;
  if (user) {
    const { data } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
    profil = data;
  }
  if (!profil) {
    ko("Pas de ligne profiles pour ce compte.");
    info("→ la session s'ouvre, puis l'API répond 403 et l'app reste vide.");
    info("→ corriger : recréer le profil (role='admin', tenant_id renseigné).");
    causes.push("profil absent");
  } else {
    ok(`Profil trouvé — role='${profil.role}', tenant_id=${profil.tenant_id || "NULL"}`);
    if (profil.role !== "admin") { ko(`role='${profil.role}' : /admin et les API admin répondront 403.`); causes.push(`role '${profil.role}'`); }
    if (!profil.tenant_id) { ko("tenant_id NULL : requireAdminAuth répond 403."); causes.push("tenant_id NULL"); }
    if (profil.email && profil.email.toLowerCase() !== (user?.email || "").toLowerCase()) {
      ko(`profiles.email (${profil.email}) ≠ email Auth (${user?.email}).`);
      info("→ l'adresse affichée dans la console n'est pas celle qui ouvre la session.");
      causes.push("email profil désynchronisé");
    }
  }

  /* ── 3. tenant ────────────────────────────────────────────────────── */
  titre("3. Tenant (abonnement / suspension)");
  let tenant = null;
  if (profil?.tenant_id) {
    const { data } = await db.from("tenants").select("*").eq("id", profil.tenant_id).maybeSingle();
    tenant = data;
  }
  if (!tenant) {
    if (profil?.tenant_id) { ko("tenant_id pointe sur un tenant inexistant."); causes.push("tenant introuvable"); }
    else info("(non vérifiable sans tenant_id)");
  } else {
    info(`slug='${tenant.slug}' · plan='${tenant.plan}' · active=${tenant.active}`);
    info(`never_expires=${tenant.never_expires ?? "(colonne absente — migration 061 non appliquée)"}`);
    info(`trial_ends_at=${fmt(tenant.trial_ends_at)} · plan_expires_at=${fmt(tenant.plan_expires_at)}`);

    const acces = etatAcces(tenant);
    if (acces.locked && acces.reason === "inactive") {
      ko("Tenant suspendu (active=false) → /locked?reason=inactive, API 402.");
      info("→ corriger : /superadmin → réactiver le tenant.");
      causes.push("tenant suspendu");
    } else if (acces.locked) {
      ko(`Accès EXPIRÉ depuis le ${fmt(acces.expiresAt)} (${-jours(acces.expiresAt)} jours).`);
      info("→ la connexion Supabase réussit, puis le middleware renvoie sur /locked");
      info("  et toutes les API admin répondent 402. Vu de l'écran : « ça ne marche plus ».");
      info("→ corriger : /superadmin → « Accès permanent » pour le tenant opérateur,");
      info("  ou « Étendre » pour un client qui a payé.");
      causes.push("accès tenant expiré");
    } else if (acces.expiresAt) {
      ok(`Accès ouvert — échéance le ${fmt(acces.expiresAt)} (J-${jours(acces.expiresAt)}).`);
      if (jours(acces.expiresAt) <= 14) info("⚠ échéance proche : c'est ce compte-à-rebours qui coupera l'accès.");
    } else {
      ok(tenant.never_expires ? "Accès permanent (never_expires) — aucune échéance." : "Aucune échéance enregistrée.");
    }
  }

  /* ── 4. connexion réelle ──────────────────────────────────────────── */
  titre("4. Connexion réelle (clé anon, comme la page de login)");
  if (!motDePasse) info("(mot de passe non fourni — étape ignorée)");
  else if (!ANON) info("(NEXT_PUBLIC_SUPABASE_ANON_KEY absente — étape ignorée)");
  else {
    const pub = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data, error } = await pub.auth.signInWithPassword({ email, password: motDePasse });
    if (error) {
      ko(`Refus de Supabase : « ${error.message} »`);
      if (/invalid login credentials/i.test(error.message) && user && !causes.includes("email non confirmé")) {
        info("→ le compte existe et est confirmé : c'est le mot de passe qui ne correspond pas.");
        info("→ corriger : /superadmin → ✏️ sur le compte admin → nouveau mot de passe.");
        causes.push("mot de passe incorrect");
      }
    } else {
      ok(`Connexion réussie — session ouverte pour ${data.user?.email}.`);
      info("L'authentification n'est donc PAS en cause : si l'app reste inaccessible,");
      info("la cause est à l'étape 2 ou 3 ci-dessus.");
    }
  }

  /* ── verdict ──────────────────────────────────────────────────────── */
  titre("Verdict");
  if (!causes.length) {
    ok("Aucun blocage détecté sur ce compte.");
    process.exit(0);
  }
  for (const c of causes) ko(c);
  process.exit(1);
}

main().catch((e) => { console.error("\n✗ Diagnostic interrompu :", e.message); process.exit(2); });
