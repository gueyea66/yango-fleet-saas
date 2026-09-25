-- ============================================================
-- MIGRATION 066 — NMK EST UN CLIENT ENTREPRISE, PAS PRO
--
-- Idempotente. Une clé de la fiche d'onboarding de NMK.
--
-- La 064 avait posé `plan: "pro"`, sur la foi d'une note devenue fausse : le
-- palier Entreprise n'existait pas dans `lib/plans.ts` au moment où elle a été
-- écrite. Il y est depuis, avec exactement les termes du devis du 17/09 —
-- 100 000 XOF/mois, 10 véhicules compris, 10 000 par véhicule actif au-delà.
--
-- Laisser « pro » ne bloquerait rien : `includedVehicles` est déclaratif et ne
-- refuse jamais un véhicule. Mais le tableau de bord superadmin compterait NMK
-- à 75 000 XOF de MRR au lieu de 100 000 — le commentaire de `lib/plans.ts`
-- signale précisément ce piège. Un chiffre d'affaires sous-évalué de 25 000 par
-- mois et par client de ce palier n'est pas une erreur d'affichage.
--
-- À passer AVANT la mise en service : `provisionOnboarding` ne lit le plan
-- qu'à la création de l'espace. Après coup, il faut le corriger dans l'onglet
-- Clients de la console, où le sélecteur de plan est déjà là.
-- ============================================================

UPDATE fleet.onboarding_files
SET doc = doc || jsonb_build_object('plan', 'enterprise'),
    updated_at = now()
WHERE id = 'nmk';
