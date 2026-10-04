-- ============================================================
-- MIGRATION 077 — SOLDE YANGO REPORTÉ SUR LES JOURNÉES SANS ACTIVITÉ YANGO
--
-- Idempotente. Demande d'Abdou (04/10/2026).
--
-- Une journée « hors Yango seul » (saisie opérateur validée, aucune course
-- Yango ce jour-là) restait sans solde Yango. Le solde réel n'a pourtant pas
-- disparu : c'est celui de la veille, plus les éventuels mouvements hors
-- espèces du jour (une recharge, par exemple).
--
-- 1. fleet.solde_yango_au(tenant, chauffeur, jour) : solde de fin de journée,
--    même formule que fleetroom_rebuild (ancre « Soldes » + transactions hors
--    espèces). NULL si le chauffeur n'a ni transaction ni export « Soldes ».
--    (Vérifié sur NMK : 142 journées Fleetroom depuis le 01/09, 0 divergence
--    avec le solde déjà enregistré.)
-- 2. fleet.journee_hors_yango : à l'écriture d'une journée Fleetroom /
--    opérateur sans solde, on pose ce solde ; à défaut (compte sans
--    Fleetroom), le dernier solde validé du chauffeur.
-- 3. fleet.fleetroom_rebuild : ces journées sont recalculées à chaque import
--    (une recharge ou un nouvel export « Soldes » déplace leur solde).
-- 4. Rattrapage des journées existantes sans solde.
-- ============================================================

-- ── 1. Solde Yango d'un chauffeur à la fin d'un jour ─────────
CREATE OR REPLACE FUNCTION fleet.solde_yango_au(p_tenant UUID, p_driver UUID, p_jour DATE)
RETURNS NUMERIC
LANGUAGE sql STABLE
SET search_path = fleet, public
AS $$
  WITH p AS (
    SELECT id, yango_driver_id, full_name, solde_initial
    FROM profiles WHERE id = p_driver AND tenant_id = p_tenant
  ),
  a AS ( -- dernière photo de solde Fleetroom du chauffeur
    SELECT s.jour, s.solde_fin
    FROM yango_balance_snapshots s, p
    WHERE s.tenant_id = p_tenant
      AND (s.yango_driver_id = p.yango_driver_id OR lower(s.driver_name) = lower(p.full_name))
    ORDER BY s.jour DESC LIMIT 1
  ),
  m AS (
    SELECT COUNT(*) AS n,
      COALESCE(SUM(t.amount) FILTER (WHERE t.jour <= p_jour), 0)                AS cum_j,
      COALESCE(SUM(t.amount) FILTER (WHERE t.jour <= (SELECT jour FROM a)), 0)  AS cum_a
    FROM yango_transactions t, p
    WHERE t.tenant_id = p_tenant AND t.yango_driver_id = p.yango_driver_id
      AND t.category <> 'cash_collected'
  )
  SELECT CASE
    WHEN m.n = 0 AND NOT EXISTS (SELECT 1 FROM a) THEN NULL
    ELSE ROUND(COALESCE((SELECT solde_fin FROM a) - m.cum_a, p.solde_initial, 0) + m.cum_j, 0)
  END
  FROM p, m;
$$;

REVOKE ALL ON FUNCTION fleet.solde_yango_au(UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fleet.solde_yango_au(UUID, UUID, DATE) TO service_role;

-- ── 2. Journée Fleetroom / opérateur sans solde → solde reporté ──
-- (reprise de la 075 : hors Yango validé du jour, plus le solde.)
CREATE OR REPLACE FUNCTION fleet.journee_hors_yango()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hy NUMERIC; v_courses INT;
BEGIN
  IF COALESCE(NEW.source, '') NOT IN ('fleetroom', 'operateur') THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(montant), 0), COALESCE(SUM(courses), 0) INTO v_hy, v_courses
  FROM fleet.saisies_hors_yango
  WHERE tenant_id = NEW.tenant_id AND driver_id = NEW.driver_id AND jour = NEW.date AND status = 'approved';
  NEW.off_yango_revenue    := v_hy;
  NEW.off_yango_trip_count := v_courses;
  NEW.gross_earnings       := COALESCE(NEW.yango_gross, 0) + COALESCE(NEW.yango_bonus, 0) + v_hy;
  NEW.net_after_expenses   := COALESCE(NEW.yango_gross, 0) + COALESCE(NEW.yango_bonus, 0)
                              - COALESCE(NEW.commission_amount, 0) + v_hy;
  -- Aucune activité Yango ce jour-là : le solde est celui de la veille (plus les
  -- mouvements hors espèces du jour) ; sans Fleetroom, le dernier solde validé.
  IF NEW.solde_yango IS NULL THEN
    NEW.solde_yango := COALESCE(
      fleet.solde_yango_au(NEW.tenant_id, NEW.driver_id, NEW.date),
      (SELECT d.solde_yango FROM fleet.daily_reports d
        WHERE d.tenant_id = NEW.tenant_id AND d.driver_id = NEW.driver_id AND d.date < NEW.date
          AND d.status = 'approved' AND d.solde_yango IS NOT NULL
        ORDER BY d.date DESC LIMIT 1));
  END IF;
  RETURN NEW;
END $$;

-- ── 3. fleetroom_rebuild : journées Fleetroom sans activité Yango ──
-- Elles ne sont pas dans le recalcul des déclarations (aucune course, aucun
-- encaissement) : leur solde est remis à jour ici, à chaque import.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure) INTO src;
  IF position('solde_yango_au' IN src) > 0 THEN RETURN; END IF;   -- déjà appliquée
  IF position('-- 4. Rechargements manuels' IN src) = 0 THEN
    RAISE EXCEPTION 'fleetroom_rebuild : définition inattendue, migration 077 non appliquée';
  END IF;
  src := replace(src, '-- 4. Rechargements manuels',
    $a$-- 3 bis. Journées Fleetroom sans activité Yango (hors Yango seul) : solde reporté
  UPDATE daily_reports d SET solde_yango = solde_yango_au(p_tenant, d.driver_id, d.date), updated_at = now()
  WHERE d.tenant_id = p_tenant AND d.date BETWEEN p_from AND p_to
    AND d.status = 'approved' AND d.source = 'fleetroom'
    AND NOT EXISTS (SELECT 1 FROM _fr f WHERE f.driver_id = d.driver_id AND f.jour = d.date)
    AND solde_yango_au(p_tenant, d.driver_id, d.date) IS DISTINCT FROM d.solde_yango;

  -- 4. Rechargements manuels$a$);
  EXECUTE src;
END $$;

-- ── 4. Rattrapage : journées existantes sans solde ───────────
-- (le déclencheur journee_hors_yango pose le solde à la réécriture)
UPDATE fleet.daily_reports SET updated_at = now()
WHERE status = 'approved' AND source IN ('fleetroom', 'operateur') AND solde_yango IS NULL;

-- ── 5. Contrôle ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM fleet.daily_reports
    WHERE status = 'approved' AND source IN ('fleetroom', 'operateur') AND solde_yango IS NULL) AS journees_sans_solde,
  position('solde_yango_au' IN pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure)) > 0 AS rebuild_a_jour;
