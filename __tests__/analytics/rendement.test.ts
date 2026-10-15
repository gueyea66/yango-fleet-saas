import {
  calculerRendement, codeZone, apprendreZones, kmSurTrace, type OrderRow, type Trace,
} from "@/lib/analytics/rendement";

let n = 0;
/** Une course terminée : tarif = 300 + 200 × km + 20 × minutes, sauf mention contraire. */
function course(debut: string, minutes: number, km: number, extra: Partial<OrderRow> = {}): OrderRow {
  const t0 = Date.parse(debut);
  return {
    order_id: `o${++n}`, status: "Terminé", cancel_reason: null,
    yango_driver_id: "d1", driver_name: "Awa Ndiaye", plate: "AA194SJ",
    started_at: new Date(t0).toISOString(), ended_at: new Date(t0 + minutes * 60000).toISOString(),
    address_from: "Rue GY-39, Grand Yoff, Parcelles, Département de Dakar", address_to: "Dakar, Rue ME-12, 4",
    service_class: "Éco", distance_m: km * 1000, tarif: 300 + 200 * km + 20 * minutes, commission: -50,
    ...extra,
  };
}

/** Enchaîne des courses de 14 à 20 min, une toutes les 25 min, à partir de `debut`. */
function serie(debut: string, combien: number, extra: Partial<OrderRow> = {}): OrderRow[] {
  const t0 = Date.parse(debut);
  return Array.from({ length: combien }, (_, i) =>
    course(new Date(t0 + i * 25 * 60000).toISOString(), 14 + (i % 4) * 2, 4 + (i % 5), extra));
}

describe("zones", () => {
  it("lit le code de rue et apprend la commune sur les adresses", () => {
    expect(codeZone("Département de Dakar, Rue GY-39, 279")).toBe("GY");
    expect(codeZone("Ouest Foire")).toBeNull();
    const noms = apprendreZones([
      "Rue GY-39, Grand Yoff, Parcelles, Département de Dakar", "Rue GY-2, Grand Yoff, Parcelles, Département de Dakar",
      "Rue GY-7, Yoff, Almadies, Département de Dakar", "Dakar, Rue ME-12, 4",
    ]);
    expect(noms.get("GY")).toBe("Grand Yoff");
    expect(noms.has("ME")).toBe(false);
  });
});

describe("kmSurTrace", () => {
  const t0 = Date.parse("2026-10-13T10:00:00Z");
  // un point toutes les 30 s, environ 111 m vers le nord à chaque pas (≈ 13 km/h)
  const roule: Trace = Array.from({ length: 121 }, (_, i) => ({ t: t0 + i * 30000, lat: 14.7 + i * 0.001, lon: -17.45 }));
  it("additionne les segments roulés", () => {
    expect(kmSurTrace(roule, t0, t0 + 3600000)).toBeCloseTo(13.3, 0);
  });
  it("ignore la dérive à l'arrêt et les sauts aberrants", () => {
    const arret: Trace = Array.from({ length: 121 }, (_, i) => ({ t: t0 + i * 30000, lat: 14.7 + (i % 2) * 0.00005, lon: -17.45 }));
    expect(kmSurTrace(arret, t0, t0 + 3600000)).toBe(0);
    const saut = [...roule]; saut[60] = { ...saut[60], lat: 15.2 };
    expect(kmSurTrace(saut, t0, t0 + 3600000)!).toBeLessThan(14);
  });
  it("ne conclut rien quand la trace ne couvre pas l'intervalle", () => {
    expect(kmSurTrace(roule.slice(0, 20), t0, t0 + 3600000)).toBeNull();
    expect(kmSurTrace(undefined, t0, t0 + 3600000)).toBeNull();
  });
});

