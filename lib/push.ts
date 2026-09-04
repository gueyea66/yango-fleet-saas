"use client";

/**
 * Activation du push sur CET appareil — logique unique partagée par la cloche
 * (NotificationBell) et l'invite de premier login (PushOnboarding).
 * Retourne { ok } ou { ok:false, reason } avec un message montrable tel quel.
 */

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator && "PushManager" in window
    && typeof Notification !== "undefined" && !!VAPID_PUBLIC;
}

export async function enablePushOnThisDevice(): Promise<{ ok: boolean; reason?: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Les notifications push ne sont pas supportées par ce navigateur." };
  }
  if (!VAPID_PUBLIC) {
    return { ok: false, reason: "Notifications push non configurées côté serveur (clé publique absente)." };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    return { ok: false, reason: "Permission refusée — autorisez les notifications dans les réglages du navigateur." };
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  });
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: res.statusText }));
    return { ok: false, reason: `Échec de l'activation : ${error}` };
  }
  return { ok: true };
}
