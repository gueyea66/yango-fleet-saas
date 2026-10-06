-- ════════════════════════════════════════════════════════════
-- 080 — Décaissement réservé aux valideurs, motif de rejet des charges
-- ════════════════════════════════════════════════════════════
-- Suite de la 075 (saisie opérateur). Demande d'Abdou (06/10/2026).
--
-- 1. fleet.expenses.rejection_reason : le motif d'un rejet devient visible par
--    l'opérateur qui a saisi la charge (il ne partait qu'au journal d'actions).
-- 2. Un décaissement (« Décaissement propriétaire », avance de fonds) ne se
--    saisit pas par un administrateur « saisie seule » : ni en création, ni en
--    changeant la catégorie d'une charge existante. Le compte technique
--    (rôle chauffeur) et les admins valideurs gardent le circuit actuel.
--    L'API (/api/admin/saisies) applique la même règle ; ce déclencheur couvre
--    l'écriture directe depuis l'app.
-- Idempotent.

-- ── 1. Motif de rejet ────────────────────────────────────────
ALTER TABLE fleet.expenses ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
COMMENT ON COLUMN fleet.expenses.rejection_reason IS
  'Motif du rejet, visible par l''auteur de la saisie. NULL tant que la charge n''est pas rejetée.';

-- ── 2. Décaissement : valideurs seulement ────────────────────
CREATE OR REPLACE FUNCTION fleet.guard_decaissement_valideur()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF fleet.is_console_ou_serveur() THEN RETURN NEW; END IF;
  IF NEW.category = 'Décaissement propriétaire' AND fleet.is_admin() AND NOT fleet.peut_valider_courant() THEN
    RAISE EXCEPTION 'Décaissement réservé à un administrateur valideur (profil « saisie seule »)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_decaissement_valideur_iu ON fleet.expenses;
CREATE TRIGGER guard_decaissement_valideur_iu BEFORE INSERT OR UPDATE OF category ON fleet.expenses
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_decaissement_valideur();

-- ── 3. Contrôle ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'fleet' AND table_name = 'expenses' AND column_name = 'rejection_reason') AS col_motif_rejet,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'guard_decaissement_valideur_iu') AS garde_decaissement;
