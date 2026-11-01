/** Copies the pure game engine into the Edge Function so client and server validate moves with the SAME code. */
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('supabase/functions/_shared/engine', { recursive: true });
for (const f of ['types.ts', 'rules.ts', 'index.ts']) copyFileSync(`src/engine/${f}`, `supabase/functions/_shared/engine/${f}`);
mkdirSync('supabase/functions/_shared/bot', { recursive: true });
copyFileSync('src/bot/ai.ts', 'supabase/functions/_shared/bot/ai.ts');
console.log('engine synced to supabase/functions/_shared/engine');
