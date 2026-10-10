/**
 * Aperçu d'un dépôt Fleetroom AVANT intégration : ce que contiennent les
 * fichiers, jour par jour, et ce qui laisse penser qu'ils sont incomplets.
 *
 * Existe parce qu'un export pris en cours de journée a été intégré tel quel
 * (NMK, 05/10/2026 : 244 transactions à 17h40, 312 le lendemain) : les
 * déclarations et les soldes du jour étaient faux, il a fallu tout retirer.
 * Rien n'est écrit ici ; l'intégration ne part qu'après confirmation.
 *
 * Les lignes du jour en cours ne bloquent pas le dépôt : l'export de la veille
 * en contient près d'un jour sur trois (course partie avant minuit, finie
 * après). Elles sont mises de côté, ici comme dans `ingestFleetroom`.
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commandeApresMinuit, commandeEnCours, detectKind, parseOrders, parseSoldes, parseTransactions, periodOf, splitCsv,
  txEnCours, type FleetroomKind,
} from "./parse";
import type { FleetroomFile } from "./ingest";

export interface ApercuFichier {
  name: string; kind: FleetroomKind | null; rows: number;
  period: { from: string | null; to: string | null };
  /** Fichier déjà déposé (même empreinte) : date du dépôt. Renseigné par `analyserDepot`. */
  dejaDepose?: string | null;
}

export interface ApercuJour {
  jour: string;
  transactions: number; commandes: number; chauffeurs: number; soldes: number;
  /** espèces + carte, comme le brut Yango des déclarations */
  brut: number;
  /** heure (UTC = Dakar) de la dernière transaction du jour, « HH:MM » */
  derniereTransaction: string | null;
  /** transactions déjà en base ce jour-là. Renseigné par `analyserDepot`. */
  dejaEnBase?: number;
}

export interface Apercu {
  fichiers: ApercuFichier[];
  jours: ApercuJour[];
  /** Ce qui doit faire hésiter avant d'intégrer, du plus grave au moins grave. */
  alertes: { niveau: "bloquant" | "attention"; texte: string }[];
  chauffeursInconnus: string[];
}

