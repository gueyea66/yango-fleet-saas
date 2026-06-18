import { createClient } from "@supabase/supabase-js";
import { getVirtualEmailForDriver } from "@/lib/auth/utils";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function POST(request: Request) {
  try {
    const { action, driverId, fullName, password, adminUserId } = await request.json();

    // Resolve tenant_id from the requesting admin's profile
    let tenantId: string | null = null;
    if (adminUserId) {
      const { data: adminProfile } = await adminClient
        .from("profiles")
        .select("tenant_id")
        .eq("id", adminUserId)
        .single();
      tenantId = adminProfile?.tenant_id ?? null;
    }

    if (action === "create") {
      if (!driverId || !fullName || !password) {
        return Response.json({ error: "Champs requis manquants" }, { status: 400 });
      }
      if (!tenantId) {
        return Response.json({ error: "Tenant non identifié — reconnectez-vous" }, { status: 403 });
      }

      const virtualEmail = getVirtualEmailForDriver(driverId.toUpperCase());

      // Create or reuse auth user
      let authUserId: string;
      const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
        email: virtualEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: "driver" },
      });

      if (authError) {
        if (authError.message.includes("already been registered") || authError.message.includes("already exists")) {
          const { data: { users } } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
          const existing = users?.find((u: any) => u.email?.toLowerCase() === virtualEmail.toLowerCase());
          if (!existing) return Response.json({ error: `Utilisateur auth introuvable pour ${virtualEmail}` }, { status: 500 });
          authUserId = existing.id;
          await adminClient.auth.admin.updateUserById(authUserId, { password, email_confirm: true });
        } else {
          return Response.json({ error: authError.message }, { status: 500 });
        }
      } else {
        authUserId = authUser.user!.id;
      }

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .upsert({
          id: authUserId,
          tenant_id: tenantId,
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

      const { data: profile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("driver_id", driverId)
        .single();

      // If not found by driver_id, try by id directly
      const profileId = profile?.id ?? driverId;

      await adminClient.from("profiles").delete().eq("id", profileId);
      await adminClient.auth.admin.deleteUser(profileId).catch(() => {});

      return Response.json({ success: true });
    }

    return Response.json({ error: "Action invalide" }, { status: 400 });

  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
