/**
 * Parseurs des exports Fleetroom (Yango Pro, parc partenaire).
 *
 * Trois exports, reconnus à leur en-tête (l'ordre des colonnes peut bouger) :
 *  - « transactions »  : 1 ligne = 1 mouvement du solde chauffeur
 *  - « commandes »     : 1 ligne = 1 commande (terminée, annulée…)
 *  - « soldes »        : 1 ligne = 1 chauffeur, solde début / fin d'UNE journée
 *                        (la date n'est pas dans le fichier : elle est saisie)
 *
 * Pièges connus des exports :
 *  - séparateur « ; », décimales à virgule, BOM UTF-8, fin de ligne CRLF ;
 *  - plaques en caractères CYRILLIQUES (АА195SJ) → normalizePlate ;
 *  - « Distance parcourue (en km) » est en MÈTRES ;
 *  - l'export commandes a deux colonnes « Conducteur » (id puis nom) et deux
 *    « Véhicule » (id puis libellé).
 */

export type FleetroomKind = "transactions" | "orders" | "soldes";

export interface YangoTransaction {
  occurred_at: string; // ISO, heure de Dakar = UTC
  jour: string; // YYYY-MM-DD
  yango_driver_id: string;
  driver_name: string;
  category: string;
  category_label: string;
  amount: number;
  order_id: string | null;
  initiated_by: string | null;
  comment: string | null;
}

export interface YangoOrder {
  order_id: string;
  order_code: string | null;
  status: string;
  cancel_reason: string | null;
  yango_driver_id: string | null;
  driver_name: string | null;
  yango_vehicle_id: string | null;
  vehicle_label: string | null;
  plate: string | null;
  started_at: string | null;
  ended_at: string | null;
  jour: string | null;
  address_from: string | null;
  address_to: string | null;
  service_class: string | null;
  distance_m: number | null;
  tarif: number | null;
  cash: number | null;
  cashless: number | null;
  promo: number | null;
  bonus: number | null;
  commission: number | null;
  booking_fee: number | null;
  partner_fee: number | null;
}

export interface YangoBalance {
  driver_name: string;
  plate_or_code: string | null;
  jour: string;
  solde_debut: number | null;
  solde_fin: number;
}

const CYRILLIC: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
};

/** « Suzuki S-Presso АА195SJ » ou « AB-872-JG » → « AA195SJ » / « AB872JG ». */
export function normalizePlate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const last = raw.trim().split(/\s+/).pop() ?? "";
  const p = last.replace(/[АВЕКМНОРСТХУ]/g, (c) => CYRILLIC[c]).replace(/-/g, "").toUpperCase();
  return p || null;
}

/** « -127,1 » → -127.1 ; vide → null. */
export function num(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** « 29.09.2026 23:49:54 » → ISO UTC + jour. */
export function parseDate(s: string | undefined): { iso: string; jour: string } | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const [, d, mo, y, h, mi, se] = m;
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${se}Z`, jour: `${y}-${mo}-${d}` };
}

/** CSV « ; » sans dépendance. Gère BOM, CRLF et guillemets éventuels. */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

export function detectKind(header: string[]): FleetroomKind | null {
  const h = header.map((x) => x.trim());
  if (h.includes("Identifiant de la catégorie")) return "transactions";
  if (h.includes("Code de la commande") && h.includes("Statut")) return "orders";
  if (h.includes("Solde à la fin de la journée")) return "soldes";
  return null;
}

function col(header: string[], name: string, required = true): number {
  const i = header.findIndex((x) => x.trim() === name);
  if (i < 0 && required) throw new Error(`Colonne « ${name} » introuvable dans l'export`);
  return i;
}

const orNull = (s: string | undefined) => (s && s.trim() !== "" ? s.trim() : null);

