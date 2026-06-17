-- Create schema


-- Profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  driver_id VARCHAR(20) UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'driver')) DEFAULT 'driver',
  phone_number TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Vehicles table
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  registration_number TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT,
  year INTEGER NOT NULL,
  transmission TEXT,
  fuel_type TEXT,
  status TEXT CHECK (status IN ('active', 'inactive', 'maintenance')) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Daily reports table
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_odometer INTEGER NOT NULL,
  end_odometer INTEGER NOT NULL,
  gross_earnings DECIMAL(10, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) DEFAULT 0,
  commission_amount DECIMAL(10, 2) DEFAULT 0,
  net_after_expenses DECIMAL(10, 2) DEFAULT 0,
  expense_count INTEGER DEFAULT 0,
  status TEXT CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')) DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(driver_id, date)
);

-- Expenses table
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Uploads table
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Settings table
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Salary rules table
CREATE TABLE salary_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_monthly_earnings DECIMAL(10, 2) NOT NULL,
  max_monthly_earnings DECIMAL(10, 2) NOT NULL,
  salary_percentage DECIMAL(5, 2) NOT NULL,
  bonus DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_driver_id ON profiles(driver_id);
CREATE INDEX idx_vehicles_driver_id ON vehicles(driver_id);
CREATE INDEX idx_daily_reports_driver_id ON daily_reports(driver_id);
CREATE INDEX idx_daily_reports_date ON daily_reports(date);
CREATE INDEX idx_expenses_report_id ON expenses(report_id);
CREATE INDEX idx_expenses_driver_id ON expenses(driver_id);
CREATE INDEX idx_uploads_user_id ON uploads(user_id);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Profiles: Users can view their own profile, admins can view all
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT
  USING (auth.uid()::text = id OR (SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin');

-- Vehicles: Drivers can view their own vehicles, admins can view all
CREATE POLICY "Drivers can view own vehicles" ON vehicles FOR SELECT
  USING (driver_id = auth.uid()::uuid OR (SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin');

-- Daily reports: Drivers can view/insert their own reports, admins can view all
CREATE POLICY "Drivers can view own reports" ON daily_reports FOR SELECT
  USING (driver_id = auth.uid()::uuid OR (SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin');

CREATE POLICY "Drivers can insert own reports" ON daily_reports FOR INSERT
  WITH CHECK (driver_id = auth.uid()::uuid);

CREATE POLICY "Drivers can update own reports" ON daily_reports FOR UPDATE
  USING (driver_id = auth.uid()::uuid)
  WITH CHECK (driver_id = auth.uid()::uuid);

-- Expenses: Drivers can view/insert their own expenses, admins can view all
CREATE POLICY "Drivers can view own expenses" ON expenses FOR SELECT
  USING (driver_id = auth.uid()::uuid OR (SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin');

CREATE POLICY "Drivers can insert own expenses" ON expenses FOR INSERT
  WITH CHECK (driver_id = auth.uid()::uuid);

-- Uploads: Users can view/insert their own uploads, admins can view all
CREATE POLICY "Users can view own uploads" ON uploads FOR SELECT
  USING (user_id = auth.uid()::uuid OR (SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin');

CREATE POLICY "Users can insert own uploads" ON uploads FOR INSERT
  WITH CHECK (user_id = auth.uid()::uuid);

-- Settings: Only admins can view/insert/update
CREATE POLICY "Admins can manage settings" ON settings FOR ALL
  USING ((SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin');

-- Salary rules: Only admins can view/insert/update
CREATE POLICY "Admins can manage salary rules" ON salary_rules FOR ALL
  USING ((SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()::text) = 'admin');
