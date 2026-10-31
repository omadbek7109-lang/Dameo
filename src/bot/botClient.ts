import type { GameState, Move } from '../engine/types.ts';
import { chooseMove, hintFor, type Difficulty } from './ai.ts';

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, (m: Move | null) => void>();
const fallbacks = new Map<number, () => void>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    // single-file builds (e.g. the hosted demo) provide the worker as a blob: URL
    const url = (globalThis as { DAMEO_WORKER_URL?: string }).DAMEO_WORKER_URL ?? '/assets/bot/worker.js';
    worker = new Worker(url, { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data.move ?? null);
    };
    worker.onerror = () => {
      // fall back to main-thread search for every waiting request
      workerBroken = true;
      worker = null;
      const waiting = [...fallbacks.values()];
      fallbacks.clear();
      waiting.forEach((fn) => fn());
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function request(kind: 'move' | 'hint', state: GameState, level: Difficulty): Promise<Move | null> {
  return new Promise((resolve) => {
    const w = getWorker();
    if (!w) {
      // main-thread fallback (still correct, just not off-thread)
      setTimeout(() => resolve(kind === 'hint' ? hintFor(state) : chooseMove(state, level)), 20);
      return;
    }
    const id = ++seq;
    const local = () => {
      if (pending.delete(id)) resolve(kind === 'hint' ? hintFor(state) : chooseMove(state, level));
    };
    const timer = setTimeout(local, 4000); // worker silent for too long: answer on the main thread
    fallbacks.set(id, () => {
      clearTimeout(timer);
      local();
    });
    pending.set(id, (m) => {
      clearTimeout(timer);
      fallbacks.delete(id);
      resolve(m);
    });
    w.postMessage({ id, kind, state, level });
  });
}

export const requestBotMove = (state: GameState, level: Difficulty) => request('move', state, level);
export const requestHint = (state: GameState) => request('hint', state, 'hard');
