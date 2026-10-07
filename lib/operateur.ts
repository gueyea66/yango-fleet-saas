/**
 * Saisie opérateur — règles pures (validation des champs, droit de décider).
 *
 * Un opérateur (admin « saisie seule », ex. dispatcher) saisit pour le compte
 * des chauffeurs : recettes hors Yango d'un jour, charges avec preuve. Un
 * AUTRE admin, valideur, décide. Les mêmes règles sont gardées en base
 * (migration 075, guard_validation_separee) : ce module sert les messages
 * clairs côté API et les tests.
 */
import { CAT_AVANCE, EXPENSE_CATEGORIES } from "./expenseCategories";

export const ISO_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MONTANT_MAX = 10_000_000;

/** Catégories de charge proposées à l'opérateur (l'avance propriétaire a son propre circuit). */
export const CATEGORIES_OPERATEUR = EXPENSE_CATEGORIES.filter((c) => c !== CAT_AVANCE);

export interface SaisieHorsYangoInput { driver_id: string; jour: string; montant: number; courses?: number; note?: string | null }
export interface SaisieChargeInput { driver_id: string; date: string; categorie: string; montant: number; description?: string | null }
/** Décaissement : `driver_id` = compte technique qui sort les fonds, `advance_driver_id` = chauffeur qui les reçoit. */
export interface SaisieDecaissementInput { driver_id: string; date: string; montant: number; advance_driver_id: string | null; description: string }

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

const jourValide = (j: string, today: string) => ISO_JOUR.test(j) && !Number.isNaN(Date.parse(j)) && j <= today && j >= "2020-01-01";
const nettoie = (s: unknown, max = 500) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

export function validerHorsYango(b: Record<string, unknown>, today: string): Ok<SaisieHorsYangoInput> | Err {
  const driver_id = String(b.driver_id ?? "");
  const jour = String(b.jour ?? "");
  const montant = Math.round(Number(b.montant));
  const courses = b.courses == null || b.courses === "" ? 0 : Math.round(Number(b.courses));
  if (!UUID.test(driver_id)) return { ok: false, error: "Chauffeur requis" };
  if (!jourValide(jour, today)) return { ok: false, error: "Jour invalide (pas dans le futur)" };
  if (!(montant > 0) || montant > MONTANT_MAX) return { ok: false, error: "Montant invalide" };
  if (!Number.isFinite(courses) || courses < 0 || courses > 500) return { ok: false, error: "Nombre de courses invalide" };
  return { ok: true, value: { driver_id, jour, montant, courses, note: nettoie(b.note) } };
}

export function validerCharge(b: Record<string, unknown>, today: string): Ok<SaisieChargeInput> | Err {
  const driver_id = String(b.driver_id ?? "");
  const date = String(b.date ?? "");
  const categorie = String(b.categorie ?? "");
  const montant = Math.round(Number(b.montant));
  if (!UUID.test(driver_id)) return { ok: false, error: "Chauffeur concerné requis" };
  if (!jourValide(date, today)) return { ok: false, error: "Date invalide (pas dans le futur)" };
  if (!(CATEGORIES_OPERATEUR as readonly string[]).includes(categorie)) return { ok: false, error: "Catégorie invalide" };
  if (!(montant > 0) || montant > MONTANT_MAX) return { ok: false, error: "Montant invalide" };
  const description = nettoie(b.description);
  if (categorie === "Autre" && !description) return { ok: false, error: "Description obligatoire pour « Autre »" };
  return { ok: true, value: { driver_id, date, categorie, montant, description } };
}

/**
 * Décaissement (avance de fonds, CAT_AVANCE) : sortie de cash du compte
 * technique, éventuellement remise à un chauffeur. Motif toujours exigé :
 * c'est lui qui alimente le détail des décaissements dans les rapports.
 */
export function validerDecaissement(b: Record<string, unknown>, today: string): Ok<SaisieDecaissementInput> | Err {
  const driver_id = String(b.driver_id ?? "");
  const date = String(b.date ?? "");
  const montant = Math.round(Number(b.montant));
  const benef = b.advance_driver_id == null || b.advance_driver_id === "" ? null : String(b.advance_driver_id);
  if (!UUID.test(driver_id)) return { ok: false, error: "Compte de décaissement requis" };
  if (benef && !UUID.test(benef)) return { ok: false, error: "Chauffeur bénéficiaire invalide" };
  if (benef === driver_id) return { ok: false, error: "Le bénéficiaire ne peut pas être le compte de décaissement" };
  if (!jourValide(date, today)) return { ok: false, error: "Date invalide (pas dans le futur)" };
  if (!(montant > 0) || montant > MONTANT_MAX) return { ok: false, error: "Montant invalide" };
  const description = nettoie(b.description);
  if (!description) return { ok: false, error: "Motif du décaissement obligatoire" };
  return { ok: true, value: { driver_id, date, montant, advance_driver_id: benef, description } };
}

/**
 * Peut-on changer le droit de valider d'un administrateur ?
 *  - seul un valideur le peut ;
 *  - jamais sur son propre compte (ni se retirer le droit, ni se le rendre) ;
 *  - il reste toujours au moins un valideur actif, sinon plus personne ne
 *    peut valider ni rétablir un droit depuis l'application.
 */
