/**
 * DAMEO skins: turns the style spec stored in shop_items.style into scoped CSS.
 *  - piece sets  → `.sk-p-<slug>` (both colours: gradient, surface pattern, rims, glow, centre motif, animation, crown colour)
 *  - boards      → `.sk-b-<slug>` (square colours + textures, frame, glow, coordinates, highlight colour)
 *  - move effects→ `.fx-<kind>`  (static CSS in app.css; the item only picks the kind + colour)
 * The scope class sits on the board wrapper, so every board (game, previews, home) uses the same renderer.
 * Only gradients / box-shadows / transforms are used — no images to download, cheap on phones.
 */
export type Slot = 'piece' | 'board' | 'effect';
export type PiecePattern = 'none' | 'rings' | 'stripes' | 'carbon' | 'dots' | 'facets' | 'conic' | 'galaxy' | 'flames' | 'frost' | 'petals' | 'waves' | 'scales' | 'glitch';
export type PieceAnim = 'none' | 'shimmer' | 'sparkle' | 'pulse' | 'hue' | 'glitch';
export interface PieceSide {
  c1: string;
  c2: string;
  c3: string;
  ring: string;
  pattern?: PiecePattern;
  /** pattern strength 0–1 */
  po?: number;
  motif?: string;
  anim?: PieceAnim;
  glow?: string;
  crown?: string;
  edge?: string;
}
export interface PieceStyle {
  w: PieceSide;
  b: PieceSide;
}
export type SquarePattern = 'none' | 'sheen' | 'wood' | 'marble' | 'carbon' | 'grid' | 'stars' | 'nebula' | 'velvet' | 'circuit' | 'petals';
export interface BoardStyle {
  light: string;
  dark: string;
  edge: string;
  edge2?: string;
  lp?: SquarePattern;
  dp?: SquarePattern;
  glow?: string;
  coord?: string;
  hl?: string;
  frame?: 'plain' | 'gold' | 'wood' | 'neon' | 'metal';
}
export type FxKind = 'ripple' | 'sparkle' | 'fire' | 'lightning' | 'stardust';
export interface EffectStyle {
  fx: FxKind;
  color?: string;
}
export interface SkinRef {
  slug: string;
  slot: Slot;
  style: unknown;
}

/* ------------------------------------------------------------- safety */
// Styles come from the DB (admins edit them): only let colour-like values through, never arbitrary CSS.
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%deg]+\)|transparent|white|black)$/;
const col = (v: unknown, fallback: string) => (typeof v === 'string' && COLOR.test(v.trim()) ? v.trim() : fallback);
const num01 = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
const cssString = (s: unknown) => (typeof s === 'string' && s.length > 0 && s.length <= 4 ? `"${s.replace(/["\\\n]/g, '')}"` : 'none');
export const safeSlug = (s: string) => s.replace(/[^a-z0-9-]/g, '');
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

const PIECE_PATTERNS = ['none', 'rings', 'stripes', 'carbon', 'dots', 'facets', 'conic', 'galaxy', 'flames', 'frost', 'petals', 'waves', 'scales', 'glitch'] as const;
const PIECE_ANIMS = ['none', 'shimmer', 'sparkle', 'pulse', 'hue', 'glitch'] as const;
const SQ_PATTERNS = ['none', 'sheen', 'wood', 'marble', 'carbon', 'grid', 'stars', 'nebula', 'velvet', 'circuit', 'petals'] as const;
const FRAMES = ['plain', 'gold', 'wood', 'neon', 'metal'] as const;
export const FX_KINDS = ['ripple', 'sparkle', 'fire', 'lightning', 'stardust'] as const;

