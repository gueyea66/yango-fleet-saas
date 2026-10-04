-- ============================================================
-- MIGRATION 076 — FLEETROOM : SOLDE SUR UN IMPORT DE PLUSIEURS JOURS
--
-- Idempotente. Redéfinit fleet.fleetroom_rebuild (072 + correctifs 073).
--
-- Cas visé : on dépose les transactions du 2 et du 3 avec l'export « Soldes »
-- du 3 seulement. Le solde de fin du 2 est reconstitué en remontant depuis
-- l'ancre : solde fin 2 = solde fin 3 − mouvements hors espèces du 3.
-- (Vérifié sur NMK : 30/09 et 29/09 reconstitués depuis le seul solde du
-- 01/10, écart ≤ 0,01 XOF avec les exports « Soldes » réels.)
--
-- Deux corrections :
-- 1. Ancre ignorée quand le chauffeur n'a aucune transaction à la date de
--    l'ancre ou avant (nouveau chauffeur) : on retombait sur solde_initial.
-- 2. Contrôle des soldes renvoyé dans « ecarts_solde » : la reconstitution
--    n'est juste que si les transactions sont complètes. On le vérifie contre
--    le solde de début du jour et contre l'export « Soldes » précédent.
--
-- Côté application (lib/fleetroom/ingest.ts) : une nouvelle ancre recalcule
-- aussi les jours POSTÉRIEURS déjà importés, pas seulement les antérieurs.
-- ============================================================

