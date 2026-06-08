import { useState, useEffect, useCallback, useRef } from "react";

export function useMonitoringRefresh(onRefresh: () => void | Promise<void>, intervalMs = 30_000) {
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await onRefreshRef.current();
    setLastRefreshed(new Date());
    setTimeout(() => setIsRefreshing(false), 600);
  }, []);

  useEffect(() => {
    const id = setInterval(handleRefresh, intervalMs);
    return () => clearInterval(id);
  }, [handleRefresh, intervalMs]);

  return { lastRefreshed, isRefreshing, handleRefresh };
}
