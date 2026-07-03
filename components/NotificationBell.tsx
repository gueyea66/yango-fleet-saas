"use client";
import { useState, useEffect, useRef, useCallback } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifs = useCallback(async () => {
    const res = await fetch("/api/notifications?limit=20");
    if (!res.ok) return;
    const { notifications: list, unreadCount } = await res.json();
    setNotifications(list);
    setUnread(unreadCount);
  }, []);

  useEffect(() => {
    fetchNotifs();
    const id = setInterval(fetchNotifs, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifs]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const enablePush = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("Les notifications push ne sont pas supportées par ce navigateur.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;

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
      alert(`Échec de l'activation des notifications push : ${error}`);
      return;
    }

    setPushEnabled(true);
    alert("Notifications push activées ✅");
  };

  const markRead = async (id: string) => {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setNotifications((n) => n.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const markAll = async () => {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAll: true }) });
    setNotifications((n) => n.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "à l'instant";
    if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
    if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)}h`;
    return d.toLocaleDateString("fr-FR");
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: "4px 8px", color: "#888" }}
        title="Notifications"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.63 5.36 6 7.93 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: 0, right: 0, background: "#ef4444",
            color: "#fff", borderRadius: "999px", fontSize: "10px",
            width: "16px", height: "16px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", right: 0, top: "36px", width: "320px", zIndex: 1000,
          background: "#0d1117", border: "1px solid #1e2330", borderRadius: "16px",
          boxShadow: "0 8px 32px rgba(0,0,0,.6)", overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e2330", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: "14px" }}>Notifications</span>
            <div style={{ display: "flex", gap: 8 }}>
              {unread > 0 && (
                <button onClick={markAll} style={{ fontSize: "11px", color: "#f5a623", background: "none", border: "none", cursor: "pointer" }}>
                  Tout lire
                </button>
              )}
              {!pushEnabled && (
                <button onClick={enablePush} style={{ fontSize: "11px", color: "#555e75", background: "none", border: "none", cursor: "pointer" }} title="Activer les notifications push">
                  🔔 Activer push
                </button>
              )}
            </div>
          </div>

          <div style={{ maxHeight: "360px", overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#555e75", fontSize: "13px" }}>
                Aucune notification
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.read_at && markRead(n.id)}
                  style={{
                    padding: "10px 16px", borderBottom: "1px solid #1e2330", cursor: n.read_at ? "default" : "pointer",
                    background: n.read_at ? "transparent" : "rgba(245,166,35,.05)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span style={{ color: "#fff", fontSize: "13px", fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>
                    <span style={{ color: "#555e75", fontSize: "10px", whiteSpace: "nowrap", marginLeft: 8 }}>{fmtTime(n.created_at)}</span>
                  </div>
                  <div style={{ color: "#888", fontSize: "12px", marginTop: 2 }}>{n.body}</div>
                  {!n.read_at && (
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f5a623", marginTop: 4 }} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
