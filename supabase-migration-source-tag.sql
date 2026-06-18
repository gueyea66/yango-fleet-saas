-- Migration : tag source pour isoler les données SaaS des données legacy (yango-app)
-- À exécuter dans Supabase SQL Editor (projet yango-fleet-saas)

-- 1. Ajouter colonne source avec default 'saas' (nouveaux enregistrements = 'saas' automatiquement)
ALTER TABLE fleet.daily_reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'saas';
ALTER TABLE fleet.expenses      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'saas';

-- 2. Marquer les enregistrements AVANT le lancement SaaS comme 'legacy'
--    (ajuster la date selon la date réelle de premier rapport SaaS)
UPDATE fleet.daily_reports SET source = 'legacy' WHERE created_at < '2026-06-18 00:00:00+00';
UPDATE fleet.expenses      SET source = 'legacy' WHERE created_at < '2026-06-18 00:00:00+00';

-- 3. Index pour filtrage rapide
CREATE INDEX IF NOT EXISTS idx_daily_reports_source ON fleet.daily_reports(source);
CREATE INDEX IF NOT EXISTS idx_expenses_source      ON fleet.expenses(source);
