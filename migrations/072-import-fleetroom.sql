-- ============================================================
-- MIGRATION 072 — IMPORT FLEETROOM (exports Yango → déclarations)
--
-- Idempotente. Additive : tables nouvelles, colonnes nullables, aucune
-- donnée existante modifiée.
--
-- ── Le besoin (Abdou, 01/10) ─────────────────────────────
-- Les exports Fleetroom du parc (« transactions » et « commandes ») tiennent
-- lieu de déclaration pour une période : on les dépose tels quels, sans
-- retraitement à la main, et l'app en tire les déclarations journalières,
-- les recharges et le solde Yango. Garde-fous contre la double déclaration.
--
-- ── Architecture ─────────────────────────────────────────
-- 1. Les lignes BRUTES sont stockées avec leur clé naturelle Yango :
--      yango_orders        PK (tenant, order_id)        → upsert (le statut
--                          d'une commande peut évoluer d'un export à l'autre)
--      yango_transactions  UNIQUE (tenant, horodatage, chauffeur, catégorie,
--                          montant, document)           → ON CONFLICT DO NOTHING
--    Déposer deux fois le même fichier, ou deux périodes qui se chevauchent,
--    ne crée donc AUCUN doublon. Le même fichier (sha256) est refusé en amont.
-- 2. fleet.fleetroom_rebuild(tenant, du, au) recalcule les déclarations de la
--    période à partir du brut. Rejouable à volonté (résultat identique).
-- 3. Une déclaration déjà saisie par le chauffeur (source ≠ 'fleetroom')
--    n'est JAMAIS écrasée : l'écart est consigné dans fleetroom_conflicts.
--
-- ── Règles de calcul validées par Abdou (01/10) ──────────
--   brut Yango          = espèces + carte (compensation promo EXCLUE)
--   commission Yango    = platform_ride_fee + platform_ride_vat
--                         + platform_reposition_fee
--   commission partenaire = partner_ride_fee
--   frais de réservation (commission_booking_fee) : EXCLUS des commissions
--   rechargements manuels (partner_service_manual) : exclus du CA, versés en
--                         dépense « Solde Yango », comptés dans le solde
--   solde fin J         = solde fin J-1 + Σ transactions du jour hors espèces
--   ancre du solde      = export Fleetroom « soldes » (yango_balance_snapshots),
--                         sinon profiles.solde_initial, sinon 0.
--   Vérifié au XOF près sur les 6 actifs au 29/09/2026.
-- ============================================================

-- ── Rattachement chauffeur ↔ identifiant Yango ────────────
ALTER TABLE fleet.profiles ADD COLUMN IF NOT EXISTS yango_driver_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_tenant_yango_driver
  ON fleet.profiles (tenant_id, yango_driver_id) WHERE yango_driver_id IS NOT NULL;

-- ── Journal des fichiers déposés ──────────────────────────
CREATE TABLE IF NOT EXISTS fleet.fleetroom_imports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  created_by    UUID,
  kind          TEXT        NOT NULL CHECK (kind IN ('transactions','orders','soldes')),
  file_name     TEXT,
  file_sha256   TEXT        NOT NULL,
  period_from   DATE,
  period_to     DATE,
  rows_total    INTEGER     DEFAULT 0,
  rows_new      INTEGER     DEFAULT 0,
  rows_known    INTEGER     DEFAULT 0,
  summary       JSONB       DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, file_sha256)
);

