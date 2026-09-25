-- ============================================================
-- MIGRATION 068 — LA COULEUR DE NMK, ÉCLAIRCIE POUR RESTER LISIBLE
--
-- Idempotente. Une clé de la fiche d'onboarding.
--
-- La 067 avait posé #125773, le bleu exact du logo de nmktransports.sn. Fidèle,
-- mais inutilisable : `--tenant-color` ne sert pas qu'aux fonds, elle sert de
-- couleur de TEXTE (libellés d'accent, pilules de filtre actives). Sur le fond
-- --sk-deep du thème midnight, #125773 donne un contraste de 2,41:1 là où le
-- seuil de lisibilité est 4,5:1. À côté, l'orange de M3A est à 9,48:1.
--
-- #209acb est la MÊME teinte, remontée en luminosité : contraste 5,99:1. Le
-- logo garde ses vraies couleurs — seul l'accent de l'interface est adapté,
-- comme toute charte le prévoit pour une couleur foncée sur thème sombre.
-- Arbitré par Abdou le 25/09 sur les trois options mesurées.
--
-- À noter au passage, pour quand on y reviendra : `transports-kebe` a le même
-- défaut avec #3224f5 (2,48:1). Ce n'est pas propre à NMK.
--
-- L'écriture passe par la fiche et non par `tenant_settings`, qui est protégée
-- par `guard_admin_only` : seuls le service_role ou un gestionnaire connecté y
-- écrivent. Rejouer « Mise en service » applique la couleur.
-- ============================================================

UPDATE fleet.onboarding_files
SET doc = doc || jsonb_build_object('couleur', '#209acb'),
    updated_at = now()
WHERE id = 'nmk';
