-- Seed admin and driver profiles
INSERT INTO yango.profiles (id, email, full_name, role, phone_number)
VALUES
  ('550e8400-e29b-41d4-a716-446655440001'::uuid, 'admin@yango.sn', 'Admin Yango', 'admin', '+221770000001'),
  ('550e8400-e29b-41d4-a716-446655440002'::uuid, 'driver@yango.sn', 'Cheikh Ndiaye', 'driver', '+221770000002')
ON CONFLICT (email) DO NOTHING;

-- Seed vehicle
INSERT INTO yango.vehicles (driver_id, registration_number, brand, model, color, year, transmission, fuel_type, status)
VALUES
  ('550e8400-e29b-41d4-a716-446655440002'::uuid, 'SN-001-ABC', 'Toyota', 'Corolla', 'Silver', 2018, 'Automatic', 'Petrol', 'active')
ON CONFLICT (registration_number) DO NOTHING;

-- Seed salary rules
INSERT INTO yango.salary_rules (min_monthly_earnings, max_monthly_earnings, salary_percentage, bonus)
VALUES
  (0, 150000, 60, 0),
  (150000, 250000, 65, 10000),
  (250000, 400000, 70, 20000),
  (400000, 1000000, 75, 50000)
ON CONFLICT DO NOTHING;

-- Seed settings
INSERT INTO yango.settings (key, value)
VALUES
  ('app_version', '1.0.0'),
  ('currency', 'XOF'),
  ('timezone', 'Africa/Dakar')
ON CONFLICT (key) DO NOTHING;

-- Seed daily reports (10 days of test data from 2024-06-01 to 2024-06-10)
INSERT INTO yango.daily_reports
  (driver_id, vehicle_id, date, start_odometer, end_odometer, gross_earnings, commission_rate, commission_amount, net_after_expenses, expense_count, status)
SELECT
  '550e8400-e29b-41d4-a716-446655440002'::uuid,
  (SELECT id FROM yango.vehicles WHERE driver_id = '550e8400-e29b-41d4-a716-446655440002'::uuid LIMIT 1),
  date,
  start_odometer,
  end_odometer,
  gross_earnings,
  commission_rate,
  commission_amount,
  net_after_expenses,
  expense_count,
  'approved'::text
FROM (
  VALUES
    ('2024-06-01'::date, 15420, 15532, 42000, 0.20, 8400, 33600, 2),
    ('2024-06-02'::date, 15532, 15648, 38500, 0.20, 7700, 30800, 2),
    ('2024-06-03'::date, 15648, 15774, 45200, 0.20, 9040, 36160, 3),
    ('2024-06-04'::date, 15774, 15891, 41800, 0.20, 8360, 33440, 2),
    ('2024-06-05'::date, 15891, 16015, 48300, 0.25, 12075, 36225, 3),
    ('2024-06-06'::date, 16015, 16134, 44600, 0.20, 8920, 35680, 2),
    ('2024-06-07'::date, 16134, 16256, 50100, 0.25, 12525, 37575, 4),
    ('2024-06-08'::date, 16256, 16378, 39800, 0.20, 7960, 31840, 2),
    ('2024-06-09'::date, 16378, 16502, 46200, 0.20, 9240, 36960, 3),
    ('2024-06-10'::date, 16502, 16628, 43900, 0.20, 8780, 35120, 2)
) AS t(date, start_odometer, end_odometer, gross_earnings, commission_rate, commission_amount, net_after_expenses, expense_count)
ON CONFLICT (driver_id, date) DO NOTHING;

-- Seed expenses (sample expenses for the reports)
INSERT INTO yango.expenses (report_id, driver_id, category, amount, description)
SELECT
  dr.id,
  dr.driver_id,
  category,
  amount,
  description
FROM yango.daily_reports dr,
LATERAL (
  VALUES
    ('Fuel', 5000::decimal, 'Fuel for the day'),
    ('Maintenance', 3600::decimal, 'Car maintenance'),
    ('Parking', 1500::decimal, 'Parking fee')
) AS t(category, amount, description)
WHERE dr.driver_id = '550e8400-e29b-41d4-a716-446655440002'::uuid
  AND dr.date >= '2024-06-01'::date
ON CONFLICT DO NOTHING;
