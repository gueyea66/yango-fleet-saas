-- ============================================================
-- MIGRATION 065 — NMK SUR LA REFONTE UI v2
--
-- Idempotente. Une seule clé ajoutée à la fiche d'onboarding de NMK.
--
-- NMK est un client neuf : il n'a aucune habitude à préserver sur l'ancienne
-- interface, et la formation de Daniel n'aura lieu qu'une fois. Lui livrer
-- l'interface actuelle reviendrait à le former deux fois.
--
-- Le drapeau ne se pose pas directement sur `tenant_settings` : l'espace NMK
-- n'existe pas encore. Il vit dans la fiche, et `provisionOnboarding` l'écrit
-- au moment de la mise en service — puis à chaque rejeu, ce qui permet de
-- revenir en arrière en changeant la fiche plutôt qu'en touchant la base.
--
-- Les autres espaces ne bougent pas : `tenant_settings.ui_v2` garde son défaut
-- `false` (migration 062), et rien ici ne les concerne.
-- ============================================================

UPDATE fleet.onboarding_files
SET doc = doc || jsonb_build_object('uiV2', true),
    updated_at = now()
WHERE id = 'nmk';
