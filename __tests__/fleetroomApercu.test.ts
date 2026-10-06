import { apercuFichiers } from "@/lib/fleetroom/apercu";

const H = "Date;Identifiant du conducteur;Conducteur;Identifiant de la catégorie;Catégorie;Montant;Document;Initié par;Commentaire\r\n";
const tx = (date: string, heure: string, id = "a1", cat = "cash_collected", montant = "1000") =>
  `${date} ${heure};${id};Chauffeur ${id};${cat};Libellé;${montant};Order #x${heure.replace(/:/g, "")}${id};Plateforme;\r\n`;
const SOL = "Nom complet;Nom de code;Règle de travail;Statut;Solde à la date de début;Solde à la fin de la journée;Espèces reçues\r\n"
  + "Chauffeur a1;AB-872-JG;Flotte;Actif;100;200;300\r\n";
const fichier = (text: string, name = "park_transactions.csv") => ({ name, text });
const textes = (a: ReturnType<typeof apercuFichiers>) => a.alertes.map((x) => x.texte).join(" | ");

describe("aperçu d'un dépôt Fleetroom", () => {
  it("résume chaque jour : lignes, chauffeurs, brut espèces + carte, dernière transaction", () => {
    const a = apercuFichiers([fichier(H
      + tx("04.10.2026", "08:10:00") + tx("04.10.2026", "23:40:00", "b2", "card", "2500")
      + tx("04.10.2026", "23:41:00", "b2", "platform_ride_fee", "-300"))], "2026-10-06");
    expect(a.jours).toEqual([{ jour: "2026-10-04", transactions: 3, commandes: 0, chauffeurs: 2, soldes: 0, brut: 3500, derniereTransaction: "23:41" }]);
    expect(a.fichiers[0]).toMatchObject({ kind: "transactions", rows: 3, period: { from: "2026-10-04", to: "2026-10-04" } });
  });

  it("bloque une journée en cours : l'export ne peut pas être complet", () => {
    const a = apercuFichiers([fichier(H + tx("05.10.2026", "17:32:00"))], "2026-10-05");
    expect(a.alertes[0].niveau).toBe("bloquant");
    expect(a.alertes[0].texte).toContain("05/10 n'est pas terminé");
  });

  it("signale une journée passée qui s'arrête tôt, sans bloquer", () => {
    const a = apercuFichiers([fichier(H + tx("05.10.2026", "17:32:00"))], "2026-10-06");
    expect(a.alertes.some((x) => x.niveau === "bloquant")).toBe(false);
    expect(textes(a)).toContain("Dernière transaction du 05/10 à 17:32");
  });

  it("signale les trous, l'absence de commandes et de soldes", () => {
    const a = apercuFichiers([fichier(H + tx("02.10.2026", "23:00:00") + tx("04.10.2026", "23:00:00"))], "2026-10-06");
    expect(textes(a)).toContain("Aucune transaction le 03/10");
    expect(textes(a)).toContain("Pas de commandes");
    expect(textes(a)).toContain("Pas d'export Soldes");
  });

  it("soldes : date exigée, et comparée au dernier jour des transactions", () => {
    expect(apercuFichiers([{ name: "file.csv", text: SOL }], "2026-10-06").alertes[0]).toMatchObject({ niveau: "bloquant" });
    const a = apercuFichiers([fichier(H + tx("04.10.2026", "23:00:00")), { name: "file.csv", text: SOL, soldesJour: "2026-10-03" }], "2026-10-06");
    expect(textes(a)).toContain("soldes sont datés du 03/10 alors que les transactions s'arrêtent le 04/10");
    expect(textes(a)).not.toContain("Pas d'export Soldes");
  });

  it("fichier inconnu : bloquant", () => {
    expect(apercuFichiers([{ name: "x.csv", text: "a;b\r\n1;2\r\n" }], "2026-10-06").alertes[0]).toEqual({ niveau: "bloquant", texte: "x.csv : export Fleetroom non reconnu." });
  });
});
