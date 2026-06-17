# Yango Fleet Manager - Setup Guide

## Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- Supabase account and project

## Installation

1. **Clone and install dependencies**
   ```bash
   npm install
   ```

2. **Configure Supabase**
   - Create a Supabase project at https://supabase.com
   - Go to Project Settings → API
   - Copy your `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   - Update `.env.local` with these credentials:
     ```
     NEXT_PUBLIC_SUPABASE_URL=your_url
     NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
     ```

3. **Create Database Schema**
   - Go to Supabase SQL Editor
   - Run the SQL from `sql/schema.sql`
   - Run the SQL from `sql/seed.sql` to populate test data

4. **Verify Installation**
   ```bash
   npm run build
   npm run dev
   ```
   - Open http://localhost:3000

## Test Credentials

- **Admin**: admin@yango.sn / admin123
- **Driver**: driver@yango.sn / driver123

## Project Structure

```
app/                    # Next.js 14 App Router
├── (auth)/             # Authentication routes
├── admin/              # Admin dashboard
├── driver/             # Driver interface
└── layout.tsx          # Root layout

lib/
├── supabase/           # Supabase clients
├── calculations.ts     # Business logic
├── types/              # TypeScript types
└── ...

sql/
├── schema.sql          # Database schema & RLS
└── seed.sql            # Test data
```

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint

## Database Tables

1. **profiles** - User accounts (admin/driver)
2. **vehicles** - Driver vehicles
3. **daily_reports** - Daily earnings/km logs
4. **expenses** - Daily trip expenses
5. **uploads** - File storage metadata
6. **settings** - App configuration
7. **salary_rules** - Commission and salary tiers

## Security

All tables have Row Level Security (RLS) enabled:
- Drivers see only their own data
- Admins see all data
- Data is encrypted in transit via Supabase Auth

## Commission Rates

- < 15,000 XOF: 15%
- 15,000 - 25,000 XOF: 20%
- 25,000 - 40,000 XOF: 25%
- > 40,000 XOF: 30%
