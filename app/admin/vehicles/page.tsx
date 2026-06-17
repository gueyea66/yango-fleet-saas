"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/context";
import { useRouter } from "next/navigation";
import { useVehicleStats } from "@/lib/hooks/useVehicleStats";

export default function VehiclesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { stats, loading: statsLoading } = useVehicleStats();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/auth/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-lg text-gray-300">Chargement...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-gray-400 hover:text-white mb-4 text-sm"
          >
            ← Retour
          </button>
          <h1 className="text-3xl font-bold text-white">Véhicules - Analytics</h1>
          <p className="text-gray-400 mt-1">Suivi consommation, dépenses et rentabilité</p>
        </div>

        {/* Stats summary */}
        {stats.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-gray-800 border-l-4 border-yellow-500 rounded-lg p-4">
              <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                Revenus totaux
              </div>
              <div className="text-2xl font-bold text-white font-mono mt-2">
                {stats
                  .reduce((sum, s) => sum + s.total_earnings, 0)
                  .toLocaleString("fr-FR")}
                <span className="text-sm text-gray-400"> XOF</span>
              </div>
            </div>

            <div className="bg-gray-800 border-l-4 border-red-500 rounded-lg p-4">
              <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                Total dépenses
              </div>
              <div className="text-2xl font-bold text-white font-mono mt-2">
                {stats
                  .reduce((sum, s) => sum + s.total_expenses, 0)
                  .toLocaleString("fr-FR")}
                <span className="text-sm text-gray-400"> XOF</span>
              </div>
            </div>

            <div className="bg-gray-800 border-l-4 border-green-500 rounded-lg p-4">
              <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                Marge nette
              </div>
              <div className="text-2xl font-bold text-white font-mono mt-2">
                {stats
                  .reduce((sum, s) => sum + s.net_margin, 0)
                  .toLocaleString("fr-FR")}
                <span className="text-sm text-gray-400"> XOF</span>
              </div>
            </div>

            <div className="bg-gray-800 border-l-4 border-blue-500 rounded-lg p-4">
              <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                Conso moyenne
              </div>
              <div className="text-2xl font-bold text-white font-mono mt-2">
                {(
                  stats.reduce((sum, s) => sum + s.avg_fuel_consumption, 0) /
                  stats.length
                ).toFixed(2)}
                <span className="text-sm text-gray-400"> L/100km</span>
              </div>
            </div>
          </div>
        )}

        {/* Vehicles table */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          {statsLoading ? (
            <div className="p-8 text-center text-gray-400">Chargement des données...</div>
          ) : stats.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Aucun véhicule avec données</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-700 border-b border-gray-600">
                  <tr>
                    <th className="text-left px-6 py-3 text-gray-300 font-semibold">
                      Véhicule
                    </th>
                    <th className="text-right px-6 py-3 text-gray-300 font-semibold">
                      Rapports
                    </th>
                    <th className="text-right px-6 py-3 text-gray-300 font-semibold">
                      Revenus
                    </th>
                    <th className="text-right px-6 py-3 text-gray-300 font-semibold">
                      Carburant
                    </th>
                    <th className="text-right px-6 py-3 text-gray-300 font-semibold">
                      Péages
                    </th>
                    <th className="text-right px-6 py-3 text-gray-300 font-semibold">
                      Conso
                    </th>
                    <th className="text-right px-6 py-3 text-gray-300 font-semibold">
                      Marge %
                    </th>
                    <th className="text-right px-6 py-3 text-gray-300 font-semibold">
                      Dernier rapport
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {stats.map((vehicle) => (
                    <tr
                      key={vehicle.vehicle_id}
                      className="hover:bg-gray-700 transition"
                    >
                      <td className="px-6 py-4 text-white font-semibold">
                        {vehicle.vehicle_name}
                      </td>
                      <td className="px-6 py-4 text-right text-gray-300">
                        {vehicle.total_reports}
                      </td>
                      <td className="px-6 py-4 text-right text-yellow-400 font-mono">
                        {vehicle.total_earnings.toLocaleString("fr-FR")} XOF
                      </td>
                      <td className="px-6 py-4 text-right text-gray-300">
                        {vehicle.total_fuel_cost.toLocaleString("fr-FR")} XOF
                        <br />
                        <span className="text-xs text-gray-500">
                          {vehicle.total_fuel_liters.toFixed(1)} L
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-gray-300">
                        {vehicle.total_toll_cost.toLocaleString("fr-FR")} XOF
                      </td>
                      <td className="px-6 py-4 text-right font-mono">
                        <span
                          className={
                            vehicle.avg_fuel_consumption > 0
                              ? "text-orange-400"
                              : "text-gray-500"
                          }
                        >
                          {vehicle.avg_fuel_consumption > 0
                            ? `${vehicle.avg_fuel_consumption.toFixed(2)} L/100km`
                            : "N/A"}
                        </span>
                        <br />
                        <span className="text-xs text-gray-500">
                          {vehicle.distance_km} km
                        </span>
                      </td>
                      <td
                        className={`px-6 py-4 text-right font-semibold font-mono ${
                          vehicle.margin_percent > 0
                            ? "text-green-400"
                            : vehicle.margin_percent < 0
                            ? "text-red-400"
                            : "text-gray-400"
                        }`}
                      >
                        {vehicle.margin_percent.toFixed(1)}%
                      </td>
                      <td className="px-6 py-4 text-right text-gray-400 text-xs">
                        {vehicle.last_report_date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detailed breakdown section */}
        {stats.length > 0 && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            {stats.map((vehicle) => (
              <div
                key={vehicle.vehicle_id}
                className="bg-gray-800 border border-gray-700 rounded-lg p-6"
              >
                <h3 className="text-lg font-bold text-white mb-4">
                  {vehicle.vehicle_name}
                </h3>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Revenus</span>
                    <span className="text-yellow-400 font-mono font-semibold">
                      {vehicle.total_earnings.toLocaleString("fr-FR")} XOF
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-400">Dépenses totales</span>
                    <span className="text-red-400 font-mono">
                      {vehicle.total_expenses.toLocaleString("fr-FR")} XOF
                    </span>
                  </div>

                  <div className="flex justify-between border-t border-gray-700 pt-3">
                    <span className="text-gray-400">Marge nette</span>
                    <span
                      className={`font-mono font-semibold ${
                        vehicle.net_margin > 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {vehicle.net_margin.toLocaleString("fr-FR")} XOF
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-400">Marge %</span>
                    <span
                      className={`font-mono font-semibold ${
                        vehicle.margin_percent > 0
                          ? "text-green-400"
                          : "text-red-400"
                      }`}
                    >
                      {vehicle.margin_percent.toFixed(1)}%
                    </span>
                  </div>

                  <div className="border-t border-gray-700 pt-3 mt-3">
                    <p className="text-gray-500 text-xs mb-2">Carburant</p>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Coût total</span>
                      <span className="text-gray-300 font-mono">
                        {vehicle.total_fuel_cost.toLocaleString("fr-FR")} XOF
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">Litres</span>
                      <span className="text-gray-300 font-mono">
                        {vehicle.total_fuel_liters.toFixed(1)} L
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">Consommation</span>
                      <span className="text-orange-400 font-mono">
                        {vehicle.avg_fuel_consumption > 0
                          ? `${vehicle.avg_fuel_consumption.toFixed(2)} L/100km`
                          : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">Distance</span>
                      <span className="text-gray-300 font-mono">
                        {vehicle.distance_km} km
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-gray-700 pt-3 mt-3">
                    <p className="text-gray-500 text-xs mb-2">Autres</p>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Péages</span>
                      <span className="text-gray-300 font-mono">
                        {vehicle.total_toll_cost.toLocaleString("fr-FR")} XOF
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">Rapports</span>
                      <span className="text-gray-300 font-mono">
                        {vehicle.total_reports}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">Dernier rapport</span>
                      <span className="text-gray-300 text-xs">
                        {vehicle.last_report_date}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
