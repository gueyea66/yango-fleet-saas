-- ============================================================
-- MIGRATION 067 — LA COULEUR DE NMK DANS SA FICHE
--
-- Idempotente. Une clé de la fiche d'onboarding.
--
-- Le produit est vendu en marque blanche, et le point A10 de la liste de
-- contrôle suit « logo et couleur validés » depuis le début. Mais rien ne les
-- appliquait : `provisionOnboarding` écrivait l'orange de M3A en dur. NMK a
-- donc ouvert son espace aux couleurs de son fournisseur.
--
-- #125773 est le bleu de nmktransports.sn, celui déjà utilisé pour le compte de
-- démonstration du 14/09. La couleur est désormais lue depuis la fiche à chaque
-- mise en service : rejouer la bascule suffit à l'appliquer.
--
-- Le logo n'est pas ici, et ne peut pas l'être : il s'envoie comme fichier dans
-- le bucket `branding/<identifiant du tenant>/`, un chemin qui n'existe pas
-- tant que l'espace n'est pas créé. Il se pose dans Clients → Gérer.
-- ============================================================

UPDATE fleet.onboarding_files
SET doc = doc || jsonb_build_object('couleur', '#125773'),
    updated_at = now()
WHERE id = 'nmk';
