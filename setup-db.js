const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = 'https://rwadhbebylicjxdroyw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3amFkaGJlYnlsaWNqeGRyb3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDI5NTksImV4cCI6MjA5NDI3ODk1OX0.3_mLtRhLBJyml9LxdfbayjPdsNi5_ngCjRi7cT-eu6Y';

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
