/**
 * DAMEO 3.1 — Premium Stones: per-material motion (idle, selection, move trail, capture shatter).
 * Purely visual: the stone's id, price and face texture stay as they are in the shop; this table only adds motion,
 * keyed by the stone's slug (or an optional `mat` in the piece style, so a new stone can reuse a material).
 * Every loop animates transform / opacity only (GPU-composited). Loops stop with html.calm, prefers-reduced-motion
 * and html.app-paused (see app.css).
 */
export type StoneMat = 'porcelain' | 'gold' | 'obsidian' | 'sapphire' | 'emerald' | 'ruby' | 'diamond' | 'celestial';
export const STONE_MATS: readonly StoneMat[] = ['porcelain', 'gold', 'obsidian', 'sapphire', 'emerald', 'ruby', 'diamond', 'celestial'];

/** the 8 Stones Collection slugs → material */
export const STONE_BY_SLUG: Record<string, StoneMat> = {
  'st-classic': 'porcelain',
  'st-royal-gold': 'gold',
  'st-obsidian': 'obsidian',
  'st-sapphire': 'sapphire',
  'st-emerald': 'emerald',
  'st-ruby': 'ruby',
  'st-diamond': 'diamond',
  'st-celestial': 'celestial',
};

interface Mat {
  /** energy colour (selection ring, trail head, flash) and its deeper partner */
  c: string;
  c2: string;
  /** idle overlay inside the stone: [.pfx, .pfx::after] declarations */
  idle: [string, string?];
  /** move trail background (drawn from the start square to the landing square) */
  trail: string;
  /** capture shards: look of each fragment */
  shard: string;
}

const gem = (c: string, deep: string, dur: number): Mat => ({
  c,
  c2: deep,
  // facet glints: two tiny star highlights that flash out of phase
  idle: [
    `display:block;background:radial-gradient(2px 2px at 30% 30%,#fff,transparent 70%),radial-gradient(1.6px 1.6px at 66% 58%,#fff,transparent 70%);opacity:0;animation:stm-glint ${dur}s ease-in-out infinite;`,
    `content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(1.8px 1.8px at 54% 24%,#fff,transparent 70%),radial-gradient(circle at 50% 55%,${c}55,transparent 62%);opacity:0;animation:stm-glint ${dur}s ease-in-out ${(dur / 2).toFixed(2)}s infinite;`,
  ],
  trail: `linear-gradient(90deg,transparent,${c}00 8%,${c}88 60%,#fff)`,
  shard: `background:linear-gradient(135deg,#fff 0%,${c} 35%,${deep} 100%);clip-path:polygon(50% 0,100% 70%,30% 100%);`,
});