/* ------------------------------------------------------------- pieces */
const w = (a: number) => `rgba(255,255,255,${a.toFixed(2)})`;
function piecePattern(p: PiecePattern, a: number): string[] {
  switch (p) {
    case 'rings':
      return [`radial-gradient(circle, transparent 50%, ${w(a)} 51% 55%, transparent 56% 66%, ${w(a * 0.7)} 67% 69%, transparent 70%)`];
    case 'stripes':
      return [`repeating-linear-gradient(135deg, ${w(a)} 0 2px, transparent 2px 6px)`];
    case 'carbon':
      return [`repeating-linear-gradient(45deg, ${w(a * 0.45)} 0 2px, transparent 2px 4px)`, `repeating-linear-gradient(-45deg, rgba(0,0,0,${a.toFixed(2)}) 0 2px, transparent 2px 4px)`];
    case 'dots':
      return [`radial-gradient(${w(a)} 1px, transparent 1.7px) 0 0 / 6px 6px`];
    case 'facets':
      return [`conic-gradient(from 22.5deg, ${w(0.55)}, ${w(0)} 12.5%, ${w(0.35)} 25%, ${w(0)} 37.5%, ${w(0.5)} 50%, ${w(0)} 62.5%, ${w(0.3)} 75%, ${w(0)} 87.5%, ${w(0.55)})`];
    case 'conic':
      return [`conic-gradient(from 0deg, rgba(255,0,76,${a}), rgba(255,184,0,${a}), rgba(60,255,0,${a}), rgba(0,225,255,${a}), rgba(122,0,255,${a}), rgba(255,0,76,${a}))`];
    case 'galaxy':
      return [
        `radial-gradient(1px 1px at 28% 34%, #fff, transparent)`,
        `radial-gradient(1.4px 1.4px at 66% 58%, #fff, transparent)`,
        `radial-gradient(1px 1px at 46% 76%, #fff, transparent)`,
        `radial-gradient(1px 1px at 72% 26%, #fff, transparent)`,
        `radial-gradient(circle at 70% 30%, rgba(190,130,255,.5), transparent 52%)`,
        `radial-gradient(circle at 25% 75%, rgba(80,160,255,.35), transparent 50%)`,
      ];
    case 'flames':
      return [`radial-gradient(ellipse 60% 55% at 50% 105%, rgba(255,230,80,.85), transparent 70%)`, `radial-gradient(ellipse 40% 45% at 28% 95%, rgba(255,110,0,.7), transparent 70%)`, `radial-gradient(ellipse 35% 40% at 74% 98%, rgba(255,70,0,.6), transparent 70%)`];
    case 'frost':
      return [`repeating-conic-gradient(from 0deg, ${w(a)} 0deg 3deg, transparent 3deg 30deg)`, `radial-gradient(circle, ${w(0.5)} 0 10%, transparent 30%)`];
    case 'petals':
      return [`radial-gradient(circle at 30% 30%, ${w(0.6)} 0 8%, transparent 9%)`, `radial-gradient(circle at 70% 36%, ${w(0.45)} 0 6%, transparent 7%)`, `radial-gradient(circle at 46% 70%, ${w(0.5)} 0 7%, transparent 8%)`];
    case 'waves':
      return [`repeating-radial-gradient(circle at 0% 100%, ${w(a)} 0 2px, transparent 2px 7px)`];
    case 'scales':
      return [`radial-gradient(circle at 50% 0, transparent 40%, ${w(a)} 41% 47%, transparent 48%) 0 0 / 8px 8px`];
    case 'glitch':
      return [`linear-gradient(0deg, transparent 28%, rgba(0,255,255,${a}) 28% 33%, transparent 33% 61%, rgba(255,0,80,${a}) 61% 66%, transparent 66%)`];
    default:
      return [];
  }
}

