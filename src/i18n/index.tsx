import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readString, writeString } from '../services/localStore.ts';
import { telegramLanguage } from '../services/telegram.ts';
import { en } from './en.ts';
import { uz, type TKey } from './uz.ts';

export type Lang = 'uz' | 'en';
export type { TKey };
export const LANGS: Array<{ code: Lang; label: string; short: string }> = [
  { code: 'uz', label: "O'zbekcha", short: 'UZ' },
  { code: 'en', label: 'English', short: 'EN' },
];
const dictionaries: Record<Lang, Record<TKey, string>> = { uz, en };
const LOCALES: Record<Lang, string> = { uz: 'uz-UZ', en: 'en-GB' };

export type Params = Record<string, string | number>;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, params?: Params) => string;
  num: (n: number) => string;
  date: (ts: number) => string;
  dateTime: (ts: number) => string;
  relative: (ts: number) => string;
}
const Ctx = createContext<I18nCtx | null>(null);

export function translate(lang: Lang, key: TKey, params?: Params): string {
  let s = dictionaries[lang][key] ?? dictionaries.uz[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function initialLang(): Lang {
  const saved = readString('dameo.lang');
  if (saved === 'en' || saved === 'uz') return saved;
  return telegramLanguage() ?? 'uz'; // Uzbek is the default
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writeString('dameo.lang', l);
  }, []);

  const value = useMemo<I18nCtx>(() => {
    const locale = LOCALES[lang];
    const nf = new Intl.NumberFormat(locale);
    const df = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    const dtf = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const UZ_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      num: (n) => nf.format(n),
      date: (ts) => {
        if (lang === 'en') return df.format(ts);
        const d = new Date(ts);
        return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
      },
      dateTime: (ts) => {
        if (lang === 'en') return dtf.format(ts);
        const d = new Date(ts);
        return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      },
      relative: (ts) => {
        const diff = Date.now() - ts;
        const m = Math.round(diff / 60_000);
        if (m < 1) return translate(lang, 'time.justNow');
        if (m < 60) return translate(lang, 'time.minutesAgo', { n: m });
        const h = Math.round(m / 60);
        if (h < 24) return translate(lang, 'time.hoursAgo', { n: h });
        return translate(lang, 'time.daysAgo', { n: Math.round(h / 24) });
      },
    };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Reusable translation hook. */
export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside I18nProvider');
  return v;
}
export const useT = () => useI18n().t;
