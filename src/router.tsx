import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  let raw = window.location.hash.replace(/^#/, '') || '/';
  // Telegram Mini Apps launch with "#tgWebAppData=...&tgWebAppVersion=..." — that is not a route.
  if (raw.startsWith('tgWebApp') || (!raw.startsWith('/') && raw.includes('='))) raw = '/';
  const [p, q = ''] = raw.split('?');
  const path = p.startsWith('/') ? p : `/${p}`;
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to.startsWith('/') ? to : `/${to}`;
}

/**
 * In-app link. Deliberately has no href: inside Telegram a long press on a real link opens a menu with the site's
 * URL ("Open in Telegram / Copy"), which players don't need and can tap by accident. Click / Enter / Space navigate.
 */
export function Link({ to, children, onClick, onKeyDown, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const go = () => navigate(to);
  return (
    <a
      role="link"
      tabIndex={0}
      data-to={to}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) go();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          go();
        }
      }}
    >
      {children}
    </a>
  );
}