const fr = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}`;
const BRUT = new Set(["cash_collected", "card"]);
/** Avant cette heure, une dernière transaction laisse penser que la journée n'était pas finie à l'export. */
const HEURE_FIN_PLAUSIBLE = "20:00";

/** Lecture seule des fichiers : aucun accès à la base. `today` = jour courant (AAAA-MM-JJ, Dakar = UTC). */
export function apercuFichiers(files: FleetroomFile[], today: string): Apercu {
  const fichiers: ApercuFichier[] = [];
  const alertes: Apercu["alertes"] = [];
  const jours = new Map<string, ApercuJour & { ids: Set<string> }>();
  const jourDe = (j: string) => {
    if (!jours.has(j)) jours.set(j, { jour: j, transactions: 0, commandes: 0, chauffeurs: 0, soldes: 0, brut: 0, derniereTransaction: null, ids: new Set() });
    return jours.get(j)!;
  };
  let txEcartees = 0, commandesEcartees = 0, apresMinuit = 0;

  for (const f of files) {
    const rows = splitCsv(f.text);
    const kind = rows.length ? detectKind(rows[0]) : null;
    let period = { from: null as string | null, to: null as string | null };
    let n = Math.max(0, rows.length - 1);
    try {
      if (kind === "transactions") {
        const tout = parseTransactions(rows);
        const tx = tout.filter((t) => !txEnCours(t, today));
        txEcartees += tout.length - tx.length;
        n = tx.length; period = periodOf(tx.map((t) => t.jour));
        for (const t of tx) {
          const d = jourDe(t.jour);
          d.transactions += 1; d.ids.add(t.yango_driver_id);
          if (BRUT.has(t.category)) d.brut += t.amount;
          const h = t.occurred_at.slice(11, 16);
          if (!d.derniereTransaction || h > d.derniereTransaction) d.derniereTransaction = h;
        }
      } else if (kind === "orders") {
        const tout = parseOrders(rows);
        const od = tout.filter((o) => !commandeEnCours(o, today));
        commandesEcartees += tout.length - od.length;
        n = od.length; period = periodOf(od.map((o) => o.jour));
        for (const o of od) {
          if (commandeApresMinuit(o, today)) apresMinuit += 1;
          else if (o.jour) jourDe(o.jour).commandes += 1;
        }
      } else if (kind === "soldes") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(f.soldesJour ?? "")) {
          const so = parseSoldes(rows, f.soldesJour!);
          n = so.length; period = { from: f.soldesJour!, to: f.soldesJour! };
          jourDe(f.soldesJour!).soldes += so.length;
        } else {
          alertes.push({ niveau: "bloquant", texte: `${f.name} : préciser la date du solde.` });
        }
      } else {
        alertes.push({ niveau: "bloquant", texte: `${f.name} : export Fleetroom non reconnu.` });
      }
    } catch {
      alertes.push({ niveau: "bloquant", texte: `${f.name} : fichier illisible (colonnes inattendues).` });
    }
    fichiers.push({ name: f.name, kind, rows: n, period });
  }

  const liste = Array.from(jours.values()).sort((a, b) => a.jour.localeCompare(b.jour))
    .map(({ ids, ...d }) => ({ ...d, chauffeurs: ids.size, brut: Math.round(d.brut) }));
  const avecTx = liste.filter((d) => d.transactions > 0);
  const kinds = new Set(fichiers.map((f) => f.kind));

  // journée en cours : ses lignes sont mises de côté ; seul un solde daté d'aujourd'hui arrive jusqu'ici
  for (const d of liste.filter((x) => x.jour >= today)) {
    alertes.push({ niveau: "bloquant", texte: `Le ${fr(d.jour)} n'est pas terminé : un solde pris en cours de journée est faux. Refaites l'export Soldes le lendemain, ou corrigez sa date.` });
  }
  const s = (k: number) => (k > 1 ? "s" : "");
  if ((txEcartees || commandesEcartees) && liste.length === 0) {
    alertes.push({ niveau: "bloquant", texte: `Le ${fr(today)} n'est pas terminé : un export pris en cours de journée donne des déclarations et des soldes faux. Refaites l'export le lendemain.` });
  } else if (txEcartees || commandesEcartees) {
    const quoi = [txEcartees && `${txEcartees} transaction${s(txEcartees)}`, commandesEcartees && `${commandesEcartees} commande${s(commandesEcartees)}`].filter(Boolean).join(" et ");
    alertes.push({ niveau: "attention", texte: `${quoi} du ${fr(today)} (journée en cours) laissée${s(txEcartees + commandesEcartees)} de côté : rien n'est intégré pour ce jour, tout reviendra avec l'export de demain.` });
  }
  if (apresMinuit) {
    alertes.push({ niveau: "attention", texte: `${apresMinuit} course${s(apresMinuit)} partie${s(apresMinuit)} avant minuit et terminée${s(apresMinuit)} le ${fr(today)} : enregistrée${s(apresMinuit)}, comptée${s(apresMinuit)} dans la journée du ${fr(today)} une fois l'export de demain déposé.` });
  }
  if (!kinds.has("transactions") && fichiers.some((f) => f.kind)) {
    alertes.push({ niveau: "attention", texte: "Aucun export Transactions : sans lui, aucune déclaration n'est calculée pour ces jours." });
  }
  const dernier = avecTx[avecTx.length - 1];
  if (dernier && dernier.jour < today && dernier.derniereTransaction && dernier.derniereTransaction < HEURE_FIN_PLAUSIBLE) {
    alertes.push({ niveau: "attention", texte: `Dernière transaction du ${fr(dernier.jour)} à ${dernier.derniereTransaction} : vérifiez que l'export couvre bien toute la journée.` });
  }
  // jours sans aucune transaction au milieu de la période
  if (avecTx.length >= 2) {
    const trous: string[] = [];
    for (let t = Date.parse(avecTx[0].jour) + 86_400_000; t < Date.parse(dernier.jour); t += 86_400_000) {
      const j = new Date(t).toISOString().slice(0, 10);
      if (!jours.get(j)?.transactions) trous.push(fr(j));
    }
    if (trous.length) alertes.push({ niveau: "attention", texte: `Aucune transaction le ${trous.slice(0, 8).join(", ")}${trous.length > 8 ? `… (${trous.length} jours)` : ""} : jour sans activité, ou export incomplet ?` });
  }
  const sansCommandes = avecTx.filter((d) => d.commandes === 0);
  if (sansCommandes.length) {
    alertes.push({ niveau: "attention", texte: `Pas de commandes pour ${sansCommandes.length === avecTx.length ? "ces jours" : `le ${sansCommandes.slice(0, 8).map((d) => fr(d.jour)).join(", ")}`} : kilomètres, heures et refus resteront vides.` });
  }
  if (avecTx.length && !kinds.has("soldes")) {
    alertes.push({ niveau: "attention", texte: "Pas d'export Soldes : les soldes seront reconstitués depuis le dernier solde connu, sans contrôle." });
  }
  const jourSoldes = liste.filter((d) => d.soldes > 0).map((d) => d.jour).pop();
  if (jourSoldes && dernier && jourSoldes !== dernier.jour) {
    alertes.push({ niveau: "attention", texte: `Les soldes sont datés du ${fr(jourSoldes)} alors que les transactions s'arrêtent le ${fr(dernier.jour)} : vérifiez la date.` });
  }

  const ordre = { bloquant: 0, attention: 1 };
  return { fichiers, jours: liste, alertes: alertes.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]), chauffeursInconnus: [] };
}

