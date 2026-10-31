import { describe, expect, test } from 'bun:test';
import {
  agreeDraw,
  applyToBoard,
  commit,
  idx,
  initialState,
  legalMoves,
  legalMovesFor,
  playMove,
  replay,
  resign,
} from './rules.ts';
import type { Cell, Color, GameState } from './types.ts';
import { positionKey } from './rules.ts';
import { chooseMove } from '../bot/ai.ts';

/** Build a state from a map like { a1: 'w', c3: 'B' } (a1 = bottom-left). */
function make(pieces: Record<string, 'w' | 'W' | 'b' | 'B'>, turn: Color = 'w'): GameState {
  const board: Cell[] = new Array(64).fill(0);
  for (const [sq, p] of Object.entries(pieces)) {
    const c = 'abcdefgh'.indexOf(sq[0]);
    const r = 8 - Number(sq[1]);
    board[idx(r, c)] = ({ w: 1, W: 2, b: -1, B: -2 } as const)[p] as Cell;
  }
  return {
    board,
    turn,
    history: [],
    result: { status: 'playing' },
    quietPlies: 0,
    seen: { [positionKey(board, turn)]: 1 },
  };
}
const sq = (name: string) => idx(8 - Number(name[1]), 'abcdefgh'.indexOf(name[0]));

describe('initial position', () => {
  test('12 pieces each, white to move, 7 legal opening moves', () => {
    const s = initialState();
    expect(s.board.filter((c) => c > 0).length).toBe(12);
    expect(s.board.filter((c) => c < 0).length).toBe(12);
    expect(s.turn).toBe('w');
    expect(legalMoves(s).length).toBe(7);
  });
});

describe('basic moves and illegal attempts', () => {
  test('man moves diagonally forward', () => {
    const out = playMove(initialState(), sq('c3'), [sq('d4')]);
    expect(out.ok).toBe(true);
    expect(out.state.turn).toBe('b');
  });
  test('cannot move an opponent piece', () => {
    const out = playMove(initialState(), sq('b6'), [sq('a5')]);
    expect(out.ok).toBe(false);
    expect(out.error).toBe('not-your-piece');
  });
  test('cannot move an empty square', () => {
    expect(playMove(initialState(), sq('d4'), [sq('e5')]).error).toBe('empty-square');
  });
  test('cannot move backward or sideways with a man', () => {
    const s = make({ c3: 'w', h8: 'b' });
    expect(playMove(s, sq('c3'), [sq('b2')]).ok).toBe(false);
    expect(playMove(s, sq('c3'), [sq('d4')]).ok).toBe(true);
  });
  test('illegal move leaves state untouched', () => {
    const s = initialState();
    const out = playMove(s, sq('c3'), [sq('c5')]);
    expect(out.ok).toBe(false);
    expect(out.state).toBe(s);
  });
});

describe('captures', () => {
  test('capture is mandatory', () => {
    const s = make({ c3: 'w', d4: 'b', g1: 'w', h8: 'b' });
    const moves = legalMoves(s);
    expect(moves.every((m) => m.captures.length > 0)).toBe(true);
    const out = playMove(s, sq('g1'), [sq('h2')]);
    expect(out.ok).toBe(false);
    expect(out.error).toBe('must-capture');
  });
  test('men capture backwards in Russian draughts', () => {
    const s = make({ d4: 'w', c3: 'b', h8: 'b' });
    const m = legalMoves(s);
    expect(m.some((x) => x.from === sq('d4') && x.to === sq('b2'))).toBe(true);
  });
  test('multi-capture sequence is one move and removes all victims', () => {
    const s = make({ a1: 'w', b2: 'b', d4: 'b', h8: 'b' });
    const moves = legalMoves(s).filter((m) => m.from === sq('a1'));
    expect(moves.length).toBe(1);
    expect(moves[0].captures.length).toBe(2);
    const out = playMove(s, sq('a1'), [sq('c3'), sq('e5')]);
    expect(out.ok).toBe(true);
    expect(out.state.board[sq('b2')]).toBe(0);
    expect(out.state.board[sq('d4')]).toBe(0);
    expect(out.state.board[sq('e5')]).toBe(1);
  });
  test('must continue the sequence — stopping halfway is illegal', () => {
    const s = make({ a1: 'w', b2: 'b', d4: 'b', h8: 'b' });
    expect(playMove(s, sq('a1'), [sq('c3')]).ok).toBe(false);
  });
  test('a piece cannot be jumped twice', () => {
    // circular capture attempt around a single victim must not double count
    const s = make({ c3: 'w', d4: 'b', f6: 'b', d6: 'b', h8: 'b', c7: 'b' });
    for (const m of legalMoves(s)) {
      expect(new Set(m.captures).size).toBe(m.captures.length);
    }
  });
});

