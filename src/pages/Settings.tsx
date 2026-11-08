import { useEffect, useState } from 'react';
import { LuMonitor, LuMoon, LuSun } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { LANGS, useI18n } from '../i18n/index.tsx';
import { SUPABASE_URL, backendConfigured } from '../services/config.ts';
import { useSettings } from '../settings/SettingsProvider.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { myHideGames, setHideGames } from '../services/live.ts';
import { playSound } from '../services/sound.ts';
import { Link } from '../router.tsx';

export function Settings() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { settings, update } = useSettings();
  const { mode, resetLocal, me, signedIn } = useAuth();
  const [hide, setHide] = useState<boolean | null>(null);
  useEffect(() => {
    if (mode === 'live' && signedIn && me) myHideGames(me.id).then(setHide, () => setHide(null));
  }, [mode, signedIn, me?.id]);
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  let host = '';
  try {
    host = backendConfigured ? new URL(SUPABASE_URL).host : '';
  } catch {
    host = '';
  }

  return (
    <div className="page page-narrow">
      <h1 className="h1">{t('nav.settings')}</h1>

      <section className="card settings-section">
        <h2 className="h3">{t('settings.appearance')}</h2>
        <div className="setting">
          <div>
            <strong>{t('settings.language')}</strong>
          </div>
          <div className="seg" role="radiogroup" aria-label={t('settings.language')}>
            {LANGS.map((l) => (
              <button key={l.code} role="radio" aria-checked={lang === l.code} className={`seg-btn ${lang === l.code ? 'seg-on' : ''}`} onClick={() => setLang(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div>
            <strong>{t('settings.theme')}</strong>
          </div>
          <div className="seg" role="radiogroup" aria-label={t('settings.theme')}>
            <button role="radio" aria-checked={theme === 'light'} className={`seg-btn ${theme === 'light' ? 'seg-on' : ''}`} onClick={() => setTheme('light')}>
              <LuSun /> {t('settings.light')}
            </button>
            <button role="radio" aria-checked={theme === 'dark'} className={`seg-btn ${theme === 'dark' ? 'seg-on' : ''}`} onClick={() => setTheme('dark')}>
              <LuMoon /> {t('settings.dark')}
            </button>
          </div>
        </div>
      </section>

      <section className="card settings-section">
        <h2 className="h3">{t('settings.gameplay')}</h2>
        <label className="setting">
          <div>
            <strong>{t('settings.showLegal')}</strong>
            <p className="muted small">{t('settings.showLegalHint')}</p>
          </div>
          <input type="checkbox" className="switch" checked={settings.showLegal} onChange={(e) => update({ showLegal: e.target.checked })} />
        </label>
        <label className="setting">
          <div>
            <strong>{t('settings.confirm')}</strong>
            <p className="muted small">{t('settings.confirmHint')}</p>
          </div>
          <input type="checkbox" className="switch" checked={settings.confirmActions} onChange={(e) => update({ confirmActions: e.target.checked })} />
        </label>
        <label className="setting">
          <div>
            <strong>{t('settings.animations')}</strong>
            <p className="muted small">{t('settings.animationsHint')}</p>
          </div>
          <input type="checkbox" className="switch" checked={settings.animations} onChange={(e) => update({ animations: e.target.checked })} />
        </label>
      </section>

      <section className="card settings-section">
        <h2 className="h3">{t('settings.sound')}</h2>
        <label className="setting">
          <div>
            <strong>{t('settings.soundOn')}</strong>
            <p className="muted small">{t('settings.soundHint')}</p>
          </div>
          <input type="checkbox" className="switch" checked={settings.sound} onChange={(e) => { update({ sound: e.target.checked }); if (e.target.checked) setTimeout(() => playSound('move'), 50); }} />
        </label>
        <label className="setting setting-col">
          <strong>
            {t('settings.volume')} · {Math.round(settings.volume * 100)}%
          </strong>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.volume * 100)}
            disabled={!settings.sound}
            onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
            onPointerUp={() => playSound('capture')}
            aria-label={t('settings.volume')}
          />
        </label>
      </section>

      {mode === 'live' && signedIn && (
        <section className="card settings-section">
          <h2 className="h3">{t('settings.privacy')}</h2>
          <label className="setting">
            <div>
              <strong>{t('settings.hideGames')}</strong>
              <p className="muted small">{t('settings.hideGamesHint')}</p>
            </div>
            <input
              type="checkbox"
              className="switch"
              checked={hide ?? false}
              disabled={hide === null}
              onChange={async (e) => {
                const v = e.target.checked;
                setHide(v);
                try {
                  await setHideGames(me!.id, v);
                } catch {
                  setHide(!v);
                  toast('error', t('shop.err.generic'));
                }
              }}
            />
          </label>
          <label className="setting">
            <div>
              <strong>{t('settings.chatOn')}</strong>
              <p className="muted small">{t('settings.chatHint')}</p>
            </div>
            <input type="checkbox" className="switch" checked={!settings.chatHidden} onChange={(e) => update({ chatHidden: !e.target.checked })} />
          </label>
          <Link to="/blocked" className="setting setting-link">
            <strong>{t('menu.blocked')}</strong>
          </Link>
        </section>
      )}

      <section className="card settings-section">
        <h2 className="h3">{t('settings.backend')}</h2>
        <div className="setting setting-col">
          <div className="status-line">
            <LuMonitor />
            {mode === 'live' ? (
              <span>
                <span className="dot dot-on" /> {t('settings.backendLive', { host })}
              </span>
            ) : (
              <span>
                <span className="dot dot-off" /> {t('settings.backendDemo')}
              </span>
            )}
          </div>
          {mode === 'demo' && <p className="muted small">{t('settings.backendHow')}</p>}
        </div>
        {mode === 'demo' && (
          <div className="setting">
            <div>
              <strong>{t('settings.resetTitle')}</strong>
              <p className="muted small">{t('settings.resetHint')}</p>
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => setConfirm(true)}>
              {t('settings.reset')}
            </button>
          </div>
        )}
      </section>

      <section className="card settings-section">
        <h2 className="h3">{t('settings.about')}</h2>
        <p className="muted">{t('settings.aboutText')}</p>
        <p className="muted small">{t('settings.free')}</p>
      </section>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('settings.resetTitle')}>
        <p className="muted">{t('settings.resetConfirm')}</p>
        <div className="row-actions">
          <button
            className="btn btn-danger"
            onClick={() => {
              resetLocal();
              setConfirm(false);
              toast('success', t('settings.resetDone'));
            }}
          >
            {t('common.confirm')}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
