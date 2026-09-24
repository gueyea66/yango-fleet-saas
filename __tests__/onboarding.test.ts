import {
  mapRemunerationModel, numFromField, plateKey, slugify, texteRelance, ficheVide, etat,
  LISTE_CLIENT,
} from "@/lib/onboarding-model";
import { provisionOnboarding, makePassword, nextDriverId, type AdminDb } from "@/lib/onboarding";
import type { OnbDoc } from "@/lib/onboarding-model";

/* ────────────────────────────────────────────────────────────
   Faux client Supabase : juste ce que provisionOnboarding appelle.
   Il garde les lignes en mémoire, ce qui permet de rejouer la mise
   en service et de vérifier qu'elle ne duplique rien.
   ──────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

function fauxAdmin(depart: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    tenants: [], tenant_settings: [], remuneration_config: [], profiles: [], vehicles: [],
    ...depart,
  };
  const comptes: { id: string; email: string; password: string }[] = [];
  let seq = 0;
  const uid = () => `id-${++seq}`;

  function query(table: string) {
    const filtres: [string, unknown][] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let charge: Row | Row[] = {};

    const filtrer = () => tables[table].filter((r) => filtres.every(([k, v]) => r[k] === v));

    const api: Record<string, unknown> = {
      select() { return api; },
      eq(k: string, v: unknown) { filtres.push([k, v]); return api; },
      insert(p: Row | Row[]) { mode = "insert"; charge = p; return api; },
      upsert(p: Row, opts?: { onConflict?: string }) {
        const cle = opts?.onConflict || "id";
        const idx = tables[table].findIndex((r) => r[cle] === p[cle]);
        if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...p };
        else tables[table].push({ ...p });
        mode = "select";
        charge = p;
        return api;
      },
      update(p: Row) { mode = "update"; charge = p; return api; },
      delete() { mode = "delete"; return api; },
      order() { return api; },
      maybeSingle() { return Promise.resolve({ data: filtrer()[0] ?? null, error: null }); },
      single() {
        if (mode === "insert") {
          const ligne = { id: uid(), ...(charge as Row) };
          tables[table].push(ligne);
          return Promise.resolve({ data: ligne, error: null });
        }
        const d = filtrer()[0];
        return Promise.resolve({ data: d ?? null, error: d ? null : { message: "introuvable" } });
      },
      then(resoudre: (v: { data: Row[] | null; error: null }) => unknown) {
        if (mode === "insert") {
          const lignes = Array.isArray(charge) ? charge : [charge];
          lignes.forEach((l) => tables[table].push({ id: uid(), ...l }));
        } else if (mode === "update") {
          filtrer().forEach((r) => Object.assign(r, charge));
        } else if (mode === "delete") {
          const cibles = new Set(filtrer());
          tables[table] = tables[table].filter((r) => !cibles.has(r));
        }
        return Promise.resolve(resoudre({ data: mode === "select" ? filtrer() : null, error: null }));
      },
    };
    return api;
  }

  const admin = {
    from: (t: string) => query(t),
    auth: {
      admin: {
        createUser({ email, password }: { email: string; password: string }) {
          if (comptes.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
            return Promise.resolve({ data: { user: null }, error: { message: "User already registered" } });
          }
          const user = { id: uid(), email, password };
          comptes.push(user);
          return Promise.resolve({ data: { user }, error: null });
        },
        listUsers() { return Promise.resolve({ data: { users: comptes }, error: null }); },
        deleteUser(id: string) {
          const i = comptes.findIndex((c) => c.id === id);
          if (i >= 0) comptes.splice(i, 1);
          return Promise.resolve({ error: null });
        },
      },
    },
  };

  return { admin: admin as unknown as AdminDb, tables, comptes };
}

function ficheNMK(): OnbDoc {
  return {
    ...ficheVide("NMK Transports"),
    gestionnaire: "Daniel",
    gestionnaireEmail: "daniel@nmk.sn",
    regle: { ...ficheVide("x").regle, mode: "Loyer journalier", versement: "15000" },
    vehicules: [
      { id: "v1", plaque: "DK-1234-AA", modele: "Toyota Hilux", annee: "2021", proprio: "NMK", service: "2024-01-10" },
      { id: "v2", plaque: "DK-5678-BB", modele: "Hyundai", annee: "", proprio: "", service: "" },
    ],
    chauffeurs: [
      { id: "c1", nom: "Thierno Sow", tel: "770000001", permis: "P1", vehicule: "DK-1234-AA", entree: "2024-02-01", kyc: "Complet" },
      { id: "c2", nom: "Abdon Ngom", tel: "770000002", permis: "P2", vehicule: "DK-5678-BB", entree: "", kyc: "Partiel" },
    ],
  };
}

/* ── Le modèle ──────────────────────────────────────────────── */

