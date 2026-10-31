import { LuCrown } from 'react-icons/lu';

/** Decorative, non-interactive hero visual: a mid-game position with one piece that quietly "moves". */
const WHITE = [[7, 0], [7, 2], [6, 3], [5, 4], [5, 6], [4, 3], [6, 7]];
const BLACK = [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [1, 6], [3, 2]];
const KINGS = new Set(['4,3', '1,6']);

export function HeroBoard() {
  const squares = Array.from({ length: 64 }, (_, i) => i);
  return (
    <div className="hero-board" aria-hidden="true">
      <div className="hero-glow" />
      <div className="board-mini">
        {squares.map((i) => {
          const r = (i / 8) | 0;
          const c = i % 8;
          return <span key={i} className={(r + c) % 2 === 1 ? 'sq sq-dark' : 'sq sq-light'} />;
        })}
        <div className="pieces">
          {WHITE.map(([r, c]) => (
            <div key={`w${r}${c}`} className={`piece piece-w ${KINGS.has(`${r},${c}`) ? 'piece-king' : ''} ${r === 5 && c === 4 ? 'hero-mover' : ''}`} style={{ ['--x' as string]: c, ['--y' as string]: r }}>
              <span className="piece-disc">{KINGS.has(`${r},${c}`) && <LuCrown className="piece-crown" />}</span>
            </div>
          ))}
          {BLACK.map(([r, c]) => (
            <div key={`b${r}${c}`} className={`piece piece-b ${KINGS.has(`${r},${c}`) ? 'piece-king' : ''}`} style={{ ['--x' as string]: c, ['--y' as string]: r }}>
              <span className="piece-disc">{KINGS.has(`${r},${c}`) && <LuCrown className="piece-crown" />}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
