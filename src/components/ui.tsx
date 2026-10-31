import type { ReactNode } from 'react';
import { LuArrowDown, LuArrowUp, LuMinus } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useI18n } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { useAuthDialog } from './AuthDialog.tsx';

export function SectionHead({ title, action, sub }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function SeeAll({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="link-btn">
      {label} →
    </Link>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'win' | 'loss' | 'gold' }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Delta({ value }: { value: number | undefined }) {
  const { num } = useI18n();
  if (value === undefined) return <span className="delta delta-0"><LuMinus /> —</span>;
  if (value > 0) return <span className="delta delta-up"><LuArrowUp />+{num(value)}</span>;
  if (value < 0) return <span className="delta delta-down"><LuArrowDown />{num(value)}</span>;
  return <span className="delta delta-0"><LuMinus />0</span>;
}

export const winRate = (w: number, l: number, d: number) => {
  const g = w + l + d;
  return g === 0 ? 0 : Math.round((w / g) * 100);
};

/** Shown on pages that need an account when a backend is configured but nobody is signed in. */
export function SignInPrompt({ text }: { text: string }) {
  const { t } = useI18n();
  const { openAuth } = useAuthDialog();
  return (
    <div className="card state">
      <div className="state-title">{t('auth.required')}</div>
      <div className="state-text">{text}</div>
      <button className="btn btn-primary" onClick={openAuth}>
        {t('auth.signIn')}
      </button>
    </div>
  );
}

/** Honest banner for sample data. */
export function DemoNotice({ text }: { text: string }) {
  const { mode } = useAuth();
  if (mode !== 'demo') return null;
  return (
    <div className="notice" role="note">
      <span className="badge badge-demo">DEMO</span>
      <span>{text}</span>
    </div>
  );
}
