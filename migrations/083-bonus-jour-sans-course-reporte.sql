-- ════════════════════════════════════════════════════════════
-- 083 — Bonus crédité un jour sans course : reporté sur le dernier jour travaillé
-- ════════════════════════════════════════════════════════════
-- Demande d'Abdou (07/10/2026) : le bonus d'objectif récompense un nombre de
-- courses hebdomadaire ; Yango le crédite sur le solde, parfois un jour où le
-- chauffeur ne roule pas. Ce bonus doit entrer dans le CA, mais un vrai jour
-- sans activité ne doit pas devenir un jour d'activité.
--
-- Remplace la règle de la 082 (qui créait une journée ce jour-là) :
--   • un jour sans course ne crée toujours AUCUNE journée ;
--   • son bonus est ajouté à la dernière journée travaillée qui le précède,
--     comme lorsque Yango le crédite un jour travaillé (4 cas sur 5).
-- Le solde, lui, suit toujours la date réelle du crédit.
-- Vérifié en lecture sur NMK : 45 jours concernés, 531 135 F reportés, total
-- des bonus après report = total des bonus Yango (3 631 589 F).
-- Relancer ensuite le recalcul (script). Idempotent.

DO $$
DECLARE src TEXT;
  regle_082 TEXT := 'AND (COALESCE(o.courses, 0) > 0 OR COALESCE(c.especes, 0) + COALESCE(c.carte, 0) <> 0 OR COALESCE(c.bonus, 0) <> 0);';
  regle     TEXT := 'AND (COALESCE(o.courses, 0) > 0 OR COALESCE(c.especes, 0) + COALESCE(c.carte, 0) <> 0);';
  bonus_avant TEXT := 'COALESCE(c.bonus, 0) AS bonus,';
  bonus_apres TEXT := $b$COALESCE(c.bonus, 0) + COALESCE((
      -- bonus des jours SANS course qui suivent, jusqu'au prochain jour travaillé
      SELECT SUM(b.bonus) FROM cum b
      WHERE b.yango_driver_id = c.yango_driver_id AND b.jour > c.jour AND COALESCE(b.bonus, 0) <> 0
        AND COALESCE(b.especes, 0) + COALESCE(b.carte, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM od ob WHERE ob.yango_driver_id = b.yango_driver_id AND ob.jour = b.jour AND ob.courses > 0)
        AND NOT EXISTS (SELECT 1 FROM cum a2 WHERE a2.yango_driver_id = c.yango_driver_id AND a2.jour > c.jour AND a2.jour < b.jour
              AND (COALESCE(a2.especes, 0) + COALESCE(a2.carte, 0) <> 0
                   OR EXISTS (SELECT 1 FROM od oa WHERE oa.yango_driver_id = a2.yango_driver_id AND oa.jour = a2.jour AND oa.courses > 0)))
    ), 0) AS bonus,$b$;
BEGIN
  SELECT pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure) INTO src;
  IF position('bonus des jours SANS course' IN src) > 0 THEN RETURN; END IF;   -- déjà appliquée
  src := replace(src, regle_082, regle);                                       -- retire la règle de la 082 si présente
  IF position(regle IN src) = 0 OR position(bonus_avant IN src) = 0 THEN
    RAISE EXCEPTION 'fleetroom_rebuild : définition inattendue, migration 083 non appliquée';
  END IF;
  EXECUTE replace(src, bonus_avant, bonus_apres);
END $$;

-- Contrôle : report_en_place = true, journee_sans_course = false
SELECT
  position('bonus des jours SANS course' IN pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure)) > 0 AS report_en_place,
  position('OR COALESCE(c.bonus, 0) <> 0)' IN pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure)) > 0 AS journee_sans_course;
