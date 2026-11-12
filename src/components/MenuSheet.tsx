import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IconType } from 'react-icons';
import {
  LuArchive, LuBackpack, LuBan, LuChevronRight, LuCircleHelp, LuCircleUser, LuFrame, LuGraduationCap, LuInfo, LuLayoutGrid, LuLogIn, LuLogOut,
  LuMessageSquareWarning, LuMoon, LuPlus, LuRadio, LuSettings, LuShieldCheck, LuSparkles, LuStar, LuSun, LuUsers, LuX,
  LuGift,
  LuListChecks,
} from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { LANGS, useI18n, type TKey } from '../i18n/index.tsx';
import { Link, useRoute } from '../router.tsx';
import { adminMe } from '../services/admin.ts';
import { coins } from '../services/shop.ts';
import { inTelegram } from '../services/telegram.ts';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { useAuthDialog } from './AuthDialog.tsx';
import { Avatar, LevelBadge } from './Avatar.tsx';
import { closeMainMenu, useMainMenuOpen } from './menuStore.ts';

interface Item {
  to: string;
  key: TKey;
  icon: IconType;
}

/**
 * Main menu (header avatar or the "Profil" tab): who I am + my coins on top, the game places as a tile grid,
 * then account and help lists, language / theme at the bottom. Full-width on phones, a side panel on desktop.
 */
export function MenuSheet() {
  const open = useMainMenuOpen();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { me, mode, signedIn, signOut } = useAuth();
  const { openAuth } = useAuthDialog();
  const cos = useCosmetics();
  const { path, query } = useRoute();
  const [isAdmin, setIsAdmin] = useState(false);
  const onClose = closeMainMenu;

  // closes on navigation and on Escape; the page underneath does not scroll
  useEffect(() => {
    closeMainMenu();
  }, [path, query.toString()]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    if (mode === 'live' && signedIn) adminMe().then((r) => setIsAdmin(!!r.role), () => setIsAdmin(false));
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [open, mode, signedIn, onClose]);
  if (!open) return null;

  const live = mode === 'live';
  const account = live && signedIn;
  const tiles: Item[] = [
    { to: '/shop?cat=pieces', key: 'menu.pieceShop', icon: LuSparkles },
    { to: '/shop?cat=boards', key: 'menu.boardShop', icon: LuLayoutGrid },
    { to: '/live', key: 'menu.live', icon: LuRadio },
    { to: '/live?tab=featured', key: 'menu.featured', icon: LuStar },
    { to: '/play?mode=practice', key: 'menu.training', icon: LuGraduationCap },
    { to: '/archive', key: 'menu.archive', icon: LuArchive },
  ];
  const mine: Item[] = account
    ? [
        { to: '/friends', key: 'nav.friends', icon: LuUsers },
        { to: '/missions', key: 'menu.missions', icon: LuListChecks },
        { to: '/referral', key: 'menu.referral', icon: LuGift },
        { to: '/profile?section=frames', key: 'menu.frames', icon: LuFrame },
        { to: '/inventory', key: 'inv.title', icon: LuBackpack },
        { to: '/settings', key: 'nav.settings', icon: LuSettings },
        { to: '/blocked', key: 'menu.blocked', icon: LuBan },
        ...(isAdmin ? [{ to: '/admin', key: 'menu.admin' as TKey, icon: LuShieldCheck }] : []),
      ]
    : [{ to: '/friends', key: 'nav.friends', icon: LuUsers }, { to: '/settings', key: 'nav.settings', icon: LuSettings }];
  const help: Item[] = [
    { to: '/help', key: 'menu.help', icon: LuCircleHelp },
    ...(account ? [{ to: '/feedback', key: 'menu.feedback' as TKey, icon: LuMessageSquareWarning }] : []),
    { to: '/about', key: 'menu.about', icon: LuInfo },
  ];
  const row = (i: Item) => (
    <li key={i.key + i.to}>
      <Link to={i.to} className="menu-row" onClick={onClose}>
        <span className="menu-row-ico">
          <i.icon />
        </span>
        <span className="menu-row-label">{t(i.key)}</span>
        <LuChevronRight className="menu-row-go" />
      </Link>
    </li>
  );

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <nav className="sheet" aria-label={t('menu.title')} id="main-menu">
        <header className="sheet-head">
          {me && (live ? signedIn : true) ? (
            <div className="sheet-me">
              <Avatar name={me.username} seed={me.avatar} size={52} userId={me.id} />
              <span className="sheet-me-text">
                <strong>{me.username}</strong>
                <span className="sheet-me-sub">
                  {me.rating} <LevelBadge rating={me.rating} label={(n) => t('level.short', { n })} />
                </span>
              </span>
            </div>
          ) : (
            <div className="sheet-me">
              <strong className="sheet-brand">DAMEO</strong>
            </div>
          )}
          <button className="icon-btn sheet-close" onClick={onClose} aria-label={t('common.close')}>
            <LuX />
          </button>
        </header>

        <div className="sheet-body">
          {me && (live ? signedIn : true) ? (
            <Link to="/profile" className="btn btn-secondary btn-block sheet-profile" onClick={onClose}>
              <LuCircleUser /> {t('menu.myProfile')}
            </Link>
          ) : (
            <button
              className="btn btn-primary btn-block sheet-profile"
              onClick={() => {
                onClose();
                openAuth();
              }}
            >
              <LuLogIn /> {t('auth.signIn')}
            </button>
          )}

          {account && (
            <Link to="/wallet" className="sheet-coins" onClick={onClose}>
              <span className="sheet-coins-main">
                <span className="sheet-coins-label">DAMEO Coins</span>
                <span className="sheet-coins-value">🪙 {cos?.balance !== null && cos?.balance !== undefined ? coins(cos.balance) : '—'}</span>
              </span>
              <span className="btn btn-primary btn-sm sheet-coins-add">
                <LuPlus /> {t('menu.topUp')}
              </span>
            </Link>
          )}

          {live && (
            <>
              <h3 className="sheet-group">{t('menu.groupGame')}</h3>
              <ul className="menu-tiles">
                {tiles.map((i) => (
                  <li key={i.to}>
                    <Link to={i.to} className="menu-tile" onClick={onClose}>
                      <i.icon />
                      <span>{t(i.key)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="sheet-group">{t('menu.groupAccount')}</h3>
          <ul className="menu-rows">{mine.map(row)}</ul>

          <h3 className="sheet-group">{t('menu.groupHelp')}</h3>
          <ul className="menu-rows">{help.map(row)}</ul>

          <div className="sheet-prefs">
            <div className="seg" role="radiogroup" aria-label={t('settings.language')}>
              {LANGS.map((l) => (
                <button key={l.code} role="radio" aria-checked={lang === l.code} className={`seg-btn ${lang === l.code ? 'seg-on' : ''}`} onClick={() => setLang(l.code)}>
                  {l.code.toUpperCase()}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={toggle} aria-label={t('settings.theme')}>
              {theme === 'dark' ? <LuSun /> : <LuMoon />} {t(theme === 'dark' ? 'settings.light' : 'settings.dark')}
            </button>
          </div>

          {account && !inTelegram && (
            <button
              className="menu-row menu-row-danger"
              onClick={() => {
                onClose();
                void signOut();
              }}
            >
              <span className="menu-row-ico">
                <LuLogOut />
              </span>
              <span className="menu-row-label">{t('auth.signOut')}</span>
            </button>
          )}
        </div>
      </nav>
    </div>,
    document.body,
  );
}