function pieceSideCss(scope: string, cls: 'piece-w' | 'piece-b', s: Partial<PieceSide>, white: boolean): string {
  const c1 = col(s.c1, white ? '#ffffff' : '#4b5a84');
  const c2 = col(s.c2, white ? '#e3eafa' : '#151c34');
  const c3 = col(s.c3, white ? '#aebbd9' : '#080c1a');
  const ring = col(s.ring, white ? 'rgba(90,120,200,.4)' : 'rgba(140,170,250,.7)');
  const pattern = oneOf(s.pattern, PIECE_PATTERNS, 'none');
  const layers = [...piecePattern(pattern, num01(s.po, 0.3)), `radial-gradient(circle at 34% 28%, ${c1}, ${c2} 55%, ${c3})`];
  const glow = s.glow ? col(s.glow, '') : '';
  const edge = s.edge ? col(s.edge, '') : '';
  const anim = oneOf(s.anim, PIECE_ANIMS, 'none');
  const shadow = [`0 3px 0 rgba(0,0,0,.28)`, `0 6px 10px rgba(0,0,0,.3)`, `inset 0 0 0 2px ${ring}`];
  if (edge) shadow.push(`0 0 0 2px ${edge}`);
  if (glow) shadow.push(`0 0 12px ${glow}`);
  const sel = `.${scope} .${cls} .piece-disc`;
  let css = `${sel}{--ring-c:${ring};background:${layers.join(',')};box-shadow:${shadow.join(',')};${glow ? `--glow:${glow};` : ''}}`;
  if (s.motif) css += `${sel}::before{content:${cssString(s.motif)};}`;
  if (s.crown) css += `.${scope} .${cls} .piece-crown{color:${col(s.crown, '#e8bb4d')};}`;
  if (anim !== 'none') css += `${sel}{animation:var(--pa-${anim});}` + `.${scope} .${cls} .pfx{${pfxFor(anim)}}`;
  return css;
}
// overlay layer inside the disc for animated light effects
function pfxFor(anim: PieceAnim): string {
  switch (anim) {
    case 'shimmer':
      return 'background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.55) 48%,transparent 60%) 0 0/250% 100%;animation:sk-shine 3.2s linear infinite;';
    case 'sparkle':
      return 'background:radial-gradient(1.5px 1.5px at 30% 28%,#fff,transparent),radial-gradient(1.2px 1.2px at 70% 40%,#fff,transparent),radial-gradient(1.6px 1.6px at 46% 72%,#fff,transparent);animation:sk-twinkle 1.8s ease-in-out infinite;';
    case 'glitch':
      return 'background:linear-gradient(90deg,rgba(0,255,255,.35),transparent 30%,transparent 70%,rgba(255,0,80,.35));animation:sk-glitch 2.4s steps(1) infinite;';
    default:
      return 'display:none;';
  }
}

/* ------------------------------------------------------------- boards */
function squarePattern(p: SquarePattern): string {
  switch (p) {
    case 'sheen':
      return 'linear-gradient(135deg,rgba(255,255,255,.07),transparent 55%)';
    case 'wood':
      return 'repeating-linear-gradient(92deg,rgba(0,0,0,.07) 0 2px,transparent 2px 7px),repeating-linear-gradient(88deg,rgba(255,255,255,.06) 0 1px,transparent 1px 13px)';
    case 'marble':
      return 'radial-gradient(ellipse at 20% 30%,rgba(255,255,255,.35),transparent 40%),linear-gradient(120deg,transparent 40%,rgba(128,128,128,.28) 42%,transparent 46%),linear-gradient(60deg,transparent 60%,rgba(170,170,170,.22) 61%,transparent 64%)';
    case 'carbon':
      return 'repeating-linear-gradient(45deg,rgba(255,255,255,.05) 0 2px,transparent 2px 4px),repeating-linear-gradient(-45deg,rgba(0,0,0,.25) 0 2px,transparent 2px 4px)';
    case 'grid':
      return 'linear-gradient(rgba(0,229,255,.22) 1px,transparent 1px) 0 0/50% 50%,linear-gradient(90deg,rgba(0,229,255,.22) 1px,transparent 1px) 0 0/50% 50%';
    case 'stars':
      return 'radial-gradient(1px 1px at 20% 30%,rgba(255,255,255,.9),transparent),radial-gradient(1px 1px at 72% 62%,rgba(255,255,255,.7),transparent),radial-gradient(1.3px 1.3px at 42% 82%,rgba(255,255,255,.85),transparent)';
    case 'nebula':
      return 'radial-gradient(circle at 30% 30%,rgba(234,128,252,.35),transparent 60%),radial-gradient(circle at 80% 70%,rgba(124,77,255,.35),transparent 55%)';
    case 'velvet':
      return 'radial-gradient(circle at 50% 40%,rgba(255,255,255,.09),transparent 70%),linear-gradient(180deg,transparent,rgba(0,0,0,.2))';
    case 'circuit':
      return 'linear-gradient(90deg,transparent 46%,rgba(252,238,10,.35) 46% 50%,transparent 50%) 0 0/100% 50%,linear-gradient(0deg,transparent 70%,rgba(255,0,127,.3) 70% 74%,transparent 74%),radial-gradient(circle at 48% 22%,rgba(252,238,10,.8) 0 5%,transparent 6%)';
    case 'petals':
      return 'radial-gradient(circle at 25% 30%,rgba(255,255,255,.55) 0 7%,transparent 8%),radial-gradient(circle at 75% 70%,rgba(255,183,209,.6) 0 6%,transparent 7%)';
    default:
      return 'none';
  }
}

