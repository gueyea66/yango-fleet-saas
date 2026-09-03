-- 046 — Avances propriétaire (retour Abdou 03/09) :
-- un « Décaissement propriétaire » est une AVANCE remise à un chauffeur
-- (cash sorti, neutre pour le résultat) ; la charge réelle est celle que le
-- chauffeur déclare ensuite avec preuve. Cette colonne porte le destinataire
-- de l'avance pour le suivi « remis vs justifié » par chauffeur.
-- À exécuter dans l'éditeur SQL Supabase (canal DDL habituel).

ALTER TABLE fleet.expenses
  ADD COLUMN IF NOT EXISTS advance_driver_id uuid REFERENCES fleet.profiles(id);

CREATE INDEX IF NOT EXISTS idx_expenses_advance_driver
  ON fleet.expenses (advance_driver_id)
  WHERE advance_driver_id IS NOT NULL;

COMMENT ON COLUMN fleet.expenses.advance_driver_id IS
  'Chauffeur destinataire quand category = Décaissement propriétaire (avance de fonds).';
