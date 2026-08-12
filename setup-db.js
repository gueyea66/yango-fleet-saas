const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Secrets retirés du code (fix audit V2). Fournir via l'environnement.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL et une clé Supabase requis");

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupDatabase() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'setup-yango-db.sql'), 'utf-8');

    // Split SQL into individual statements
    const statements = sql.split(';').filter(s => s.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        console.log('Executing:', statement.substring(0, 50) + '...');
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        if (error) {
          console.error('Error:', error);
        } else {
          console.log('✓ Success');
        }
      }
    }

    console.log('Database setup complete!');
  } catch (error) {
    console.error('Setup failed:', error);
  }
}

setupDatabase();
