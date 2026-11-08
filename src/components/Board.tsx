import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { LuCrown } from 'react-icons/lu';
import { isDark, rc, squareName, type Cell } from '../engine/index.ts';
import { useT } from '../i18n/index.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';

interface Props {
  board: Cell[];
  ids: number[];
  flipped: boolean;
  selected: number | null;
  targets: number[];
  pathMarks: number[];
  mustMove: number[];
  hint: { from: number; to: number } | null;
  lastMove: { from: number; to: number } | null;
  showLegal: boolean;
  disabled: boolean;
  shake: number;
  onSquare: (i: number) => void;
  /** skin classes override (shop previews); default = the player's equipped cosmetics */
  skin?: string;
  /** per-side move effect classes (real games: each player's effect plays only on their own moves) */
  fx?: { w?: string; b?: string };
}

const FILES = 'abcdefgh';

function BoardImpl({ board, ids, flipped, selected, targets, pathMarks, mustMove, hint, lastMove, showLegal, disabled, shake, onSquare, skin, fx }: Props) {
  const t = useT();
  const cosmetics = useCosmetics();
  const skinClass = skin ?? cosmetics?.boardClass ?? '';
  const hasFx = /(^| )fx-/.test(skinClass);
  // effect for the last move: the mover's own effect (per side) or, without `fx`, the wrapper's
  const moverCell = lastMove ? board[lastMove.to] : 0;
  const lastFx: string | null = !lastMove ? null : fx ? ((moverCell > 0 ? fx.w : moverCell < 0 ? fx.b : undefined) ?? null) : hasFx ? '' : null;
  const pos = (i: number) => {
    const [r, c] = rc(i);
    return { x: flipped ? 7 - c : c, y: flipped ? 7 - r : r };
  };

  /** is the square shown at display position (row y, col x) a dark one? (flip-aware) */
  const coordDark = (y: number, x: number) => (((flipped ? 7 - y : y) + (flipped ? 7 - x : x)) % 2 === 1);

  const squares = useMemo(() => {
    const list: number[] = [];
    for (let i = 0; i < 64; i++) list.push(i);
    return flipped ? list.reverse() : list;
  }, [flipped]);

  const pieces = useMemo(() => {
    const out: Array<{ id: number; cell: Cell; i: number }> = [];
    for (let i = 0; i < 64; i++) if (board[i] !== 0 && ids[i] >= 0) out.push({ id: ids[i], cell: board[i], i });
    return out.sort((a, b) => a.id - b.id); // stable DOM order keeps CSS transitions attached to the right piece
  }, [board, ids]);

  // Captured stones stay ~0.7 s as a "ghost" so a Premium Stone can shatter (purely visual; the game state is untouched).
  // Only when a move removed a few pieces — never on a new game, an undo or a jump to another position.
  const prevPieces = useRef<Map<number, { id: number; cell: Cell; i: number }>>(new Map());
  const [gone, setGone] = useState<Array<{ id: number; cell: Cell; i: number; k: number }>>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  useEffect(() => {
    const now = new Map(pieces.map((p) => [p.id, p]));
    const old = prevPieces.current;
    prevPieces.current = now;
    if (!lastMove || old.size === 0) return;
    const lost = [...old.values()].filter((p) => !now.has(p.id));
    if (lost.length === 0 || lost.length > 12 || now.size !== old.size - lost.length) return;
    const k = Date.now();
    setGone(lost.map((p) => ({ ...p, k })));
    timers.current.push(window.setTimeout(() => setGone((g) => g.filter((x) => x.k !== k)), 720));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces]);

  // move trail for the last move (only visible for Premium Stones, see stoneMaterials.ts)
  const trail = useMemo(() => {
    if (!lastMove || moverCell === 0) return null;
    const a = pos(lastMove.from);
    const b = pos(lastMove.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { side: moverCell > 0 ? 'w' : 'b', x: (a.x + 0.5) * 12.5, y: (a.y + 0.5) * 12.5, len: Math.hypot(dx, dy) * 12.5, ang: Math.atan2(dy, dx) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMove, moverCell, flipped]);

  const label = (i: number) => {
    const c = board[i];
    const piece = c === 0 ? t('board.empty') : t(c > 0 ? (c === 2 ? 'board.whiteKing' : 'board.whiteMan') : c === -2 ? 'board.blackKing' : 'board.blackMan');
    return `${squareName(i)}, ${piece}`;
  };

  return (
    <div className={`board-wrap ${skinClass}`}>
      <div key={shake} className={`board ${shake > 0 ? 'board-shake' : ''} ${disabled ? 'board-disabled' : ''}`} role="grid" aria-label={t('board.label')}>
        {squares.map((i) => {
          const [r, c] = rc(i);
          const dark = isDark(r, c);
          const p = pos(i);
          const isTarget = showLegal && targets.includes(i);
          const isPath = pathMarks.includes(i);
          const cls = [
            'sq',
            dark ? 'sq-dark' : 'sq-light',
            selected === i ? 'sq-selected' : '',
            lastMove && (lastMove.from === i || lastMove.to === i) ? 'sq-last' : '',
            showLegal && mustMove.includes(i) && selected !== i ? 'sq-must' : '',
            hint && (hint.from === i || hint.to === i) ? 'sq-hint' : '',
            isTarget ? 'sq-target' : '',
            isPath ? 'sq-path' : '',
          ].join(' ');
          const style = { gridColumn: p.x + 1, gridRow: p.y + 1 };
          if (!dark) return <div key={i} className={cls} style={style} aria-hidden="true" />;
          return (
            <button key={i} className={cls} style={style} onClick={() => onSquare(i)} aria-label={label(i)} role="gridcell" aria-selected={selected === i}>
              {isTarget && <span className="mark" />}
              {isPath && <span className="mark mark-path" />}
              {lastFx !== null && lastMove && lastMove.to === i &&
                (lastFx ? (
                  <span className={`fx-host ${lastFx}`} key={`${lastMove.from}-${lastMove.to}`} aria-hidden="true">
                    <span className="fx-burst" />
                  </span>
                ) : (
                  <span className="fx-burst" key={`${lastMove.from}-${lastMove.to}`} aria-hidden="true" />
                ))}
            </button>
          );
        })}
        <div className="pieces" aria-hidden="true">
          {trail && lastMove && (
            <span
              key={`t${lastMove.from}-${lastMove.to}`}
              className={`mv-trail mv-trail-${trail.side}`}
              style={{ left: `${trail.x}%`, top: `${trail.y}%`, width: `${trail.len}%`, ['--a' as string]: `${trail.ang}rad` }}
            />
          )}
          {gone.map(({ id, cell, i, k }) => {
            const p = pos(i);
            return (
              <div key={`g${id}-${k}`} className={`piece piece-gone ${cell > 0 ? 'piece-w' : 'piece-b'} ${cell === 2 || cell === -2 ? 'piece-king' : ''}`} style={{ ['--x' as string]: p.x, ['--y' as string]: p.y }}>
                <span className="piece-disc">
                  <i className="pfx" />
                </span>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <i key={n} className="shard" />
                ))}
              </div>
            );
          })}
          {pieces.map(({ id, cell, i }) => {
            const p = pos(i);
            const white = cell > 0;
            const king = cell === 2 || cell === -2;
            return (
              <div key={id} className={`piece ${white ? 'piece-w' : 'piece-b'} ${king ? 'piece-king' : ''} ${selected === i ? 'piece-selected' : ''}`} style={{ ['--x' as string]: p.x, ['--y' as string]: p.y }}>
                <span className="piece-disc">
                  <i className="pfx" />
                  {king && <LuCrown className="piece-crown" />}
                </span>
              </div>
            );
          })}
        </div>
        {/* coordinates */}
        {Array.from({ length: 8 }, (_, k) => (
          <span key={`f${k}`} className={`coord coord-file ${coordDark(7, k) ? 'coord-on-dark' : 'coord-on-light'}`} style={{ gridColumn: `${k + 1} / ${k + 2}`, gridRow: '1 / 9' }}>
            {flipped ? FILES[7 - k] : FILES[k]}
          </span>
        ))}
        {Array.from({ length: 8 }, (_, k) => (
          <span key={`r${k}`} className={`coord coord-rank ${coordDark(k, 0) ? 'coord-on-dark' : 'coord-on-light'}`} style={{ gridRow: `${k + 1} / ${k + 2}`, gridColumn: '1 / 9' }}>
            {flipped ? k + 1 : 8 - k}
          </span>
        ))}
      </div>
    </div>
  );
}

export const Board = memo(BoardImpl);
