"use client";

import { useEffect, useState } from "react";
import { useReports } from "@/lib/hooks/useReports";

interface DriverHomeProps {
  user: any;
  onNav: (tab: string) => void;
}

export function DriverHome({ user, onNav }: DriverHomeProps) {
  const [todayReport, setTodayReport] = useState<any>(null);
  const [monthlyEarnings, setMonthlyEarnings] = useState<any>(null);
  const { getTodayReport, getMonthlyEarnings } = useReports(user?.id);

  useEffect(() => {
    const loadData = async () => {
      const report = await getTodayReport();
      setTodayReport(report);

      const month = new Date().toISOString().slice(0, 7);
      const earnings = await getMonthlyEarnings(month);
      setMonthlyEarnings(earnings);
    };

    loadData();
  }, [getTodayReport, getMonthlyEarnings]);

  const monthNet = monthlyEarnings?.totalNet || 0;
  const level = { label: "Base", total_salary: 200000 };
  const nextLevel = { label: "Palier 1", min_net: 1000000, total_salary: 230000 };
  const progress = monthNet > 0 ? (monthNet / nextLevel.min_net) * 100 : 0;

  return (
    <div className="pt-4 pb-24">
      <div
        className={`rounded-lg p-4 mb-4 border text-sm ${
          todayReport
            ? "bg-green-900 bg-opacity-20 border-green-600"
            : "bg-yellow-900 bg-opacity-20 border-yellow-600"
        }`}
      >
        <div className={`font-semibold mb-2 ${todayReport ? "text-green-400" : "text-yellow-400"}`}>
          {todayReport
            ? "✓ Rapport aujourd'hui"
            : "⚠ Aucun rapport aujourd'hui"}
        </div>
        <div className="text-gray-300">
          {todayReport
            ? `Statut : ${todayReport.status === "pending" ? "En attente" : "Validé"}`
            : "Pensez à soumettre votre rapport en fin de journée"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => onNav("report")}
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold py-3 rounded-lg text-center text-sm"
        >
          📋
          <br />
          <span className="text-xs block mt-1">
            {todayReport ? "Rapport soumis" : "Faire le rapport"}
          </span>
        </button>
        <button
          onClick={() => onNav("expense")}
          className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 rounded-lg text-center text-sm border border-gray-600"
        >
          💸
          <br />
          <span className="text-xs text-gray-300 block mt-1">Ajouter dépense</span>
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700">
        <div className="text-xs uppercase text-gray-400 tracking-widest font-semibold mb-3">
          Mois en cours
        </div>
        <div className="text-3xl font-bold text-white font-mono mb-1">
          {(monthNet || 0).toLocaleString("fr-FR")} XOF
        </div>
        <div className="text-sm text-gray-400 mb-3">Net validé · {level.label}</div>

        {nextLevel && (
          <>
            <div className="h-1.5 bg-gray-700 rounded overflow-hidden mb-2">
              <div
                className="h-full bg-yellow-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-400">
              {(nextLevel.min_net - monthNet).toLocaleString("fr-FR")} XOF pour atteindre{" "}
              {nextLevel.label}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
