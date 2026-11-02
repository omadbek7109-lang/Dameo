import { useState } from 'react';
import { LuCalendar, LuCheck, LuCrown, LuLoader, LuSwords, LuUsers } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useAuthDialog } from '../components/AuthDialog.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { DemoNotice } from '../components/ui.tsx';
import { WeeklyTournament } from '../components/WeeklyTournament.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { registerLive, listTournaments, unregisterLive } from '../services/tournaments.ts';
import { SbError } from '../services/supabase.ts';
import type { Tournament, TournamentStatus } from '../types/models.ts';

const TABS: Array<{ id: TournamentStatus; key: TKey }> = [
  { id: 'upcoming', key: 'tour.upcoming' },
  { id: 'in_progress', key: 'tour.inProgress' },
  { id: 'completed', key: 'tour.completed' },
];

/** `embedded`: shown as the third tab of the rating page (no page frame / title). */
export function Tournaments({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useI18n();
  const { me, mode, signedIn, local, mutateLocal } = useAuth();
  const { openAuth } = useAuthDialog();
  const { toast } = useToast();
  const [tab, setTab] = useState<TournamentStatus>('upcoming');
  const [busy, setBusy] = useState<string | null>(null);
  const list = useAsync(() => listTournaments(local?.tournaments ?? [], me?.id ?? null), [mode, me?.id, local?.tournaments.join(',')]);

  const items = (list.data ?? []).filter((x) => x.status === tab);

  const toggle = async (x: Tournament) => {
    if (mode === 'demo') {
      mutateLocal((p) => ({ ...p, tournaments: x.registered ? p.tournaments.filter((i) => i !== x.id) : [...p.tournaments, x.id] }));
      toast('info', t(x.registered ? 'tour.demoLeft' : 'tour.demoRegistered'));
      return;
    }
    if (!signedIn) return openAuth();
    setBusy(x.id);
    try {
      if (x.registered) await unregisterLive(x.id);
      else await registerLive(x.id);
      toast('success', t(x.registered ? 'tour.left' : 'tour.registered'));
      list.reload();
    } catch (e) {
      const msg = e instanceof SbError ? e.message : '';
      toast('error', t(/full/i.test(msg) ? 'tour.err.full' : /closed|started/i.test(msg) ? 'tour.err.closed' : 'tour.err.generic'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={embedded ? 'tour-embedded' : 'page'}>
      {!embedded && (
      <div className="page-head">
        <div>
          <h1 className="h1">{t('nav.tournaments')}</h1>
          <p className="muted">{t('tour.sub')}</p>
        </div>
        <span className="badge badge-free badge-lg">{t('tour.allFree')}</span>
      </div>
      )}
      <DemoNotice text={t('demo.tourNotice')} />

      {mode === 'live' && <WeeklyTournament />}

      {/* other (bracket) tournaments: only shown when there are any, or in demo mode */}
      {(mode !== 'live' || (list.data ?? []).length > 0) && (
      <>
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={`tab ${tab === x.id ? 'tab-active' : ''}`} onClick={() => setTab(x.id)}>
            {t(x.key)} <span className="tab-count">{(list.data ?? []).filter((i) => i.status === x.id).length}</span>
          </button>
        ))}
      </div>

      {list.loading && !list.data ? (
        <Spinner />
      ) : list.error ? (
        <ErrorState onRetry={list.reload} />
      ) : items.length === 0 ? (
        <EmptyState title={t(tab === 'upcoming' ? 'tour.emptyUpcoming' : tab === 'in_progress' ? 'tour.emptyLive' : 'tour.emptyDone')} />
      ) : (
        <div className="tour-grid">
          {items.map((x) => (
            <TournamentCard key={x.id} x={x} busy={busy === x.id} onToggle={() => toggle(x)} />
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}

function TournamentCard({ x, busy, onToggle }: { x: Tournament; busy: boolean; onToggle: () => void }) {
  const { t, num, dateTime } = useI18n();
  const full = x.participants >= x.capacity;
  const pct = Math.min(100, Math.round((x.participants / x.capacity) * 100));
  return (
    <article className={`card tour-card tour-${x.status}`}>
      <div className="tour-top">
        <h3>{x.name}</h3>
        <div className="chips">
          <span className="badge badge-free">{t('common.free')}</span>
          {x.demo && <span className="badge badge-demo">{t('demo.badge')}</span>}
        </div>
      </div>
      <ul className="tour-meta">
        <li>
          <LuCalendar /> {dateTime(x.startsAt)}
        </li>
        <li>
          <LuSwords /> {t(`tour.format.${x.format}` as 'tour.format.swiss')} · {t(x.bestOf === 3 ? 'tour.bo3' : 'tour.bo1')}
        </li>
        <li>
          <LuUsers /> {t('tour.participants', { n: num(x.participants), max: num(x.capacity) })}
        </li>
      </ul>
      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('tour.fill')}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="tour-foot">
        {x.status === 'upcoming' && (
          <button className={`btn ${x.registered ? 'btn-secondary' : 'btn-primary'} btn-block`} onClick={onToggle} disabled={busy || (full && !x.registered)}>
            {busy ? <LuLoader className="spin" /> : x.registered ? <LuCheck /> : null} {x.registered ? t('tour.registeredBtn') : full ? t('tour.full') : t('tour.register')}
          </button>
        )}
        {x.status === 'in_progress' && <span className="muted small">{t('tour.closed')}</span>}
        {x.status === 'completed' && (
          <span className="winner">
            <LuCrown /> {t('tour.winner')}: <strong>{x.winner ?? '—'}</strong>
          </span>
        )}
        {x.status === 'upcoming' && x.registered && <span className="muted small">{t('tour.unregisterHint')}</span>}
      </div>
    </article>
  );
}
