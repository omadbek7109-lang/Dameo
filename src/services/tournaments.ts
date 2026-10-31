import type { Tournament } from '../types/models.ts';
import { backendConfigured } from './config.ts';
import { demoTournaments } from './demoData.ts';
import { db } from './supabase.ts';

interface Row {
  id: string;
  name: string;
  starts_at: string;
  capacity: number;
  status: Tournament['status'];
  format: Tournament['format'];
  best_of: 1 | 3;
  winner_name: string | null;
  participants: number;
}

export async function listTournaments(localRegistered: string[], myId: string | null): Promise<Tournament[]> {
  if (!backendConfigured) {
    return demoTournaments().map((t) => ({ ...t, registered: localRegistered.includes(t.id), participants: t.participants + (localRegistered.includes(t.id) ? 1 : 0) }));
  }
  const rows = await db.select<Row>('tournament_overview', { order: 'starts_at.asc' });
  let mine = new Set<string>();
  if (myId) {
    const regs = await db.select<{ tournament_id: string }>('tournament_registrations', { select: 'tournament_id', filter: { user_id: `eq.${myId}` } });
    mine = new Set(regs.map((r) => r.tournament_id));
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startsAt: new Date(r.starts_at).getTime(),
    capacity: r.capacity,
    participants: r.participants,
    status: r.status,
    format: r.format,
    bestOf: r.best_of,
    winner: r.winner_name ?? undefined,
    registered: mine.has(r.id),
  }));
}

/** Live mode: the DB trigger validates status/capacity and rejects duplicates. */
export async function registerLive(tournamentId: string): Promise<void> {
  await db.rpc('register_for_tournament', { p_tournament: tournamentId });
}
export async function unregisterLive(tournamentId: string): Promise<void> {
  await db.rpc('unregister_from_tournament', { p_tournament: tournamentId });
}
