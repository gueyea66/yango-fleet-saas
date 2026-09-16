-- ============================================================
-- MIGRATION 051 — PURGE POSSIBLE PAR LE SERVEUR, RÉÉCRITURE TOUJOURS INTERDITE
--
-- Idempotente. Corrige une garde trop absolue posée par la 049.
--
-- La 049 interdisait UPDATE **et** DELETE à tout le monde, service_role
-- compris. Conséquence non voulue, constatée avant toute mise en service :
--   • impossible d'appliquer une rétention (90 j) sur des millions de points ;
--   • impossible de retirer des positions de démonstration ;
--   • impossible de supprimer un boîtier (la cascade déclenche la garde).
--
-- Nouvelle règle, plus juste :
--   • UPDATE reste interdit à TOUT LE MONDE, y compris au serveur. Une
--     position ne se réécrit jamais : c'est la preuve.
--   • DELETE est réservé au serveur de confiance (service_role), pour la
--     purge et le retrait de données de démonstration. Aucun utilisateur,
--     même administrateur, ne peut effacer l'historique depuis l'interface.
-- ============================================================

CREATE OR REPLACE FUNCTION fleet.guard_telematics_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'telematics_positions : une position ne se réécrit jamais';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF fleet.is_trusted_server() THEN
      RETURN OLD;  -- purge de rétention ou retrait de données de démonstration
    END IF;
    RAISE EXCEPTION 'telematics_positions : suppression réservée au serveur';
  END IF;

  RETURN NEW;
END $$;
