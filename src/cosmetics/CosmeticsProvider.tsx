import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { cosmeticsOf, myNotifications, walletMe, type Cosmetic } from '../services/shop.ts';
import { fxOf, matchSkin, registerSkins, skinClasses, type Loadout, type Slot } from '../services/skins.ts';
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

/* ---------------------------------------------------------------- two-player games */
// other players' loadouts, shared by every board on the page (5 min is plenty for a game)
const others = new Map<string, { at: number; p: Promise<Loadout | null> }>();
function loadoutOf(id: string): Promise<Loadout | null> {
  const hit = others.get(id);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.p;
  const p = cosmeticsOf(id)
    .then((c) => {
      if (c) registerSkins((['piece', 'board', 'effect'] as Slot[]).flatMap((s) => (c[s] ? [{ slug: c[s]!.slug, slot: s, style: c[s]!.style }] : [])));
      return c ?? null;
    })
    .catch(() => {
      others.delete(id);
      return null;
    });
  others.set(id, { at: Date.now(), p });
  return p;
}

/**
 * Board classes for a game between two players (`'me'` or the signed-in user's id = my own loadout; null = bot / nobody).
 * Returns undefined when `players` is null — the board then simply uses my own cosmetics (practice, pass-and-play).
 */
export function useMatchSkin(
  players: { white: string | null; black: string | null; whiteRating?: number | null; blackRating?: number | null } | null,
): { cls: string; fx: { w?: string; b?: string } } | undefined {
  const ctx = useCosmetics();
  const { me } = useAuth();
  const myId = me?.id ?? null;
  const [loaded, setLoaded] = useState<Record<string, Loadout | null>>({});
  const isMe = (id: string | null) => id === 'me' || (!!id && id === myId);
  const w = players?.white ?? null;
  const b = players?.black ?? null;
  useEffect(() => {
    let alive = true;
    for (const id of [w, b]) {
      if (!id || isMe(id)) continue;
      void loadoutOf(id).then((l) => alive && setLoaded((cur) => (cur[id] === l ? cur : { ...cur, [id]: l })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, b, myId]);
  const mine: Loadout | null = ctx ? ctx.equipped : null;
  const pick = (id: string | null): Loadout | null => (!id ? null : isMe(id) ? mine : (loaded[id] ?? null));
  const lw = pick(w);
  const lb = pick(b);
  const wr = players?.whiteRating ?? null;
  const br = players?.blackRating ?? null;
  // a player sees their own board; spectators see the shared one
  const viewer: 'w' | 'b' | null = isMe(w) ? 'w' : isMe(b) ? 'b' : null;
  return useMemo(() => (players ? matchSkin(lw, lb, wr, br, viewer) : undefined), [!!players, lw, lb, wr, br, viewer]);
}
