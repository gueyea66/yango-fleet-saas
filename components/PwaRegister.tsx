"use client";

import { useEffect } from "react";

// Enregistre le service worker au chargement (installabilité PWA/TWA).
// Idempotent avec l'enregistrement fait par NotificationBell au moment de l'opt-in push.
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // non bloquant : l'app fonctionne sans SW
    });
  }, []);

  return null;
}
