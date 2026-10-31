# DAMEO — Every Move Matters.

Onlayn shashka platformasi / International online checkers platform.
Default language **Uzbek**, secondary **English**. Light & dark themes. First release is **100% free**
(no payments, skins, subscriptions or paid tournaments exist anywhere in the code).

## Quick start

```bash
# Requires Bun ≥ 1.1 (https://bun.sh) — or Node 20+ with `npx bun`.
bun install
bun run dev          # http://localhost:5173 (rebuilds on change)
bun test src         # engine, bot, rating and i18n tests
bun run build        # static site in ./dist
```

Without backend credentials the app runs in **Demo mode**: everything works locally
(bot, practice, same-device play, demo-rated quick match, profile, achievements), and every
sample player / tournament / live match is labelled **DEMO** in the UI.

## Features

| Area | What works |
|---|---|
| Game | Full Russian draughts engine, legal-move highlighting, mandatory captures, multi-jumps (step-by-step), flying kings, promotion mid-capture, move history, undo (practice/local), hints, restart, resign, draw by agreement (local), threefold repetition, kings-only draw, animated pieces, invalid-move feedback |
| Bot | Easy (mostly random), Medium (depth-3 alpha-beta), Hard (iterative-deepening negamax + alpha-beta, time-bounded) — runs in a Web Worker |
| Modes | Quick match (real matchmaking with backend; labelled demo opponent without), Play with friends (rooms + codes + invite link with backend; same-device play without), vs Bot, Practice (never rated) |
| Leaderboard | Podium, All / Friends / Top 100, search, pagination, highlighted own position, last-updated, live status; realtime with backend |
| Profiles | Avatar, ID, rating, rank, level, online status, stats, achievements, recent matches, rating chart, editable username/avatar colour |
| Tournaments | Upcoming / In progress / Completed tabs, free registration (server-validated capacity & status) |
| Friends | Search, requests, accept/reject, list with online status, invite to game (delivered via realtime notification) |
| UX | Uzbek/English (centralised dictionaries + `useI18n` hook, key parity enforced by tests), persisted theme & language, mobile bottom nav, 360px tested, reduced-motion support, keyboard & screen-reader labels |

## Ruleset (documented, not mixed)

DAMEO uses **Russian draughts (shashki)** — see `src/engine/rules.ts`:
men move forward one square and capture forward & backward; flying kings; captures are mandatory
(any sequence may be chosen, but must be completed); captured pieces are removed after the move
and cannot be jumped twice; a man reaching the last row mid-capture continues as a king; no legal
move = loss; draws by threefold repetition or 15 moves each with only kings and no capture.

## Rating system

Elo with a provisional period (`src/services/rating.ts`, mirrored in SQL `rating_delta`):

```
expected = 1 / (1 + 10^((opponent − player) / 400))
new      = player + K × (score − expected)      score: win 1, draw 0.5, loss 0
K = 40 for the first 20 rated games, then 24 · start 1200 · floor 100
```

Only validated competitive games count. Practice, bot and same-device games never change ratings.
In demo mode the "demo-rated" quick match updates a **local demo rating** stored only in the browser.

## Backend (Supabase) — enabling real-time and online play

1. Create a Supabase project.
2. Apply the schema: `supabase link` then `supabase db push`
   (or paste `supabase/migrations/0001_schema.sql` then `0002_functions.sql` into the SQL editor).
3. Deploy the validator: `bun run sync-engine && supabase functions deploy match-action`.
4. Build the frontend with the **public** credentials only:
   ```bash
   DAMEO_SUPABASE_URL=https://xxxx.supabase.co DAMEO_SUPABASE_ANON_KEY=eyJ... bun run build
   ```
   (or put them in `.env`). **Never** use the service-role key in the frontend.
5. Optional: create real tournaments with `supabase/seed.sql`.

### Security model
- Row Level Security on every table. Profiles are public-read; users can update only their own
  `username`, `avatar`, `country` (column-level grant) — rating/stats columns are not writable.
- No client insert/update policies exist for matches, moves, ratings or results.
- Moves and resignations go through the Edge Function `match-action`, which authenticates the user,
  checks it is their turn, **replays the whole game with the same engine** and rejects illegal moves.
  `(match_id, ply)` is a primary key, so a move can't be submitted twice.
- Ratings are applied by `apply_match_result` (executable only by the service role), guarded by
  `matches.rating_applied` under a row lock → no duplicate rating updates.
- Private room codes are only visible to the two players; emails are never exposed.
- Presence: heartbeat RPC every 60 s (`touch_presence`), "online" = active in the last 2 minutes.
- Realtime: leaderboard, own profile, match moves, pairing, friendships and invites; the client
  re-fetches after every reconnect.

## Project structure

```
src/engine/      pure TS rules engine (no React) + tests
src/bot/         AI (minimax/alpha-beta), Web Worker, client
src/services/    supabase client, leaderboard, tournaments, friends, online play, rating, demo data
src/auth/        AuthProvider (demo local profile / Supabase session)
src/i18n/        uz.ts (source of truth), en.ts, useI18n hook, tests
src/theme/       ThemeProvider (persisted light/dark)
src/components/  Board, Header, Modal, Avatar, Logo, RatingChart, …
src/pages/       Home, Play, Game, Leaderboard, Profile, Tournaments, Friends, Settings
supabase/        migrations, Edge Function, seed
```

## Deployment

`dist/` is a static site (hash routing; `_redirects` included). Deploy to Netlify, Vercel,
Cloudflare Pages or any static host. Set `DAMEO_SUPABASE_URL` / `DAMEO_SUPABASE_ANON_KEY` as
build-time environment variables.

## Notes & known limitations (honest status)

- The build environment for this release had no access to the npm registry, so the app uses
  React 19 + react-icons (Lucide set) bundled with **Bun**, hand-written CSS instead of Tailwind,
  CSS animations instead of Framer Motion, and a small fetch/WebSocket Supabase client
  (`src/services/supabase.ts`) instead of `@supabase/supabase-js`. All are drop-in replaceable.
- The Supabase SQL and Edge Function were written against the documented Supabase APIs but have
  **not yet been run against a live project** — test them on a staging project first.
- Not yet implemented: game clocks / abandonment timeouts, spectating live games, tournament
  pairings & brackets (registration only), online draw offers.
- `bun run typecheck` needs `@types/react` etc. from `bun install`; `typecheck:sandbox` is only for
  offline machines.
