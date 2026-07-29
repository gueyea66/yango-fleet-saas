-- Migration 034 — 2026-07-29
-- Phase 1.1 : extension du catalogue de règles (analyse croisée du 29/07).
-- Ne touche QUE la table ai_recommendations (couche IA) — aucune table métier.
-- Idempotente.

ALTER TABLE fleet.ai_recommendations
  DROP CONSTRAINT IF EXISTS ai_recommendations_rule_id_check;

ALTER TABLE fleet.ai_recommendations
  ADD CONSTRAINT ai_recommendations_rule_id_check
  CHECK (rule_id IN (
    -- Phase 1
    'palier_a_risque','carburant_derive','rapport_manquant','avance_solde_gonflee',
    -- Phase 1.1 — règles d'optimisation (gains chiffrés)
    'panier_moyen',                  -- qualité de course vs volume
    'efficience_carburant',          -- FCFA/km comparé entre chauffeurs matures
    'jour_optimal_repos',            -- pattern hebdo, placement des repos
    'reconciliation_solde',          -- solde consommé vs commissions déclarées
    'utilisation_vehicule',          -- jours véhicule immobile = CA envolé
    'frais_evitables'                -- amendes/contrôles + dérive entretien
  ));
