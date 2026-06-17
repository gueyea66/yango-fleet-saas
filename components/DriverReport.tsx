"use client";

import { useState } from "react";
import { useReports } from "@/lib/hooks/useReports";

interface DriverReportProps {
  user: any;
  onBack: () => void;
}

export function DriverReport({ user, onBack }: DriverReportProps) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    endOdometer: "",
    yangoGross: "",
    yangoBonus: "",
    offYangoRevenue: "",
    yangoTripCount: "",
    offYangoTripCount: "",
    comment: "",
  });
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { submitReport } = useReports(user?.id);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await submitReport({
        date: form.date,
        endOdometer: parseInt(form.endOdometer) || 0,
        yangoGross: parseFloat(form.yangoGross) || 0,
        yangoBonus: parseFloat(form.yangoBonus) || 0,
        offYangoRevenue: parseFloat(form.offYangoRevenue) || 0,
        yangoTripCount: parseInt(form.yangoTripCount) || 0,
        offYangoTripCount: parseInt(form.offYangoTripCount) || 0,
        comment: form.comment,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la soumission");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="pt-16 text-center pb-24">
        <div className="text-5xl mb-4">📋</div>
        <div className="font-bold text-lg text-white mb-2">Rapport soumis !</div>
        <div className="text-sm text-gray-400 mb-6">
          En attente de validation par l'admin
        </div>
        <button
          onClick={onBack}
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-6 py-3 rounded"
        >
          Retour accueil
        </button>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-24">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="bg-none text-gray-400 text-xl cursor-pointer"
        >
          ←
        </button>
        <h2 className="text-base font-semibold text-white">Rapport journalier</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
            Date
          </label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
          />
        </div>

        <div>
          <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
            Kilométrage fin de journée *
          </label>
          <input
            type="number"
            placeholder="ex: 48900"
            value={form.endOdometer}
            onChange={(e) => setForm({ ...form, endOdometer: e.target.value })}
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
              Brut Yango *
            </label>
            <input
              type="number"
              placeholder="0"
              value={form.yangoGross}
              onChange={(e) => setForm({ ...form, yangoGross: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
            />
          </div>
          <div>
            <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
              Bonus Yango
            </label>
            <input
              type="number"
              placeholder="0"
              value={form.yangoBonus}
              onChange={(e) => setForm({ ...form, yangoBonus: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
            />
          </div>
        </div>

        <div>
          <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
            Courses hors Yango
          </label>
          <input
            type="number"
            placeholder="0"
            value={form.offYangoRevenue}
            onChange={(e) => setForm({ ...form, offYangoRevenue: e.target.value })}
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
              Courses Yango
            </label>
            <input
              type="number"
              placeholder="0"
              value={form.yangoTripCount}
              onChange={(e) => setForm({ ...form, yangoTripCount: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
            />
          </div>
          <div>
            <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
              Courses hors
            </label>
            <input
              type="number"
              placeholder="0"
              value={form.offYangoTripCount}
              onChange={(e) => setForm({ ...form, offYangoTripCount: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white"
            />
          </div>
        </div>

        <div>
          <label className="text-xs uppercase font-semibold text-gray-400 block mb-2">
            Commentaire
          </label>
          <textarea
            rows={2}
            placeholder="Optionnel..."
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-3 text-white resize-none"
          />
        </div>

        {error && (
          <div className="bg-red-900 bg-opacity-30 border border-red-600 rounded px-4 py-3 mb-4 text-red-300 text-sm">
            {error}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-black font-semibold py-3 rounded mt-4"
        >
          {loading ? "Soumission..." : "Soumettre le rapport →"}
        </button>
      </div>
    </div>
  );
}
