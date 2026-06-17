import { createClient } from "@/lib/supabase/client";

const VIRTUAL_EMAIL_DOMAIN = "internal.yango";

export function getVirtualEmailForDriver(driverId: string): string {
  return `driver-${driverId}@${VIRTUAL_EMAIL_DOMAIN}`;
}

export async function createDriver(
  driverId: string,
  fullName: string,
  password: string
) {
  const supabase = createClient();
  const virtualEmail = getVirtualEmailForDriver(driverId);

  // Create Supabase auth user with virtual email
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: virtualEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: "driver",
    },
  });

  if (authError) {
    throw new Error(`Failed to create auth user: ${authError.message}`);
  }

  if (!authUser.user) {
    throw new Error("Auth user creation returned no user data");
  }

  // Insert client_users record
  const { data: profile, error: profileError } = await (supabase as any)
    .from("client_users")
    .insert({
      id: authUser.user.id,
      email: virtualEmail,
      driver_id: driverId,
      full_name: fullName,
      role: "driver",
    })
    .select()
    .single();

  if (profileError) {
    throw new Error(`Failed to create client_users record: ${profileError.message}`);
  }

  return profile;
}

export async function updateDriverPassword(
  driverId: string,
  newPassword: string
) {
  const supabase = createClient();

  // Get the driver's auth user ID
  const { data: profile, error: profileError } = await (supabase
    .from("client_users")
    .select("id")
    .eq("driver_id", driverId)
    .single() as any);

  if (profileError || !profile) {
    throw new Error(`Driver not found: ${driverId}`);
  }

  // Update password via admin API
  const { data, error } = await supabase.auth.admin.updateUserById(
    profile.id,
    { password: newPassword }
  );

  if (error) {
    throw new Error(`Failed to update password: ${error.message}`);
  }

  return data;
}

export async function deleteDriver(driverId: string) {
  const supabase = createClient();

  // Get the driver's auth user ID
  const { data: profile, error: profileError } = await (supabase
    .from("client_users")
    .select("id")
    .eq("driver_id", driverId)
    .single() as any);

  if (profileError || !profile) {
    throw new Error(`Driver not found: ${driverId}`);
  }

  // Delete the client_users record (cascades to daily_reports, expenses, vehicles, uploads)
  const { error: deleteError } = await (supabase
    .from("client_users")
    .delete()
    .eq("id", profile.id) as any);

  if (deleteError) {
    throw new Error(`Failed to delete profile: ${deleteError.message}`);
  }

  // Delete the auth user
  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(
    profile.id
  );

  if (authDeleteError) {
    console.error(`Failed to delete auth user: ${authDeleteError.message}`);
    // Continue anyway as profile is already deleted
  }

  return { success: true };
}

export async function getDriverByDriverId(driverId: string) {
  const supabase = createClient();

  const { data, error } = await (supabase
    .from("client_users")
    .select("*")
    .eq("driver_id", driverId)
    .eq("role", "driver")
    .single() as any);

  if (error) {
    return null;
  }

  return data;
}

export async function listAllDrivers() {
  const supabase = createClient() as any;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "driver")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list drivers: ${error.message}`);
  }

  return data;
}
