/**
 * Telegram Mini App integration (no-op in a normal browser).
 * The official SDK (telegram-web-app.js) is loaded in index.html before the app.
 */
import { readString, writeString } from './localStore.ts';

type TgInsets = { top?: number; bottom?: number; left?: number; right?: number };
interface TgWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name?: string; username?: string; language_code?: string } };
  version: string;
  platform: string;
  isFullscreen?: boolean;
  safeAreaInset?: TgInsets;
  contentSafeAreaInset?: TgInsets;
  ready(): void;
  expand(): void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  isVersionAtLeast?: (v: string) => boolean;
  onEvent(e: string, cb: () => void): void;
  offEvent?: (e: string, cb: () => void) => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium' | 'heavy'): void; notificationOccurred(t: 'error' | 'success' | 'warning'): void };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

export const tg: TgWebApp | null = (() => {
  const w = (globalThis as any).Telegram?.WebApp as TgWebApp | undefined;
  return w && typeof w.initData === 'string' && w.initData.length > 0 ? w : null;
})();
export const inTelegram = tg !== null;

/** Call once at startup: fullscreen, colours, safe areas. */
export function initTelegram(theme: 'light' | 'dark') {
  if (!tg) return;
  document.documentElement.classList.add('in-telegram');
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast?.('8.0') && !tg.isFullscreen && /android|ios/.test(tg.platform)) tg.requestFullscreen?.();
    tg.disableVerticalSwipes?.();
  } catch {
    /* older clients */
  }
  const applyInsets = () => {
    const s = tg.safeAreaInset ?? {};
    const c = tg.contentSafeAreaInset ?? {};
    const root = document.documentElement.style;
    root.setProperty('--tg-top', `${(s.top ?? 0) + (c.top ?? 0)}px`);
    root.setProperty('--tg-bottom', `${(s.bottom ?? 0) + (c.bottom ?? 0)}px`);
  };
  applyInsets();
  tg.onEvent('safeAreaChanged', applyInsets);
  tg.onEvent('contentSafeAreaChanged', applyInsets);
  tg.onEvent('fullscreenChanged', applyInsets);
  setTelegramColors(theme);
}

export function setTelegramColors(theme: 'light' | 'dark') {
  if (!tg) return;
  const bg = theme === 'dark' ? '#0a1020' : '#f2f5fb';
  try {
    tg.setHeaderColor?.(bg);
    tg.setBackgroundColor?.(bg);
    tg.setBottomBarColor?.(bg);
  } catch {
    /* unsupported */
  }
}

export function haptic(kind: 'move' | 'capture' | 'error' | 'win') {
  const h = tg?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'error') h.notificationOccurred('error');
    else if (kind === 'win') h.notificationOccurred('success');
    else h.impactOccurred(kind === 'capture' ? 'medium' : 'light');
  } catch {
    /* noop */
  }
}

/** `startapp=join_ABC123` → room code */
export function startJoinCode(): string | null {
  const p = tg?.initDataUnsafe?.start_param ?? '';
  const m = /^join_([A-Z0-9]{4,8})$/i.exec(p);
  return m ? m[1].toUpperCase() : null;
}

const BOT_KEY = 'dameo.tg.bot';
export const botUsername = () => readString(BOT_KEY);
export const rememberBotUsername = (u: string | null) => u && writeString(BOT_KEY, u);

/** Share a room invitation inside Telegram. Returns false when not possible. */
export function shareRoomInTelegram(code: string, text: string): boolean {
  const bot = botUsername();
  if (!tg?.openTelegramLink || !bot) return false;
  const link = `https://t.me/${bot}?startapp=join_${code}`;
  tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  return true;
}

export function telegramLanguage(): 'uz' | 'en' | null {
  const l = tg?.initDataUnsafe?.user?.language_code;
  if (!l) return null;
  return l.startsWith('uz') ? 'uz' : l.startsWith('en') ? 'en' : null;
}