-- ── Transactions brutes (park_transactions) ───────────────
CREATE TABLE IF NOT EXISTS fleet.yango_transactions (
  id              BIGSERIAL   PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  occurred_at     TIMESTAMPTZ NOT NULL,          -- heure de Dakar = UTC
  jour            DATE        NOT NULL,
  yango_driver_id TEXT        NOT NULL,
  driver_name     TEXT,
  category        TEXT        NOT NULL,          -- ex. cash_collected, platform_ride_fee
  category_label  TEXT,
  amount          NUMERIC     NOT NULL,
  order_id        TEXT        NOT NULL DEFAULT '', -- « Order #… » sans préfixe ; '' si aucun
  initiated_by    TEXT,
  comment         TEXT,
  import_id       UUID        REFERENCES fleet.fleetroom_imports(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- clé naturelle : unique sur 81 799 lignes réelles (janv.-sept. 2026).
  -- Contrainte sur colonnes simples (pas d'expression) pour l'upsert PostgREST.
  CONSTRAINT uq_yango_tx_natural
    UNIQUE (tenant_id, occurred_at, yango_driver_id, category, amount, order_id)
);
CREATE INDEX IF NOT EXISTS idx_yango_tx_driver_day
  ON fleet.yango_transactions (tenant_id, yango_driver_id, jour);

-- ── Commandes brutes (report_orders) ──────────────────────
CREATE TABLE IF NOT EXISTS fleet.yango_orders (
  tenant_id        UUID        NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  order_id         TEXT        NOT NULL,
  order_code       TEXT,
  status           TEXT,                         -- Terminé | Annulé | …
  cancel_reason    TEXT,
  yango_driver_id  TEXT,
  driver_name      TEXT,
  yango_vehicle_id TEXT,
  vehicle_label    TEXT,
  plate            TEXT,                         -- normalisée en latin, sans tiret
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  jour             DATE,                         -- jour de fin de course
  address_from     TEXT,
  address_to       TEXT,
  service_class    TEXT,
  distance_m       NUMERIC,                      -- l'en-tête dit « km », ce sont des mètres
  tarif            NUMERIC,
  cash             NUMERIC,
  cashless         NUMERIC,
  promo            NUMERIC,
  bonus            NUMERIC,
  commission       NUMERIC,
  booking_fee      NUMERIC,
  partner_fee      NUMERIC,
  import_id        UUID        REFERENCES fleet.fleetroom_imports(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_yango_orders_driver_day
  ON fleet.yango_orders (tenant_id, yango_driver_id, jour);

-- ── Soldes Fleetroom (ancre du solde) ─────────────────────
CREATE TABLE IF NOT EXISTS fleet.yango_balance_snapshots (
  tenant_id       UUID    NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  yango_driver_id TEXT,
  driver_name     TEXT    NOT NULL,
  jour            DATE    NOT NULL,
  solde_debut     NUMERIC,
  solde_fin       NUMERIC NOT NULL,
  import_id       UUID    REFERENCES fleet.fleetroom_imports(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, driver_name, jour)
);

-- ── Écarts avec les déclarations déjà saisies ─────────────
CREATE TABLE IF NOT EXISTS fleet.fleetroom_conflicts (
  tenant_id   UUID    NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  driver_id   UUID    NOT NULL REFERENCES fleet.profiles(id) ON DELETE CASCADE,
  jour        DATE    NOT NULL,
  report_id   UUID    REFERENCES fleet.daily_reports(id) ON DELETE CASCADE,
  declared    JSONB   NOT NULL,   -- ce que le chauffeur a déclaré
  fleetroom   JSONB   NOT NULL,   -- ce que dit Yango
  resolved    BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, driver_id, jour)
);

-- ── Dépenses : référence externe (recharge Yango) ─────────
ALTER TABLE fleet.expenses ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_tenant_external_ref
  ON fleet.expenses (tenant_id, external_ref) WHERE external_ref IS NOT NULL;

-- ── RLS : admins du tenant + serveur de confiance ─────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['fleetroom_imports','yango_transactions','yango_orders',
                           'yango_balance_snapshots','fleetroom_conflicts']
  LOOP
    EXECUTE format('ALTER TABLE fleet.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON fleet.%I', t || '_admin_tenant', t);
    EXECUTE format($p$CREATE POLICY %I ON fleet.%I FOR ALL
      USING (fleet.is_trusted_server() OR (fleet.is_admin() AND tenant_id = fleet.current_tenant_id()))
      WITH CHECK (fleet.is_trusted_server() OR (fleet.is_admin() AND tenant_id = fleet.current_tenant_id()))$p$,
      t || '_admin_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.%I TO authenticated, service_role', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE fleet.yango_transactions_id_seq TO authenticated, service_role;

-- ============================================================
-- fleet.fleetroom_rebuild — déclarations journalières d'une période
-- ============================================================
CREATE OR REPLACE FUNCTION fleet.fleetroom_rebuild(p_tenant UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = fleet, public
AS $$
DECLARE
  v_inserted INT := 0; v_updated INT := 0; v_conflicts INT := 0; v_expenses INT := 0;
  v_unmapped TEXT[];
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
    ROUND(COALESCE(a.solde_fin - (SELECT c2.cumul FROM cum c2 WHERE c2.yango_driver_id = c.yango_driver_id
                                   AND c2.jour <= a.jour ORDER BY c2.jour DESC LIMIT 1),
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
                      AND d.status = 'approved' AND COALESCE(d.source, '') <> 'fleetroom'
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
                      AND d.driver_id = f.driver_id AND d.date = f.jour AND d.status = 'approved');
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

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'conflicts', v_conflicts,
                            'recharges', v_expenses, 'unmapped_drivers', COALESCE(v_unmapped, '{}'));
END $$;

REVOKE ALL ON FUNCTION fleet.fleetroom_rebuild(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fleet.fleetroom_rebuild(UUID, DATE, DATE) TO service_role;
