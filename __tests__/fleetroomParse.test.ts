import {
  detectKind, normalizePlate, num, parseDate, parseOrders, parseSoldes, parseTransactions, splitCsv,
} from "@/lib/fleetroom/parse";

// Extraits réels des exports Fleetroom NMK (sept. 2026), BOM et CRLF compris.
const TX = "﻿Date;Identifiant du conducteur;Conducteur;Identifiant de la catégorie;Catégorie;Montant;Document;Initié par;Commentaire\r\n"
  + "29.09.2026 23:49:54;bebe073c;Ngom Emile Abdou;platform_ride_fee;Commission du service pour la commande;-127,1;Order #86da8445;Plateforme;Commission\r\n"
  + "29.09.2026 07:35:07;aa11;NGOUMA RAPHAEL;partner_service_manual;Rechargements manuels;20000;—;Dispatcher, Daniel TRAORE;\r\n";

const ORD = "﻿Identifiant;Statut;Code de la commande;Conducteur;Conducteur;Véhicule;Véhicule;Date de prise en charge;Date de réalisation;Raison de l'annulation;Adresse;Classe de service;Distance parcourue (en km);Tarif dans Yango Pro;Espèces;Paiement sans espèces;Paiements sur le compte du partenaire;Paiement d’entreprise;Pourboire;Compensation de la promotion;Bonus;Autres paiements du service;Commission du service;Autres paiements;Taxes et commissions;Paiements du service pour la course;Commission du partenaire\r\n"
  + "5e141805;Terminé;107403;d7c447f3;Seck Cheikh Oumar Foutiyou;e6a0fa53;Suzuki S-Presso АА195SJ;29.09.2026 23:18:56;29.09.2026 23:30:53;;Département de Dakar, Rue BIS-68, 1387 -> Rue KA-02, 379;Confort;3844;1100;1000;;;;;100;;;-150;;-100;;\r\n";

const SOL = "Nom complet;Nom de code;Règle de travail;Statut;Solde à la date de début;Solde à la fin de la journée;Espèces reçues\r\n"
  + "Ngom Abdon Boure;AB-872-JG;Flotte partenariat;Actif;10443,14;3351,94;36500\r\n";

describe("parseurs Fleetroom", () => {
  it("normalise les plaques cyrilliques et à tirets", () => {
    expect(normalizePlate("Suzuki S-Presso АА195SJ")).toBe("AA195SJ");
    expect(normalizePlate("Renault Clio АВ268FК")).toBe("AB268FK");
    expect(normalizePlate("AB-872-JG")).toBe("AB872JG");
  });

  it("lit nombres à virgule et dates Fleetroom", () => {
    expect(num("-22,878")).toBeCloseTo(-22.878);
    expect(num("")).toBeNull();
    expect(parseDate("29.09.2026 23:49:54")).toEqual({ iso: "2026-09-29T23:49:54Z", jour: "2026-09-29" });
  });

  it("reconnaît les trois exports", () => {
    expect(detectKind(splitCsv(TX)[0])).toBe("transactions");
    expect(detectKind(splitCsv(ORD)[0])).toBe("orders");
    expect(detectKind(splitCsv(SOL)[0])).toBe("soldes");
    expect(detectKind(["date", "chauffeur", "ca_brut"])).toBeNull();
  });

  it("parse les transactions (commande et recharge)", () => {
    const [fee, rech] = parseTransactions(splitCsv(TX));
    expect(fee).toMatchObject({ category: "platform_ride_fee", amount: -127.1, order_id: "86da8445", jour: "2026-09-29" });
    expect(rech).toMatchObject({ category: "partner_service_manual", amount: 20000, order_id: null,
      initiated_by: "Dispatcher, Daniel TRAORE", comment: null });
  });

  it("parse les commandes : distance en mètres, colonnes en double, adresses", () => {
    const [o] = parseOrders(splitCsv(ORD));
    expect(o).toMatchObject({
      order_id: "5e141805", status: "Terminé", yango_driver_id: "d7c447f3", driver_name: "Seck Cheikh Oumar Foutiyou",
      plate: "AA195SJ", distance_m: 3844, tarif: 1100, cash: 1000, promo: 100, commission: -150, booking_fee: -100,
      address_from: "Département de Dakar, Rue BIS-68, 1387", address_to: "Rue KA-02, 379", jour: "2026-09-29",
    });
  });

  it("parse les soldes avec la date fournie", () => {
    expect(parseSoldes(splitCsv(SOL), "2026-09-29")).toEqual([
      { driver_name: "Ngom Abdon Boure", plate_or_code: "AB-872-JG", jour: "2026-09-29", solde_debut: 10443.14, solde_fin: 3351.94 },
    ]);
  });
});
