-- Yango Fleet Database Schema

-- Daily Reports Table
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  date DATE NOT NULL,
  end_odometer INT NOT NULL,
  gross_earnings DECIMAL(10, 2) NOT NULL,
  commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 12.00,
  commission_amount DECIMAL(10, 2) NOT NULL,
  net_after_expenses DECIMAL(10, 2) NOT NULL,
  expense_count INT DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'submitted',
  yango_gross DECIMAL(10, 2),
  yango_bonus DECIMAL(10, 2),
  off_yango_revenue DECIMAL(10, 2),
  yango_trip_count INT,
  off_yango_trip_count INT,
  comment TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(driver_id, date)
);

-- Expenses Table
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  report_id UUID REFERENCES daily_reports(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_reports_driver_id ON daily_reports(driver_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_status ON daily_reports(status);
CREATE INDEX IF NOT EXISTS idx_expenses_driver_id ON expenses(driver_id);
CREATE INDEX IF NOT EXISTS idx_expenses_report_id ON expenses(report_id);