describe("modèle de fiche", () => {
  it("normalise les plaques quelle que soit la frappe", () => {
    expect(plateKey("DK-1234-AA")).toBe("DK1234AA");
    expect(plateKey("dk 1234 aa")).toBe("DK1234AA");
    expect(plateKey("DK1234AA")).toBe("DK1234AA");
    expect(plateKey("")).toBe("");
  });

  it("traduit la règle de versement en modèle de rémunération", () => {
    expect(mapRemunerationModel("Loyer journalier")).toBe("location");
    expect(mapRemunerationModel("Commission sur le brut")).toBe("percent");
    expect(mapRemunerationModel("Fixe et prime")).toBe("hybrid");
    expect(mapRemunerationModel("Paliers de chiffre d'affaires")).toBe("tiered");
    expect(mapRemunerationModel("n'importe quoi")).toBe("location");
  });

  it("lit un montant saisi librement", () => {
    expect(numFromField("15 000 F")).toBe(15000);
    expect(numFromField("12,5")).toBe(12.5);
    expect(numFromField("")).toBe(0);
    expect(numFromField(4200)).toBe(4200);
  });

  it("fabrique un slug utilisable comme sous-domaine", () => {
    expect(slugify("NMK Transports")).toBe("nmk-transports");
    expect(slugify("Société Générale & Fils")).toBe("societe-generale-fils");
    expect(slugify("  ")).toBe("");
  });

  it("construit la relance sur ce qui manque encore", () => {
    const doc = ficheVide("NMK");
    doc.contact = "Nicolas";
    LISTE_CLIENT.forEach((x) => { doc.a[x.id] = { s: 2, n: "" }; });
    expect(texteRelance(doc)).toBe("Tous les éléments sont reçus.");

    doc.a["A3"] = { s: 1, n: "" };
    const texte = texteRelance(doc);
    expect(texte).toContain("Bonjour Nicolas");
    expect(texte).toContain("Liste des véhicules");
    expect(texte).toContain("Abdoulaye");
  });

  it("donne un état par défaut aux points jamais touchés", () => {
    expect(etat(ficheVide("x"), "a", "A1")).toEqual({ s: 0, n: "" });
    expect(etat(null, "b", "B1")).toEqual({ s: 0, n: "" });
  });
});

describe("identifiants", () => {
  it("génère un mot de passe sans caractère ambigu, assez long", () => {
    for (let i = 0; i < 50; i++) {
      const mdp = makePassword();
      expect(mdp).toHaveLength(10);
      expect(mdp).not.toMatch(/[O0Il1]/);
    }
  });

  it("prend le premier identifiant libre de la série", () => {
    expect(nextDriverId(new Set())).toBe("D01");
    expect(nextDriverId(new Set(["D01", "D02"]))).toBe("D03");
    expect(nextDriverId(new Set(["D02"]))).toBe("D01");
  });
});

/* ── La mise en service ─────────────────────────────────────── */

