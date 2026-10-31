/**
 * Builds ONE self-contained HTML file (CSS, app and bot worker inlined) — used for the hosted demo.
 *   bun run build && bun run scripts/build-single.ts   ->  dist-single/dameo.html
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const esc = (js: string) => js.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('dist/assets/app.css', 'utf8');
const app = readFileSync('dist/assets/main.js', 'utf8');
const worker = readFileSync('dist/assets/bot/worker.js', 'utf8');
const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<script>\s*\/\/ Apply the saved theme[\s\S]*?<\/script>/)![0];

const out = `<title>DAMEO</title>
<meta name="description" content="DAMEO — online shashka. Every Move Matters.">
<meta name="theme-color" content="#0a1020">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<style>${css}</style>
${head}
<script id="dameo-bot-src" type="text/plain">${esc(worker)}</script>
<script>
  try {
    var src = document.getElementById('dameo-bot-src').textContent;
    window.DAMEO_WORKER_URL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  } catch (e) {}
</script>
<div id="root"></div>
<script type="module">${esc(app)}</script>
`;
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/dameo.html', out);
console.log(`dist-single/dameo.html  ${(out.length / 1024).toFixed(0)} KB`);
