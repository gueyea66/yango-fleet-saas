-- ════════════════════════════════════════════════════════════
-- 085 — Contrôle routier : validation sans preuve (demande d'Abdou, 09/10/2026)
-- ════════════════════════════════════════════════════════════
-- Constat : la saisie opérateur d'un contrôle routier passe sans reçu (#190),
-- mais le valideur restait bloqué : la garde en base (075) exigeait encore
-- une pièce jointe pour toute charge opérateur.
-- Règle alignée sur lib/operateur.ts (preuveExigee) : seule la catégorie
-- « Contrôle routier » se valide sans preuve ; toutes les autres l'exigent.
-- Le reste de la fonction est repris de 075 à l'identique. Idempotent.

CREATE OR REPLACE FUNCTION fleet.guard_validation_separee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_decision  BOOLEAN := false;
  v_auteur    UUID;
  v_confiance BOOLEAN := fleet.is_console_ou_serveur();
BEGIN
  -- décision = passage à approved / rejected (OLD n'est lu qu'en UPDATE)
  IF NEW.status IN ('approved','rejected') THEN
    IF TG_OP = 'INSERT' THEN v_decision := true;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN v_decision := true;
    END IF;
  END IF;

  -- saisie : chauffeur du même tenant, toujours (serveur compris)
  IF TG_TABLE_NAME = 'saisies_hors_yango' THEN
    IF NOT EXISTS (SELECT 1 FROM fleet.profiles WHERE id = NEW.driver_id AND tenant_id = NEW.tenant_id AND role = 'driver') THEN
      RAISE EXCEPTION 'Chauffeur inconnu pour ce compte';
    END IF;
  END IF;

  IF NOT v_confiance THEN
    -- Champs de traçabilité : posés par la base, jamais par l'app.
    -- (blocs imbriqués : daily_reports n'a pas entered_by, l'accès ne doit pas être évalué)
    IF TG_TABLE_NAME <> 'daily_reports' THEN
      IF TG_OP = 'INSERT' THEN
        NEW.entered_by := auth.uid();
        IF NEW.status <> 'submitted' THEN
          RAISE EXCEPTION 'Une saisie part toujours en attente de validation';
        END IF;
      ELSE
        NEW.entered_by := OLD.entered_by;
      END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.approved_by := NULL; NEW.approved_at := NULL;
    ELSE
      NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
    END IF;
  END IF;

  IF v_decision AND NOT v_confiance THEN
    IF NOT fleet.peut_valider_courant() THEN
      RAISE EXCEPTION 'Validation réservée à un administrateur valideur (profil « saisie seule »)';
    END IF;
    -- auteur lu sur OLD : impossible de vider / changer entered_by pour se valider
    IF TG_TABLE_NAME <> 'daily_reports' THEN
      IF TG_OP = 'UPDATE' THEN v_auteur := COALESCE(OLD.entered_by, OLD.driver_id);
      ELSE v_auteur := COALESCE(NEW.entered_by, NEW.driver_id); END IF;
      IF v_auteur = auth.uid() THEN
        RAISE EXCEPTION 'Une saisie ne peut pas être validée par son auteur';
      END IF;
    END IF;
    -- charge saisie par un opérateur : preuve obligatoire pour la valider,
    -- sauf contrôle routier (aucun reçu délivré)
    IF TG_TABLE_NAME = 'expenses' THEN
      IF NEW.status = 'approved' AND NEW.source = 'operateur'
         AND NEW.category IS DISTINCT FROM 'Contrôle routier'
         AND NOT EXISTS (SELECT 1 FROM fleet.uploads WHERE ref_id = NEW.id AND tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'Preuve manquante : impossible de valider une charge sans pièce jointe';
      END IF;
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;

  -- déclaration chauffeur validée un jour qui a déjà du hors Yango validé :
  -- le montant serait perdu (la journée Fleetroom cède la place) → refus explicite
  IF v_decision AND TG_TABLE_NAME = 'daily_reports' THEN
    IF NEW.status = 'approved' AND COALESCE(NEW.source, '') NOT IN ('fleetroom', 'operateur')
       AND EXISTS (SELECT 1 FROM fleet.saisies_hors_yango s WHERE s.tenant_id = NEW.tenant_id
                   AND s.driver_id = NEW.driver_id AND s.jour = NEW.date AND s.status = 'approved') THEN
      RAISE EXCEPTION 'Des recettes hors Yango validées existent pour ce jour : rejetez-les ou intégrez-les à la déclaration';
    END IF;
  END IF;
  RETURN NEW;
END $$;
