import { createClient } from "@supabase/supabase-js";
import { getVirtualEmailForDriver } from "@/lib/auth/utils";
import { requireAdminAuth, getClientIp } from "@/lib/auth/server";
import { getPlanLimits } from "@/lib/plans";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

/** Parse en nombre, ou null si vide/invalide (colonne nullable). */
function numOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    // select("*") : tolère l'absence de colonnes récentes (ex: active avant la migration 029)
    const { data, error } = await adminClient
      .from("profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("role", "driver")
      .order("created_at", { ascending: false });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ drivers: data ?? [] });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: error.status ?? 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Vérifie la session serveur — tenantId vient de la DB, jamais du client
    const { tenantId, userId } = await requireAdminAuth();
    const ip = getClientIp(request as any);

    const body = await request.json();
    const { action, driverId, fullName, password, paymentFrequency, accountType } = body;
    const normAccountType = accountType === "technical" ? "technical" : "driver";

    if (action === "create") {
      if (!driverId || !fullName || !password) {
        return Response.json({ error: "Champs requis manquants" }, { status: 400 });
      }
      // Politique de mot de passe (fix audit V10) : les identifiants chauffeurs
      // sont énumérables (driver-<ID>@…), un mot de passe faible = compte devinable.
      if (String(password).length < 8) {
        return Response.json({ error: "Mot de passe trop court (8 caractères minimum)" }, { status: 400 });
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
          account_type: normAccountType,
          payment_frequency: paymentFrequency || "monthly",
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" })
        .select()
        .single();

      if (profileError) {
        return Response.json({ error: `Erreur profil : ${profileError.message}` }, { status: 500 });
      }

      audit({ tenantId, userId, action: "driver.create", resourceType: "driver", resourceId: driverId, ip });
      return Response.json({ success: true, profile });
    }

    if (action === "update") {
      // Mise à jour des paramètres de rému/commission d'un chauffeur
      const { driverProfileId, comm_yango, comm_partner, hire_date, contract_end_date, solde_initial, salary_model, base_amount, account_type } = body;
      if (!driverProfileId) return Response.json({ error: "driverProfileId manquant" }, { status: 400 });

      // Vérifier que le chauffeur appartient au tenant de l'admin
      const { data: prof } = await adminClient.from("profiles").select("id, tenant_id").eq("id", driverProfileId).single();
      if (!prof || prof.tenant_id !== tenantId) {
        return Response.json({ error: "Chauffeur introuvable dans ce tenant" }, { status: 403 });
      }

      const MODELS = ["fixed", "tiered", "percent", "hybrid", "location"];
      const patch: Record<string, number | string | null> = {
        comm_yango: numOrNull(comm_yango),
        comm_partner: numOrNull(comm_partner),
        solde_initial: numOrNull(solde_initial),
        base_amount: numOrNull(base_amount),
        salary_model: salary_model && MODELS.includes(salary_model) ? salary_model : null,
        hire_date: hire_date ? String(hire_date) : null,
        contract_end_date: contract_end_date ? String(contract_end_date) : null,
        ...(account_type === "driver" || account_type === "technical" ? { account_type } : {}),
        updated_at: new Date().toISOString(),
      };
      const { error: updErr } = await adminClient.from("profiles").update(patch).eq("id", driverProfileId);
      if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

      audit({ tenantId, userId, action: "driver.update_settings", resourceType: "driver", resourceId: driverProfileId, ip });
      return Response.json({ success: true });
    }

    if (action === "set_active") {
      // Désactiver = plus de connexion possible ; l'historique reste intact.
      const { driverProfileId, active } = body;
      if (!driverProfileId || typeof active !== "boolean") {
        return Response.json({ error: "driverProfileId et active (booléen) requis" }, { status: 400 });
      }

      const { data: prof } = await adminClient.from("profiles").select("id, tenant_id").eq("id", driverProfileId).single();
      if (!prof || prof.tenant_id !== tenantId) {
        return Response.json({ error: "Chauffeur introuvable dans ce tenant" }, { status: 403 });
      }

      const { error: updErr } = await adminClient
        .from("profiles")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("id", driverProfileId);
      if (updErr) return Response.json({ error: updErr.message }, { status: 500 });

      audit({ tenantId, userId, action: active ? "driver.activate" : "driver.deactivate", resourceType: "driver", resourceId: driverProfileId, ip });
      return Response.json({ success: true });
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

      // ⚠️ Le véhicule appartient à la FLOTTE, pas au chauffeur.
      // Historiquement fleet.vehicles.driver_id était un FK ON DELETE CASCADE :
      // supprimer le chauffeur effaçait aussi son véhicule (bug prod du Kia K3).
      // On désassigne AVANT la suppression du profil — le véhicule survit, libre.
      // Si la migration 045 n'est pas encore appliquée (driver_id NOT NULL /
      // cascade toujours en place), on refuse la suppression plutôt que de
      // détruire un actif de la flotte.
      const { data: linkedVehicles } = await adminClient
        .from("vehicles")
        .select("id, plate")
        .eq("driver_id", profileId);

      const plates: string[] = (linkedVehicles ?? []).map((v) => String(v.plate ?? ""));

      if (plates.length > 0) {
        const { error: unassignErr } = await adminClient
          .from("vehicles")
          .update({ driver_id: null })
          .eq("driver_id", profileId);

        if (unassignErr) {
          return Response.json(
            {
              error:
                `Suppression annulée : impossible de libérer le(s) véhicule(s) ` +
                `${plates.join(", ")} ` +
                `(${unassignErr.message}). Applique la migration 045 ` +
                `(migrations/045-fix-suppression-chauffeur-supprime-vehicule.sql) ` +
                `puis réessaie — sans elle, supprimer ce chauffeur supprimerait aussi son véhicule.`,
            },
            { status: 409 }
          );
        }
      }

      await adminClient.from("profiles").delete().eq("id", profileId);
      await adminClient.auth.admin.deleteUser(profileId).catch(() => {});
      audit({
        tenantId,
        userId,
        action: "driver.delete",
        resourceType: "driver",
        resourceId: driverId,
        ip,
        changes: {
          before: { vehicles: plates },
          after: { vehicles: [] }, // véhicules conservés, simplement libérés
        },
      });

      return Response.json({
        success: true,
        unassignedVehicles: plates,
      });
    }

    if (action === "reset_password") {
      const { driverProfileId, password } = body;
      if (!driverProfileId || !password || String(password).length < 8) {
        return Response.json({ error: "Mot de passe requis (8 caractères minimum)" }, { status: 400 });
      }
      // Le chauffeur doit appartenir au tenant de l'admin
      const { data: prof } = await adminClient.from("profiles").select("id, tenant_id").eq("id", driverProfileId).single();
      if (!prof || prof.tenant_id !== tenantId) {
        return Response.json({ error: "Chauffeur introuvable dans ce tenant" }, { status: 403 });
      }
      // profile.id === auth user id (créés ensemble)
      const { error: pwErr } = await adminClient.auth.admin.updateUserById(driverProfileId, { password: String(password) });
      if (pwErr) return Response.json({ error: pwErr.message }, { status: 500 });

      audit({ tenantId, userId, action: "driver.reset_password", resourceType: "driver", resourceId: driverProfileId, ip });
      return Response.json({ success: true });
    }

    return Response.json({ error: "Action invalide" }, { status: 400 });

  } catch (error: any) {
    const status = error.status ?? 500;
    return Response.json({ error: error.message }, { status });
  }
}