describe("mise en service", () => {
  it("crée l'espace, la règle, les comptes et le parc en une passe", async () => {
    const { admin, tables } = fauxAdmin();
    const r = await provisionOnboarding({ admin, fileId: "nmk-transports", doc: ficheNMK(), tenantId: null });

    expect(r.ok).toBe(true);
    expect(tables.tenants).toHaveLength(1);
    expect(tables.tenants[0].slug).toBe("nmk-transports");
    expect(tables.tenant_settings).toHaveLength(1);

    expect(tables.remuneration_config).toHaveLength(1);
    expect(tables.remuneration_config[0].model).toBe("location");
    expect(tables.remuneration_config[0].base_amount).toBe(15000);

    // un gestionnaire + deux chauffeurs
    expect(tables.profiles.filter((p) => p.role === "admin")).toHaveLength(1);
    expect(tables.profiles.filter((p) => p.role === "driver")).toHaveLength(2);
    expect(tables.vehicles).toHaveLength(2);

    // marque et modèle séparés, plaque en majuscules
    const hilux = tables.vehicles.find((v) => v.plate === "DK-1234-AA")!;
    expect(hilux.make).toBe("Toyota");
    expect(hilux.model).toBe("Hilux");
    expect(hilux.year).toBe(2021);

    // le véhicule est attribué au chauffeur qui le conduit
    const sow = tables.profiles.find((p) => p.full_name === "Thierno Sow")!;
    expect(hilux.driver_id).toBe(sow.id);

    // les identifiants ne sortent qu'ici
    expect(r.identifiants).toHaveLength(2);
    expect(r.adminIdentifiants?.email).toBe("daniel@nmk.sn");
    expect(r.doc.chauffeurs[0].driverId).toBe("D01");
    expect(r.doc.chauffeurs[1].driverId).toBe("D02");
  });

  it("rejouée, ne duplique rien et ne change aucun mot de passe", async () => {
    const { admin, tables, comptes } = fauxAdmin();
    const premier = await provisionOnboarding({ admin, fileId: "nmk-transports", doc: ficheNMK(), tenantId: null });
    const tenantId = premier.tenantId;
    const mdpAvant = comptes.map((c) => c.password);

    const second = await provisionOnboarding({ admin, fileId: "nmk-transports", doc: premier.doc, tenantId });

    expect(second.ok).toBe(true);
    expect(tables.tenants).toHaveLength(1);
    expect(tables.profiles).toHaveLength(3);
    expect(tables.vehicles).toHaveLength(2);
    expect(tables.remuneration_config).toHaveLength(1);
    expect(second.identifiants).toHaveLength(0);       // rien de neuf à remettre
    expect(comptes.map((c) => c.password)).toEqual(mdpAvant);
  });

  it("ajoute seulement la ligne nouvelle quand la fiche grandit", async () => {
    const { admin, tables } = fauxAdmin();
    const premier = await provisionOnboarding({ admin, fileId: "nmk", doc: ficheNMK(), tenantId: null });

    const grandie = structuredClone(premier.doc);
    grandie.vehicules.push({ id: "v3", plaque: "dk 9999 cc", modele: "Kia K3", annee: "2022", proprio: "", service: "" });
    grandie.chauffeurs.push({ id: "c3", nom: "Ahmada Ba", tel: "770000003", permis: "P3", vehicule: "dk 9999 cc", entree: "", kyc: "Partiel" });

    const second = await provisionOnboarding({ admin, fileId: "nmk", doc: grandie, tenantId: premier.tenantId });

    expect(tables.vehicles).toHaveLength(3);
    expect(tables.profiles.filter((p) => p.role === "driver")).toHaveLength(3);
    expect(second.identifiants).toHaveLength(1);
    expect(second.identifiants[0].nom).toBe("Ahmada Ba");
    expect(second.doc.chauffeurs[2].driverId).toBe("D03");
  });

  it("ne crée pas de doublon quand la plaque est retapée autrement", async () => {
    const { admin, tables } = fauxAdmin();
    const premier = await provisionOnboarding({ admin, fileId: "nmk", doc: ficheNMK(), tenantId: null });

    const retapee = structuredClone(premier.doc);
    retapee.vehicules[0].plaque = "dk1234aa";
    retapee.vehicules[0].proprio = "NMK Holding";
    await provisionOnboarding({ admin, fileId: "nmk", doc: retapee, tenantId: premier.tenantId });

    expect(tables.vehicles).toHaveLength(2);
    expect(tables.vehicles.find((v) => plateKey(String(v.plate)) === "DK1234AA")!.notes)
      .toBe("Propriétaire : NMK Holding");
  });

  it("reprend un espace existant portant déjà le slug", async () => {
    const { admin, tables } = fauxAdmin({ tenants: [{ id: "t-existant", slug: "nmk-transports", name: "NMK" }] });
    const r = await provisionOnboarding({ admin, fileId: "nmk-transports", doc: ficheNMK(), tenantId: null });

    expect(r.tenantId).toBe("t-existant");
    expect(tables.tenants).toHaveLength(1);
    expect(r.lignes[0].etat).toBe("inchange");
  });

  it("convertit le taux de commission, sans le confondre avec le versement", async () => {
    const { admin, tables } = fauxAdmin();
    const doc = ficheNMK();
    doc.regle.mode = "Commission sur le brut";
    doc.regle.versement = "40000";   // montant brut attendu par jour
    doc.regle.commission = "12";     // le taux, lui, est à part
    await provisionOnboarding({ admin, fileId: "nmk", doc, tenantId: null });

    expect(tables.remuneration_config[0].model).toBe("percent");
    expect(tables.remuneration_config[0].commission_rate).toBe(0.12);
    expect(tables.remuneration_config[0].base_amount).toBe(40000);
  });

  it("ne laisse jamais une commission dépasser 100 %", async () => {
    const { admin, tables } = fauxAdmin();
    const doc = ficheNMK();
    doc.regle.mode = "Commission sur le brut";
    doc.regle.commission = "40000";  // saisie erronée : un montant dans la case taux
    await provisionOnboarding({ admin, fileId: "nmk", doc, tenantId: null });

    expect(tables.remuneration_config[0].commission_rate).toBe(1);
  });

  it("prend un taux déjà écrit en ratio tel quel", async () => {
    const { admin, tables } = fauxAdmin();
    const doc = ficheNMK();
    doc.regle.mode = "Commission sur le brut";
    doc.regle.commission = "0,15";
    await provisionOnboarding({ admin, fileId: "nmk", doc, tenantId: null });

    expect(tables.remuneration_config[0].commission_rate).toBe(0.15);
  });

  it("refuse une fiche sans raison sociale", async () => {
    const { admin } = fauxAdmin();
    const doc = { ...ficheNMK(), nom: "  " };
    await expect(provisionOnboarding({ admin, fileId: "nmk", doc, tenantId: null }))
      .rejects.toThrow(/raison sociale/);
  });

  it("ignore les lignes vides de la fiche", async () => {
    const { admin, tables } = fauxAdmin();
    const doc = ficheNMK();
    doc.vehicules.push({ id: "v9", plaque: "   ", modele: "", annee: "", proprio: "", service: "" });
    doc.chauffeurs.push({ id: "c9", nom: "", tel: "", permis: "", vehicule: "", entree: "", kyc: "" });
    await provisionOnboarding({ admin, fileId: "nmk", doc, tenantId: null });

    expect(tables.vehicles).toHaveLength(2);
    expect(tables.profiles.filter((p) => p.role === "driver")).toHaveLength(2);
  });
});
