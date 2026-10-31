/**
 * DAMEO build script (Bun).
 *   bun run build            -> production bundle in ./dist
 *   bun run dev              -> dev server on http://localhost:5173 with rebuild on change
 *
 * Backend configuration is injected at build time from the environment
 * (or a .env file, which Bun loads automatically):
 *   DAMEO_SUPABASE_URL, DAMEO_SUPABASE_ANON_KEY
 * Never put a service-role key here — it would end up in the browser bundle.
 */
import { cp, mkdir, rm, watch as fsWatch } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

declare const Bun: any;
declare const process: any;

const dev = process.argv.includes('--serve');
const watching = process.argv.includes('--watch');

async function build(): Promise<boolean> {
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist/assets', { recursive: true });
  const result = await Bun.build({
    entrypoints: ['src/main.tsx', 'src/bot/worker.ts'],
    root: 'src',
    outdir: 'dist/assets',
    target: 'browser',
    minify: !dev,
    sourcemap: dev ? 'inline' : 'none',
    define: {
      'process.env.DAMEO_SUPABASE_URL': JSON.stringify(process.env.DAMEO_SUPABASE_URL ?? ''),
      'process.env.DAMEO_SUPABASE_ANON_KEY': JSON.stringify(process.env.DAMEO_SUPABASE_ANON_KEY ?? ''),
      'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    return false;
  }
  await cp('src/styles/app.css', 'dist/assets/app.css');
  const html = readFileSync('index.html', 'utf8');
  writeFileSync('dist/index.html', html);
  if (existsSync('public')) await cp('public', 'dist', { recursive: true });
  // SPA hosting helpers (Netlify / Cloudflare Pages style)
  writeFileSync('dist/_redirects', '/* /index.html 200\n');
  console.log(`built ${new Date().toLocaleTimeString()}`);
  return true;
}

const ok = await build();
if (!ok && !watching) process.exit(1);

if (dev) {
  const port = Number(process.env.PORT ?? 5173);
  Bun.serve({
    port,
    async fetch(req: Request) {
      const url = new URL(req.url);
      let path = 'dist' + decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = Bun.file(path);
      if (await file.exists()) return new Response(file);
      return new Response(Bun.file('dist/index.html'));
    },
  });
  console.log(`DAMEO dev server: http://localhost:${port}`);
}
if (watching) {
  let timer: any;
  for await (const _ of fsWatch('src', { recursive: true })) {
    clearTimeout(timer);
    timer = setTimeout(() => build(), 150);
  }
}
