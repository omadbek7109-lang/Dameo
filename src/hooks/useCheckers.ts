import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../bot/ai.ts';
import { requestBotMove, requestHint } from '../bot/botClient.ts';
import { colorOf, initialBoard, initialState, legalMoves, playMove, resign as resignState, agreeDraw, type Color, type GameState, type Move } from '../engine/index.ts';
import type { TKey } from '../i18n/index.tsx';

export type GameKind = 'bot' | 'practice' | 'local' | 'demo-rated' | 'online';

export interface GameConfig {
  kind: GameKind;
  difficulty?: Difficulty;
  humanColor: Color;
}

export interface UiMessage {
  key: TKey;
  tone: 'error' | 'info';
  n: number;
}

interface Snapshot {
  game: GameState;
  ids: number[];
}

const startIds = () => {
  const b = initialBoard();
  let n = 0;
  return b.map((c) => (c === 0 ? -1 : n++));
};

const prefixMatches = (path: number[], prefix: number[]) => prefix.every((p, i) => path[i] === p);

export function useCheckers(cfg: GameConfig, hooks: { onHumanMove?: (m: Move) => void } = {}) {
  const [game, setGame] = useState<GameState>(initialState);
  const [ids, setIds] = useState<number[]>(startIds);
  const [selected, setSelected] = useState<number | null>(null);
  const [prefix, setPrefix] = useState<number[]>([]);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<{ from: number; to: number } | null>(null);
  const [shake, setShake] = useState(0);
  const [lastMove, setLastMove] = useState<{ from: number; to: number } | null>(null);
  const undoStack = useRef<Snapshot[]>([]);
  const token = useRef(0); // invalidates in-flight bot moves on restart / unmount
  const gameRef = useRef(game);
  gameRef.current = game;
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const botEnabled = cfg.kind === 'bot' || cfg.kind === 'practice' || cfg.kind === 'demo-rated';
  const botColor: Color = cfg.humanColor === 'w' ? 'b' : 'w';
  const playing = game.result.status === 'playing';
  const humanTurn = cfg.kind === 'local' ? true : game.turn === cfg.humanColor;
  const legal = useMemo(() => legalMoves(game), [game]);

  const say = useCallback((key: TKey, tone: UiMessage['tone'] = 'error') => {
    setMessage({ key, tone, n: Date.now() });
    if (tone === 'error') setShake((s) => s + 1);
  }, []);

  const commitMove = useCallback((from: number, path: number[], pushUndo: boolean): boolean => {
    const cur = gameRef.current;
    const out = playMove(cur, from, path);
    if (!out.ok || !out.move) return false;
    if (pushUndo) undoStack.current.push({ game: cur, ids: idsRef.current });
    const nextIds = idsRef.current.slice();
    nextIds[out.move.to] = nextIds[from];
    if (out.move.to !== from) nextIds[from] = -1;
    for (const c of out.move.captures) nextIds[c] = -1;
    setIds(nextIds);
    setGame(out.state);
    setSelected(null);
    setPrefix([]);
    setHint(null);
    setLastMove({ from, to: out.move.to });
    setMessage(null);
    return true;
  }, []);

  /* ------------------------------ bot ------------------------------ */
  useEffect(() => {
    if (!botEnabled || !playing || game.turn !== botColor) return;
    const my = ++token.current;
    setThinking(true);
    const started = Date.now();
    requestBotMove(game, cfg.difficulty ?? 'medium').then((m) => {
      const wait = Math.max(0, 520 - (Date.now() - started)); // never instant: lets the player see the move
      window.setTimeout(() => {
        if (token.current !== my) return;
        setThinking(false);
        if (m) commitMove(m.from, m.path, false);
      }, wait);
    });
    return () => {
      // a re-render with the same state must not cancel; only a different token does
    };
  }, [game, botEnabled, playing, botColor, cfg.difficulty, commitMove]);

  useEffect(
    () => () => {
      token.current++;
    },
    [],
  );

  /* --------------------------- interaction --------------------------- */
  const clickSquare = useCallback(
    (i: number) => {
      const g = gameRef.current;
      if (g.result.status !== 'playing') return say('game.msg.over', 'info');
      if (thinking || !humanTurn) return say('game.msg.wait', 'info');
      const moves = legalMoves(g);
      const turnColor = g.turn;
      const cell = g.board[i];

      if (selected !== null) {
        const cands = moves.filter((m) => m.from === selected && prefixMatches(m.path, prefix));
        if (cands.some((m) => m.path[prefix.length] === i)) {
          const np = [...prefix, i];
          const done = cands.filter((m) => m.path.length === np.length && prefixMatches(m.path, np));
          if (done.length === 1) {
            const mv = done[0];
            if (commitMove(selected, mv.path, true)) hooks.onHumanMove?.(mv);
          } else {
            setPrefix(np);
            say('game.msg.continue', 'info');
          }
          return;
        }
        if (prefix.length > 0) return say('game.msg.continue');
      }

      if (colorOf(cell) === turnColor) {
        const own = moves.filter((m) => m.from === i);
        if (own.length === 0) {
          const mustCapture = moves.some((m) => m.captures.length > 0);
          return say(mustCapture ? 'game.msg.mustCapture' : 'game.msg.noMoves');
        }
        setSelected(i);
        setPrefix([]);
        setMessage(null);
        return;
      }
      if (cell !== 0) return say('game.msg.notYours');
      if (selected !== null) {
        const mustCapture = moves.some((m) => m.captures.length > 0);
        return say(mustCapture ? 'game.msg.mustCapture' : 'game.msg.illegal');
      }
    },
    [selected, prefix, thinking, humanTurn, say, commitMove, hooks],
  );

  const restart = useCallback(() => {
    token.current++;
    undoStack.current = [];
    setGame(initialState());
    setIds(startIds());
    setSelected(null);
    setPrefix([]);
    setMessage(null);
    setThinking(false);
    setHint(null);
    setLastMove(null);
  }, []);

  const resign = useCallback(
    (loser: Color) => {
      token.current++;
      setThinking(false);
      setGame((g) => resignState(g, loser));
    },
    [],
  );
  const drawByAgreement = useCallback(() => {
    token.current++;
    setGame((g) => agreeDraw(g));
  }, []);

  const undo = useCallback(() => {
    if (thinking) return;
    token.current++;
    // pop until it is the human's turn again (undoes the bot reply too)
    let snap: Snapshot | undefined;
    while (undoStack.current.length > 0) {
      snap = undoStack.current.pop();
      if (!snap) break;
      if (cfg.kind === 'local' || snap.game.turn === cfg.humanColor) break;
    }
    if (!snap) return;
    setGame(snap.game);
    setIds(snap.ids);
    setSelected(null);
    setPrefix([]);
    setHint(null);
    setLastMove(null);
    setMessage(null);
  }, [thinking, cfg.kind, cfg.humanColor]);

  const askHint = useCallback(async () => {
    if (!playing || thinking || !humanTurn) return;
    const my = token.current;
    const m = await requestHint(gameRef.current);
    if (token.current !== my || !m) return;
    setHint({ from: m.from, to: m.path[0] });
    setSelected(m.from);
    setPrefix([]);
  }, [playing, thinking, humanTurn]);

  /* ---------------- hooks for the online controller ---------------- */
  const applyRemote = useCallback((from: number, path: number[]) => commitMove(from, path, false), [commitMove]);
  const loadMoves = useCallback((moves: Array<{ from: number; path: number[] }>) => {
    let s = initialState();
    let nid = startIds();
    for (const mv of moves) {
      const out = playMove(s, mv.from, mv.path);
      if (!out.ok || !out.move) break;
      const n = nid.slice();
      n[out.move.to] = n[mv.from];
      if (out.move.to !== mv.from) n[mv.from] = -1;
      for (const c of out.move.captures) n[c] = -1;
      nid = n;
      s = out.state;
    }
    token.current++;
    setGame(s);
    setIds(nid);
    setSelected(null);
    setPrefix([]);
    setLastMove(null);
  }, []);
  const finishExternal = useCallback((winner: Color | null, reason: 'resign' | 'no-moves' | 'agreement') => {
    setGame((g) => (winner ? { ...g, result: { status: 'won', winner, reason: reason === 'agreement' ? 'resign' : reason } } : { ...g, result: { status: 'draw', reason: 'agreement' } }));
  }, []);

  // squares the UI should highlight
  const targets = useMemo(() => {
    if (selected === null || !playing) return [] as number[];
    const cands = legal.filter((m) => m.from === selected && prefixMatches(m.path, prefix));
    return [...new Set(cands.map((m) => m.path[prefix.length]))];
  }, [legal, selected, prefix, playing]);
  const mustMove = useMemo(() => {
    if (!playing || !humanTurn) return [] as number[];
    const caps = legal.filter((m) => m.captures.length > 0);
    return caps.length > 0 ? [...new Set(caps.map((m) => m.from))] : [];
  }, [legal, playing, humanTurn]);

  return {
    game,
    ids,
    selected,
    prefix,
    targets,
    mustMove,
    message,
    thinking,
    hint,
    shake,
    lastMove,
    humanTurn,
    canUndo: undoStack.current.length > 0 && !thinking,
    clickSquare,
    restart,
    resign,
    drawByAgreement,
    undo,
    askHint,
    applyRemote,
    loadMoves,
    finishExternal,
    botColor,
  };
}
