import { createClient } from "@supabase/supabase-js";
import { getVirtualEmailForDriver } from "@/lib/auth/utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { action, driverId, fullName, password } = await request.json();

    if (action === "create") {
      if (!driverId || !fullName || !password) {
        return Response.json({ error: "Champs requis manquants" }, { status: 400 });
      }

      const virtualEmail = getVirtualEmailForDriver(driverId.toUpperCase());
      let authUserId: string;

      // Try to create auth user — if already exists, fetch existing one
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: virtualEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: "driver" },
      });

      if (authError) {
        if (authError.message.includes("already been registered") || authError.message.includes("already exists")) {
          // Find auth user by email (case-insensitive)
          const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const existing = users?.find((u: any) =>
            u.email?.toLowerCase() === virtualEmail.toLowerCase()
          );
          if (!existing) {
            return Response.json({ error: `Auth user not found for email ${virtualEmail}` }, { status: 500 });
          }
          authUserId = existing.id;
          // Update password
          await supabase.auth.admin.updateUserById(authUserId, { password });
          // Also fix email to canonical lowercase
          await supabase.auth.admin.updateUserById(authUserId, {
            email: virtualEmail.toLowerCase(),
            email_confirm: true,
          });
        } else {
          return Response.json({ error: authError.message }, { status: 500 });
        }
      } else {
        authUserId = authUser.user!.id;
      }

      // Upsert profile (create or update if exists)
      const { data: profile, error: profileError } = await (supabase as any)
        .from("profiles")
        .upsert({
          id: authUserId,
          email: virtualEmail,
          driver_id: driverId.toUpperCase(),
          full_name: fullName,
          role: "driver",
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" })
        .select()
        .single();

      if (profileError) {
        return Response.json({ error: `Erreur profil : ${profileError.message}` }, { status: 500 });
      }

      return Response.json({ success: true, profile });
    }

    if (action === "delete") {
      if (!driverId) {
        return Response.json({ error: "driver_id manquant" }, { status: 400 });
      }

      const { data: profile } = await (supabase as any)
        .from("profiles")
        .select("id")
        .eq("driver_id", driverId)
        .single();

      if (!profile) {
        return Response.json({ error: `Conducteur introuvable : ${driverId}` }, { status: 404 });
      }

      await (supabase as any).from("profiles").delete().eq("id", profile.id);
      await supabase.auth.admin.deleteUser(profile.id).catch(() => {});

      return Response.json({ success: true });
    }

    return Response.json({ error: "Action invalide" }, { status: 400 });

  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
