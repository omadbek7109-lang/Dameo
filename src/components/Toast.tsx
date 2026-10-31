import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { LuCircleCheck, LuInfo, LuTriangleAlert, LuX } from 'react-icons/lu';
import { useT } from '../i18n/index.tsx';

export type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
interface ToastCtx {
  toast: (kind: ToastKind, text: string) => void;
}
const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const t = useT();
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (kind: ToastKind, text: string) => {
      const id = ++seq.current;
      setItems((l) => [...l.slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-live="polite" aria-label={t('a11y.notifications')}>
        {items.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon">{x.kind === 'success' ? <LuCircleCheck /> : x.kind === 'error' ? <LuTriangleAlert /> : <LuInfo />}</span>
            <span className="toast-text">{x.text}</span>
            <button className="icon-btn icon-btn-sm" onClick={() => dismiss(x.id)} aria-label={t('common.close')}>
              <LuX />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside ToastProvider');
  return v;
}
