/**
 * Fiches de mise en service client — modèle et bascule vers l'application.
 *
 * La fiche d'onboarding est le point de saisie unique : le parc, les chauffeurs
 * et la règle de versement y sont notés une fois, pendant les échanges avec le
 * client. `provisionOnboarding` les verse ensuite dans M3A Fleet. Personne ne
 * ressaisit rien.
 *
 * L'opération est REJOUABLE : on la relance après avoir ajouté deux véhicules
 * sans que les précédents soient dupliqués ni que les mots de passe déjà remis
 * aux chauffeurs soient changés. Ce qui existe est mis à jour, ce qui manque
 * est créé, et la fiche garde la trace de ce qui a été attribué.
 */

import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVirtualEmailForDriver } from "@/lib/auth/utils";
import {
  mapRemunerationModel,
  numFromField,
  plateKey,
  segmentDe,
  slugify,
  type OnbDoc,
} from "@/lib/onboarding-model";

export * from "@/lib/onboarding-model";

/**
 * Mot de passe remis au chauffeur : lu a voix haute et tape sur un telephone.
 * Alphabet sans O/0, I/l/1 - les confusions coutent un appel au gestionnaire.
 * 10 caracteres, au-dessus du minimum de 8 exige par la politique (audit V10).
 */
export function makePassword(len = 10): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/**
 * Couleur hexadécimale à six chiffres, normalisée en minuscules avec le dièse.
 * Rend `null` sur tout le reste : mieux vaut garder la couleur par défaut que
 * d'écrire une valeur que le navigateur ignorera en silence.
 */
export function couleurValide(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
  return m ? "#" + m[1].toLowerCase() : null;
}

/** Prochain identifiant libre de la serie D01, D02... pour ce tenant. */
export function nextDriverId(taken: Set<string>): string {
  for (let i = 1; i < 1000; i++) {
    const id = "D" + String(i).padStart(2, "0");
    if (!taken.has(id)) return id;
  }
  throw new Error("Serie d'identifiants chauffeur epuisee");
}

/* ── Mise en service ────────────────────────────────────────── */

export interface ProvisionLigne {
  quoi: string;
  etat: "cree" | "maj" | "inchange" | "erreur";
  detail?: string;
}

export interface ProvisionResult {
  ok: boolean;
  tenantId: string;
  slug: string;
  /** Identifiants générés pendant CETTE passe — jamais relus ensuite. */
  identifiants: { nom: string; driverId: string; motDePasse: string }[];
  /**
   * Comptes admin ouverts pendant CETTE passe. Une liste, pas un seul compte :
   * le gestionnaire valide au quotidien, la direction regarde — les deux ont
   * besoin d'un accès, et remettre le même à deux personnes supprime la trace
   * de qui a validé quoi.
   */
  adminIdentifiants?: { nom: string; email: string; motDePasse: string }[];
  lignes: ProvisionLigne[];
  /** Fiche enrichie des identifiants attribués, à ré-enregistrer. */
  doc: OnbDoc;
}

/**
 * Client Supabase service_role, schéma `fleet`. Le projet ne génère pas les
 * types de la base : comme les autres routes serveur, on prend le client dans
 * sa forme non typée plutôt que de décrire à la main un schéma qui dérivera.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminDb = SupabaseClient<any, "public", any>;

/** Ligne de `profiles` lue ici — les seules colonnes dont on se sert. */
interface ProfilRow { id: string; driver_id: string | null; full_name: string | null }
/** Ligne de `vehicles` lue ici. */
interface VehiculeRow { id: string; plate: string | null }
/** Compte d'authentification, vu de `auth.admin.listUsers`. */
interface CompteAuth { id: string; email?: string | null }

interface ProvisionArgs {
  admin: AdminDb;
  fileId: string;             // slug de la fiche
  doc: OnbDoc;
  tenantId: string | null;    // tenant déjà rattaché, s'il existe
  plan?: string;
  trialDays?: number;
}

