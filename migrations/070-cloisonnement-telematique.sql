-- ============================================================
-- MIGRATION 070 — CLOISONNEMENT DE LA TÉLÉMATIQUE
--
-- Idempotente. Policies RLS uniquement, aucune donnée touchée.
--
-- Suite de la 069, qui a fermé les quatre tables de données personnelles.
-- Les tables `telematics_*` étaient restées en lecture ouverte au tenant :
-- avec la clé anon et une session de chauffeur, on pouvait lire les positions,
-- les trajets et les journées GPS de TOUS les véhicules du parc — donc les
-- déplacements de chacun de ses collègues, à la minute.
--
-- Elles n'ont pas de `driver_id` : le rattachement passe par le véhicule.
-- D'où la jointure sur `fleet.vehicles.driver_id`, qui rend à un chauffeur les
-- traces du véhicule qui lui est affecté, et rien d'autre.
--
-- L'application chauffeur ne lit aucune de ces tables : l'exposition était
-- théorique, mais réelle pour qui savait forger la requête. Les écrans GPS du
-- gestionnaire passent par `is_admin()`, l'ingestion et les recalculs par le
-- service_role — rien ne change pour eux.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  anciennes TEXT[] := ARRAY[
    'telematics_positions_tenant_read', 'telematics_trips_tenant_read',
    'telematics_events_tenant_read', 'telematics_daily_tenant_read',
    'telematics_devices_tenant_read'];
  i INT := 1;
BEGIN
  FOREACH t IN ARRAY ARRAY['telematics_positions', 'telematics_trips',
                           'telematics_events', 'telematics_daily',
                           'telematics_devices']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON fleet.%I', anciennes[i], t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON fleet.%I', t || '_cloisonne', t);
    EXECUTE format($f$
      CREATE POLICY %I ON fleet.%I FOR SELECT
        USING (
          tenant_id = fleet.current_tenant_id()
          AND (
            fleet.is_trusted_server()
            OR fleet.is_admin()
            OR vehicle_id IN (SELECT v.id FROM fleet.vehicles v WHERE v.driver_id = auth.uid())
          )
        )
    $f$, t || '_cloisonne', t);
    i := i + 1;
  END LOOP;
END $$;

/* ── Retour arrière ──────────────────────────────────────────
     DROP POLICY "telematics_positions_cloisonne" ON fleet.telematics_positions;
     CREATE POLICY "telematics_positions_tenant_read" ON fleet.telematics_positions
       FOR SELECT USING (tenant_id = fleet.current_tenant_id());
     -- idem pour trips, events, daily, devices
   ────────────────────────────────────────────────────────── */
