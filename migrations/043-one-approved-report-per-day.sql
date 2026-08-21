-- Migration 043 — 2026-08-21 — APPLIQUÉE EN PROD le 21/08/2026 (approuvée Telegram,
-- pré-check 0 doublon sur 176 rapports approuvés, exécutée par Abdou via SQL Editor).
-- Verrou DB : au plus un rapport journalier VALIDÉ par chauffeur et par date.
--
-- Contexte : un rapport rejeté peut désormais être "ressaisi" en créant une
-- NOUVELLE ligne (au lieu d'écraser la ligne rejetée) — voir app/driver/page.tsx
-- (ReportTab, ReportHistoryCard). Plusieurs lignes peuvent donc coexister pour
-- le même (tenant_id, driver_id, date) : une rejetée (historique) + une active
-- (submitted, puis approved). Les écrans admin (app/admin/page.tsx::updateStatus,
-- components/SimpleModeAdmin.tsx::reportAction) vérifient déjà côté app qu'aucun
-- autre rapport n'est approuvé pour cette date avant de valider — cet index
-- unique est le filet de sécurité DB contre une course entre deux validations
-- concurrentes (deux onglets admin, ou double-clic).
--
-- Index unique PARTIEL (uniquement sur status = 'approved') : les rapports
-- rejetés/soumis/archivés peuvent coexister librement pour la même date.
-- Idempotente.
--
-- ⚠️ Avant d'appliquer en prod : vérifier qu'aucun (tenant_id, driver_id, date)
-- n'a déjà 2 rapports 'approved' aujourd'hui, sinon CREATE INDEX échoue :
--   SELECT tenant_id, driver_id, date, count(*)
--   FROM fleet.daily_reports WHERE status = 'approved'
--   GROUP BY tenant_id, driver_id, date HAVING count(*) > 1;
-- S'il y en a, les résoudre (rejeter le doublon en trop) avant de lancer cette migration.

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_reports_one_approved_per_day
  ON fleet.daily_reports (tenant_id, driver_id, date)
  WHERE status = 'approved';
