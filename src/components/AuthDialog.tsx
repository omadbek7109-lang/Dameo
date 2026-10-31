import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { LuLoader, LuLock, LuMail, LuUser } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useT, type TKey } from '../i18n/index.tsx';
import { validateUsername } from '../services/localProfile.ts';
import { SbError } from '../services/supabase.ts';
import { navigate } from '../router.tsx';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

interface Ctx {
  openAuth: () => void;
}
const AuthUi = createContext<Ctx>({ openAuth: () => {} });
export const useAuthDialog = () => useContext(AuthUi);

export function AuthDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openAuth = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openAuth }), [openAuth]);
  return (
    <AuthUi.Provider value={value}>
      {children}
      <AuthDialog open={open} onClose={() => setOpen(false)} />
    </AuthUi.Provider>
  );
}

function errorKey(e: unknown): TKey {
  if (e instanceof SbError) {
    if (e.status === 400 || e.status === 401) return 'auth.err.credentials';
    if (e.status === 422 || e.status === 409) return 'auth.err.exists';
    if (e.status === 429) return 'auth.err.rate';
  }
  if (e instanceof TypeError) return 'auth.err.network';
  return 'auth.err.generic';
}

function AuthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { mode, signIn, signUp } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<TKey | null>(null);

  if (mode === 'demo') {
    return (
      <Modal open={open} onClose={onClose} title={t('auth.demoTitle')}>
        <p className="muted">{t('auth.demoBody')}</p>
        <div className="row-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose();
              navigate('/profile');
            }}
          >
            {t('auth.editDemoProfile')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </Modal>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('validation.email');
    if (password.length < 8) return setErr('validation.password');
    if (tab === 'up') {
      const u = validateUsername(username);
      if (u) return setErr(u);
    }
    setBusy(true);
    try {
      if (tab === 'in') {
        await signIn(email, password);
        toast('success', t('auth.signedIn'));
        onClose();
      } else {
        const r = await signUp(email, password, username.trim());
        if (r.needsConfirmation) {
          toast('info', t('auth.confirmEmail'));
          setTab('in');
        } else {
          toast('success', t('auth.signedUp'));
          onClose();
        }
      }
    } catch (ex) {
      setErr(errorKey(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={tab === 'in' ? t('auth.signIn') : t('auth.signUp')} locked={busy}>
      <div className="tabs tabs-sm" role="tablist">
        {(['in', 'up'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'tab-active' : ''}`} onClick={() => (setTab(k), setErr(null))}>
            {t(k === 'in' ? 'auth.signIn' : 'auth.signUp')}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="form" noValidate>
        {tab === 'up' && (
          <label className="field">
            <span>{t('auth.username')}</span>
            <span className="input-wrap">
              <LuUser />
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={20} />
            </span>
          </label>
        )}
        <label className="field">
          <span>{t('auth.email')}</span>
          <span className="input-wrap">
            <LuMail />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
          </span>
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <span className="input-wrap">
            <LuLock />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'in' ? 'current-password' : 'new-password'} />
          </span>
        </label>
        {err && (
          <div className="form-error" role="alert">
            {t(err)}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy && <LuLoader className="spin" />} {t(tab === 'in' ? 'auth.signIn' : 'auth.signUp')}
        </button>
      </form>
    </Modal>
  );
}