describe('kings', () => {
  test('flying king moves any distance', () => {
    const s = make({ a1: 'W', h8: 'b' });
    const m = legalMoves(s).filter((x) => x.from === sq('a1'));
    expect(m.length).toBe(6); // b2..g7 along the long diagonal (h8 occupied)
  });
  test('flying king captures from a distance and may land on any empty square beyond', () => {
    const s = make({ a1: 'W', d4: 'b', h8: 'b' });
    const m = legalMoves(s).filter((x) => x.from === sq('a1'));
    const lands = m.map((x) => x.to).sort();
    expect(lands).toEqual([sq('e5'), sq('f6'), sq('g7')].sort());
  });
  test('king must choose a landing that allows continuing the capture', () => {
    const s = make({ a1: 'W', c3: 'b', f4: 'b', h8: 'b' });
    // after c3, only landing d4 (or e5? ) leaving a diagonal to f4... verify all moves capture 2
    const m = legalMoves(s).filter((x) => x.from === sq('a1'));
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => x.captures.length === 2)).toBe(true);
  });
  test('man promotes on last row and turn ends', () => {
    const s = make({ b7: 'w', h2: 'b' });
    const out = playMove(s, sq('b7'), [sq('a8')]);
    expect(out.ok).toBe(true);
    expect(out.state.board[sq('a8')]).toBe(2);
    expect(out.move!.promotes).toBe(true);
    expect(out.state.turn).toBe('b');
  });
  test('man reaching the last row mid-capture continues as a king', () => {
    // white man b6 jumps a7? use: man on c6 captures d7 -> e8 (promotes), then as a king captures along e8-h5 diagonal piece f7? build explicitly
    const s = make({ c6: 'w', d7: 'b', g6: 'b', h1: 'b' });
    // c6 x d7 -> e8 (king now); from e8 the diagonal e8-f7-g6-h5: g6 enemy, h5 empty
    const out = playMove(s, sq('c6'), [sq('e8'), sq('h5')]);
    expect(out.ok).toBe(true);
    expect(out.state.board[sq('h5')]).toBe(2);
    expect(out.state.board[sq('g6')]).toBe(0);
  });
});

describe('game end', () => {
  test('player with no legal moves loses', () => {
    const s = make({ a1: 'w', b2: 'b', c3: 'b', h8: 'b' }, 'w');
    // a1 blocked? a1 jumps b2 -> c3 occupied: no capture, no forward move
    expect(legalMovesFor(s.board, 'w').length).toBe(0);
  });
  test('capturing the last enemy piece wins', () => {
    const s = make({ c3: 'w', d4: 'b' });
    const out = playMove(s, sq('c3'), [sq('e5')]);
    expect(out.state.result).toEqual({ status: 'won', winner: 'w', reason: 'no-moves' });
    expect(legalMoves(out.state).length).toBe(0);
  });
  test('no moves can be played after the game is over', () => {
    const s = make({ c3: 'w', d4: 'b' });
    const done = playMove(s, sq('c3'), [sq('e5')]).state;
    expect(playMove(done, sq('e5'), [sq('f6')]).error).toBe('game-over');
  });
  test('resign ends the game for the opponent', () => {
    const r = resign(initialState(), 'w');
    expect(r.result).toEqual({ status: 'won', winner: 'b', reason: 'resign' });
  });
  test('draw by agreement', () => {
    expect(agreeDraw(initialState()).result.status).toBe('draw');
  });
  test('threefold repetition is a draw', () => {
    let s = make({ a1: 'W', h2: 'B' });
    const cycle: Array<[string, string]> = [
      ['a1', 'b2'], ['h2', 'g1'], ['b2', 'a1'], ['g1', 'h2'],
    ];
    for (let round = 0; round < 3 && s.result.status === 'playing'; round++) {
      for (const [f, t] of cycle) {
        const out = playMove(s, sq(f), [sq(t)]);
        expect(out.ok).toBe(true);
        s = out.state;
        if (s.result.status !== 'playing') break;
      }
    }
    expect(s.result).toEqual({ status: 'draw', reason: 'repetition' });
  });
  test('restart gives a fresh independent state', () => {
    const a = playMove(initialState(), sq('c3'), [sq('d4')]).state;
    const fresh = initialState();
    expect(a.history.length).toBe(1);
    expect(fresh.history.length).toBe(0);
    expect(fresh.turn).toBe('w');
  });
});

describe('replay (used for server-side validation)', () => {
  test('valid game replays, tampered game is rejected', () => {
    const a = playMove(initialState(), sq('c3'), [sq('d4')]);
    const b = playMove(a.state, sq('b6'), [sq('a5')]);
    expect(replay(b.state.history).ok).toBe(true);
    const bad = replay([{ from: sq('c3'), path: [sq('c5')] }]);
    expect(bad.ok).toBe(false);
    expect(bad.badPly).toBe(0);
  });
});

describe('bot', () => {
  test('always returns a legal move at every difficulty', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const s = initialState();
      const m = chooseMove(s, level, { timeMs: 150 });
      expect(m).not.toBeNull();
      expect(legalMoves(s).some((x) => x.from === m!.from && x.to === m!.to)).toBe(true);
    }
  });
  test('hard bot takes a free capture', () => {
    const s = make({ c3: 'b', d4: 'w', h2: 'w', a7: 'b' }, 'b');
    const m = chooseMove(s, 'hard', { timeMs: 150 })!;
    expect(m.captures.length).toBeGreaterThan(0);
  });
  test('bot vs bot completes a full game without illegal moves', () => {
    let s = initialState();
    let plies = 0;
    while (s.result.status === 'playing' && plies < 300) {
      const m = chooseMove(s, plies % 2 === 0 ? 'medium' : 'easy', { timeMs: 30 });
      expect(m).not.toBeNull();
      const out = playMove(s, m!.from, m!.path);
      expect(out.ok).toBe(true);
      s = out.state;
      plies++;
    }
    expect(plies).toBeGreaterThan(10);
  });
});
void applyToBoard; void commit;

describe('server engine copy', () => {
  test('supabase/functions/_shared/engine is identical to src/engine (run `bun run sync-engine`)', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['types.ts', 'rules.ts', 'index.ts']) {
      expect(readFileSync(`supabase/functions/_shared/engine/${f}`, 'utf8')).toBe(readFileSync(`src/engine/${f}`, 'utf8'));
    }
  });
});
