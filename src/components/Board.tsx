import { memo, useMemo } from 'react';
import { LuCrown } from 'react-icons/lu';
import { isDark, rc, squareName, type Cell } from '../engine/index.ts';
import { useT } from '../i18n/index.tsx';

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
}

const FILES = 'abcdefgh';

function BoardImpl({ board, ids, flipped, selected, targets, pathMarks, mustMove, hint, lastMove, showLegal, disabled, shake, onSquare }: Props) {
  const t = useT();
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

  const label = (i: number) => {
    const c = board[i];
    const piece = c === 0 ? t('board.empty') : t(c > 0 ? (c === 2 ? 'board.whiteKing' : 'board.whiteMan') : c === -2 ? 'board.blackKing' : 'board.blackMan');
    return `${squareName(i)}, ${piece}`;
  };

  return (
    <div className={`board-wrap`}>
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
            </button>
          );
        })}
        <div className="pieces" aria-hidden="true">
          {pieces.map(({ id, cell, i }) => {
            const p = pos(i);
            const white = cell > 0;
            const king = cell === 2 || cell === -2;
            return (
              <div key={id} className={`piece ${white ? 'piece-w' : 'piece-b'} ${king ? 'piece-king' : ''} ${selected === i ? 'piece-selected' : ''}`} style={{ ['--x' as string]: p.x, ['--y' as string]: p.y }}>
                <span className="piece-disc">{king && <LuCrown className="piece-crown" />}</span>
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
