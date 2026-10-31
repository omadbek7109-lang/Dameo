import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { readJSON, writeJSON } from '../services/localStore.ts';

export interface Settings {
  /** highlight selectable pieces and legal destination squares */
  showLegal: boolean;
  /** ask before restart / resign */
  confirmActions: boolean;
}
const DEFAULTS: Settings = { showLegal: true, confirmActions: true };
const KEY = 'dameo.settings';

interface Ctx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}
const C = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULTS, ...readJSON<Partial<Settings>>(KEY, {}) }));
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writeJSON(KEY, next);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useSettings(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useSettings must be used inside SettingsProvider');
  return v;
}
