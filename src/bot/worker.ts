/// Web Worker: keeps the UI at 60 fps while the hard bot is thinking.
import { chooseMove, hintFor, type Difficulty } from './ai.ts';
import type { GameState } from '../engine/types.ts';

declare const self: {
  onmessage: ((e: { data: { id: number; kind: 'move' | 'hint'; state: GameState; level: Difficulty } }) => void) | null;
  postMessage: (m: unknown) => void;
};

self.onmessage = (e) => {
  const { id, kind, state, level } = e.data;
  try {
    const move = kind === 'hint' ? hintFor(state) : chooseMove(state, level);
    self.postMessage({ id, move });
  } catch (err) {
    self.postMessage({ id, move: null, error: String(err) });
  }
};
