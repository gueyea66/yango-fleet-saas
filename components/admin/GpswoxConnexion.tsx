"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Connexion à la plateforme GPS d'origine (GPSwox), sans toucher aux boîtiers.
 *
 * Le parcours tient en deux gestes : saisir les accès que le prestataire GPS a
 * remis au client, puis cocher les véhicules à suivre. Le client garde son
 * application ; M3A relit simplement les mêmes positions.
 */

type Etat = {
  disponible: boolean;
  connecte: boolean;
  serveur: string | null;
  compte: string | null;
  nonChiffre: boolean;
  derniereReleve: string | null;
  erreur: string | null;
};
type Boitier = {
  imei: string | null;
  nom: string | null;
  plaque: string | null;
  vuLe: string | null;
  statut: "nouveau" | "enrole" | "ailleurs" | "illisible";
  vehiculePropose: string | null;
};
type Vehicle = { id: string; plate: string; name: string };

const inputCls =
  "w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2.5 min-h-[44px] " +
  "focus:outline-none focus:ring-2 focus:ring-yellow-500 placeholder:text-gray-500";
const btnCls =
  "min-h-[44px] px-4 rounded-lg border border-gray-600 text-sm text-gray-200 hover:border-gray-400 " +
  "hover:text-white transition-colors duration-200 cursor-pointer disabled:opacity-50 " +
  "focus:outline-none focus:ring-2 focus:ring-yellow-500";

const ilYA = (iso: string | null) => {
  if (!iso) return "jamais";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
};

