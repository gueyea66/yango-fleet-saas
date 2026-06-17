const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://rwjadhbebylicjxdroyw.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error(
    "Error: SUPABASE_SERVICE_ROLE_KEY environment variable is not set"
  );
  console.log("\nTo run this migration:");
  console.log(
    "1. Copy your Service Role Key from Supabase (Settings > API > Service Role)"
  );
  console.log(
    "2. Run: SUPABASE_SERVICE_ROLE_KEY=<your-key> node add-driver-id-migration.js"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  try {
    console.log("Running migration: Add driver_id column to profiles...");

    // Add driver_id column
    const sql1 = `ALTER TABLE yango.profiles ADD COLUMN IF NOT EXISTS driver_id VARCHAR(20) UNIQUE;`;

    console.log("Executing: " + sql1);
    const { error: error1 } = await supabase.rpc("exec_sql", {
      sql: sql1,
    });

    if (error1) {
      console.error("Error adding driver_id column:", error1);
      return;
    }

    console.log("✓ driver_id column added");

    // Create index
    const sql2 = `CREATE INDEX IF NOT EXISTS idx_profiles_driver_id ON yango.profiles(driver_id);`;

    console.log("Executing: " + sql2);
    const { error: error2 } = await supabase.rpc("exec_sql", {
      sql: sql2,
    });

    if (error2) {
      console.error("Error creating index:", error2);
      return;
    }

    console.log("✓ Index created");

    console.log("\n✓ Migration completed successfully!");
    console.log("\nNow you can:");
    console.log("1. Login as admin: admin@yango.sn / password123");
    console.log("2. Go to Admin > Conducteurs");
    console.log("3. Create a driver with ID: DRV001");
    console.log("4. Login as driver with DRV001 / password123");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
