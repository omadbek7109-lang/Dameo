import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/** Runs an async loader; ignores results from stale runs. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(() => {
    const my = ++run.current;
    setLoading(true);
    setError(null);
    fnRef.current().then(
      (d) => {
        if (run.current === my) {
          setData(d);
          setLoading(false);
        }
      },
      (e) => {
        if (run.current === my) {
          setError(e);
          setLoading(false);
        }
      },
    );
  }, []);

  useEffect(() => {
    load();
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: load };
}
