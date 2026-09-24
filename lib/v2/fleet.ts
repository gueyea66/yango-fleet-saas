/**
 * État du signal GPS d'un véhicule (maquette 2e) : vert < 15 min,
 * jaune < 60 min, rouge au-delà, gris sans boîtier.
 */
export type SignalTone = "ok" | "accent" | "neg" | "idle";

export function vehicleSignal(lastSeenAt: string | null | undefined, hasDevice: boolean, now: Date): { tone: SignalTone; text: string } {
  if (!hasDevice) return { tone: "idle", text: "Sans boîtier" };
  if (!lastSeenAt) return { tone: "idle", text: "Aucun signal reçu" };
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return { tone: "idle", text: "Aucun signal reçu" };
  const min = Math.max(0, Math.round((now.getTime() - t) / 60000));
  if (min < 2) return { tone: "ok", text: "Signal à l'instant" };
  if (min < 15) return { tone: "ok", text: `Signal il y a ${min} min` };
  if (min < 60) return { tone: "accent", text: `Silencieux depuis ${min} min` };
  const h = Math.round(min / 60);
  return { tone: "neg", text: h < 48 ? `Silencieux depuis ${h} h` : `Silencieux depuis ${Math.round(h / 24)} j` };
}
