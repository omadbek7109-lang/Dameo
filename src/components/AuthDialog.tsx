import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LuLoader, LuRotateCcw, LuSend } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useT } from '../i18n/index.tsx';
import { navigate } from '../router.tsx';
import { db } from '../services/supabase.ts';
import { botUsername, inTelegram, rememberBotUsername } from '../services/telegram.ts';
import { Modal } from './Modal.tsx';

/**
 * DAMEO accounts are Telegram accounts only. Inside Telegram the player is signed in automatically;
 * in a normal browser this dialog sends them to the bot.
 */
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

function TelegramLogo() {
  return (
    <svg className="tg-logo" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#2AABEE" />
      <path d="M14.5 31.2l29.2-11.3c1.4-.5 2.6.3 2.1 2.5l-5 23.5c-.4 1.7-1.4 2.1-2.8 1.3l-7.6-5.6-3.7 3.5c-.4.4-.8.8-1.6.8l.6-7.8 14.2-12.8c.6-.5-.1-.9-1-.3L21.4 36l-7.5-2.3c-1.6-.5-1.7-1.6.6-2.5z" fill="#fff" />
    </svg>
  );
}

function AuthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { mode, tgError } = useAuth();
  const [bot, setBot] = useState<string | null>(botUsername());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || bot || mode !== 'live') return;
    setLoading(true);
    db.invokeFunction<{ ok: boolean; bot_username?: string | null }>('telegram-auth', { info: true })
      .then((r) => {
        if (r?.bot_username) {
          rememberBotUsername(r.bot_username);
          setBot(r.bot_username);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, bot, mode]);

  if (mode === 'demo') {
    return (
      <Modal open={open} onClose={onClose} title={t('auth.demoTitle')}>
        <p className="muted">{t('auth.demoBody')}</p>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => (onClose(), navigate('/profile'))}>
            {t('auth.editDemoProfile')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={t('auth.tgTitle')}>
      <div className="tg-login">
        <TelegramLogo />
        {inTelegram ? (
          <>
            <p className="muted">{tgError ? t('auth.tgRetryBody') : t('auth.tgSigningIn')}</p>
            <button className="btn btn-primary" onClick={() => location.reload()}>
              <LuRotateCcw /> {t('common.retry')}
            </button>
          </>
        ) : (
          <>
            <p className="muted">{t('auth.tgOnlyBody')}</p>
            {loading ? (
              <LuLoader className="spin" />
            ) : bot ? (
              <a className="btn btn-primary btn-lg" href={`https://t.me/${bot}?startapp=web`} target="_blank" rel="noopener noreferrer">
                <LuSend /> {t('auth.openInTelegram')}
              </a>
            ) : (
              <p className="small muted">{t('auth.tgBotUnknown')}</p>
            )}
            <p className="small muted">{t('auth.tgPracticeHint')}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
