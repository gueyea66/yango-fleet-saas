const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://rwadhbebylicjxdroyw.supabase.co";
const supabaseServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3amFkaGJlYnlsaWNqeGRyb3l3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODcwMjk1OSwiZXhwIjoyMDk0Mjc4OTU5fQ.VZEcfV_iA3aOWFKCMvPRSN8Psx8MoHWNgLSxMSFZVNQ";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createTestUsers() {
  try {
    // Create admin user
    const adminUser = await supabase.auth.admin.createUser({
      email: "admin@yango.sn",
      password: "password123",
      email_confirm: true,
      user_metadata: {
        full_name: "Admin User",
        role: "admin",
      },
    });

    if (adminUser.data) {
      console.log("✓ Admin user created:", adminUser.data.user.id);
    } else if (adminUser.error) {
      console.log("Admin user error:", adminUser.error.message);
    }

    // Create driver user
    const driverUser = await supabase.auth.admin.createUser({
      email: "driver@yango.sn",
      password: "password123",
      email_confirm: true,
      user_metadata: {
        full_name: "Driver User",
        role: "driver",
      },
    });

    if (driverUser.data) {
      console.log("✓ Driver user created:", driverUser.data.user.id);
    } else if (driverUser.error) {
      console.log("Driver user error:", driverUser.error.message);
    }

    console.log("\n✓ Test users created successfully!");
  } catch (error) {
    console.error("Error:", error);
  }
}

createTestUsers();