CREATE OR REPLACE FUNCTION fleet.fleetroom_rebuild(p_tenant UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = fleet, public
AS $$
DECLARE
  v_inserted INT := 0; v_updated INT := 0; v_conflicts INT := 0; v_expenses INT := 0;
  v_unmapped TEXT[];
  v_ecarts JSONB;
BEGIN
  -- Chauffeurs Yango actifs sur la période sans profil rattaché
  SELECT array_agg(DISTINCT t.driver_name) INTO v_unmapped
  FROM yango_transactions t
  LEFT JOIN profiles p ON p.tenant_id = t.tenant_id AND p.yango_driver_id = t.yango_driver_id
  WHERE t.tenant_id = p_tenant AND t.jour BETWEEN p_from AND p_to AND p.id IS NULL;

  CREATE TEMP TABLE _fr ON COMMIT DROP AS
  WITH tx AS (
    SELECT yango_driver_id, jour,
      SUM(amount) FILTER (WHERE category = 'cash_collected')                       AS especes,
      SUM(amount) FILTER (WHERE category = 'card')                                 AS carte,
      SUM(amount) FILTER (WHERE category IN ('promotion_discount','promotion_promocode')) AS promo,
      SUM(amount) FILTER (WHERE category = 'bonus')                                AS bonus,
      -SUM(amount) FILTER (WHERE category IN ('platform_ride_fee','platform_ride_vat','platform_reposition_fee')) AS comm_yango,
      -SUM(amount) FILTER (WHERE category = 'partner_ride_fee')                    AS comm_partenaire,
      -SUM(amount) FILTER (WHERE category = 'commission_booking_fee')              AS frais_resa,
      SUM(amount) FILTER (WHERE category = 'partner_service_manual')               AS recharges,
      SUM(amount) FILTER (WHERE category <> 'cash_collected')                      AS mvt_solde
    FROM yango_transactions WHERE tenant_id = p_tenant
    GROUP BY 1, 2
  ),
  cum AS (   -- solde relatif cumulé depuis la première transaction connue
    SELECT tx.*, SUM(COALESCE(mvt_solde, 0)) OVER (PARTITION BY yango_driver_id ORDER BY jour) AS cumul
    FROM tx
  ),
  ancre AS ( -- dernière photo de solde Fleetroom par chauffeur
    SELECT DISTINCT ON (p.id) p.id AS profile_id, s.jour, s.solde_fin
    FROM yango_balance_snapshots s
    JOIN profiles p ON p.tenant_id = s.tenant_id
      AND (p.yango_driver_id = s.yango_driver_id OR lower(p.full_name) = lower(s.driver_name))
    WHERE s.tenant_id = p_tenant
    ORDER BY p.id, s.jour DESC
  ),
  od AS (
    SELECT yango_driver_id, jour,
      COUNT(*) FILTER (WHERE status = 'Terminé')                                   AS courses,
      ROUND(SUM(distance_m) FILTER (WHERE status = 'Terminé') / 1000.0, 1)         AS km,
      MODE() WITHIN GROUP (ORDER BY plate) FILTER (WHERE status = 'Terminé')      AS plate,
      COUNT(*) FILTER (WHERE cancel_reason IN ('Le conducteur n''a pas accepté la demande de course',
                                               'Le conducteur a refusé la demande de course')) AS refus,
      ROUND(EXTRACT(EPOCH FROM SUM(ended_at - started_at) FILTER (WHERE status = 'Terminé')) / 3600.0, 2) AS h_course
    FROM yango_orders WHERE tenant_id = p_tenant
    GROUP BY 1, 2
  )
  SELECT p.id AS driver_id, c.jour,
    COALESCE(c.especes, 0) AS especes, COALESCE(c.carte, 0) AS carte, COALESCE(c.promo, 0) AS promo,
    COALESCE(c.bonus, 0) AS bonus, COALESCE(c.comm_yango, 0) AS comm_yango,
    COALESCE(c.comm_partenaire, 0) AS comm_partenaire, COALESCE(c.frais_resa, 0) AS frais_resa,
    COALESCE(c.recharges, 0) AS recharges,
    -- solde fin J = ancre − cumul à la date de l'ancre + cumul à J : vaut pour les jours
    -- APRÈS l'ancre comme pour les jours AVANT (solde du 2 reconstitué depuis celui du 3).
    -- Sans transaction à la date de l'ancre ou avant, le cumul à l'ancre vaut 0.
    ROUND(COALESCE(a.solde_fin - COALESCE((SELECT c2.cumul FROM cum c2 WHERE c2.yango_driver_id = c.yango_driver_id
                                            AND c2.jour <= a.jour ORDER BY c2.jour DESC LIMIT 1), 0),
                   p.solde_initial, 0) + c.cumul, 0) AS solde_fin,
    COALESCE(o.courses, 0) AS courses, o.km, o.refus, o.h_course,
    v.id AS vehicle_id
  FROM cum c
  JOIN profiles p ON p.tenant_id = p_tenant AND p.yango_driver_id = c.yango_driver_id
  LEFT JOIN ancre a ON a.profile_id = p.id
  LEFT JOIN od o ON o.yango_driver_id = c.yango_driver_id AND o.jour = c.jour
  LEFT JOIN vehicles v ON v.tenant_id = p_tenant AND replace(upper(v.plate), '-', '') = o.plate
  WHERE c.jour BETWEEN p_from AND p_to
    AND (COALESCE(o.courses, 0) > 0 OR COALESCE(c.especes, 0) + COALESCE(c.carte, 0) <> 0);

  -- 1. Déclarations déjà saisies par le chauffeur → écart consigné, rien d'écrasé
  INSERT INTO fleetroom_conflicts (tenant_id, driver_id, jour, report_id, declared, fleetroom, updated_at)
  SELECT p_tenant, f.driver_id, f.jour, d.id,
    jsonb_build_object('especes', d.yango_cash, 'carte', d.yango_card, 'brut', d.yango_gross,
                       'courses', d.yango_trip_count, 'solde', d.solde_yango, 'source', d.source),
    jsonb_build_object('especes', f.especes, 'carte', f.carte, 'brut', f.especes + f.carte,
                       'courses', f.courses, 'solde', f.solde_fin),
    now()
  FROM _fr f
  JOIN daily_reports d ON d.tenant_id = p_tenant AND d.driver_id = f.driver_id AND d.date = f.jour
                      AND d.status <> 'rejected' AND COALESCE(d.source, '') <> 'fleetroom'
  ON CONFLICT (tenant_id, driver_id, jour) DO UPDATE
    SET report_id = EXCLUDED.report_id, declared = EXCLUDED.declared,
        fleetroom = EXCLUDED.fleetroom, updated_at = now();
  GET DIAGNOSTICS v_conflicts = ROW_COUNT;

  -- 2. Déclarations Fleetroom existantes → rafraîchies
  UPDATE daily_reports d SET
    yango_cash = f.especes, yango_card = f.carte, yango_gross = f.especes + f.carte,
    yango_bonus = f.bonus, gross_earnings = f.especes + f.carte + f.bonus,
    commission_yango_reelle = f.comm_yango, commission_partenaire_reelle = f.comm_partenaire,
    commission_amount = f.comm_yango + f.comm_partenaire,
    net_after_expenses = f.especes + f.carte + f.bonus - f.comm_yango - f.comm_partenaire,
    solde_yango = f.solde_fin, yango_trip_count = f.courses, vehicle_id = COALESCE(f.vehicle_id, d.vehicle_id),
    comment = format('Fleetroom · KM en course: %s · promo: %s · frais résa: %s · recharges: %s · refus: %s · h en course: %s',
                     f.km, f.promo, f.frais_resa, f.recharges, COALESCE(f.refus, 0), f.h_course),
    updated_at = now()
  FROM _fr f
  WHERE d.tenant_id = p_tenant AND d.driver_id = f.driver_id AND d.date = f.jour
    AND d.status = 'approved' AND d.source = 'fleetroom';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 3. Nouveaux jours → déclarations approuvées, source 'fleetroom'
  INSERT INTO daily_reports (tenant_id, driver_id, vehicle_id, date, status, source,
    yango_cash, yango_card, yango_gross, yango_bonus, off_yango_revenue, gross_earnings,
    commission_yango_reelle, commission_partenaire_reelle, commission_amount,
    service_supplementaire, net_after_expenses, solde_yango, yango_trip_count, end_odometer,
    expense_count, comment)
  SELECT p_tenant, f.driver_id, f.vehicle_id, f.jour, 'approved', 'fleetroom',
    f.especes, f.carte, f.especes + f.carte, f.bonus, 0, f.especes + f.carte + f.bonus,
    f.comm_yango, f.comm_partenaire, f.comm_yango + f.comm_partenaire,
    0, f.especes + f.carte + f.bonus - f.comm_yango - f.comm_partenaire, f.solde_fin, f.courses, 0,
    0,
    format('Fleetroom · KM en course: %s · promo: %s · frais résa: %s · recharges: %s · refus: %s · h en course: %s',
           f.km, f.promo, f.frais_resa, f.recharges, COALESCE(f.refus, 0), f.h_course)
  FROM _fr f
  WHERE NOT EXISTS (SELECT 1 FROM daily_reports d WHERE d.tenant_id = p_tenant
                      AND d.driver_id = f.driver_id AND d.date = f.jour AND d.status <> 'rejected');
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 4. Rechargements manuels → dépenses « Solde Yango » (1 transaction = 1 dépense)
  INSERT INTO expenses (tenant_id, driver_id, category, amount, description, expense_date, status, source, external_ref)
  SELECT p_tenant, p.id, 'Solde Yango', t.amount,
         'Recharge Fleetroom' || COALESCE(' — ' || t.initiated_by, ''), t.jour, 'approved', 'fleetroom',
         'yango_tx:' || t.id
  FROM yango_transactions t
  JOIN profiles p ON p.tenant_id = p_tenant AND p.yango_driver_id = t.yango_driver_id
  WHERE t.tenant_id = p_tenant AND t.category = 'partner_service_manual'
    AND t.jour BETWEEN p_from AND p_to
  ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_expenses = ROW_COUNT;

  -- 5. Contrôle des soldes : un export « Soldes » doit coller aux transactions.
  --    'jour'       : solde de début + mouvements du jour ≠ solde de fin
  --                   → transactions du jour incomplètes (export fait avant la fin de journée ?)
  --    'intervalle' : solde précédent + mouvements depuis ≠ solde de fin
  --                   → il manque des transactions entre les deux exports « Soldes »
  --    Tant qu'un écart existe, les soldes reconstitués autour de ce jour sont faux d'autant.
  WITH sp AS (
    SELECT DISTINCT ON (p.id, s.jour) p.id AS profile_id, p.full_name, p.yango_driver_id,
           s.jour, s.solde_debut, s.solde_fin
    FROM yango_balance_snapshots s
    JOIN profiles p ON p.tenant_id = s.tenant_id
      AND (p.yango_driver_id = s.yango_driver_id OR lower(p.full_name) = lower(s.driver_name))
    WHERE s.tenant_id = p_tenant
    ORDER BY p.id, s.jour
  ),
  k AS (
    SELECT sp.*, LAG(sp.solde_fin) OVER w AS fin_prec, LAG(sp.jour) OVER w AS jour_prec
    FROM sp WINDOW w AS (PARTITION BY sp.profile_id ORDER BY sp.jour)
  ),
  m AS (
    SELECT k.*,
      (SELECT COALESCE(SUM(t.amount), 0) FROM yango_transactions t
        WHERE t.tenant_id = p_tenant AND t.yango_driver_id = k.yango_driver_id
          AND t.category <> 'cash_collected' AND t.jour = k.jour) AS mvt_jour,
      (SELECT COALESCE(SUM(t.amount), 0) FROM yango_transactions t
        WHERE t.tenant_id = p_tenant AND t.yango_driver_id = k.yango_driver_id
          AND t.category <> 'cash_collected' AND t.jour > k.jour_prec AND t.jour <= k.jour) AS mvt_intervalle
    FROM k WHERE k.jour BETWEEN p_from AND p_to
  ),
  e AS (
    SELECT full_name, jour, 'jour' AS type, NULL::date AS depuis,
           ROUND(solde_debut + mvt_jour, 0) AS attendu, ROUND(solde_fin, 0) AS constate
    FROM m WHERE solde_debut IS NOT NULL AND abs(solde_debut + mvt_jour - solde_fin) > 1
    UNION ALL
    SELECT full_name, jour, 'intervalle', jour_prec,
           ROUND(fin_prec + mvt_intervalle, 0), ROUND(solde_fin, 0)
    FROM m WHERE fin_prec IS NOT NULL AND abs(fin_prec + mvt_intervalle - solde_fin) > 1
  )
  SELECT jsonb_agg(jsonb_build_object('chauffeur', full_name, 'jour', jour, 'type', type, 'depuis', depuis,
                                      'attendu', attendu, 'constate', constate, 'ecart', constate - attendu)
                   ORDER BY jour DESC, full_name)
  INTO v_ecarts FROM (SELECT * FROM e ORDER BY jour DESC LIMIT 50) x;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'conflicts', v_conflicts,
                            'recharges', v_expenses, 'unmapped_drivers', COALESCE(v_unmapped, '{}'),
                            'ecarts_solde', COALESCE(v_ecarts, '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION fleet.fleetroom_rebuild(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fleet.fleetroom_rebuild(UUID, DATE, DATE) TO service_role;
