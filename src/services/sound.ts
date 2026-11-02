/**
 * DAMEO sound effects, synthesized with WebAudio (no files to download → instant, nothing to preload over 3G).
 * Mobile / Telegram WebView autoplay rules: the AudioContext is created and resumed on the first user gesture.
 * Callers play a sound once per server-confirmed event (online games) — this module only plays what it is told.
 */
export type SoundKind = 'move' | 'opponent' | 'capture' | 'king' | 'win' | 'loss' | 'draw' | 'notify';

let ctx: AudioContext | null = null;
let enabled = true;
let volume = 0.7;
let unlockedOnce = false;

/** called by the settings provider whenever the player changes the sound settings */
export function configureSound(o: { enabled: boolean; volume: number }) {
  enabled = o.enabled;
  volume = Math.max(0, Math.min(1, o.volume));
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** resume audio on the first tap / key press (autoplay policies) */
export function installAudioUnlock() {
  if (typeof window === 'undefined' || unlockedOnce) return;
  unlockedOnce = true;
  const unlock = () => {
    const a = audio();
    if (a && a.state === 'suspended') void a.resume();
    // a silent blip fully unlocks iOS WebViews
    if (a) {
      const o = a.createOscillator();
      const g = a.createGain();
      g.gain.value = 0;
      o.connect(g).connect(a.destination);
      o.start();
      o.stop(a.currentTime + 0.01);
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

function tone(a: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType, peak: number, slideTo?: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * volume), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
// short filtered noise burst = wooden "click"
function click(a: AudioContext, t0: number, freq: number, peak: number) {
  const len = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 3;
  const g = a.createGain();
  g.gain.value = peak * volume;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

let lastAt = 0;
let lastKind = '';
export function playSound(kind: SoundKind) {
  if (!enabled || volume <= 0) return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  // never double-play the same event (e.g. response + realtime echo within a few ms)
  const now = performance.now();
  if (kind === lastKind && now - lastAt < 60) return;
  lastAt = now;
  lastKind = kind;
  const t0 = a.currentTime + 0.005;
  switch (kind) {
    case 'move':
      click(a, t0, 1800, 0.9);
      tone(a, t0, 520, 0.07, 'triangle', 0.12);
      break;
    case 'opponent':
      click(a, t0, 1300, 0.8);
      tone(a, t0, 380, 0.08, 'triangle', 0.1);
      break;
    case 'capture':
      click(a, t0, 900, 1);
      tone(a, t0, 220, 0.16, 'sine', 0.35, 110);
      click(a, t0 + 0.06, 2200, 0.5);
      break;
    case 'king':
      [660, 880, 1320].forEach((f, i) => tone(a, t0 + i * 0.08, f, 0.22, 'sine', 0.22));
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(a, t0 + i * 0.11, f, 0.32, 'triangle', 0.25));
      break;
    case 'loss':
      [392, 330, 262].forEach((f, i) => tone(a, t0 + i * 0.16, f, 0.38, 'sine', 0.22));
      break;
    case 'draw':
      tone(a, t0, 440, 0.25, 'sine', 0.2);
      tone(a, t0 + 0.2, 440, 0.3, 'sine', 0.18);
      break;
    case 'notify':
      tone(a, t0, 880, 0.12, 'sine', 0.2);
      tone(a, t0 + 0.1, 1175, 0.18, 'sine', 0.18);
      break;
  }
}

/** sound for a played move, from the engine's move record */
export const moveSound = (rec: { captures: number[]; promotes: boolean } | undefined, mine: boolean): SoundKind =>
  !rec ? (mine ? 'move' : 'opponent') : rec.promotes ? 'king' : rec.captures.length > 0 ? 'capture' : mine ? 'move' : 'opponent';
