import { createClient } from "@supabase/supabase-js";
import { getVirtualEmailForDriver } from "@/lib/auth/utils";
import { requireAdminAuth } from "@/lib/auth/server";
import { getPlanLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function POST(request: Request) {
  try {
    // Vérifie la session serveur — tenantId vient de la DB, jamais du client
    const { tenantId } = await requireAdminAuth();

    const { action, driverId, fullName, password } = await request.json();

    if (action === "create") {
      if (!driverId || !fullName || !password) {
        return Response.json({ error: "Champs requis manquants" }, { status: 400 });
      }

      // Vérification du quota de plan
      const [{ data: tenant }, { count: driverCount }] = await Promise.all([
        adminClient.from("tenants").select("plan").eq("id", tenantId).single(),
        adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("role", "driver"),
      ]);

      const limits = getPlanLimits(tenant?.plan || "standard");
      if (limits.maxDrivers !== Infinity && (driverCount ?? 0) >= limits.maxDrivers) {
        return Response.json(
          { error: `Quota atteint : ${limits.maxDrivers} chauffeurs max pour le plan ${limits.label}` },
          { status: 403 }
        );
      }

      const virtualEmail = getVirtualEmailForDriver(driverId.toUpperCase());

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
          if (!existing) return Response.json({ error: "Utilisateur introuvable" }, { status: 500 });
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

      // Vérifier que le chauffeur appartient bien au tenant de l'admin
      const { data: profile } = await adminClient
        .from("profiles")
        .select("id, tenant_id")
        .eq("driver_id", driverId)
        .single();

      if (profile && profile.tenant_id !== tenantId) {
        return Response.json({ error: "Chauffeur non trouvé dans ce tenant" }, { status: 403 });
      }

      const profileId = profile?.id ?? driverId;
      await adminClient.from("profiles").delete().eq("id", profileId);
      await adminClient.auth.admin.deleteUser(profileId).catch(() => {});

      return Response.json({ success: true });
    }

    return Response.json({ error: "Action invalide" }, { status: 400 });

  } catch (error: any) {
    const status = error.status ?? 500;
    return Response.json({ error: error.message }, { status });
  }
}
