-- Migration : ajout ref_id sur fleet.uploads pour lier les PJ aux reports
ALTER TABLE fleet.uploads ADD COLUMN IF NOT EXISTS ref_id UUID;
CREATE INDEX IF NOT EXISTS idx_uploads_ref_id ON fleet.uploads(ref_id);
