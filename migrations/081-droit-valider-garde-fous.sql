-- ════════════════════════════════════════════════════════════
-- 081 — Droit de valider : garde-fous (demande d'Abdou, 07/10/2026)
-- ════════════════════════════════════════════════════════════
-- Constat : un valideur pouvait se passer lui-même en « saisie seule ».
-- Règles, déjà appliquées par l'API (/api/admin/administrateurs) et doublées
-- ici pour toute écriture directe depuis l'app :
--   1. personne ne modifie son propre droit de valider (ni retrait, ni octroi) ;
--   2. il reste toujours au moins un administrateur valideur actif dans le
--      compte : sinon plus personne ne peut valider ni rétablir un droit.
-- Le serveur et la console SQL restent libres (réparation). Idempotent.

CREATE OR REPLACE FUNCTION fleet.guard_droits_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF fleet.is_console_ou_serveur() THEN RETURN NEW; END IF;

  -- (075) seul un valideur accorde ou retire un droit ou un rôle administrateur
  IF NOT fleet.peut_valider_courant() THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.role = 'admin' THEN RAISE EXCEPTION 'RLS: création d''administrateur réservée à un administrateur valideur'; END IF;
      RETURN NEW;
    END IF;
    IF NEW.peut_valider IS DISTINCT FROM OLD.peut_valider THEN
      RAISE EXCEPTION 'RLS: seul un administrateur valideur peut modifier le droit de valider';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role AND (NEW.role = 'admin' OR OLD.role = 'admin') THEN
      RAISE EXCEPTION 'RLS: seul un administrateur valideur peut changer un rôle administrateur';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- 1. jamais son propre droit
    IF NEW.id = auth.uid() AND NEW.peut_valider IS DISTINCT FROM OLD.peut_valider THEN
      RAISE EXCEPTION 'Vous ne pouvez pas modifier votre propre droit de valider';
    END IF;
    -- 2. il reste au moins un valideur actif (retrait du droit, ou du rôle admin)
    IF OLD.role = 'admin' AND OLD.peut_valider
       AND (NEW.peut_valider IS DISTINCT FROM true OR NEW.role IS DISTINCT FROM 'admin')
       AND NOT EXISTS (
         SELECT 1 FROM fleet.profiles p
         WHERE p.tenant_id = OLD.tenant_id AND p.id <> OLD.id
           AND p.role = 'admin' AND p.peut_valider AND COALESCE(p.active, true)
       ) THEN
      RAISE EXCEPTION 'Il doit rester au moins un administrateur valideur';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- le déclencheur existe depuis la 075 (BEFORE INSERT OR UPDATE OF role, peut_valider)
DROP TRIGGER IF EXISTS guard_droits_admin_iu ON fleet.profiles;
CREATE TRIGGER guard_droits_admin_iu BEFORE INSERT OR UPDATE OF role, peut_valider ON fleet.profiles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_droits_admin();

-- Contrôle : valideurs actifs par compte (aucun compte ne doit afficher 0)
SELECT t.slug, count(*) FILTER (WHERE p.peut_valider AND COALESCE(p.active, true)) AS valideurs_actifs, count(*) AS administrateurs
FROM fleet.tenants t JOIN fleet.profiles p ON p.tenant_id = t.id AND p.role = 'admin'
GROUP BY t.slug ORDER BY t.slug;
