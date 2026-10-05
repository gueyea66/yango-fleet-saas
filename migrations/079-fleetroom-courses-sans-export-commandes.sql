-- ============================================================
-- MIGRATION 079 — FLEETROOM : COURSES DES JOURS SANS EXPORT « COMMANDES »
--
-- Idempotente. Demande d'Abdou (05/10/2026).
--
-- L'export « Commandes » de janvier à septembre 2025 n'existe plus dans
-- Fleetroom : ces journées NMK avaient un CA mais 0 course, ce qui faussait
-- toutes les moyennes (CA / course, courses / jour, ticket moyen).
--
-- Quand un chauffeur n'a AUCUNE commande importée un jour donné, le nombre de
-- courses est compté dans les transactions : commandes distinctes encaissées
-- (espèces ou carte). Dès qu'un export « Commandes » couvre le jour, c'est lui
-- qui fait foi, comme avant.
--
-- Vérifié sur NMK, jours où les deux sources existent : 6 681 contre 6 679
-- courses (oct. → déc. 2025), 24 190 contre 24 206 (2026) ; jamais plus d'une
-- course d'écart sur un jour (course à cheval sur minuit).
--
-- Les km, heures en course et refus restent vides ces jours-là : ils ne se
-- déduisent pas des transactions.
-- ============================================================
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure) INTO src;
  IF position('courses_tx' IN src) > 0 THEN RETURN; END IF;   -- déjà appliquée
  IF position('AS mvt_solde' IN src) = 0 OR position('COALESCE(o.courses, 0) AS courses' IN src) = 0 THEN
    RAISE EXCEPTION 'fleetroom_rebuild : définition inattendue, migration 079 non appliquée';
  END IF;
  src := replace(src, 'AS mvt_solde',
    $a$AS mvt_solde,
      COUNT(DISTINCT order_id) FILTER (WHERE category IN ('cash_collected','card') AND order_id <> '') AS courses_tx$a$);
  src := replace(src, 'COALESCE(o.courses, 0) AS courses',
    'CASE WHEN o.yango_driver_id IS NULL THEN COALESCE(c.courses_tx, 0) ELSE COALESCE(o.courses, 0) END AS courses');
  EXECUTE src;
END $$;

-- Contrôle
SELECT position('courses_tx' IN pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure)) > 0 AS rebuild_a_jour;
