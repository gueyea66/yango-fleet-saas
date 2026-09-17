import {
  parseRconf,
  buildInstallSms,
  normalizeDeviceId,
  isIpv4,
} from "@/lib/telematics/devices";

/** Réponse RCONF réelle du Kia K3, reçue le 17/09/2026 (numéro autorisé masqué). */
const RCONF_K3 =
  "ST-901-868L:V4.35,ID:9170258210,UP:0000,U1:000000000000,U2:,U3:,MODE:GPRS," +
  "POWER ALARM:ON,OVERSPEED:80,VOICE:OFF,SHAKE ALARM:50,GEOFENCE:OFF,SLEEP:OFF," +
  "ACC ALARM SMS:ON,ACC ALARM CALL:OFF,APN:internet,internet,internet," +
  "IP:45.112.204.246,8090,GPRS UPLOAD TIME:30,TIME ZONE:E00";

describe("parseRconf", () => {
  it("lit le relevé réel du K3", () => {
    const r = parseRconf(RCONF_K3);
    expect(r.ok).toBe(true);
    expect(r.model).toBe("ST-901-868L");
    expect(r.firmware).toBe("V4.35");
    expect(r.deviceId).toBe("9170258210");
    expect(r.password).toBe("0000");
    expect(r.serverIp).toBe("45.112.204.246");
    expect(r.serverPort).toBe(8090);
    expect(r.apn).toBe("internet");
    expect(r.uploadIntervalS).toBe(30);
    expect(r.timezone).toBe("E00");
    expect(r.warnings).toEqual([]);
  });

  it("recolle un message coupé par l'écran du téléphone, y compris au milieu de l'IP", () => {
    // Coupures telles qu'affichées sur la capture du 17/09 : « 9170\n258210 »,
    // « GEO\nFENCE », « 45.112.204.2\n46 ».
    const coupe =
      "ST-901-868L:V4.35,ID:9170\n258210,UP:0000,U1:000000\n000000,U2:,U3:,MODE:GPR\n" +
      "S,POWER ALARM:ON,OVER\nSPEED:80,VOICE:OFF,SHAKE\nALARM:50,GEO\nFENCE:OFF," +
      "SLEEP:OFF,ACC\nALARM SMS:ON,ACC ALARM\nCALL:OFF,APN:internet,inte\nrnet,internet," +
      "IP:45.112.204.2\n46,8090,GPRS UPLOAD\nTIME:30,TIME ZONE:E00";
    const r = parseRconf(coupe);
    expect(r.ok).toBe(true);
    expect(r.deviceId).toBe("9170258210");
    expect(r.serverIp).toBe("45.112.204.246");
    expect(r.serverPort).toBe(8090);
  });

  it("ne conserve pas le numéro de téléphone autorisé", () => {
    const r = parseRconf(RCONF_K3);
    expect(JSON.stringify(r)).not.toContain("000000000000");
  });

  it("alerte quand le serveur d'origine manque, au lieu de laisser basculer sans retour", () => {
    const r = parseRconf("ST-901-868L:V4.35,ID:9170258210,UP:0000,MODE:GPRS");
    expect(r.ok).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/retour arrière/);
  });

  it("signale un serveur d'origine exprimé en nom de domaine", () => {
    const r = parseRconf("ST-901:V4.35,ID:9170258210,UP:0000,IP:gps.exemple.com,5013");
    expect(r.serverIp).toBe("gps.exemple.com");
    expect(r.warnings.join(" ")).toMatch(/n'est pas une adresse IP/);
  });

  it("ne fabrique rien à partir d'un texte qui n'est pas un relevé", () => {
    const r = parseRconf("bonjour, voici le message");
    expect(r.ok).toBe(false);
    expect(r.deviceId).toBeNull();
    expect(r.password).toBeNull();
  });
});

describe("buildInstallSms", () => {
  const base = {
    password: "0000",
    gatewayIp: "66.33.22.219",
    gatewayPort: 14728,
    originalIp: "45.112.204.246",
    originalPort: 8090,
  };

  it("génère la séquence exacte pour le K3", () => {
    const plan = buildInstallSms(base);
    expect(plan.ok).toBe(true);
    expect(plan.steps.map((s) => s.sms)).toEqual([
      "RCONF",
      "8040000 66.33.22.219 14728",
      "RCONF",
    ]);
    expect(plan.rollback?.sms).toBe("8040000 45.112.204.246 8090");
  });

  it("refuse un nom de domaine comme passerelle : le ST-901 l'ignorerait en silence", () => {
    const plan = buildInstallSms({ ...base, gatewayIp: "iriguchi.proxy.rlwy.net" });
    expect(plan.ok).toBe(false);
    expect(plan.steps).toHaveLength(0);
  });

  it("refuse un mot de passe absent plutôt que de générer une commande fausse", () => {
    expect(buildInstallSms({ ...base, password: null }).ok).toBe(false);
    expect(buildInstallSms({ ...base, password: "ab12" }).ok).toBe(false);
  });

  it("ne propose pas de retour arrière quand l'origine est inconnue", () => {
    const plan = buildInstallSms({ ...base, originalIp: null, originalPort: null });
    expect(plan.ok).toBe(true);
    expect(plan.rollback).toBeNull();
  });
});

describe("utilitaires", () => {
  it("normalise l'identifiant imprimé sur le boîtier", () => {
    expect(normalizeDeviceId("9170 258 210")).toBe("9170258210");
    expect(normalizeDeviceId("9170-258-210")).toBe("9170258210");
    expect(normalizeDeviceId("SIM-4470")).toBeNull();
    expect(normalizeDeviceId("123")).toBeNull();
  });

  it("valide une IPv4", () => {
    expect(isIpv4("66.33.22.219")).toBe(true);
    expect(isIpv4("256.1.1.1")).toBe(false);
    expect(isIpv4("iriguchi.proxy.rlwy.net")).toBe(false);
  });
});
