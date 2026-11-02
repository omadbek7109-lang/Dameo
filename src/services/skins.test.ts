import { describe, expect, test } from 'bun:test';
import { skinClasses, skinCss } from './skins.ts';

describe('skins', () => {
  test('piece set CSS is scoped and covers both colours', () => {
    const css = skinCss({ slug: 'fire', slot: 'piece', style: { w: { c1: '#fff6d5', c2: '#ffb300', c3: '#ff5722', ring: 'rgba(1,2,3,.5)', pattern: 'flames', motif: '🔥', anim: 'pulse', glow: '#ff7043' }, b: { c1: '#5d0a00', c2: '#2e0500', c3: '#120200', ring: '#ff7828' } } });
    expect(css).toContain('.sk-p-fire .piece-w .piece-disc');
    expect(css).toContain('.sk-p-fire .piece-b .piece-disc');
    expect(css).toContain('radial-gradient(circle at 34% 28%, #fff6d5, #ffb300 55%, #ff5722)');
    expect(css).toContain('content:"🔥"');
    expect(css).toContain('0 0 12px #ff7043');
  });
  test('board CSS sets squares, frame and highlight', () => {
    const css = skinCss({ slug: 'neon-arena', slot: 'board', style: { light: '#121a3a', dark: '#060a1c', edge: '#00e5ff', edge2: '#ff00d4', lp: 'grid', dp: 'grid', frame: 'neon', hl: '#ff00d4' } });
    expect(css).toContain('.sk-b-neon-arena{--sq-light:#121a3a;--sq-dark:#060a1c;--board-edge:#00e5ff;--hl:#ff00d4;}');
    expect(css).toContain('0 0 10px #00e5ff');
    expect(css).toContain('.sk-b-neon-arena .sq-dark{background-color:#060a1c');
  });
  test('values from the database cannot inject CSS', () => {
    const css = skinCss({ slug: 'bad', slot: 'board', style: { light: 'red;}body{display:none', dark: 'url(http://x)', edge: '#000' } });
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('url(');
    const p = skinCss({ slug: 'x"y', slot: 'piece', style: { w: { motif: '"}*{x' }, b: {} } });
    expect(p).not.toContain('"}*{');
    expect(p).toContain('.sk-p-xy');
  });
  test('classes for a wrapper', () => {
    expect(skinClasses({ piece: 'fire', board: 'marble', effect: { slug: 'fx-fire', fx: 'fire' } })).toBe('sk-p-fire sk-b-marble fx-fire fxs-fx-fire');
    expect(skinClasses({})).toBe('');
  });
});
