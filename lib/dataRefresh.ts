"use client";
/**
 * Rafraîchissement automatique des écrans admin (retour Abdou 04/10 : « je dois
 * lancer refresh pour voir les nouveaux chiffres après une action »).
 *
 * - notifyDataChanged() : à appeler après toute écriture (validation, saisie,
 *   import…). Tous les écrans abonnés se rechargent, y compris ceux d'un autre
 *   onglet du menu.
 * - useDataRefresh()    : compteur qui avance à chaque notification, au retour
 *   sur la fenêtre, et toutes les `pollMs` tant que la fenêtre est visible
 *   (les actions d'un autre administrateur apparaissent sans recharger).
 *
 * `reason` distingue une action (« action ») d'un simple passage du temps
 * (« poll ») : un écran avec un formulaire ouvert peut ignorer le second.
 */
import { useEffect, useState } from "react";

const EVT = "m3a:data-changed";
const POLL_MS = 60_000;
/** Retour sur la fenêtre : on ne recharge que si elle est restée cachée un moment. */
const RETOUR_MIN_MS = 10_000;

export function notifyDataChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export interface DataRefresh { tick: number; reason: "action" | "poll" }

export function useDataRefresh(pollMs: number = POLL_MS): DataRefresh {
  const [state, setState] = useState<DataRefresh>({ tick: 0, reason: "poll" });
  useEffect(() => {
    const bump = (reason: DataRefresh["reason"]) => setState((s) => ({ tick: s.tick + 1, reason }));
    const onAction = () => bump("action");
    let cacheDepuis = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { cacheDepuis = Date.now(); return; }
      if (cacheDepuis && Date.now() - cacheDepuis >= RETOUR_MIN_MS) bump("action");
      cacheDepuis = 0;
    };
    const timer = pollMs > 0
      ? setInterval(() => { if (document.visibilityState === "visible") bump("poll"); }, pollMs)
      : null;
    window.addEventListener(EVT, onAction);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener(EVT, onAction);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollMs]);
  return state;
}
