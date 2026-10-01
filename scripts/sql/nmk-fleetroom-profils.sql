-- ============================================================
-- NMK — profils pour la reconstitution Fleetroom (à lancer APRÈS la migration 072)
--
-- 1. Chauffeurs partis en 2026 : profils INACTIFS, pour que leur historique
--    (Mazda AB035EQ, Nissan AB922ER, Kia AB872JG) soit rattaché. Aucun compte
--    de connexion (pas d'email). Exclus de l'onboarding du 25/09 car partis.
-- 2. Date d'entrée = première activité Fleetroom pour ceux arrivés en cours
--    d'année ; solde de départ 0 (consigne Abdou 01/10 : un nouveau chauffeur
--    démarre à 0 puis reçoit une recharge de départ).
-- 3. Identifiant Yango renseigné pour tous (rattachement sans ambiguïté).
-- Idempotent.
-- ============================================================
DO $$
DECLARE nmk UUID := (SELECT id FROM fleet.tenants WHERE slug = 'nmk');
BEGIN
  INSERT INTO fleet.profiles (id, tenant_id, role, account_type, full_name, driver_id, active,
                              hire_date, contract_end_date, solde_initial, yango_driver_id)
  SELECT gen_random_uuid(), nmk, 'driver', 'driver', v.nom, v.code, false,
         v.debut::date, v.fin::date, 0, v.yid
  FROM (VALUES
    -- Bah et Mballo roulaient déjà au 01/01 : date d'entrée inconnue (NULL)
    ('Bah Abdourahmane',    'D12', NULL,         '2026-04-14', '572cf56cab8e4c5587d2ae67150f733f'),
    ('Diao Mamadou Lamine', 'D13', '2026-02-02', '2026-03-13', 'af694963fa554e06a437b3d662e76663'),
    ('Diamanka Abdoulaye',  'D14', '2026-02-14', '2026-03-13', 'd842afb39eef4255976c4415d2b0d77e'),
    ('Balde Braima',        'D15', '2026-03-02', '2026-03-13', '31435cbfdfa04114af74eaa635149bc6'),
    ('Mballo Ismaila',      'D16', NULL,         '2026-07-10', '3dc27bdd2b4f498eb6095e9638ee5d34')
  ) AS v(nom, code, debut, fin, yid)
  WHERE NOT EXISTS (SELECT 1 FROM fleet.profiles p WHERE p.tenant_id = nmk AND p.yango_driver_id = v.yid);

  UPDATE fleet.profiles p SET
    yango_driver_id = v.yid,
    hire_date       = COALESCE(p.hire_date, v.debut::date),
    solde_initial   = CASE WHEN v.debut IS NOT NULL THEN COALESCE(p.solde_initial, 0) ELSE p.solde_initial END
  FROM (VALUES
    ('NGOUMA RAPHAEL',             '61d774bc49574a64be4b5f69442ba487', NULL),
    ('Fall Souka',                 '44f8569ec6bd470eb16dc727d4637f78', '2026-01-22'),
    ('FALL El Hadj Ibrahima',      '36d71daad9724eeeb39f6f30f8b7d89e', NULL),
    ('SECK CHEIKH OUMAR FOUTIYOU', 'd7c447f3e98f4984adadb98a12edfd2b', NULL),
    ('MANE OMAR IDIONTY',          '9ecfcfa402a549d3ae88584ea72bed99', NULL),
    ('Sarr Mounirou',              '4657dc57a7284ec6971f164abb4d1038', '2026-05-11'),
    ('Seidi Amadu',                '7386792ca4454fc79ef43340ccab7458', '2026-01-16'),
    ('Ngom Emile Abdou',           'bebe073ca79749b486f413b1702b73ca', '2026-06-29'),
    ('Badiane Khadim Cheikh',      '0594598edbcf4c019d40010a41efb544', '2026-07-06'),
    ('Ngom Daouda',                '9f3568248c5f44db82c39e2d597e0cbc', '2026-07-20'),
    ('Ngom Abdon Boure',           'c6d18a27efa747feacb7cb3dff6a1160', '2026-09-01')
  ) AS v(nom, yid, debut)
  WHERE p.tenant_id = nmk AND p.role = 'driver' AND lower(p.full_name) = lower(v.nom);
END $$;
