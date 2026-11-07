import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { framesActive, type FrameId } from '../services/frames.ts';
import { appActive } from '../services/telegram.ts';

/**
 * Which avatars wear a frame right now (one small list for the whole app, refreshed every few minutes and after
 * the player changes theirs). The champion frame only appears while its owner is #1 — the server decides that.
 */
interface Ctx {
  frameOf: (userId?: string | null) => FrameId | null;
  refresh: () => void;
}
const C = createContext<Ctx | null>(null);

export function FramesProvider({ children }: { children: ReactNode }) {
  const { mode, me } = useAuth();
  const [map, setMap] = useState<Map<string, FrameId>>(() => new Map());
  const refresh = useCallback(() => {
    if (mode !== 'live') return;
    framesActive().then(
      (rows) => setMap(new Map((rows ?? []).map((r) => [r.user_id, r.frame]))),
      () => {},
    );
  }, [mode]);
  useEffect(() => {
    refresh();
    const t = setInterval(() => appActive() && refresh(), 3 * 60_000);
    return () => clearInterval(t);
    // re-check when my rating changes (I may have taken or lost #1)
  }, [refresh, me?.rating]);
  const frameOf = useCallback((id?: string | null) => (id ? (map.get(id) ?? null) : null), [map]);
  const value = useMemo(() => ({ frameOf, refresh }), [frameOf, refresh]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useFrames(): Ctx | null {
  return useContext(C);
}