describe("calculerRendement", () => {
  // 30 lundis : une série le matin (8 h → ~11 h 15), un silence, une série l'après-midi (14 h → ~17 h 15)
  const lundis = Array.from({ length: 30 }, (_, s) => new Date(Date.UTC(2026, 2, 2 + 7 * s)).toISOString().slice(0, 10));
  const orders = lundis.flatMap((j) => [...serie(`${j}T08:00:00Z`, 8), ...serie(`${j}T14:00:00Z`, 8)]);

  it("retrouve le modèle de tarif", () => {
    const r = calculerRendement(orders);
    expect(r.modeleTarif!.parKm).toBeCloseTo(200, 0);
    expect(r.modeleTarif!.base).toBeCloseTo(300, -1);
    expect(r.modeleTarif!.r2).toBeGreaterThan(0.99);
  });

  it("range l'activité dans la grille jour × heure, en heure de Dakar (UTC)", () => {
    const r = calculerRendement(orders);
    const lundi9 = r.grille.find((c) => c.js === 0 && c.h === 9)!;
    expect(lundi9.heures).toBeCloseTo(30, 0);
    expect(lundi9.fiable).toBe(true);
    expect(r.grille.find((c) => c.js === 3 && c.h === 9)!.heures).toBe(0);
    expect(r.periode.courses).toBe(480);
  });

  it("déduit une coupure du silence entre deux sessions, avec sa vraisemblance", () => {
    const r = calculerRendement(orders);
    expect(r.coupuresResume.nombre).toBe(30);
    const c = r.coupures[0];
    expect(c.minutes).toBeGreaterThan(150);
    expect(c.probaAllumee).toBeLessThan(0.01);
    expect(c.nature).toBe("inconnue");
    expect(c.zoneApres).toBe("Grand Yoff");
  });

  it("qualifie la coupure avec le GPS : roulée ou simple pause", () => {
    const debut = Date.parse(`${lundis[29]}T11:15:00Z`);
    const roule: Trace = Array.from({ length: 330 }, (_, i) => ({ t: debut + i * 30000, lat: 14.7 + i * 0.001, lon: -17.45 }));
    const r = calculerRendement(orders, { traces: new Map([["AA194SJ", roule]]) });
    expect(r.coupuresResume.roulees).toBe(1);
    expect(r.coupures[0].nature).toBe("roule");
    expect(r.coupures[0].kmGps!).toBeGreaterThan(20);
    expect(r.coupures[0].valeurEstimee!).toBeGreaterThan(0);
    expect(r.constats[0].id).toBe("coupures-roulees");

    const pause: Trace = roule.map((p) => ({ ...p, lat: 14.7 }));
    expect(calculerRendement(orders, { traces: new Map([["AA194SJ", pause]]) }).coupures
      .find((c) => c.nature === "pause")).toBeDefined();
  });

  it("ne compte pas un refus comme une course, mais comme une preuve de vie de l'application", () => {
    const refus = lundis.map((j) => course(`${j}T12:30:00Z`, 0, 0, {
      status: "Annulé", cancel_reason: "Le conducteur n'a pas accepté la demande de course", ended_at: null, tarif: null,
    }));
    const r = calculerRendement([...orders, ...refus]);
    expect(r.periode.courses).toBe(480);
    // le refus de 12 h 30 coupe le silence en deux : plus aucun trou de 60 min côté après-midi… mais un avant
    expect(r.coupuresResume.nombre).toBe(60);
    expect(r.chauffeurs[0].acceptation).toBeCloseTo(480 / 510, 2);
  });

  it("sépare l'effet des horaires de la manière de travailler", () => {
    // d2 ne travaille que l'après-midi, au même tarif : son écart tient aux horaires, pas à lui
    const autre = lundis.flatMap((j) => serie(`${j}T14:00:00Z`, 8, { yango_driver_id: "d2", driver_name: "Ibra Fall" }));
    const r = calculerRendement([...orders, ...autre]);
    expect(r.chauffeurs).toHaveLength(2);
    for (const c of r.chauffeurs) expect(c.profil.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
    for (const c of r.chauffeurs) expect(c.xofH - r.periode.xofH! - c.effetHoraires - c.effetPropre).toBeCloseTo(0, 5);
  });

  it("donne à chaque chauffeur sa semaine type, ses zones et des propositions", () => {
    const r = calculerRendement(orders);
    const c = r.chauffeurs[0];
    expect(c.semaine).toHaveLength(168);
    // 30 lundis sur ~29 semaines : un peu plus de 6 h d'activité par semaine
    expect(c.semaine.reduce((s, v) => s + v, 0)).toBeGreaterThan(5);
    expect(c.semaine[9]).toBeGreaterThan(0.9);       // lundi 9 h
    expect(c.semaine[24 + 9]).toBe(0);              // mardi 9 h
    expect(c.zones[0]).toMatchObject({ zone: "Grand Yoff", part: 1 });
    expect(r.zonesTranches.some((z) => z.zone === "Grand Yoff")).toBe(true);
    expect(Array.isArray(c.conseils)).toBe(true);
  });

  it("reste muet sur trop peu de données", () => {
    const r = calculerRendement(serie("2026-03-02T08:00:00Z", 6));
    expect(r.constats).toEqual([]);
    expect(r.modeleTarif).toBeNull();
    expect(calculerRendement([]).periode.courses).toBe(0);
  });
});
