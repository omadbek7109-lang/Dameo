import { useEffect, useState } from 'react';
import { LuArchive, LuEyeOff, LuPlay } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { myGames, type ArchiveGame } from '../services/live.ts';
import { modeLabel } from './Live.tsx';

/** My finished games (newest first) → replay in the Watch view. */
export function Archive() {
  const { t, dateTime } = useI18n();
  const { me, signedIn } = useAuth();
  const [rows, setRows] = useState<ArchiveGame[] | null>(null);
  const [more, setMore] = useState(true);
  const [error, setError] = useState(false);
  const load = async (reset: boolean) => {
    try {
      const before = reset ? undefined : rows?.[rows.length - 1]?.ended_at;
      const r = await myGames(before);
      setRows((cur) => (reset ? r : [...(cur ?? []), ...r]));
      setMore(r.length === 20);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    if (signedIn) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);
  if (!signedIn) return <div className="page"><SignInPrompt text={t('archive.needAccount')} /></div>;
  return (
    <div className="page">
      <h1 className="h1">
        <LuArchive /> {t('archive.title')}
      </h1>
      {error && !rows ? (
        <ErrorState onRetry={() => load(true)} />
      ) : !rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={t('archive.empty')} />
      ) : (
        <ul className="admin-list">
          {rows.map((g) => {
            const white = g.white_id === me?.id;
            const won = g.result === (white ? 'white' : 'black');
            const delta = white ? g.white_delta : g.black_delta;
            return (
              <li key={g.id}>
                <Link to={`/watch?m=${g.id}`} className="admin-row">
                  <span className={`res-dot ${g.result === 'draw' ? 'res-draw' : won ? 'res-win' : 'res-loss'}`} aria-hidden="true" />
                  <span className="admin-row-main">
                    <strong>
                      {white ? g.black_name : g.white_name} {!g.is_public && <LuEyeOff aria-label={t('archive.private')} />}
                    </strong>
                    <span className="muted small">
                      {t(g.result === 'draw' ? 'result.drawn' : won ? 'result.victory' : 'result.defeat')} · {modeLabel(t, g)} · {g.move_count} {t('live.moves')} · {dateTime(Date.parse(g.ended_at))}
                    </span>
                  </span>
                  {g.rated && delta !== null && <span className={`ledger-amt ${delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : ''}`}>{delta > 0 ? `+${delta}` : delta}</span>}
                  <LuPlay />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {rows && more && rows.length > 0 && (
        <button className="btn btn-ghost btn-block" onClick={() => load(false)}>
          {t('common.more')}
        </button>
      )}
    </div>
  );
}
