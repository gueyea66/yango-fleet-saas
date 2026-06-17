-- Migration: Add event tracking and analytics tables
-- Adds detailed event entries, attachments, and vehicle metrics for better data analysis

-- 1. Add missing columns to daily_reports
ALTER TABLE daily_reports
ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES vehicles(id),
ADD COLUMN IF NOT EXISTS fuel_liters_total DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS odometer_start INT,
ADD COLUMN IF NOT EXISTS odometer_end INT,
ADD COLUMN IF NOT EXISTS fuel_cost NUMERIC,
ADD COLUMN IF NOT EXISTS toll_cost NUMERIC;

-- 2. EVENT_ENTRIES table - stores each driver event (fuel, toll, balance, control)
CREATE TABLE IF NOT EXISTS event_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id),
  report_id UUID REFERENCES daily_reports(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('fuel', 'toll', 'balance', 'control')),
  date DATE NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  description TEXT,
  odometer INT,
  liters DECIMAL(10, 2),
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. ATTACHMENTS table - stores file references for events
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_entry_id UUID NOT NULL REFERENCES event_entries(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INT,
  mime_type TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. VEHICLE_METRICS table - pre-calculated metrics for analytics/dashboards
CREATE TABLE IF NOT EXISTS vehicle_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  period_date DATE NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('day', 'week', 'month')),
  fuel_cost NUMERIC(10, 2),
  fuel_liters DECIMAL(10, 2),
  fuel_consumption_l_per_100km DECIMAL(10, 2),
  total_expenses NUMERIC(10, 2),
  distance_km INT,
  net_earnings NUMERIC(10, 2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(vehicle_id, period_date, period_type)
);

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_entries_driver_id ON event_entries(driver_id);
CREATE INDEX IF NOT EXISTS idx_event_entries_vehicle_id ON event_entries(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_event_entries_report_id ON event_entries(report_id);
CREATE INDEX IF NOT EXISTS idx_event_entries_date ON event_entries(date);
CREATE INDEX IF NOT EXISTS idx_event_entries_type ON event_entries(type);
CREATE INDEX IF NOT EXISTS idx_attachments_event_entry_id ON attachments(event_entry_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_metrics_vehicle_id ON vehicle_metrics(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_metrics_period ON vehicle_metrics(period_date, period_type);

-- 6. RLS Policies for security
ALTER TABLE event_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_metrics ENABLE ROW LEVEL SECURITY;

-- Drivers can only see their own event entries
CREATE POLICY IF NOT EXISTS drivers_see_own_events ON event_entries
  FOR SELECT USING (driver_id = auth.uid());

-- Drivers can insert their own events
CREATE POLICY IF NOT EXISTS drivers_insert_own_events ON event_entries
  FOR INSERT WITH CHECK (driver_id = auth.uid());

-- Admins can see all events
CREATE POLICY IF NOT EXISTS admins_see_all_events ON event_entries
  FOR SELECT USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- Similar policies for attachments
CREATE POLICY IF NOT EXISTS drivers_see_own_attachments ON attachments
  FOR SELECT USING (
    event_entry_id IN (
      SELECT id FROM event_entries WHERE driver_id = auth.uid()
    )
  );

CREATE POLICY IF NOT EXISTS admins_see_all_attachments ON attachments
  FOR SELECT USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- Everyone can see vehicle metrics (read-only for drivers)
CREATE POLICY IF NOT EXISTS see_vehicle_metrics ON vehicle_metrics
  FOR SELECT USING (true);