export default function GpswoxConnexion({ vehicles, onEnrolled }: {
  vehicles: Vehicle[];
  onEnrolled: () => void | Promise<void>;
}) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ton: "ok" | "bad"; texte: string } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [boitiers, setBoitiers] = useState<Boitier[] | null>(null);
  // imei → véhicule choisi ; présent dans la table = coché
  const [choix, setChoix] = useState<Record<string, string>>({});

  const charger = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/telematics/gpswox");
      if (res.ok) setEtat(await res.json());
    } catch { /* bloc facultatif : l'écran Boîtiers reste utilisable sans lui */ }
  }, []);
  useEffect(() => { void charger(); }, [charger]);

  async function appeler(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/telematics/gpswox", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      return json;
    } catch (e) {
      setMessage({ ton: "bad", texte: e instanceof Error ? e.message : "Opération impossible" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  function recevoir(liste: Boitier[]) {
    setBoitiers(liste);
    // Pré-coché quand la plaque a désigné un seul véhicule ; le reste est au choix du gestionnaire.
    setChoix(Object.fromEntries(liste
      .filter((b) => b.statut === "nouveau" && b.imei && b.vehiculePropose)
      .map((b) => [b.imei as string, b.vehiculePropose as string])));
  }

  if (!etat?.disponible) return null;

  const nouveaux = boitiers?.filter((b) => b.statut === "nouveau") ?? [];
  const selection = Object.keys(choix);

  return (
    <section className="mb-5 bg-gray-800 border border-gray-700 rounded-lg p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Plateforme GPS d&apos;origine (GPSwox)</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {etat.connecte
              ? <>Connectée à <span className="font-mono text-gray-200">{etat.serveur}</span> · dernière relève {ilYA(etat.derniereReleve)}</>
              : "Suivre des véhicules déjà équipés, sans toucher aux boîtiers : le client garde son application."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {etat.connecte ? (
            <>
              <button type="button" disabled={busy} className={btnCls}
                onClick={async () => { const j = await appeler({ action: "list" }); if (j) recevoir(j.boitiers); }}>
                Voir les véhicules
              </button>
              <button type="button" disabled={busy} className={btnCls}
                onClick={async () => {
                  const j = await appeler({ action: "sync" });
                  if (j) {
                    setMessage({ ton: "ok", texte: `Relève faite : ${j.releve?.inseres ?? 0} nouvelle(s) position(s).` });
                    await Promise.all([charger(), onEnrolled()]);
                  }
                }}>
                Relever maintenant
              </button>
              <button type="button" disabled={busy} className={btnCls}
                onClick={async () => {
                  if (!window.confirm("Déconnecter la plateforme GPS ? Les positions déjà reçues sont conservées.")) return;
                  if (await appeler({ action: "disconnect" })) { setBoitiers(null); await charger(); }
                }}>
                Déconnecter
              </button>
            </>
          ) : (
            <button type="button" className={btnCls} onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
              Connecter
            </button>
          )}
        </div>
      </div>

      {etat.erreur && (
        <p role="alert" className="mt-3 text-sm text-red-300">Dernière relève en échec : {etat.erreur}</p>
      )}
      {message && (
        <p role="status" aria-live="polite"
          className={`mt-3 text-sm ${message.ton === "ok" ? "text-emerald-400" : "text-red-300"}`}>
          {message.texte}
        </p>
      )}

      {!etat.connecte && ouvert && (
        <form className="mt-4 grid sm:grid-cols-3 gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const j = await appeler({ action: "connect", baseUrl, email, password });
            if (j) { setPassword(""); setOuvert(false); recevoir(j.boitiers); await charger(); }
          }}>
          <div>
            <label htmlFor="gpswox-url" className="block text-sm font-medium text-gray-200 mb-1.5">Serveur</label>
            <input id="gpswox-url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://…" inputMode="url" autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label htmlFor="gpswox-email" className="block text-sm font-medium text-gray-200 mb-1.5">Identifiant</label>
            <input id="gpswox-email" required value={email} onChange={(e) => setEmail(e.target.value)}
              autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label htmlFor="gpswox-mdp" className="block text-sm font-medium text-gray-200 mb-1.5">Mot de passe</label>
            <input id="gpswox-mdp" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="off" className={inputCls} />
          </div>
          <p className="sm:col-span-2 text-xs text-gray-400">
            Ce sont les accès remis par le prestataire GPS. Le mot de passe sert une seule fois, à obtenir la clé de
            lecture : il n&apos;est pas conservé.
          </p>
          <button type="submit" disabled={busy}
            className="min-h-[44px] px-5 rounded-lg bg-yellow-500 text-gray-900 font-semibold text-sm hover:bg-yellow-400
                       transition-colors duration-200 cursor-pointer disabled:opacity-50
                       focus:outline-none focus:ring-2 focus:ring-yellow-300">
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      )}

      {etat.connecte && etat.nonChiffre && (
        <p className="mt-3 text-xs text-amber-300">
          Cette plateforme répond sans chiffrement (http) : demandez au prestataire une adresse en https.
        </p>
      )}

      {boitiers && (
        <div className="mt-4 border-t border-gray-700 pt-4">
          {boitiers.length === 0 ? (
            <p className="text-sm text-gray-400">Ce compte ne voit aucun véhicule sur la plateforme.</p>
          ) : (
            <ul className="divide-y divide-gray-700">
              {boitiers.map((b, i) => {
                const coche = Boolean(b.imei && b.imei in choix);
                return (
                  <li key={b.imei ?? `x${i}`} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                      <input type="checkbox" className="h-5 w-5 accent-yellow-500" disabled={b.statut !== "nouveau"}
                        checked={coche}
                        onChange={(e) => setChoix((c) => {
                          const n = { ...c };
                          if (e.target.checked) n[b.imei as string] = b.vehiculePropose ?? "";
                          else delete n[b.imei as string];
                          return n;
                        })} />
                      <span className="min-w-0">
                        <span className="block text-white truncate">{b.nom ?? b.plaque ?? "Sans nom"}</span>
                        <span className="block text-xs text-gray-400 font-mono tabular-nums">
                          {b.imei ?? "IMEI illisible"} · signal {ilYA(b.vuLe)}
                        </span>
                      </span>
                    </label>
                    {b.statut === "nouveau" ? (
                      <select aria-label={`Véhicule M3A pour ${b.nom ?? b.imei}`} disabled={!coche}
                        value={coche ? choix[b.imei as string] : ""}
                        onChange={(e) => setChoix((c) => ({ ...c, [b.imei as string]: e.target.value }))}
                        className={`${inputCls} sm:w-64 cursor-pointer disabled:opacity-50`}>
                        <option value="">Sans véhicule pour l&apos;instant</option>
                        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} {v.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {b.statut === "enrole" ? "déjà suivi" : b.statut === "ailleurs" ? "indisponible — contactez le support M3A" : "non exploitable"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {nouveaux.length > 0 && (
            <button type="button" disabled={busy || selection.length === 0}
              onClick={async () => {
                const j = await appeler({
                  action: "enroll",
                  items: selection.map((imei) => ({ imei, vehicleId: choix[imei] || null })),
                });
                if (j) {
                  setMessage({ ton: "ok", texte: `${j.enroles} véhicule(s) suivis. Le signal apparaît dans la liste ci-dessous.` });
                  setBoitiers(null);
                  await Promise.all([charger(), onEnrolled()]);
                }
              }}
              className="mt-4 min-h-[44px] px-5 rounded-lg bg-yellow-500 text-gray-900 font-semibold text-sm
                         hover:bg-yellow-400 transition-colors duration-200 cursor-pointer disabled:opacity-50
                         focus:outline-none focus:ring-2 focus:ring-yellow-300">
              Suivre {selection.length || ""} véhicule{selection.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
