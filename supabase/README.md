# DAMEO backend (Supabase)

migrations/0001_schema.sql     tables, views, Row Level Security, realtime
migrations/0002_functions.sql  RPCs: rooms, matchmaking, friends, tournaments, leaderboard, Elo rating
functions/match-action/        Edge Function: validates every move with the game engine, finishes games, applies rating once
functions/_shared/engine/      copy of src/engine (keep in sync: bun run sync-engine)
tests/                         run on plain PostgreSQL 16:
                               psql -f tests/00_supabase_stub.sql -f migrations/0001_schema.sql -f migrations/0002_functions.sql -f tests/10_rls_and_rating.sql
seed.sql                       optional: create real tournaments

Phone setup (no command line): ../mobile-setup/dameo-database.sql → SQL Editor,
../mobile-setup/match-action.ts → Edge Functions → "Via Editor", name: match-action.