export const MATERIALS: Record<StoneMat, Mat> = {
  // Classic — ivory porcelain: a calm glaze highlight that breathes
  porcelain: {
    c: '#f6efe1',
    c2: '#a7afc2',
    idle: ['display:block;background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.55),transparent 42%);opacity:.12;animation:stm-breathe 5s ease-in-out infinite;'],
    trail: 'linear-gradient(90deg,transparent,rgba(246,239,225,.0) 10%,rgba(246,239,225,.55) 70%,rgba(255,255,255,.9))',
    shard: 'background:linear-gradient(140deg,#fffaf0,#cfc6b4);clip-path:polygon(0 20%,70% 0,100% 60%,40% 100%);',
  },
  // Royal Gold — polished metal: a specular band sweeps across now and then
  gold: {
    c: '#ffd56b',
    c2: '#b8862b',
    idle: [
      'display:block;overflow:hidden;',
      "content:'';position:absolute;inset:-10% -80%;background:linear-gradient(110deg,transparent 42%,rgba(255,248,214,.75) 50%,transparent 58%);transform:translateX(-60%);animation:stm-sweep 4.2s ease-in-out infinite;",
    ],
    trail: 'linear-gradient(90deg,transparent,rgba(255,213,107,0) 8%,rgba(255,213,107,.8) 65%,#fff6d0)',
    shard: 'background:radial-gradient(circle at 35% 30%,#fff6d0,#ffd56b 45%,#9a6a14);border-radius:50%;',
  },
  // Obsidian — volcanic glass: the lava veins glow and cool
  obsidian: {
    c: '#ff9a2e',
    c2: '#5a2a0a',
    idle: [
      'display:block;background:radial-gradient(circle at 50% 50%,rgba(255,140,30,.38),transparent 66%);opacity:0;animation:stm-lava 3.4s ease-in-out infinite;',
      "content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(1.6px 1.6px at 62% 40%,#ffd08a,transparent 70%),radial-gradient(1.4px 1.4px at 36% 66%,#ffb050,transparent 70%);opacity:0;animation:stm-glint 3.4s ease-in-out 1.2s infinite;",
    ],
    trail: 'linear-gradient(90deg,transparent,rgba(255,120,20,0) 10%,rgba(255,120,20,.75) 65%,#ffd08a)',
    shard: 'background:linear-gradient(135deg,#3a3532 0%,#0c0a09 60%,#ff8a1e 100%);clip-path:polygon(20% 0,100% 30%,70% 100%,0 70%);',
  },
  sapphire: gem('#4d8dff', '#0b2a8a', 3.0),
  emerald: gem('#2fd88a', '#06512c', 3.3),
  ruby: gem('#ff3d63', '#6b0618', 2.8),
  // Diamond — prism: a rainbow fire turns slowly inside, plus a bright glint
  diamond: {
    c: '#e6f2ff',
    c2: '#8fb4ff',
    idle: [
      'display:block;overflow:hidden;background:conic-gradient(from 0deg,rgba(255,80,80,.0),rgba(255,80,80,.28),rgba(255,220,80,.0),rgba(80,255,160,.26),rgba(80,160,255,.0),rgba(200,90,255,.28),rgba(255,80,80,.0));opacity:.55;animation:stm-spin 9s linear infinite;',
      "content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(2.2px 2.2px at 30% 28%,#fff,transparent 70%),radial-gradient(1.6px 1.6px at 70% 62%,#fff,transparent 70%);opacity:0;animation:stm-glint 2.6s ease-in-out infinite;",
    ],
    trail: 'linear-gradient(90deg,transparent,rgba(255,90,90,.35) 30%,rgba(255,220,90,.5) 50%,rgba(90,220,160,.55) 65%,rgba(110,160,255,.7) 80%,#fff)',
    shard: 'background:linear-gradient(135deg,#ffffff 0%,#dfeaff 30%,#ffb3d0 55%,#a7f0ff 80%,#ffffff 100%);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);',
  },
  // Celestial — a galaxy: the starfield turns, the nebula breathes
  celestial: {
    c: '#a98bff',
    c2: '#f3c24f',
    idle: [
      'display:block;overflow:hidden;background:radial-gradient(1.4px 1.4px at 24% 32%,#fff,transparent 70%),radial-gradient(1.2px 1.2px at 70% 26%,#fff,transparent 70%),radial-gradient(1.6px 1.6px at 58% 72%,#fff,transparent 70%),radial-gradient(1px 1px at 36% 78%,#fff,transparent 70%),radial-gradient(1.2px 1.2px at 80% 58%,#fff,transparent 70%);animation:stm-spin 14s linear infinite;',
      "content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 50% 50%,rgba(169,139,255,.45),transparent 60%);opacity:0;animation:stm-lava 4.6s ease-in-out infinite;",
    ],
    trail: 'radial-gradient(1.5px 1.5px at 20% 40%,#fff,transparent 70%),radial-gradient(1.5px 1.5px at 45% 70%,#fff,transparent 70%),linear-gradient(90deg,transparent,rgba(169,139,255,.0) 10%,rgba(169,139,255,.7) 65%,#fff1c1)',
    shard: 'background:radial-gradient(circle,#fff 0 30%,#d8c8ff 45%,rgba(169,139,255,0) 72%);border-radius:50%;',
  },
};

export function stoneMat(slug: string, mat: unknown): StoneMat | null {
  if (typeof mat === 'string' && (STONE_MATS as readonly string[]).includes(mat)) return mat as StoneMat;
  return STONE_BY_SLUG[slug] ?? null;
}

/**
 * Motion CSS for one side of a stone set. `on(tail)` builds `.scope .piece-w<tail>` for every scope class.
 *  - `.piece` gets the energy colours; selected → spinning energy ring + lift and scale-up
 *  - `.mv-trail-w|b` (rendered by Board for the last move) becomes visible in the material's colours
 *  - `.piece-gone` (a captured stone, kept for ~0.7 s by Board) shatters into the material's fragments
 */
export function stoneMotionCss(mat: StoneMat, on: (tail: string) => string, trailSel: string): string {
  const m = MATERIALS[mat];
  const [fx, after] = m.idle;
  return (
    `${on('')}{--stc:${m.c};--stc2:${m.c2};}` +
    `${on(' .pfx')}{${fx}}` +
    (after ? `${on(' .pfx::after')}{${after}}` : '') +
    `${on('.piece-selected::before')}{display:block;}` +
    `${on('.piece-selected .piece-disc')}{transform:translateY(-4px) scale(1.13);}` +
    `${trailSel}{display:block;--stc:${m.c};background:${m.trail};}` +
    `${on('.piece-gone')}{display:grid;}` +
    `${on('.piece-gone .shard')}{${m.shard}}`
  );
}
