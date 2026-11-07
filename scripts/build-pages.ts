/** Builds the GitHub Pages site into ./docs (relative paths, works under /<repo>/). */
declare const Bun: any;
declare const process: any;
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
const proc = Bun.spawnSync(['bun', 'run', 'scripts/build.ts'], { stdout: 'inherit', stderr: 'inherit', env: process.env });
if (proc.exitCode !== 0) process.exit(1);
rmSync('docs', { recursive: true, force: true });
mkdirSync('docs');
cpSync('dist/assets/app.css', 'docs/style.css');
cpSync('dist/assets/main.js', 'docs/app.js');
cpSync('dist/assets/bot/worker.js', 'docs/bot-worker.js');
cpSync('public/favicon.svg', 'docs/favicon.svg');
cpSync('public/vp', 'docs/vp', { recursive: true }); // virtual opponents' avatars (own artwork)
cpSync('public/brand', 'docs/brand', { recursive: true }); // partner banner art
cpSync('public/boards', 'docs/boards', { recursive: true }); // Limited board artwork + texture tiles
writeFileSync('docs/.nojekyll', '');
// Content hashes in the URLs: Telegram's in-app browser keeps app.js / style.css cached for a long time, so a new
// build must change the address, not only the file (otherwise players keep running the old version).
const v = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 10);
const [vJs, vCss, vWorker] = [v('docs/app.js'), v('docs/style.css'), v('docs/bot-worker.js')];
let html = readFileSync('dist/index.html', 'utf8')
  .replace('href="/favicon.svg"', 'href="favicon.svg"')
  .replace('<link rel="stylesheet" href="/assets/app.css" />', `<link rel="stylesheet" href="style.css?v=${vCss}" />`)
  .replace('<script type="module" src="/assets/main.js"></script>', `<script>window.DAMEO_WORKER_URL = new URL("bot-worker.js?v=${vWorker}", location.href).href;</script>\n    <script type="module" src="app.js?v=${vJs}"></script>`);
if (!html.includes(`app.js?v=${vJs}`) || !html.includes(`style.css?v=${vCss}`)) throw new Error('index.html rewrite failed');
writeFileSync('docs/index.html', html);
writeFileSync(
  'docs/404.html',
  `<!doctype html><meta charset="utf-8"><title>DAMEO</title><script>
var parts = location.pathname.split('/').filter(Boolean);
var home = location.hostname.endsWith('github.io') ? '/' + (parts[0] || '') + '/' : '/';
if (location.pathname.replace(/index\\.html$/, '') !== home.replace('//', '/')) location.replace(home + location.hash);
else document.write('<p style="font-family:sans-serif;padding:24px">DAMEO: GitHub Pages sozlamasida Branch: main, papka: /docs ni tanlang.</p>');
</script>`,
);
console.log('docs/ ready for GitHub Pages');
