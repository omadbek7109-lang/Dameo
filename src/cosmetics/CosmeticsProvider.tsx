import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { cosmeticsOf, myNotifications, walletMe, type Cosmetic } from '../services/shop.ts';
import { fxOf, registerSkins, skinClasses, type Slot } from '../services/skins.ts';
import { readJSON, writeJSON } from '../services/localStore.ts';
import { subscribeChanges } from '../services/supabase.ts';

/**
 * Player's DAMEO Coins balance + equipped cosmetics, kept in sync with the server:
 *  - loaded on sign-in, cached for an instant first paint,
 *  - the balance follows the user_wallets row in realtime (top-ups land without a reload, on every device),
 *  - server notifications (top-up, admin actions…) are forwarded to the header bell.
 */
interface Equip {
  piece: Cosmetic | null;
  board: Cosmetic | null;
  effect: Cosmetic | null;
}
interface Ctx {
  balance: number | null;
  equipped: Equip;
  /** classes for any board wrapper (pieces + board + move effect) */
  boardClass: string;
  refreshWallet: () => Promise<void>;
  setEquipped: (slot: Slot, item: Cosmetic | null) => void;
}
const EMPTY: Equip = { piece: null, board: null, effect: null };
const C = createContext<Ctx | null>(null);
const CACHE = 'dameo.cosmetics';

export function CosmeticsProvider({ children }: { children: ReactNode }) {
  const { me, mode, signedIn, notify } = useAuth();
  const uid = mode === 'live' && signedIn ? (me?.id ?? null) : null;
  const [balance, setBalance] = useState<number | null>(null);
  const [equipped, setEq] = useState<Equip>(() => readJSON<Equip>(CACHE, EMPTY));
  const seenNotes = useRef(new Set<number>());

  useEffect(() => {
    registerSkins(
      (['piece', 'board', 'effect'] as Slot[]).flatMap((s) => (equipped[s] ? [{ slug: equipped[s]!.slug, slot: s, style: equipped[s]!.style }] : [])),
    );
  }, [equipped]);

  const refreshWallet = useCallback(async () => {
    if (!uid) return;
    try {
      setBalance(Number((await walletMe()).balance));
    } catch {
      /* keep the last value */
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setBalance(null);
      return;
    }
    let alive = true;
    void refreshWallet();
    cosmeticsOf(uid)
      .then((c) => {
        if (!alive) return;
        const next = { piece: c?.piece ?? null, board: c?.board ?? null, effect: c?.effect ?? null };
        setEq(next);
        writeJSON(CACHE, next);
      })
      .catch(() => {});
    // unread server notifications → bell (once each)
    myNotifications()
      .then((list) => {
        for (const n of [...list].reverse()) {
          if (n.read_at || seenNotes.current.has(n.id)) continue;
          seenNotes.current.add(n.id);
          notify('system', `${n.title}: ${n.body}`, n.kind.startsWith('wallet') ? '/wallet' : undefined);
        }
      })
      .catch(() => {});
    const sub = subscribeChanges(
      `public:wallet:${uid}`,
      [
        { table: 'user_wallets', event: 'UPDATE', filter: `user_id=eq.${uid}` },
        { table: 'user_notifications', event: 'INSERT', filter: `user_id=eq.${uid}` },
      ],
      (e) => {
        if (e.table === 'user_wallets') setBalance(Number(e.record.balance));
        else if (!seenNotes.current.has(e.record.id)) {
          seenNotes.current.add(e.record.id);
          notify('system', `${e.record.title}: ${e.record.body}`, String(e.record.kind).startsWith('wallet') ? '/wallet' : undefined);
        }
      },
    );
    return () => {
      alive = false;
      sub.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const setEquipped = useCallback((slot: Slot, item: Cosmetic | null) => {
    setEq((cur) => {
      const next = { ...cur, [slot]: item };
      writeJSON(CACHE, next);
      return next;
    });
  }, []);

  const boardClass = useMemo(
    () =>
      skinClasses({
        piece: equipped.piece?.slug,
        board: equipped.board?.slug,
        effect: equipped.effect ? { slug: equipped.effect.slug, fx: fxOf(equipped.effect.style) } : null,
      }),
    [equipped],
  );
  const value = useMemo(() => ({ balance, equipped, boardClass, refreshWallet, setEquipped }), [balance, equipped, boardClass, refreshWallet, setEquipped]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

/** Optional: components outside the provider (tests, previews) simply get no cosmetics. */
export function useCosmetics(): Ctx | null {
  return useContext(C);
}
