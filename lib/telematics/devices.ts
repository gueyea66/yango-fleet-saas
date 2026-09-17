/**
 * Installation d'un boîtier par un gestionnaire, sans intervention technique.
 *
 * Deux fonctions PURES, testées sur un vrai relevé de boîtier :
 *
 *   parseRconf()        lit la réponse au SMS « RCONF » et en extrait ce qui
 *                       compte — surtout le serveur d'ORIGINE, sans lequel le
 *                       retour arrière n'est plus garanti ;
 *   buildInstallSms()   produit les SMS exacts à envoyer, dans l'ordre, et le
 *                       SMS de retour arrière.
 *
 * Seules des commandes documentées du SinoTrack ST-901 sont générées :
 *   RCONF                       relevé de configuration
 *   804<mdp> <ip> <port>        serveur de destination
 * Aucune commande n'est inventée : une commande erronée envoyée à un boîtier
 * installé chez un client est un déplacement sur site.
 */

export interface RconfResult {
  ok: boolean;
  model: string | null;
  firmware: string | null;
  deviceId: string | null;
  password: string | null;
  serverIp: string | null;
  serverPort: number | null;
  apn: string | null;
  uploadIntervalS: number | null;
  timezone: string | null;
  /** Ce qui manque ou paraît anormal, formulé pour le gestionnaire. */
  warnings: string[];
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isIpv4(value: string): boolean {
  return IPV4.test(value.trim());
}

/** Identifiant tel qu'imprimé sur le boîtier : chiffres uniquement. */
export function normalizeDeviceId(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{6,20}$/.test(digits) ? digits : null;
}

/**
 * Lit la réponse RCONF.
 *
 * Le texte arrive souvent recopié depuis l'écran d'un téléphone, qui coupe les
 * lignes n'importe où — y compris au milieu d'une adresse IP
 * (« 45.112.204.2⏎46 »). Les retours à la ligne sont donc supprimés SANS être
 * remplacés par un espace ; les espaces réels du message (« POWER ALARM ») sont
 * conservés.
 */
export function parseRconf(input: string): RconfResult {
  const text = input.replace(/\r?\n/g, "").trim();
  const warnings: string[] = [];

  const pick = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;

  const head = text.match(/(ST-[\w-]+)\s*:\s*(V[\d.]+)/i);
  const model = head?.[1]?.toUpperCase() ?? null;
  const firmware = head?.[2]?.toUpperCase() ?? null;

  const deviceId = pick(/\bID\s*:\s*(\d{6,20})/i);
  const password = pick(/\bUP\s*:\s*(\d{4,6})/i);

  const server = text.match(/\bIP\s*:\s*([^,\s]+)\s*,\s*(\d{1,5})/i);
  const serverIp = server?.[1] ?? null;
  const serverPort = server ? Number(server[2]) : null;

  const apn = pick(/\bAPN\s*:\s*([^,]*)/i) || null;
  const interval = pick(/GPRS\s*UPLOAD\s*TIME\s*:\s*(\d+)/i);
  const timezone = pick(/TIME\s*ZONE\s*:\s*([EW]\d{2})/i);

  if (!deviceId) warnings.push("Identifiant du boîtier introuvable dans le message.");
  if (!password) warnings.push("Mot de passe du boîtier introuvable : les SMS ne pourront pas être générés.");
  if (!serverIp || !serverPort) {
    warnings.push("Serveur d'origine introuvable : le retour arrière ne pourra pas être garanti.");
  } else if (!isIpv4(serverIp)) {
    warnings.push(`Le serveur d'origine n'est pas une adresse IP (${serverIp}) : à vérifier avant toute bascule.`);
  }
  if (!model) warnings.push("Modèle non reconnu : vérifier qu'il s'agit bien d'un boîtier SinoTrack.");

  return {
    ok: Boolean(deviceId && password && serverIp && serverPort),
    model,
    firmware,
    deviceId,
    password,
    serverIp,
    serverPort,
    apn,
    uploadIntervalS: interval ? Number(interval) : null,
    timezone,
    warnings,
  };
}

export interface SmsStep {
  label: string;
  sms: string;
  explanation: string;
}

export interface InstallPlan {
  ok: boolean;
  errors: string[];
  steps: SmsStep[];
  rollback: SmsStep | null;
}

/**
 * Produit la séquence de SMS d'installation.
 *
 * La passerelle doit être une adresse IPv4 : le ST-901 n'accepte pas de nom de
 * domaine comme serveur. Le plan est refusé plutôt que de générer une commande
 * que le boîtier ignorerait en silence.
 */
export function buildInstallSms(input: {
  password: string | null;
  gatewayIp: string | null;
  gatewayPort: number | null;
  originalIp: string | null;
  originalPort: number | null;
}): InstallPlan {
  const errors: string[] = [];
  const { password, gatewayIp, gatewayPort, originalIp, originalPort } = input;

  if (!password || !/^\d{4,6}$/.test(password)) {
    errors.push("Mot de passe du boîtier manquant ou invalide (4 à 6 chiffres).");
  }
  if (!gatewayIp || !isIpv4(gatewayIp)) {
    errors.push("Adresse IP de la passerelle manquante ou invalide.");
  }
  if (!gatewayPort || gatewayPort < 1 || gatewayPort > 65535) {
    errors.push("Port de la passerelle invalide.");
  }
  if (errors.length) return { ok: false, errors, steps: [], rollback: null };

  const hasOrigin = Boolean(originalIp && isIpv4(originalIp) && originalPort);

  const steps: SmsStep[] = [
    {
      label: "Relever la configuration",
      sms: "RCONF",
      explanation:
        "À faire AVANT tout le reste. Copier la réponse dans M3A : elle contient le serveur d'origine, indispensable pour revenir en arrière.",
    },
    {
      label: "Basculer vers M3A",
      sms: `804${password} ${gatewayIp} ${gatewayPort}`,
      explanation:
        "Le boîtier quitte sa plateforme actuelle et envoie ses positions à M3A. Il disparaît de l'application d'origine tant que ce réglage est actif.",
    },
    {
      label: "Confirmer",
      sms: "RCONF",
      explanation:
        `La réponse doit afficher IP:${gatewayIp},${gatewayPort}. Le signal apparaît ensuite dans M3A en moins d'une minute.`,
    },
  ];

  const rollback: SmsStep | null = hasOrigin
    ? {
        label: "Revenir à la plateforme d'origine",
        sms: `804${password} ${originalIp} ${originalPort}`,
        explanation:
          "Restaure le serveur relevé avant la bascule. Le SMS passe par le réseau GSM : il fonctionne même si la passerelle M3A est injoignable.",
      }
    : null;

  return { ok: true, errors: [], steps, rollback };
}