export async function provisionOnboarding(args: ProvisionArgs): Promise<ProvisionResult> {
  const { admin, fileId, doc } = args;
  const lignes: ProvisionLigne[] = [];
  const identifiants: ProvisionResult["identifiants"] = [];
  const out: OnbDoc = JSON.parse(JSON.stringify(doc));

  /* 1 ── L'espace client */
  const slug = slugify(fileId || doc.nom);
  if (!slug) throw new Error("Nom de client vide : impossible de nommer l'espace");
  if (!doc.nom?.trim()) throw new Error("La fiche n'a pas de raison sociale");

  let tenantId = args.tenantId;
  if (tenantId) {
    const { data: t } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
    if (!t) tenantId = null;   // espace supprimé depuis : on le recrée
    else lignes.push({ quoi: `Espace « ${slug} »`, etat: "inchange", detail: "déjà en service" });
  }

  if (!tenantId) {
    const { data: bySlug } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    if (bySlug) {
      tenantId = bySlug.id;
      lignes.push({ quoi: `Espace « ${slug} »`, etat: "inchange", detail: "existait déjà, réutilisé" });
    }
  }

  if (!tenantId) {
    const trialDays = args.trialDays ?? 14;
    const { data: t, error } = await admin.from("tenants").insert({
      slug,
      name: doc.nom.trim(),
      plan: args.plan || doc.plan || "standard",
      active: true,
      trial_ends_at: new Date(Date.now() + trialDays * 86400000).toISOString(),
      notifications_sent: {},
    }).select("id").single();
    if (error || !t) throw new Error("Espace non créé : " + (error?.message || "raison inconnue"));
    tenantId = t.id as string;

    await admin.from("tenant_settings").insert({
      tenant_id: tenantId, app_name: doc.nom.trim(),
      primary_color: couleurValide(doc.couleur) ?? "#f5a623",
      currency: "XOF", timezone: "Africa/Dakar",
      ui_v2: doc.uiV2 === true,
    });
    lignes.push({ quoi: `Espace « ${slug} »`, etat: "cree", detail: `essai de ${trialDays} jours` });
  }

  // L'interface, une fois l'espace certain. Rejouable : changer d'avis sur la
  // v2 après la première mise en service suffit à basculer le client, sans
  // passer par la base. Sur un espace tout neuf l'insert ci-dessus a déjà posé
  // la valeur ; l'écrire deux fois ne coûte rien et garde un seul chemin.
  if (doc.uiV2 !== undefined) {
    const { error } = await admin.from("tenant_settings")
      .update({ ui_v2: doc.uiV2 === true }).eq("tenant_id", tenantId);
    lignes.push(error
      ? { quoi: "Interface", etat: "erreur", detail: error.message }
      : { quoi: "Interface", etat: "maj", detail: doc.uiV2 ? "refonte v2" : "interface actuelle" });
  }

  // La couleur du client, même traitement : posée à la création, reposée au
  // rejeu. Une couleur invalide est ignorée plutôt qu'écrite — une valeur que
  // le navigateur ne sait pas lire rendrait l'espace illisible, et l'erreur
  // serait invisible en base.
  const couleur = couleurValide(doc.couleur);
  if (couleur) {
    const { error } = await admin.from("tenant_settings")
      .update({ primary_color: couleur }).eq("tenant_id", tenantId);
    lignes.push(error
      ? { quoi: "Couleur de marque", etat: "erreur", detail: error.message }
      : { quoi: "Couleur de marque", etat: "maj", detail: couleur });
  }

  /* 2 ── La règle de versement */
  const model = mapRemunerationModel(doc.regle?.mode || "");
  // Deux champs distincts, et c'est voulu : `versement` est un montant par jour,
  // `commission` un taux. Les confondre écrirait « 40 000 % » de commission dans
  // la base le jour où le client est en commission sur le brut.
  const versement = numFromField(doc.regle?.versement);
  const tauxSaisi = numFromField(doc.regle?.commission);
  const remun = {
    tenant_id: tenantId,
    model,
    base_amount: versement,
    // La fiche note « 12 » pour 12 % ; la base attend un ratio. Un taux déjà
    // écrit en ratio (0,12) est pris tel quel, et rien ne dépasse 100 %.
    commission_rate: model === "percent"
      ? Math.min(1, Math.max(0, tauxSaisi > 1 ? tauxSaisi / 100 : tauxSaisi))
      : 0,
    updated_at: new Date().toISOString(),
  };
  const { data: existingRemun } = await admin.from("remuneration_config")
    .select("id").eq("tenant_id", tenantId).maybeSingle();
  if (existingRemun) {
    await admin.from("remuneration_config").update(remun).eq("tenant_id", tenantId);
    lignes.push({ quoi: "Règle de versement", etat: "maj", detail: doc.regle?.mode || model });
  } else {
    await admin.from("remuneration_config").insert(remun);
    lignes.push({ quoi: "Règle de versement", etat: "cree", detail: doc.regle?.mode || model });
  }

  /* 3 ── Les comptes admin : gestionnaire et direction */
  // Deux rôles, deux comptes. Le gestionnaire valide les rapports au
  // quotidien, la direction regarde les chiffres — partager un identifiant
  // effacerait la trace de qui a validé quoi dans le journal. Une adresse vide
  // est simplement sautée : la fiche se complète souvent après la première
  // mise en service, qui est rejouable.
  const adminIdentifiants: ProvisionResult["adminIdentifiants"] = [];
  const comptesAdmin = [
    { role: "Gestionnaire", nom: doc.gestionnaire, email: doc.gestionnaireEmail },
    { role: "Direction", nom: doc.direction, email: doc.directionEmail },
  ];

  for (const compte of comptesAdmin) {
    const email = (compte.email || "").trim().toLowerCase();
    if (!email) continue;
    const libelle = `${compte.role} ${email}`;

    const { data: dejaLa } = await admin.from("profiles")
      .select("id").eq("tenant_id", tenantId).eq("email", email).maybeSingle();
    if (dejaLa) {
      lignes.push({ quoi: libelle, etat: "inchange", detail: "compte déjà ouvert" });
      continue;
    }

    const motDePasse = makePassword();
    const { data: user, error: authError } = await admin.auth.admin.createUser({
      email, password: motDePasse, email_confirm: true,
    });
    if (authError || !user?.user) {
      lignes.push({ quoi: libelle, etat: "erreur", detail: authError?.message || "création refusée" });
      continue;
    }

    const nom = (compte.nom || "").trim() || email.split("@")[0];
    const { error: pErr } = await admin.from("profiles").insert({
      id: user.user.id, tenant_id: tenantId, email,
      full_name: nom, role: "admin",
    });
    if (pErr) {
      // Le compte d'authentification sans profil serait un fantôme : il peut se
      // connecter et n'appartient à aucun tenant. On le retire.
      await admin.auth.admin.deleteUser(user.user.id);
      lignes.push({ quoi: libelle, etat: "erreur", detail: pErr.message });
      continue;
    }

    adminIdentifiants.push({ nom: `${compte.role} — ${nom}`, email, motDePasse });
    lignes.push({ quoi: libelle, etat: "cree" });
  }

  /* 4 ── Les chauffeurs (avant les véhicules : l'attribution en dépend) */
  const { data: profilsExistants } = await admin.from("profiles")
    .select("id, driver_id, full_name").eq("tenant_id", tenantId).eq("role", "driver");
  const parDriverId = new Map<string, ProfilRow>();
  const parNom = new Map<string, ProfilRow>();
  ((profilsExistants || []) as ProfilRow[]).forEach((p) => {
    if (p.driver_id) parDriverId.set(String(p.driver_id).toUpperCase(), p);
    if (p.full_name) parNom.set(String(p.full_name).trim().toLowerCase(), p);
  });
  const prisDriverIds = new Set<string>(parDriverId.keys());

  /** profil du chauffeur, par plaque attribuée — pour l'étape véhicules */
  const profilParPlaque = new Map<string, string>();

  for (const c of out.chauffeurs || []) {
    const nom = (c.nom || "").trim();
    if (!nom) continue;

    let profil = c.driverId ? parDriverId.get(c.driverId.toUpperCase()) : undefined;
    if (!profil) profil = parNom.get(nom.toLowerCase());

    if (profil) {
      c.driverId = profil.driver_id || c.driverId;
      if (c.vehicule) profilParPlaque.set(plateKey(c.vehicule), profil.id);
      lignes.push({ quoi: `Chauffeur ${nom}`, etat: "inchange", detail: `compte ${c.driverId} déjà ouvert` });
      continue;
    }

    const driverId = (c.driverId || nextDriverId(prisDriverIds)).toUpperCase();
    prisDriverIds.add(driverId);
    const motDePasse = makePassword();
    const virtualEmail = getVirtualEmailForDriver(driverId);

    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: virtualEmail, password: motDePasse, email_confirm: true,
      user_metadata: { full_name: nom, role: "driver" },
    });

    let authUserId: string | null = authUser?.user?.id ?? null;
    if (authError) {
      // L'identifiant a déjà servi (fiche rejouée après suppression du profil) :
      // on récupère le compte plutôt que d'échouer, sans toucher au mot de passe.
      const dejaPris = /already (been )?registered|already exists/i.test(authError.message);
      if (!dejaPris) {
        lignes.push({ quoi: `Chauffeur ${nom}`, etat: "erreur", detail: authError.message });
        continue;
      }
      const { data: liste } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = (liste?.users as CompteAuth[] | undefined)
        ?.find((u) => u.email?.toLowerCase() === virtualEmail.toLowerCase());
      if (!existing) {
        lignes.push({ quoi: `Chauffeur ${nom}`, etat: "erreur", detail: "compte introuvable" });
        continue;
      }
      authUserId = existing.id;
    }
    if (!authUserId) {
      lignes.push({ quoi: `Chauffeur ${nom}`, etat: "erreur", detail: "compte non créé" });
      continue;
    }

    const { error: pErr } = await admin.from("profiles").upsert({
      id: authUserId, tenant_id: tenantId, email: virtualEmail,
      driver_id: driverId, full_name: nom, role: "driver",
      account_type: "driver", payment_frequency: "monthly",
      hire_date: c.entree || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    if (pErr) {
      lignes.push({ quoi: `Chauffeur ${nom}`, etat: "erreur", detail: pErr.message });
      continue;
    }

    c.driverId = driverId;
    if (c.vehicule) profilParPlaque.set(plateKey(c.vehicule), authUserId);
    // Le mot de passe n'est lisible qu'ici : la base ne le rend jamais.
    if (!authError) identifiants.push({ nom, driverId, motDePasse });
    lignes.push({
      quoi: `Chauffeur ${nom}`,
      etat: "cree",
      detail: authError ? `${driverId} — compte repris, mot de passe inchangé` : driverId,
    });
  }

  /* 5 ── Le parc */
  const { data: vehiculesExistants } = await admin.from("vehicles")
    .select("id, plate").eq("tenant_id", tenantId);
  const parPlaque = new Map<string, VehiculeRow>();
  ((vehiculesExistants || []) as VehiculeRow[]).forEach((v) => parPlaque.set(plateKey(v.plate || ""), v));

  for (const v of out.vehicules || []) {
    const plaque = (v.plaque || "").trim();
    if (!plaque) continue;
    const key = plateKey(plaque);
    // « Toyota Corolla » : la fiche tient marque et modèle dans une case, la
    // base les sépare. Le premier mot est la marque, le reste le modèle.
    const mots = (v.modele || "").trim().split(/\s+/).filter(Boolean);
    const driverProfileId = profilParPlaque.get(key);
    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      plate: plaque.toUpperCase(),
      make: mots[0] || null,
      model: mots.slice(1).join(" ") || null,
      year: /^\d{4}$/.test(String(v.annee || "").trim()) ? parseInt(String(v.annee).trim(), 10) : null,
      // `owner_name` est la colonne que lisent les filtres et les agrégats ;
      // `notes` garde la phrase lisible, pour les espaces ouverts avant la 062.
      owner_name: v.proprio?.trim() || null,
      notes: v.proprio ? `Propriétaire : ${v.proprio}` : null,
      fleet_segment: segmentDe(v),
      status: "active",
      // Explicitement null, pas omis : un véhicule sans chauffeur est un état
      // normal (voiture à l'arrêt, en attente d'affectation) et omettre la clé
      // laissait la valeur précédente en place lors d'un rejeu.
      driver_id: driverProfileId ?? null,
      updated_at: new Date().toISOString(),
    };

    const dejaLa = parPlaque.get(key);
    if (dejaLa) {
      const { error } = await admin.from("vehicles").update(payload).eq("id", dejaLa.id);
      lignes.push(error
        ? { quoi: `Véhicule ${plaque}`, etat: "erreur", detail: error.message }
        : { quoi: `Véhicule ${plaque}`, etat: "maj" });
    } else {
      const { error } = await admin.from("vehicles").insert(payload);
      lignes.push(error
        ? { quoi: `Véhicule ${plaque}`, etat: "erreur", detail: error.message }
        : { quoi: `Véhicule ${plaque}`, etat: "cree", detail: driverProfileId ? "attribué" : "sans chauffeur" });
    }
  }

  return {
    ok: !lignes.some((l) => l.etat === "erreur"),
    tenantId: tenantId!,
    slug,
    identifiants,
    adminIdentifiants,
    lignes,
    doc: out,
  };
}
