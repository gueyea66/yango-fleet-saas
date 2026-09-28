"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Radio } from "lucide-react";
import { Badge, Button, Card, StatusDot } from "@/components/ui";
import { fetchJsonRetry } from "@/lib/fetchJsonRetry";
import { vehicleSignal } from "@/lib/v2/fleet";
import { SEGMENT_META, compterParSegment, estMixte, segmentDe, TOUS_SEGMENTS } from "@/lib/fleetSegment";

interface Payload {
  vehicles: { id: string; plate: string; name: string; segment?: string | null; owner?: string | null }[];
  devices: { id: string; vehicleId: string | null; lastSeenAt: string | null; label: string | null; externalId: string }[];
}

/**
 * Véhicules v2 (maquette 2e) : état du signal de chaque véhicule, au-dessus
 * de la gestion de flotte actuelle. Lecture seule (GET des boîtiers).
 */
export function VehiclesSignalV2({ demo, segments = TOUS_SEGMENTS }: { demo?: Payload; segments?: string[] }) {
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
  const tous = data?.vehicles ?? [];
  // Le même filtre que la liste du dessous. Sans ça, restreindre à la flotte
  // interne laisserait la carte du haut compter les voitures des partenaires.
  const vus = tous.filter((v) => segments.includes(segmentDe(v)));
  const mixte = estMixte(compterParSegment(tous, (v) => v));

  return (
    <Card flush>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--sk-surface)", flexWrap: "wrap" }}>
        <h2 style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 600 }}>Signal des véhicules</h2>
        <Button variant="outline" size="sm" icon={MapPin} onClick={() => router.push("/admin/suivi")}>Suivi GPS</Button>
        <Button variant="outline" size="sm" icon={Radio} onClick={() => router.push("/admin/boitiers")}>Installer un boîtier</Button>
      </div>
      {!data ? (
        <div className="v2-skeleton" style={{ height: 120, margin: 16 }} aria-hidden />
      ) : tous.length === 0 ? (
        <div style={{ padding: 18, fontSize: 13, color: "var(--v2-muted)" }}>Aucun véhicule.</div>
      ) : vus.length === 0 ? (
        <div style={{ padding: 18, fontSize: 13, color: "var(--v2-muted)" }}>
          Aucune flotte sélectionnée.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {vus.map((v) => {
            const dev = data.devices.find((d) => d.vehicleId === v.id);
            const s = vehicleSignal(dev?.lastSeenAt, !!dev, now);
            return (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--sk-surface)", borderRight: "1px solid var(--sk-surface)" }}>
                <StatusDot tone={s.tone} label={s.text} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span className="v2-num" style={{ fontSize: 14, fontWeight: 600 }}>{v.plate}</span>
                    {/* La pastille ne sert que sur un parc réellement mixte : ailleurs
                        elle répéterait la même valeur sur toutes les lignes. */}
                    {mixte && (
                      <Badge tone={SEGMENT_META[segmentDe(v)].tone} title={v.owner ? `Propriétaire : ${v.owner}` : undefined}>
                        {SEGMENT_META[segmentDe(v)].court}
                      </Badge>
                    )}
                  </div>
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
