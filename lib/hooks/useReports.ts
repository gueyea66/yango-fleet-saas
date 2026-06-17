import { useState, useEffect, useCallback } from "react";
import * as reportService from "@/lib/services/reports";

export const useReports = (driverId: string | undefined) => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await reportService.getDriverReports(driverId);
      setReports(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch reports");
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const submitReport = useCallback(
    async (data: any) => {
      if (!driverId) throw new Error("Driver ID not found");
      try {
        const report = await reportService.submitDailyReport(driverId, data);
        setReports((prev) => [report, ...prev]);
        return report;
      } catch (err) {
        throw err instanceof Error ? err : new Error("Failed to submit report");
      }
    },
    [driverId]
  );

  const getTodayReport = useCallback(async () => {
    if (!driverId) return null;
    const today = new Date().toISOString().split("T")[0];
    return await reportService.getDailyReport(driverId, today);
  }, [driverId]);

  const getMonthlyEarnings = useCallback(
    async (month: string) => {
      if (!driverId) return null;
      return await reportService.getMonthlyEarnings(driverId, month);
    },
    [driverId]
  );

  return {
    reports,
    loading,
    error,
    submitReport,
    getTodayReport,
    getMonthlyEarnings,
    refetch: fetchReports,
  };
};

export const usePendingReports = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPendingReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportService.getPendingReports();
      setReports(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPendingReports();
  }, [fetchPendingReports]);

  const approveReport = useCallback(async (reportId: string) => {
    try {
      await reportService.approveReport(reportId);
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (err) {
      throw err instanceof Error ? err : new Error("Failed to approve report");
    }
  }, []);

  const rejectReport = useCallback(async (reportId: string, reason: string) => {
    try {
      await reportService.rejectReport(reportId, reason);
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (err) {
      throw err instanceof Error ? err : new Error("Failed to reject report");
    }
  }, []);

  return {
    reports,
    loading,
    error,
    approveReport,
    rejectReport,
    refetch: fetchPendingReports,
  };
};