export function peutChangerDroit(p: {
  acteur: { id: string; peut_valider: boolean };
  cibleId: string;
  nouveau: boolean;
  admins: { id: string; peut_valider: boolean; active?: boolean | null }[];
}): { ok: true } | Err {
  if (!p.acteur.peut_valider) return { ok: false, error: "Réservé à un administrateur valideur." };
  if (p.cibleId === p.acteur.id) return { ok: false, error: "Vous ne pouvez pas modifier votre propre droit : demandez à un autre administrateur valideur." };
  if (!p.admins.some((a) => a.id === p.cibleId)) return { ok: false, error: "Administrateur introuvable" };
  const restants = p.admins.filter((a) => a.peut_valider && a.active !== false && a.id !== p.cibleId).length;
  if (!p.nouveau && restants === 0) return { ok: false, error: "Il doit rester au moins un administrateur valideur." };
  return { ok: true };
}

/** Profils d'un compte gestionnaire : valideur (tous les droits) ou opérateur (saisie seule). */
export type ProfilAdmin = "valideur" | "operateur";
export const MDP_ADMIN_MIN = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface CompteAdminInput { full_name: string; email: string; profil: ProfilAdmin; password?: string }

/**
 * Création (mot de passe exigé) ou modification (mot de passe ignoré) d'un
 * compte gestionnaire. Le mot de passe n'est jamais modifiable ici après la
 * création : chacun change le sien, personne ne prend le compte d'un autre.
 */
export function validerCompteAdmin(b: Record<string, unknown>, mode: "creation" | "modification"): Ok<CompteAdminInput> | Err {
  const full_name = nettoie(b.full_name, 80);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!full_name || full_name.length < 2) return { ok: false, error: "Nom requis" };
  if (!EMAIL.test(email) || email.length > 120) return { ok: false, error: "Adresse e-mail invalide" };
  if (b.profil !== "valideur" && b.profil !== "operateur") return { ok: false, error: "Profil requis : valideur ou opérateur" };
  if (mode === "modification") return { ok: true, value: { full_name, email, profil: b.profil } };
  const password = String(b.password ?? "");
  if (password.length < MDP_ADMIN_MIN) return { ok: false, error: `Mot de passe provisoire : ${MDP_ADMIN_MIN} caractères minimum` };
  return { ok: true, value: { full_name, email, profil: b.profil, password } };
}

/** Un décaissement se saisit par un administrateur valideur, jamais par un profil « saisie seule ». */
export function peutSaisirDecaissement(p: { peut_valider: boolean }): { ok: true } | Err {
  return p.peut_valider ? { ok: true } : { ok: false, error: "Les décaissements sont réservés aux administrateurs valideurs." };
}

/** L'auteur corrige ou annule sa saisie tant qu'elle n'est pas traitée ; ensuite elle est figée. */
export function peutModifierSaisie(p: { userId: string; saisie: { entered_by: string | null; status: string } }): { ok: true } | Err {
  if (p.saisie.status !== "submitted") return { ok: false, error: "Saisie déjà traitée : elle n'est plus modifiable." };
  if (p.saisie.entered_by !== p.userId) return { ok: false, error: "Seul l'auteur peut corriger ou annuler sa saisie." };
  return { ok: true };
}

export interface ChargeComparable { id?: string | null; driver_id: string; expense_date: string | null; category: string; amount: number; status?: string | null }

/**
 * Charges déjà présentes qui ressemblent à `c` : même chauffeur, même date,
 * même catégorie, même montant, non rejetées. Le chauffeur (app) et
 * l'opérateur peuvent déclarer la même dépense chacun de leur côté.
 */
export function doublonsPossibles<T extends ChargeComparable>(c: ChargeComparable, existantes: T[]): T[] {
  return existantes.filter((e) => e.id !== c.id && e.driver_id === c.driver_id && e.expense_date === c.expense_date
    && e.category === c.category && Math.round(Number(e.amount)) === Math.round(Number(c.amount)) && e.status !== "rejected");
}

/**
 * Peut-on décider (valider / rejeter) ? Valideur requis, jamais l'auteur,
 * uniquement une saisie en attente ; une charge opérateur exige une preuve.
 */
export function peutDecider(p: {
  decideur: { id: string; peut_valider: boolean };
  saisie: { entered_by: string | null; status: string };
  decision: "approved" | "rejected";
  piecesJointes?: number;   // charges : nombre de preuves rattachées
}): { ok: true } | Err {
  if (!p.decideur.peut_valider) return { ok: false, error: "Votre profil est en saisie seule : la validation revient à un autre administrateur." };
  if (p.saisie.status !== "submitted") return { ok: false, error: "Saisie déjà traitée" };
  if (p.saisie.entered_by && p.saisie.entered_by === p.decideur.id) return { ok: false, error: "Une saisie ne peut pas être validée par son auteur." };
  if (p.decision === "approved" && p.piecesJointes !== undefined && p.piecesJointes < 1) return { ok: false, error: "Preuve manquante : impossible de valider une charge sans pièce jointe." };
  return { ok: true };
}
