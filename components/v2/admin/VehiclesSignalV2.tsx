"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Radio } from "lucide-react";
import { Button, Card, StatusDot } from "@/components/ui";
import { fetchJsonRetry } from "@/lib/fetchJsonRetry";
import { vehicleSignal } from "@/lib/v2/fleet";

interface Payload {
  vehicles: { id: string; plate: string; name: string }[];
  devices: { id: string; vehicleId: string | null; lastSeenAt: string | null; label: string | null; externalId: string }[];
}

/**
 * Véhicules v2 (maquette 2e) : état du signal de chaque véhicule, au-dessus
 * de la gestion de flotte actuelle. Lecture seule (GET des boîtiers).
 */
export function VehiclesSignalV2({ demo }: { demo?: Payload }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(demo ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (demo) return;
    let alive = true;
    fetchJsonRetry("/api/admin/telematics/devices")
      .then((j) => { if (alive) setData(j as Payload); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [demo]);

  if (failed) return null; // module télématique indisponible : la flotte actuelle reste seule
  const now = new Date();

  return (
    <Card flush>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--sk-surface)", flexWrap: "wrap" }}>
        <h2 style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 600 }}>Signal des véhicules</h2>
        <Button variant="outline" size="sm" icon={MapPin} onClick={() => router.push("/admin/suivi")}>Suivi GPS</Button>
        <Button variant="outline" size="sm" icon={Radio} onClick={() => router.push("/admin/boitiers")}>Installer un boîtier</Button>
      </div>
      {!data ? (
        <div className="v2-skeleton" style={{ height: 120, margin: 16 }} aria-hidden />
      ) : data.vehicles.length === 0 ? (
        <div style={{ padding: 18, fontSize: 13, color: "var(--v2-muted)" }}>Aucun véhicule.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {data.vehicles.map((v) => {
            const dev = data.devices.find((d) => d.vehicleId === v.id);
            const s = vehicleSignal(dev?.lastSeenAt, !!dev, now);
            return (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--sk-surface)", borderRight: "1px solid var(--sk-surface)" }}>
                <StatusDot tone={s.tone} label={s.text} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="v2-num" style={{ fontSize: 14, fontWeight: 600 }}>{v.plate}</div>
                  <div style={{ fontSize: 12, color: "var(--v2-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name || "—"} · {s.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
