import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IconType } from 'react-icons';
import {
  LuArchive, LuBackpack, LuBan, LuBookOpen, LuChevronRight, LuCircleHelp, LuGlobe, LuInfo, LuLayoutGrid, LuLogOut, LuMessageSquareWarning,
  LuMoon, LuPlus, LuRadio, LuSettings, LuShieldCheck, LuSparkles, LuSun, LuWallet, LuX,
} from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { LANGS, useI18n, type TKey } from '../i18n/index.tsx';
import { Link, useRoute } from '../router.tsx';
import { adminMe } from '../services/admin.ts';
import { coins } from '../services/shop.ts';
import { inTelegram } from '../services/telegram.ts';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { Avatar, LevelBadge } from './Avatar.tsx';

interface Item {
  to: string;
  key: TKey;
  icon: IconType;
  extra?: string;
}

/** Main menu (opened from the avatar): rarely used places grouped by topic, plus language / theme. */
export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { me, mode, signedIn, signOut } = useAuth();
  const cos = useCosmetics();
  const { path, query } = useRoute();
  const [isAdmin, setIsAdmin] = useState(false);

  // closes on navigation and on Escape
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const game: Item[] = [
    { to: '/shop?cat=pieces', key: 'menu.pieceShop', icon: LuSparkles },
    { to: '/shop?cat=boards', key: 'menu.boardShop', icon: LuLayoutGrid },
    { to: '/live', key: 'menu.live', icon: LuRadio },
    { to: '/live?tab=featured', key: 'menu.featured', icon: LuSparkles },
    { to: '/play?mode=practice', key: 'menu.training', icon: LuBookOpen },
    { to: '/archive', key: 'menu.archive', icon: LuArchive },
  ];
  const account: Item[] = [
    { to: '/wallet', key: 'menu.balance', icon: LuWallet, extra: cos?.balance !== null && cos?.balance !== undefined ? `🪙 ${coins(cos.balance)}` : undefined },
    { to: '/wallet', key: 'wallet.topUp', icon: LuPlus },
    { to: '/inventory', key: 'inv.title', icon: LuBackpack },
    { to: '/blocked', key: 'menu.blocked', icon: LuBan },
    { to: '/settings', key: 'nav.settings', icon: LuSettings },
    { to: '/help', key: 'menu.help', icon: LuCircleHelp },
    { to: '/feedback', key: 'menu.feedback', icon: LuMessageSquareWarning },
    { to: '/about', key: 'menu.about', icon: LuInfo },
  ];
  const row = (i: Item) => (
    <li key={i.key + i.to}>
      <Link to={i.to} className="menu-row" onClick={onClose}>
        <i.icon className="menu-row-ico" />
        <span>{t(i.key)}</span>
        {i.extra && <span className="menu-row-extra">{i.extra}</span>}
        <LuChevronRight className="menu-row-go" />
      </Link>
    </li>
  );

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <nav className="sheet" aria-label={t('menu.title')} id="main-menu">
        <header className="sheet-head">
          {me ? (
            <Link to="/profile" className="sheet-me" onClick={onClose}>
              <Avatar name={me.username} seed={me.avatar} size={44} />
              <span>
                <strong>{me.username}</strong>
                <span className="muted small">
                  {me.rating} <LevelBadge rating={me.rating} label={(n) => t('level.short', { n })} />
                </span>
              </span>
            </Link>
          ) : (
            <strong>DAMEO</strong>
          )}
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <LuX />
          </button>
        </header>
        <div className="sheet-quick">
          <div className="seg" role="radiogroup" aria-label={t('settings.language')}>
            <LuGlobe className="sheet-quick-ico" />
            {LANGS.map((l) => (
              <button key={l.code} role="radio" aria-checked={lang === l.code} className={`seg-btn ${lang === l.code ? 'seg-on' : ''}`} onClick={() => setLang(l.code)}>
                {l.code.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={toggle} aria-label={t('settings.theme')}>
            {theme === 'dark' ? <LuSun /> : <LuMoon />} {t(theme === 'dark' ? 'settings.light' : 'settings.dark')}
          </button>
        </div>
        <div className="sheet-body">
          {live && (
            <>
              <h3 className="sheet-group">{t('menu.groupGame')}</h3>
              <ul className="menu-rows">{game.map(row)}</ul>
            </>
          )}
          <h3 className="sheet-group">{t('menu.groupAccount')}</h3>
          <ul className="menu-rows">
            {(live && signedIn ? account : account.filter((i) => ['/settings', '/help', '/about'].includes(i.to))).map(row)}
            {isAdmin && row({ to: '/admin', key: 'menu.admin', icon: LuShieldCheck })}
            {live && signedIn && !inTelegram && (
              <li>
                <button
                  className="menu-row"
                  onClick={() => {
                    onClose();
                    void signOut();
                  }}
                >
                  <LuLogOut className="menu-row-ico" />
                  <span>{t('auth.signOut')}</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      </nav>
    </div>,
    document.body,
  );
}
