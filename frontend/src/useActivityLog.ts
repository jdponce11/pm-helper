import { useEffect, useState } from "react";
import { fetchActivityLog } from "./api";
import type { ActivityLogEntry } from "./types";

export function useActivityLog(projectId: number | null, enabled: boolean) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || projectId == null) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setEntries([]);
    setError(null);
    setLoading(true);

    void fetchActivityLog(projectId)
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load history");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectId]);

  return { entries, loading, error };
}
