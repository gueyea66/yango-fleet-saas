-- RLS Policies for attachments table
-- Drivers can see only their own attachments
-- Admins can see all attachments

-- Allow drivers to read their own attachments
CREATE POLICY "drivers_read_own_attachments" ON attachments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM event_entries
    WHERE event_entries.id = attachments.event_id
    AND event_entries.driver_id = auth.uid()
  )
);

-- Allow admins to read all attachments
CREATE POLICY "admins_read_all_attachments" ON attachments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- Allow drivers to insert attachments for their events
CREATE POLICY "drivers_insert_own_attachments" ON attachments
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM event_entries
    WHERE event_entries.id = attachments.event_id
    AND event_entries.driver_id = auth.uid()
  )
);

-- Allow admins to delete attachments
CREATE POLICY "admins_delete_attachments" ON attachments
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);

-- Enable RLS on attachments table
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