/**
 * Aperçu complet : fichiers + ce que la base connaît déjà (fichier déjà déposé,
 * jours déjà chargés, chauffeurs absents de l'app). Lecture seule.
 */
export async function analyserDepot(sb: SupabaseClient, tenantId: string, files: FleetroomFile[], today: string): Promise<Apercu> {
  const a = apercuFichiers(files, today);
  const db = sb.schema("fleet");

  for (let i = 0; i < files.length; i++) {
    if (!a.fichiers[i].kind) continue;
    // même empreinte que ingestFleetroom
    const sha = createHash("sha256").update(files[i].text).update(files[i].soldesJour ?? "").digest("hex");
    const { data } = await db.from("fleetroom_imports").select("created_at").eq("tenant_id", tenantId).eq("file_sha256", sha).maybeSingle();
    a.fichiers[i].dejaDepose = data?.created_at ? String(data.created_at).slice(0, 10) : null;
    if (data) a.alertes.push({ niveau: "attention", texte: `${files[i].name} a déjà été déposé le ${fr(String(data.created_at).slice(0, 10))} : il sera ignoré.` });
  }

  // jours déjà chargés (dépôt d'une journée ou de quelques semaines : au plus 62 jours interrogés)
  const cibles = a.jours.filter((d) => d.transactions > 0).slice(-62);
  await Promise.all(cibles.map(async (d) => {
    const { count } = await db.from("yango_transactions").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("jour", d.jour);
    d.dejaEnBase = count ?? 0;
  }));
  const connus = cibles.filter((d) => (d.dejaEnBase ?? 0) > 0);
  if (connus.length) {
    a.alertes.push({ niveau: "attention", texte: `${connus.length} jour${connus.length > 1 ? "s" : ""} déjà en base (${connus.slice(0, 6).map((d) => `${fr(d.jour)} : ${d.dejaEnBase} lignes, ${d.transactions} dans le fichier`).join(" ; ")}) : les lignes connues sont ignorées, les déclarations de ces jours seront recalculées.` });
  }

  // chauffeurs des fichiers absents de l'app (même rattachement que l'intégration : identifiant Yango, sinon nom exact)
  const chauffeurs = new Map<string, string>();
  for (const f of files) {
    const rows = splitCsv(f.text);
    const kind = rows.length ? detectKind(rows[0]) : null;
    try {
      if (kind === "transactions") parseTransactions(rows).forEach((t) => chauffeurs.set(t.yango_driver_id, t.driver_name));
      if (kind === "orders") parseOrders(rows).forEach((o) => o.yango_driver_id && o.driver_name && !chauffeurs.has(o.yango_driver_id) && chauffeurs.set(o.yango_driver_id, o.driver_name));
    } catch { /* déjà signalé par apercuFichiers */ }
  }
  if (chauffeurs.size) {
    const { data: profiles } = await db.from("profiles").select("full_name, yango_driver_id").eq("tenant_id", tenantId).eq("role", "driver");
    const ids = new Set((profiles ?? []).map((p) => p.yango_driver_id).filter(Boolean));
    const noms = new Set((profiles ?? []).filter((p) => !p.yango_driver_id).map((p) => String(p.full_name ?? "").trim().toLowerCase()));
    for (const [yid, nom] of chauffeurs) if (!ids.has(yid) && !noms.has(nom.trim().toLowerCase())) a.chauffeursInconnus.push(nom);
    if (a.chauffeursInconnus.length) {
      a.alertes.push({ niveau: "attention", texte: `Chauffeur${a.chauffeursInconnus.length > 1 ? "s" : ""} absent${a.chauffeursInconnus.length > 1 ? "s" : ""} de l'app : ${a.chauffeursInconnus.join(", ")}. Aucune déclaration ne sera créée pour ${a.chauffeursInconnus.length > 1 ? "eux" : "lui"}.` });
    }
  }
  return a;
}