export function parseTransactions(rows: string[][]): YangoTransaction[] {
  const [h, ...data] = rows;
  const iDate = col(h, "Date"), iDrvId = col(h, "Identifiant du conducteur"), iDrv = col(h, "Conducteur");
  const iCat = col(h, "Identifiant de la catégorie"), iLbl = col(h, "Catégorie"), iAmt = col(h, "Montant");
  const iDoc = col(h, "Document"), iBy = col(h, "Initié par"), iCom = col(h, "Commentaire");
  const out: YangoTransaction[] = [];
  for (const r of data) {
    const d = parseDate(r[iDate]);
    const amount = num(r[iAmt]);
    if (!d || amount === null || !r[iDrvId]) continue;
    out.push({
      occurred_at: d.iso,
      jour: d.jour,
      yango_driver_id: r[iDrvId].trim(),
      driver_name: r[iDrv].trim(),
      category: r[iCat].trim(),
      category_label: r[iLbl]?.trim() ?? "",
      amount,
      order_id: /Order #(\w+)/.exec(r[iDoc] ?? "")?.[1] ?? null,
      initiated_by: orNull(r[iBy]),
      comment: orNull(r[iCom]),
    });
  }
  return out;
}

export function parseOrders(rows: string[][]): YangoOrder[] {
  const [h, ...data] = rows;
  const iDrv = col(h, "Conducteur"), iVeh = col(h, "Véhicule"); // id ; le libellé suit (i + 1)
  const c = (n: string) => col(h, n, false);
  const iId = col(h, "Identifiant"), iSt = col(h, "Statut"), iCode = c("Code de la commande");
  const iT0 = c("Date de prise en charge"), iT1 = c("Date de réalisation"), iWhy = c("Raison de l'annulation");
  const iAdr = c("Adresse"), iCls = c("Classe de service"), iDist = c("Distance parcourue (en km)");
  const iTarif = c("Tarif dans Yango Pro"), iCash = c("Espèces"), iCless = c("Paiement sans espèces");
  const iPromo = c("Compensation de la promotion"), iBonus = c("Bonus"), iComm = c("Commission du service");
  const iTax = c("Taxes et commissions"), iPart = c("Commission du partenaire");
  const at = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);
  return data
    .filter((r) => r[iId])
    .map((r) => {
      const t0 = parseDate(at(r, iT0)), t1 = parseDate(at(r, iT1));
      const [from, to] = (at(r, iAdr) ?? "").split(" -> ");
      return {
        order_id: r[iId].trim(),
        order_code: orNull(at(r, iCode)),
        status: r[iSt].trim(),
        cancel_reason: orNull(at(r, iWhy)),
        yango_driver_id: orNull(r[iDrv]),
        driver_name: orNull(r[iDrv + 1]),
        yango_vehicle_id: orNull(r[iVeh]),
        vehicle_label: orNull(r[iVeh + 1]),
        plate: normalizePlate(r[iVeh + 1]),
        started_at: t0?.iso ?? null,
        ended_at: t1?.iso ?? null,
        jour: t1?.jour ?? t0?.jour ?? null,
        address_from: orNull(from),
        address_to: orNull(to),
        service_class: orNull(at(r, iCls)),
        distance_m: num(at(r, iDist)),
        tarif: num(at(r, iTarif)),
        cash: num(at(r, iCash)),
        cashless: num(at(r, iCless)),
        promo: num(at(r, iPromo)),
        bonus: num(at(r, iBonus)),
        commission: num(at(r, iComm)),
        booking_fee: num(at(r, iTax)),
        partner_fee: num(at(r, iPart)),
      };
    });
}

/** L'export « soldes » ne porte pas sa date : elle est fournie par l'utilisateur. */
export function parseSoldes(rows: string[][], jour: string): YangoBalance[] {
  const [h, ...data] = rows;
  const iName = col(h, "Nom complet"), iCode = col(h, "Nom de code", false);
  const iDeb = col(h, "Solde à la date de début", false), iFin = col(h, "Solde à la fin de la journée");
  const out: YangoBalance[] = [];
  for (const r of data) {
    const fin = num(r[iFin]);
    if (!r[iName] || fin === null) continue;
    out.push({
      driver_name: r[iName].trim(),
      plate_or_code: iCode >= 0 ? orNull(r[iCode]) : null,
      jour,
      solde_debut: iDeb >= 0 ? num(r[iDeb]) : null,
      solde_fin: fin,
    });
  }
  return out;
}

export function periodOf(jours: (string | null)[]): { from: string | null; to: string | null } {
  const js = jours.filter((j): j is string => !!j).sort();
  return { from: js[0] ?? null, to: js[js.length - 1] ?? null };
}
