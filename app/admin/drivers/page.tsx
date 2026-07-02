"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/context";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Driver {
  id: string;
  driver_id: string;
  full_name: string;
  email: string;
  created_at: string;
  comm_yango: number | null;
  comm_partner: number | null;
  hire_date: string | null;
  solde_initial: number | null;
}

type SettingsForm = { comm_yango: string; comm_partner: string; hire_date: string; solde_initial: string };

export default function DriversPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    driverId: "",
    fullName: "",
    password: "",
    paymentFrequency: "monthly",
  });

  // Édition des paramètres commission/rému par chauffeur
  const [editId, setEditId] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({ comm_yango: "", comm_partner: "", hire_date: "", solde_initial: "" });
  const [savingSettings, setSavingSettings] = useState(false);

  const openSettings = (d: Driver) => {
    setEditId(editId === d.id ? null : d.id);
    setSettingsForm({
      comm_yango: d.comm_yango != null ? String(d.comm_yango) : "",
      comm_partner: d.comm_partner != null ? String(d.comm_partner) : "",
      hire_date: d.hire_date || "",
      solde_initial: d.solde_initial != null ? String(d.solde_initial) : "",
    });
  };

  const saveSettings = async (driverProfileId: string) => {
    setSavingSettings(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", driverProfileId, ...settingsForm }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      setSuccess("Paramètres du chauffeur enregistrés");
      setEditId(null);
      await loadDrivers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    loadDrivers();
  }, []);

  const loadDrivers = async () => {
    try {
      setLoadingDrivers(true);
      const res = await fetch("/api/admin/drivers");
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur chargement");
      const { drivers: driversList } = await res.json();
      setDrivers(driversList);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingDrivers(false);
    }
  };

  const handleCreateDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (!formData.driverId || !formData.fullName || !formData.password) {
        setError("Tous les champs sont requis");
        setFormLoading(false);
        return;
      }

      const response = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          adminUserId: user?.id,
          driverId: formData.driverId.toUpperCase(),
          fullName: formData.fullName,
          password: formData.password,
          paymentFrequency: formData.paymentFrequency,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Erreur lors de la création");
      }

      setSuccess(
        `Conducteur ${formData.driverId.toUpperCase()} créé avec succès`
      );
      setFormData({ driverId: "", fullName: "", password: "", paymentFrequency: "monthly" });
      setShowForm(false);

      // Reload drivers list
      await loadDrivers();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la création du conducteur");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteDriver = async (driverId: string) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le conducteur ${driverId} ?`)) {
      return;
    }

    try {
      const response = await fetch("/api/admin/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          adminUserId: user?.id,
          driverId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Erreur lors de la suppression");
      }

      setSuccess(`Conducteur ${driverId} supprimé`);
      await loadDrivers();
    } catch (err: any) {
      setError(err.message || "Erreur lors de la suppression");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-600">Chargement...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-700 px-6 py-4 bg-gray-800 sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-gray-400 hover:text-white"
            >
              ← Retour
            </button>
            <h1 className="text-2xl font-bold text-white">Gestion des conducteurs</h1>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-4 py-2 rounded"
          >
            {showForm ? "Annuler" : "+ Nouveau conducteur"}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="p-6 max-w-4xl mx-auto">
        {error && (
          <div className="bg-red-900 bg-opacity-30 border border-red-600 rounded px-4 py-3 mb-6 text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-900 bg-opacity-30 border border-green-600 rounded px-4 py-3 mb-6 text-green-300">
            {success}
          </div>
        )}

        {showForm && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-bold text-white mb-4">Créer un nouveau conducteur</h2>
            <form onSubmit={handleCreateDriver} className="space-y-4">
              <div>
                <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
                  ID Conducteur (ex: DRV001)
                </label>
                <input
                  type="text"
                  value={formData.driverId}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      driverId: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="DRV001"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
                  Nom complet
                </label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) =>
                    setFormData({ ...formData, fullName: e.target.value })
                  }
                  placeholder="Moussa Diallo"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
                  Mot de passe
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  placeholder="••••••••"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-yellow-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
                  Rythme de paiement
                </label>
                <select
                  value={formData.paymentFrequency}
                  onChange={(e) => setFormData({ ...formData, paymentFrequency: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white focus:outline-none focus:border-yellow-500"
                >
                  <option value="weekly">Hebdomadaire (chaque semaine)</option>
                  <option value="biweekly">Quinzaine (tous les 15 jours)</option>
                  <option value="monthly">Mensuel (fin de mois)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={formLoading}
                className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-black font-semibold py-2 rounded"
              >
                {formLoading ? "Création..." : "Créer le conducteur"}
              </button>
            </form>
          </div>
        )}

        {/* Drivers list */}
        {loadingDrivers ? (
          <div className="text-center text-gray-400 py-12">Chargement...</div>
        ) : drivers.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            Aucun conducteur. Créez-en un pour commencer.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {drivers.map((driver) => (
              <div key={driver.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-bold text-white">{driver.driver_id}</div>
                    <div className="text-sm text-gray-400">{driver.full_name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Créé: {new Date(driver.created_at).toLocaleDateString("fr-FR")}
                      {driver.comm_yango != null && <span className="ml-2 text-yellow-600">· Yango {driver.comm_yango}%</span>}
                      {driver.hire_date && <span className="ml-2 text-gray-400">· Entré {new Date(driver.hire_date).toLocaleDateString("fr-FR")}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openSettings(driver)}
                      className="bg-gray-700 hover:bg-gray-600 text-yellow-400 font-semibold px-4 py-2 rounded text-sm"
                    >
                      {editId === driver.id ? "Fermer" : "⚙️ Paramètres"}
                    </button>
                    <button
                      onClick={() => handleDeleteDriver(driver.driver_id || driver.id)}
                      className="bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded text-sm"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>

                {editId === driver.id && (
                  <div className="mt-4 pt-4 border-t border-gray-700">
                    <p className="text-xs text-gray-500 mb-3">
                      Taux vides → repli automatique sur le véhicule puis la config tenant.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Commission Yango (%)</label>
                        <input type="number" step="0.01" value={settingsForm.comm_yango}
                          onChange={(e) => setSettingsForm({ ...settingsForm, comm_yango: e.target.value })}
                          placeholder="ex: 15"
                          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Commission partenaire (%)</label>
                        <input type="number" step="0.01" value={settingsForm.comm_partner}
                          onChange={(e) => setSettingsForm({ ...settingsForm, comm_partner: e.target.value })}
                          placeholder="ex: 0.75"
                          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Date d&apos;entrée (prorata salaire)</label>
                        <input type="date" value={settingsForm.hire_date}
                          onChange={(e) => setSettingsForm({ ...settingsForm, hire_date: e.target.value })}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500"
                          style={{ colorScheme: "dark" }} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Solde wallet initial (XOF)</label>
                        <input type="number" value={settingsForm.solde_initial}
                          onChange={(e) => setSettingsForm({ ...settingsForm, solde_initial: e.target.value })}
                          placeholder="solde de départ"
                          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-yellow-500" />
                      </div>
                    </div>
                    <button
                      onClick={() => saveSettings(driver.id)}
                      disabled={savingSettings}
                      className="mt-3 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded text-sm"
                    >
                      {savingSettings ? "Enregistrement..." : "Enregistrer"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
