-- Migration: Create vehicles + uploads tables in public schema

CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers_own_vehicles" ON public.vehicles FOR ALL USING (driver_id = auth.uid());
CREATE POLICY "admins_vehicles" ON public.vehicles FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "drivers_own_uploads" ON public.uploads FOR ALL USING (driver_id = auth.uid());
CREATE POLICY "admins_uploads" ON public.uploads FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON public.vehicles(driver_id);
CREATE INDEX IF NOT EXISTS idx_uploads_driver ON public.uploads(driver_id);
