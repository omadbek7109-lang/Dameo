import { useCallback, useEffect, useRef, useState } from 'react';
import { LuCheck, LuLoader, LuSearch, LuSwords, LuUserPlus, LuUserX, LuX } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Modal } from '../components/Modal.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { DemoNotice, SignInPrompt } from '../components/ui.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link, navigate, useRoute } from '../router.tsx';
import { isOnline } from '../services/demoData.ts';
import { demoRelations, demoSearch, inviteFriendLive, liveRelations, liveSearch, removeFriendLive, respondRequestLive, sendRequestLive, type Relations } from '../services/friends.ts';
import { onMyTopic, subscribeChanges, subscribeLive } from '../services/supabase.ts';
import type { Player } from '../types/models.ts';

type Tab = 'friends' | 'requests' | 'find';

export function Friends() {
  const { t, num } = useI18n();
  const { mode, signedIn, local, mutateLocal } = useAuth();
  const { toast } = useToast();
  const { query: rq } = useRoute();
  const qt = rq.get('tab');
  const [tab, setTab] = useState<Tab>(qt === 'requests' || qt === 'find' ? qt : 'friends');
  useEffect(() => {
    if (qt === 'requests' || qt === 'find' || qt === 'friends') setTab(qt);
  }, [qt]);
  const [rel, setRel] = useState<Relations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Player[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [demoInvite, setDemoInvite] = useState<Player | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (mode === 'live' && !signedIn) return;
      if (!silent) setLoading(true);
      setError(false);
      try {
        setRel(mode === 'demo' ? demoRelations({ friends: local?.friends ?? [], outgoing: local?.outgoing ?? [], handledIncoming: local?.handledIncoming ?? [] }) : await liveRelations());
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [mode, signedIn, local?.friends, local?.outgoing, local?.handledIncoming],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (mode !== 'live' || !signedIn) return;
    const sub = subscribeLive({
      changes: () => subscribeChanges('public:friendships', [{ table: 'friendships' }], () => void loadRef.current(true)),
      broadcast: () => onMyTopic((ev) => ev === 'friends' && void loadRef.current(true)),
    });
    return () => sub.close();
  }, [mode, signedIn]);

  // player search (debounced)
  useEffect(() => {
    if (tab !== 'find') return;
    const my = ++seq.current;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const known = new Set([...(rel?.friends ?? []), ...(rel?.outgoing ?? [])].map((p) => p.id));
        const r = mode === 'demo' ? demoSearch(query, new Set()) : await liveSearch(query);
        if (seq.current === my) setResults(r.map((p) => p).filter((p) => !known.has(p.id) || mode === 'demo'));
      } catch {
        if (seq.current === my) toast('error', t('common.error'));
      } finally {
        if (seq.current === my) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tab, mode]);

  if (mode === 'live' && !signedIn) return <div className="page"><SignInPrompt text={t('friends.needAccount')} /></div>;

  const relationOf = (p: Player): 'friend' | 'outgoing' | null => (rel?.friends.some((f) => f.id === p.id) ? 'friend' : rel?.outgoing.some((o) => o.id === p.id) ? 'outgoing' : null);

  const sendRequest = async (p: Player) => {
    setBusy(p.id);
    try {
      if (mode === 'demo') {
        mutateLocal((s) => ({ ...s, outgoing: [...s.outgoing, p.id] }));
        toast('info', t('friends.demoSent'));
      } else {
        await sendRequestLive(p.id);
        toast('success', t('friends.sent', { name: p.username }));
        await load(true);
      }
    } catch {
      toast('error', t('friends.err.send'));
    } finally {
      setBusy(null);
    }
  };

  const respond = async (id: string, from: Player, accept: boolean, demo?: boolean) => {
    setBusy(id);
    try {
      if (demo) {
        mutateLocal((s) => ({ ...s, handledIncoming: [...s.handledIncoming, id], friends: accept ? [...s.friends, id] : s.friends }));
        toast('info', t(accept ? 'friends.demoAccepted' : 'friends.demoRejected'));
      } else {
        await respondRequestLive(id, accept);
        toast('success', t(accept ? 'friends.accepted' : 'friends.rejected', { name: from.username }));
        await load(true);
      }
    } catch {
      toast('error', t('friends.err.respond'));
    } finally {
      setBusy(null);
    }
  };

  const invite = async (p: Player) => {
    if (mode === 'demo') return setDemoInvite(p);
    setBusy(p.id);
    try {
      const r = await inviteFriendLive(p.id);
      toast('success', t('friends.inviteSent', { name: p.username }));
      navigate(`/game?online=${r.match_id}`);
    } catch {
      toast('error', t('friends.err.invite'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: Player) => {
    setBusy(p.id);
    try {
      await removeFriendLive(p.id);
      toast('success', t('friends.removed', { name: p.username }));
      await load(true);
    } catch {
      toast('error', t('friends.err.respond'));
    } finally {
      setBusy(null);
    }
  };

  const incomingCount = rel?.incoming.length ?? 0;
  const tabs: Array<{ id: Tab; key: TKey; count?: number }> = [
    { id: 'friends', key: 'friends.tabFriends', count: rel?.friends.length },
    { id: 'requests', key: 'friends.tabRequests', count: incomingCount },
    { id: 'find', key: 'friends.tabFind' },
  ];

  const PlayerLine = ({ p, children }: { p: Player; children?: React.ReactNode }) => (
    <li className="row row-static">
      <Link to={`/profile/${p.id}`} className="row-link">
        <Avatar name={p.username} seed={p.avatar} size={40} online={isOnline(p)} userId={p.id} />
        <span className="row-main">
          <span className="row-title">
            {p.username} {p.demo && <span className="badge badge-demo">{t('demo.badge')}</span>}
          </span>
          <span className="row-sub">
            {num(p.rating)} · {isOnline(p) ? t('common.online') : t('common.offline')}
          </span>
        </span>
      </Link>
      <span className="row-actions-inline">{children}</span>
    </li>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">{t('nav.friends')}</h1>
          <p className="muted">{t('friends.sub')}</p>
        </div>
      </div>
      <DemoNotice text={t('demo.friendsNotice')} />
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={`tab ${tab === x.id ? 'tab-active' : ''}`} onClick={() => setTab(x.id)}>
            {t(x.key)} {x.count ? <span className={`tab-count ${x.id === 'requests' ? 'tab-count-alert' : ''}`}>{x.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'find' && (
        <div className="card">
          <label className="search search-wide">
            <LuSearch aria-hidden="true" />
            <span className="sr-only">{t('friends.search')}</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('friends.search')} type="search" autoFocus />
          </label>
          {query.trim().length < 2 ? (
            <p className="muted small mt">{t('friends.searchHint')}</p>
          ) : searching ? (
            <Spinner />
          ) : results.length === 0 ? (
            <EmptyState title={t('friends.noResults')} />
          ) : (
            <ul className="rows mt">
              {results.map((p) => {
                const r = relationOf(p);
                return (
                  <PlayerLine key={p.id} p={p}>
                    {r === 'friend' ? (
                      <span className="badge badge-free">{t('friends.isFriend')}</span>
                    ) : r === 'outgoing' ? (
                      <span className="badge">{t('friends.pending')}</span>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => sendRequest(p)} disabled={busy === p.id}>
                        {busy === p.id ? <LuLoader className="spin" /> : <LuUserPlus />} {t('friends.add')}
                      </button>
                    )}
                  </PlayerLine>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab !== 'find' && (loading && !rel ? <Spinner /> : error ? <ErrorState onRetry={() => load()} /> : null)}

      {tab === 'friends' && rel && (
        <div className="card">
          {rel.friends.length === 0 ? (
            <EmptyState title={t('friends.empty')} hint={t('friends.emptyHint')} action={<button className="btn btn-primary" onClick={() => setTab('find')}>{t('friends.tabFind')}</button>} />
          ) : (
            <ul className="rows">
              {[...rel.friends].sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || b.rating - a.rating).map((p) => (
                <PlayerLine key={p.id} p={p}>
                  <button className="btn btn-primary btn-sm" onClick={() => invite(p)} disabled={busy === p.id}>
                    {busy === p.id ? <LuLoader className="spin" /> : <LuSwords />} {t('friends.invite')}
                  </button>
                  {mode === 'live' && (
                    <button className="icon-btn icon-btn-sm" onClick={() => remove(p)} aria-label={t('friends.remove', { name: p.username })} title={t('friends.remove', { name: p.username })}>
                      <LuUserX />
                    </button>
                  )}
                </PlayerLine>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'requests' && rel && (
        <div className="grid-2">
          <section className="card">
            <h2 className="h3">{t('friends.incoming')}</h2>
            {rel.incoming.length === 0 ? (
              <EmptyState title={t('friends.noIncoming')} />
            ) : (
              <ul className="rows">
                {rel.incoming.map((r) => (
                  <PlayerLine key={r.id} p={r.from}>
                    <button className="btn btn-primary btn-sm" onClick={() => respond(r.id, r.from, true, r.demo)} disabled={busy === r.id}>
                      <LuCheck /> {t('friends.accept')}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => respond(r.id, r.from, false, r.demo)} disabled={busy === r.id}>
                      <LuX /> {t('friends.reject')}
                    </button>
                  </PlayerLine>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2 className="h3">{t('friends.outgoing')}</h2>
            {rel.outgoing.length === 0 ? (
              <EmptyState title={t('friends.noOutgoing')} />
            ) : (
              <ul className="rows">
                {rel.outgoing.map((p) => (
                  <PlayerLine key={p.id} p={p}>
                    <span className="badge">{t('friends.pending')}</span>
                  </PlayerLine>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Modal open={demoInvite !== null} onClose={() => setDemoInvite(null)} title={t('friends.demoInviteTitle')}>
        <p className="muted">{t('friends.demoInviteBody', { name: demoInvite?.username ?? '' })}</p>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => navigate('/game?mode=local')}>
            {t('friendsPlay.localStart')}
          </button>
          <button className="btn btn-ghost" onClick={() => setDemoInvite(null)}>
            {t('common.close')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
