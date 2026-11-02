import { useEffect, useMemo, useState } from 'react';
import { LuCrown } from 'react-icons/lu';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { initialState } from '../engine/index.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { coins, type Rarity, type ShopItem } from '../services/shop.ts';
import { fxOf, registerSkins, skinClasses } from '../services/skins.ts';
import { Board } from './Board.tsx';

/** 🪙 12 500 */
export function CoinBadge({ value, to, className = '' }: { value: number | null; to?: string; className?: string }) {
  const body = (
    <>
      <span className="coin-ico" aria-hidden="true">
        🪙
      </span>
      <strong>{value === null ? '…' : coins(value)}</strong>
    </>
  );
  return to ? (
    <Link to={to} className={`coin-badge ${className}`}>
      {body}
    </Link>
  ) : (
    <span className={`coin-badge ${className}`}>{body}</span>
  );
}

export function RarityBadge({ r }: { r: Rarity }) {
  const { t } = useI18n();
  return <span className={`rarity rarity-${r}`}>{t(`rarity.${r}` as TKey)}</span>;
}

/** skin classes for previewing an item on top of what the player already uses */
export function usePreviewClass(item: Pick<ShopItem, 'slug' | 'slot' | 'style'> | null) {
  const cos = useCosmetics();
  return useMemo(() => {
    if (!item) return cos?.boardClass ?? '';
    registerSkins([{ slug: item.slug, slot: item.slot, style: item.style }]);
    const eq = cos?.equipped;
    return skinClasses({
      piece: item.slot === 'piece' ? item.slug : eq?.piece?.slug,
      board: item.slot === 'board' ? item.slug : eq?.board?.slug,
      effect: item.slot === 'effect' ? { slug: item.slug, fx: fxOf(item.style) } : null,
    });
  }, [item, cos?.equipped, cos?.boardClass]);
}

// one shared clock for all looping effect previews (re-mounts the burst)
let tickers = 0;
function useLoop(ms: number, on: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    tickers++;
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => {
      tickers--;
      clearInterval(id);
    };
  }, [ms, on]);
  return n;
}

/** Small 4×4 board with one white and one black piece (cards). */
export function MiniPreview({ item }: { item: Pick<ShopItem, 'slug' | 'slot' | 'style'> }) {
  const cls = usePreviewClass(item);
  const loop = useLoop(2200, item.slot === 'effect');
  const sq = Array.from({ length: 16 }, (_, i) => i);
  return (
    <div className={`board-wrap mini-skin ${cls}`} aria-hidden="true">
      <div className="board mini-board4">
        {sq.map((i) => {
          const r = Math.floor(i / 4);
          const c = i % 4;
          const dark = (r + c) % 2 === 1;
          return (
            <div key={i} className={`sq ${dark ? 'sq-dark' : 'sq-light'} ${i === 6 && item.slot === 'effect' ? 'sq-last' : ''}`}>
              {item.slot === 'effect' && i === 6 && <span className="fx-burst" key={loop} />}
            </div>
          );
        })}
        <div className="pieces">
          <div className="piece piece-b" style={{ ['--x' as string]: 1, ['--y' as string]: 0 }}>
            <span className="piece-disc">
              <i className="pfx" />
            </span>
          </div>
          <div className="piece piece-w piece-king" style={{ ['--x' as string]: 2, ['--y' as string]: 1 }}>
            <span className="piece-disc">
              <i className="pfx" />
              <LuCrown className="piece-crown" />
            </span>
          </div>
          <div className="piece piece-w" style={{ ['--x' as string]: 0, ['--y' as string]: 3 }}>
            <span className="piece-disc">
              <i className="pfx" />
            </span>
          </div>
          <div className="piece piece-b" style={{ ['--x' as string]: 3, ['--y' as string]: 2 }}>
            <span className="piece-disc">
              <i className="pfx" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Full 8×8 board in the starting position with the item applied (detail view, "try before you buy"). */
export function FullPreview({ item }: { item: Pick<ShopItem, 'slug' | 'slot' | 'style'> }) {
  const cls = usePreviewClass(item);
  const st = useMemo(() => initialState(), []);
  const ids = useMemo(() => st.board.map((c, i) => (c !== 0 ? i : -1)), [st]);
  const loop = useLoop(1800, item.slot === 'effect');
  // effect preview: a white man "moves" back and forth so the landing burst replays
  const board = useMemo(() => {
    if (item.slot !== 'effect') return st.board;
    const b = st.board.slice();
    const from = loop % 2 === 0 ? 42 : 35;
    const to = loop % 2 === 0 ? 35 : 42;
    b[to] = b[from];
    b[from] = 0;
    return b;
  }, [st, loop, item.slot]);
  const last = item.slot === 'effect' ? (loop % 2 === 0 ? { from: 42, to: 35 } : { from: 35, to: 42 }) : null;
  const moveIds = useMemo(() => {
    if (item.slot !== 'effect') return ids;
    const x = ids.slice();
    const from = loop % 2 === 0 ? 42 : 35;
    const to = loop % 2 === 0 ? 35 : 42;
    x[to] = 42;
    x[from] = -1;
    return x;
  }, [ids, loop, item.slot]);
  return (
    <div className="full-preview">
      <Board
        board={board}
        ids={moveIds}
        flipped={false}
        selected={null}
        targets={[]}
        pathMarks={[]}
        mustMove={[]}
        hint={null}
        lastMove={last}
        showLegal={false}
        disabled
        shake={0}
        onSquare={() => {}}
        skin={cls}
      />
    </div>
  );
}