function boardCss(scope: string, s: Partial<BoardStyle>): string {
  const light = col(s.light, '#e9effc');
  const dark = col(s.dark, '#4f74c8');
  const edge = col(s.edge, '#243b78');
  const edge2 = col(s.edge2, edge);
  const glow = s.glow ? col(s.glow, '') : '';
  const hl = col(s.hl, '#e8bb4d');
  const frame = oneOf(s.frame, FRAMES, 'plain');
  const shadow: string[] = [];
  if (frame === 'gold' || frame === 'metal') shadow.push(`0 0 0 2px ${edge2}`, `0 0 0 4px ${edge}`);
  if (frame === 'wood') shadow.push(`inset 0 0 0 1px rgba(0,0,0,.35)`, `0 0 0 3px ${edge2}`);
  if (frame === 'neon') shadow.push(`0 0 10px ${edge}`, `0 0 22px ${edge2}`);
  if (glow) shadow.push(`0 0 28px ${glow}`);
  shadow.push('0 18px 44px rgba(0,0,0,.35)');
  let css = `.${scope}{--sq-light:${light};--sq-dark:${dark};--board-edge:${edge};--hl:${hl};}`;
  css += `.${scope} .board{border-color:${edge};box-shadow:${shadow.join(',')};}`;
  css += `.${scope} .sq-light{background-color:${light};background-image:${squarePattern(oneOf(s.lp, SQ_PATTERNS, 'none'))};}`;
  css += `.${scope} .sq-dark{background-color:${dark};background-image:${squarePattern(oneOf(s.dp, SQ_PATTERNS, 'sheen'))};}`;
  if (s.coord) css += `.${scope} .coord{color:${col(s.coord, '#ffffff')};opacity:.85;}`;
  return css;
}

/* ------------------------------------------------------------- registry */
const injected = new Set<string>();
let sheet: HTMLStyleElement | null = null;
/** CSS for one item (exported for tests). */
export function skinCss(item: SkinRef): string {
  const slug = safeSlug(item.slug);
  const st = (item.style ?? {}) as Record<string, unknown>;
  if (item.slot === 'piece') {
    const ps = st as Partial<PieceStyle>;
    return pieceSideCss(`sk-p-${slug}`, 'piece-w', ps.w ?? {}, true) + pieceSideCss(`sk-p-${slug}`, 'piece-b', ps.b ?? {}, false);
  }
  if (item.slot === 'board') return boardCss(`sk-b-${slug}`, st as Partial<BoardStyle>);
  const fx = st as Partial<EffectStyle>;
  return `.fxs-${slug}{--fx-c:${col(fx.color, '#ffd54f')};}`;
}
/** Adds the CSS of these items to the page once (idempotent, cheap). */
export function registerSkins(items: SkinRef[]) {
  if (typeof document === 'undefined') return;
  const fresh = items.filter((i) => i && i.slug && !injected.has(`${i.slot}:${i.slug}:${JSON.stringify(i.style)}`));
  if (fresh.length === 0) return;
  if (!sheet) {
    sheet = document.createElement('style');
    sheet.id = 'dameo-skins';
    document.head.appendChild(sheet);
  }
  for (const i of fresh) {
    injected.add(`${i.slot}:${i.slug}:${JSON.stringify(i.style)}`);
    sheet.appendChild(document.createTextNode(skinCss(i)));
  }
}
/** Classes for a board wrapper with these cosmetics. */
export function skinClasses(c: { piece?: string | null; board?: string | null; effect?: { slug: string; fx: FxKind } | null }): string {
  const out: string[] = [];
  if (c.piece) out.push(`sk-p-${safeSlug(c.piece)}`);
  if (c.board) out.push(`sk-b-${safeSlug(c.board)}`);
  if (c.effect) out.push(`fx-${c.effect.fx}`, `fxs-${safeSlug(c.effect.slug)}`);
  return out.join(' ');
}
export const fxOf = (style: unknown): FxKind => oneOf((style as EffectStyle | undefined)?.fx, FX_KINDS, 'sparkle');
