import type { ReactNode } from 'react';
import { LuInbox, LuTriangleAlert } from 'react-icons/lu';
import { useT } from '../i18n/index.tsx';
import { LogoMark } from './Logo.tsx';

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="state-text">{label ?? t('common.loading')}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="state state-error" role="alert">
      <LuTriangleAlert className="state-icon" />
      <div className="state-text">{message ?? t('common.error')}</div>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <LuInbox className="state-icon" />
      <div className="state-title">{title}</div>
      {hint && <div className="state-text">{hint}</div>}
      {action}
    </div>
  );
}

/** Full-screen elegant loader shown while the app boots. */
export function SplashLoader() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-mark">
        <LogoMark size={72} />
      </div>
      <div className="splash-bar" />
    </div>
  );
}

export function DemoBadge({ label }: { label: string }) {
  return <span className="badge badge-demo">{label}</span>;
}
