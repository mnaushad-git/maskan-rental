import { useCallback, useEffect, useRef, useState } from "react";

type FetchState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  refresh: () => void;
};

// Shared fetch/loading/error/refresh state so screens don't each hand-roll
// their own useEffect+try/catch — also distinguishes "still loading", "failed"
// and "refreshing" so screens can show a retry affordance instead of a blank
// empty state when a request fails.
export function useFetch<T>(fetcher: () => Promise<T>, deps: ReadonlyArray<unknown>): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback((isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(false);
    fetcherRef
      .current()
      .then((result) => setData(result))
      .catch(() => setError(true))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => run(true), [run]);

  return { data, loading, refreshing, error, refresh };
}
