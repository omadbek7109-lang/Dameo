import { LuBell, LuCheck, LuGlobe, LuMenu, LuMoon, LuSun, LuTrophy, LuUser, LuUsers, LuHouse, LuSwords, LuMedal } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { useAuth } from '../auth/AuthProvider.tsx';
import { LANGS, useI18n, type TKey } from '../i18n/index.tsx';
import { Link, useRoute } from '../router.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { inTelegram } from '../services/telegram.ts';
import { LevelBadge } from './Avatar.tsx';
import { Avatar } from './Avatar.tsx';
import { useAuthDialog } from './AuthDialog.tsx';
import { Logo } from './Logo.tsx';
import { Popover } from './Popover.tsx';
import { MenuSheet } from './MenuSheet.tsx';
import { useCallback, useState } from 'react';
import { CoinBadge } from './ShopParts.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';

export const NAV: Array<{ to: string; key: TKey; short?: TKey; icon: IconType; match: (p: string) => boolean }> = [
  { to: '/', key: 'nav.home', icon: LuHouse, match: (p) => p === '/' },
  { to: '/play', key: 'nav.play', icon: LuSwords, match: (p) => p.startsWith('/play') || p.startsWith('/game') },
  { to: '/leaderboard', key: 'nav.leaderboard', short: 'nav.leaderboard.short', icon: LuTrophy, match: (p) => p.startsWith('/leaderboard') },
  { to: '/tournaments', key: 'nav.tournaments', short: 'nav.tournaments.short', icon: LuMedal, match: (p) => p.startsWith('/tournaments') },
  { to: '/friends', key: 'nav.friends', icon: LuUsers, match: (p) => p.startsWith('/friends') },
  { to: '/profile', key: 'nav.profile', icon: LuUser, match: (p) => p.startsWith('/profile') },
];

export function Header() {
  const { t, lang, setLang, relative } = useI18n();
  const { theme, toggle } = useTheme();
  const { me, mode, signedIn, signOut, notifications, markAllRead } = useAuth();
  const { openAuth } = useAuthDialog();
  const { path } = useRoute();
  const unread = notifications.filter((n) => !n.read).length;
  const cos = useCosmetics();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="brand" aria-label={t('nav.home')}>
          <Logo size={34} />
        </Link>
        <nav className="nav-desktop" aria-label={t('a11y.mainNav')}>
          {NAV.slice(0, 5).map((n) => (
            <Link key={n.to} to={n.to} className={`nav-link ${n.match(path) ? 'nav-active' : ''}`} aria-current={n.match(path) ? 'page' : undefined}>
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          {mode === 'live' && signedIn && <CoinBadge value={cos?.balance ?? null} to="/wallet" className="coin-badge-header" />}
          {mode === 'demo' && (
            <span className="badge badge-demo hide-sm" title={t('demo.modeHint')}>
              {t('demo.mode')}
            </span>
          )}

          <Popover
            id="lang-menu"
            className="hide-sm"
            button={({ open, toggle: tg, ref, id }) => (
              <button ref={ref} className="icon-btn icon-btn-text" onClick={tg} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={t('a11y.language')}>
                <LuGlobe />
                <span className="icon-btn-label">{lang.toUpperCase()}</span>
              </button>
            )}
          >
            {(close) => (
              <ul className="menu" role="menu">
                {LANGS.map((l) => (
                  <li key={l.code} role="none">
                    <button
                      role="menuitemradio"
                      aria-checked={lang === l.code}
                      className="menu-item"
                      onClick={() => {
                        setLang(l.code);
                        close();
                      }}
                    >
                      <span>{l.label}</span>
                      {lang === l.code && <LuCheck />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Popover>

          <button className="icon-btn theme-toggle hide-sm" onClick={toggle} aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')} title={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}>
            <span className={`theme-icon ${theme === 'dark' ? 'is-on' : ''}`}>
              <LuMoon />
            </span>
            <span className={`theme-icon ${theme === 'light' ? 'is-on' : ''}`}>
              <LuSun />
            </span>
          </button>

          <Popover
            id="notif-menu"
            className="popover-notif"
            button={({ open, toggle: tg, ref, id }) => (
              <button ref={ref} className="icon-btn notif-btn" onClick={tg} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={unread > 0 ? t('notif.unread', { n: unread }) : t('notif.title')}>
                <LuBell />
                {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
              </button>
            )}
          >
            {(close) => (
              <div className="notif-panel">
                <div className="notif-head">
                  <strong>{t('notif.title')}</strong>
                  {unread > 0 && (
                    <button className="link-btn" onClick={markAllRead}>
                      {t('notif.markRead')}
                    </button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <p className="muted small notif-empty">{t('notif.empty')}</p>
                ) : (
                  <ul className="notif-list">
                    {notifications.slice(0, 8).map((n) => (
                      <li key={n.id} className={n.read ? '' : 'unread'}>
                        {n.href ? (
                          <Link to={n.href} className="notif-link" onClick={close}>
                            {n.text}
                          </Link>
                        ) : (
                          <span>{n.text}</span>
                        )}
                        <time className="muted small">{relative(n.ts)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Popover>

          {signedIn && me ? (
            <button className="user-btn" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="main-menu" aria-label={t('menu.title')}>
              <Avatar name={me.username} seed={me.avatar} size={34} />
            </button>
          ) : (
            <>
              <button className="btn btn-primary btn-sm" onClick={openAuth}>
                {t('auth.signIn')}
              </button>
              <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label={t('menu.title')} aria-controls="main-menu">
                <LuMenu />
              </button>
            </>
          )}
          <MenuSheet open={menuOpen} onClose={closeMenu} />
        </div>
      </div>
    </header>
  );
}

export function BottomNav() {
  const t = useI18n().t;
  const { path } = useRoute();
  return (
    <nav className="bottom-nav" aria-label={t('a11y.mainNav')}>
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = n.match(path);
        return (
          <Link key={n.to} to={n.to} className={`bn-item ${active ? 'bn-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon />
            <span>{t(n.short ?? n.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
