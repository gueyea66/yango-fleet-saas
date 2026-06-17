# Database Setup for Yango Fleet Manager

## Creating the Database Schema

Follow these steps to set up the PostgreSQL database in Supabase:

### 1. Create the `yango` Schema

Log into your Supabase project and go to the **SQL Editor**.

Run the SQL from `sql/schema.sql`:
- This creates 7 tables: profiles, vehicles, daily_reports, expenses, uploads, settings, salary_rules
- Enables Row Level Security (RLS) on all tables
- Creates indexes for performance
- Sets up RLS policies for access control

### 2. Seed Test Data

Run the SQL from `sql/seed.sql`:
- Creates admin account: admin@yango.sn (password: admin123)
- Creates driver account: driver@yango.sn (password: driver123)
- Adds a vehicle record
- Adds 10 days of sample daily reports
- Adds salary tier rules
- Adds sample expenses

### 3. Verify Setup

Check that all tables exist:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'yango' 
ORDER BY table_name;
```

Expected output:
- daily_reports
- expenses
- profiles
- salary_rules
- settings
- uploads
- vehicles

## Row Level Security (RLS) Policies

The following RLS policies are applied:

### profiles
- **SELECT**: Users can view their own profile; admins can view all
- **UPDATE**: Users can update their own profile

### vehicles
- **SELECT**: Drivers see only their vehicles; admins see all

### daily_reports
- **SELECT**: Drivers see their own reports; admins see all
- **INSERT**: Drivers can create their own reports
- **UPDATE**: Drivers can update their own reports

### expenses
- **SELECT**: Drivers see their own expenses; admins see all
- **INSERT**: Drivers can create their own expenses

### uploads
- **SELECT**: Users see their own uploads; admins see all
- **INSERT**: Users can create their own uploads

### settings & salary_rules
- **ALL**: Only admins have access

## Authentication

Supabase Auth is configured with:
- Email/password authentication
- JWT-based session management
- Automatic session refresh via middleware

Test credentials are provided in `SETUP.md`.

## Connection String

Your Supabase project connection details are in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

The browser client uses the ANON key (public, read-only by default).
RLS policies control what each user can actually access.
