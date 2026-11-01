import { useEffect, useRef, useState } from 'react';
import { LuBot, LuCheck, LuCopy, LuSend, LuGraduationCap, LuLoader, LuLink, LuSwords, LuUsers, LuWifiOff, LuBookOpen } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import type { Difficulty } from '../bot/ai.ts';
import { Avatar } from '../components/Avatar.tsx';
import { RulesDialog } from '../components/RulesDialog.tsx';
import { useToast } from '../components/Toast.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import { backendConfigured } from '../services/config.ts';
import { DEMO_PLAYERS } from '../services/demoData.ts';
import { botGamesLeft, cancelQuickMatch, createRoom, joinRoom, quickMatch, startBotMatch, watchPairing } from '../services/online.ts';
import { inTelegram, shareRoomInTelegram } from '../services/telegram.ts';
import { LiveQuickPanel } from '../components/Lobby.tsx';
import type { Player } from '../types/models.ts';

type PanelId = 'quick' | 'friends' | 'bot' | 'practice';

const MODES: Array<{ id: PanelId; icon: typeof LuSwords; title: TKey; desc: TKey }> = [
  { id: 'quick', icon: LuSwords, title: 'mode.quick', desc: 'mode.quickDesc' },
  { id: 'friends', icon: LuUsers, title: 'mode.friends', desc: 'mode.friendsDesc' },
  { id: 'bot', icon: LuBot, title: 'mode.bot', desc: 'mode.botDesc' },
  { id: 'practice', icon: LuGraduationCap, title: 'mode.practice', desc: 'mode.practiceDesc' },
];

export function Play() {
  const { t } = useI18n();
  const route = useRoute();
  const initial = (route.query.get('mode') as PanelId) ?? 'quick';
  const [panel, setPanel] = useState<PanelId>(MODES.some((m) => m.id === initial) ? initial : 'quick');
  const [rules, setRules] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // tapping the "Find opponent" card (or arriving with ?go=1) starts matchmaking immediately
  const [quickStart, setQuickStart] = useState(() => (route.query.get('go') === '1' && route.query.get('mode') === 'quick' ? 1 : 0));
  useEffect(() => {
    // consume ?go=1 so a page refresh does not start another search
    if (route.query.get('go') === '1') history.replaceState(null, '', `${location.pathname}${location.search}#/play?mode=quick`);
  }, [route.query]);
  const picked = useRef(false);
  useEffect(() => {
    // on phones, jump to the chosen mode's panel after the player taps a tile
    if (picked.current && window.innerWidth < 1000) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [panel]);
  useEffect(() => {
    const m = route.query.get('mode') as PanelId | null;
    if (m && MODES.some((x) => x.id === m)) setPanel(m);
  }, [route.query]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">{t('play.title')}</h1>
          <p className="muted">{t('play.sub')}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setRules(true)}>
          <LuBookOpen /> {t('rules.button')}
        </button>
      </div>

      <div className="play-layout">
        <div className="mode-list" role="tablist" aria-label={t('home.modes')}>
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.id} role="tab" aria-selected={panel === m.id} className={`mode-tab ${panel === m.id ? 'mode-tab-active' : ''}`} onClick={() => {
                  picked.current = true;
                  setPanel(m.id);
                  if (m.id === 'quick') setQuickStart((n) => n + 1);
                }}>
                <span className="mode-icon">
                  <Icon />
                </span>
                <span className="mode-tab-text">
                  <span className="mode-title">{t(m.title)}</span>
                  <span className="mode-desc">{t(m.desc)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="card play-panel" role="tabpanel" ref={panelRef}>
          {panel === 'quick' && <QuickPanel autoStart={quickStart} />}
          {panel === 'friends' && <FriendsPanel />}
          {panel === 'bot' && <BotPanel practice={false} />}
          {panel === 'practice' && <BotPanel practice />}
        </div>
      </div>
      <RulesDialog open={rules} onClose={() => setRules(false)} />
    </div>
  );
}

/* ------------------------------ Quick match ------------------------------ */

function pickDemoOpponent(me: Player): Player {
  const pool = DEMO_PLAYERS.filter((p) => Math.abs(p.rating - me.rating) <= 220);
  const list = pool.length > 0 ? pool : DEMO_PLAYERS;
  return list[Math.floor(Math.random() * list.length)];
}
export const botLevelFor = (r: number): Difficulty => (r < 1250 ? 'easy' : r < 1600 ? 'medium' : 'hard');

function QuickPanel({ autoStart = 0 }: { autoStart?: number }) {
  const { t, num } = useI18n();
  const { me, mode, signedIn } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<'idle' | 'searching' | 'found'>('idle');
  const [opp, setOpp] = useState<Player | null>(null);
  const botFallback = false;
  const cancelled = useRef(false);
  const stopWatch = useRef<() => void>(() => {});


  useEffect(
    () => () => {
      cancelled.current = true;
      stopWatch.current();
    },
    [],
  );

  if (mode === 'live' && !signedIn) return <SignInPrompt text={t('quick.needAccount')} />;
  if (mode === 'live') return <LiveQuickPanel autoStart={autoStart} />;

  const startDemo = () => {
    if (!me) return;
    cancelled.current = false;
    setState('searching');
    window.setTimeout(() => {
      if (cancelled.current) return;
      const o = pickDemoOpponent(me);
      setOpp(o);
      setState('found');
      window.setTimeout(() => {
        if (cancelled.current) return;
        navigate(`/game?mode=demo-rated&opp=${o.id}`);
      }, 2200);
    }, 2400);
  };

  const cancel = async () => {
    cancelled.current = true;
    stopWatch.current();
    setState('idle');
    setOpp(null);
  };

  return (
    <div>
      <h2>{t('mode.quick')}</h2>
      <p className="muted">{t('mode.quickDesc')}</p>
      {mode === 'demo' && (
        <div className="notice">
          <LuWifiOff />
          <span>{t('quick.demoNotice')}</span>
        </div>
      )}
      <div className="match-stage" aria-live="polite">
        {state === 'idle' && (
          <button className="btn btn-primary btn-lg" onClick={startDemo}>
            <LuSwords /> {t('quick.startDemo')}
          </button>
        )}
        {state === 'searching' && (
          <div className="searching">
            <div className="radar" aria-hidden="true">
              <span />
              <span />
              <span />
              {me && <Avatar name={me.username} seed={me.avatar} size={56} />}
            </div>
            <p className="search-title">{t('quick.searchingDemo')}</p>
            <button className="btn btn-ghost" onClick={cancel}>
              {t('common.cancel')}
            </button>
          </div>
        )}
        {state === 'found' && (
          <div className="found">
            <div className="vs">
              {me && (
                <div className="vs-side">
                  <Avatar name={me.username} seed={me.avatar} size={64} />
                  <strong>{me.username}</strong>
                  <span className="muted small">{num(me.rating)}</span>
                </div>
              )}
              <span className="vs-badge">VS</span>
              <div className="vs-side">
                {opp ? <Avatar name={opp.username} seed={opp.avatar} size={64} /> : <Avatar name="?" size={64} />}
                <strong>{opp?.username ?? (botFallback ? t('game.botName') : t('quick.opponent'))}</strong>
                {opp && <span className="muted small">{num(opp.rating)}</span>}
              </div>
            </div>
            <p className="search-title">
              <LuCheck /> {botFallback ? t('quick.foundBot') : t('quick.found')}
            </p>
            {mode === 'demo' && <p className="muted small">{t('quick.demoOpponent')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Friends ------------------------------ */

function FriendsPanel() {
  const { t } = useI18n();
  const { me, mode, signedIn } = useAuth();
  const { toast } = useToast();
  const route = useRoute();
  const [code, setCode] = useState<string | null>(null);
  const [join, setJoin] = useState(route.query.get('join') ?? '');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [copied, setCopied] = useState(false);
  const stop = useRef<() => void>(() => {});

  useEffect(() => () => stop.current(), []);

  // Opened from an invitation link (?join=CODE or Telegram startapp): join automatically once signed in.
  const autoJoined = useRef(false);
  useEffect(() => {
    const c = route.query.get('join');
    if (!c || autoJoined.current || mode !== 'live' || !signedIn || !me) return;
    autoJoined.current = true;
    setBusy('join');
    joinRoom(c)
      .then((r) => navigate(`/game?online=${r.match_id}`))
      .catch(() => toast('error', t('room.joinFailed')))
      .finally(() => setBusy(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query, mode, signedIn, me?.id]);

  if (mode === 'demo') {
    return (
      <div>
        <h2>{t('mode.friends')}</h2>
        <p className="muted">{t('mode.friendsDesc')}</p>
        <div className="notice">
          <LuWifiOff />
          <span>{t('friendsPlay.demoNotice')}</span>
        </div>
        <div className="split-actions">
          <div className="option-card disabled-card" aria-disabled="true">
            <strong>{t('room.create')}</strong>
            <span className="muted small">{t('friendsPlay.needsBackend')}</span>
          </div>
          <div className="option-card disabled-card" aria-disabled="true">
            <strong>{t('room.join')}</strong>
            <span className="muted small">{t('friendsPlay.needsBackend')}</span>
          </div>
        </div>
        <h3 className="mt">{t('friendsPlay.localTitle')}</h3>
        <p className="muted">{t('friendsPlay.localDesc')}</p>
        <button className="btn btn-primary" onClick={() => navigate('/game?mode=local')}>
          <LuUsers /> {t('friendsPlay.localStart')}
        </button>
      </div>
    );
  }
  if (!signedIn) return <SignInPrompt text={t('room.needAccount')} />;

  const create = async () => {
    setBusy('create');
    try {
      const r = await createRoom();
      setCode(r.code);
      stop.current = watchPairing(me!.id, (id) => navigate(`/game?online=${id}`));
    } catch {
      toast('error', t('room.createFailed'));
    } finally {
      setBusy(null);
    }
  };
  const doJoin = async () => {
    if (join.trim().length < 4) return toast('error', t('validation.roomCode'));
    setBusy('join');
    try {
      const r = await joinRoom(join);
      navigate(`/game?online=${r.match_id}`);
    } catch {
      toast('error', t('room.joinFailed'));
    } finally {
      setBusy(null);
    }
  };
  const inviteText = code ? `${t('room.inviteText', { code })} ${window.location.origin}${window.location.pathname}#/play?mode=friends&join=${code}` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast('success', t('room.copied'));
    } catch {
      toast('error', t('room.copyFailed'));
    }
  };

  return (
    <div>
      <h2>{t('mode.friends')}</h2>
      <p className="muted">{t('mode.friendsDesc')}</p>
      <div className="split-actions">
        <div className="option-card">
          <strong>{t('room.create')}</strong>
          {code ? (
            <>
              <div className="room-code" aria-label={t('room.code')}>
                {code}
              </div>
              <p className="muted small">
                <LuLoader className="spin" /> {t('room.waiting')}
              </p>
              <button className="btn btn-secondary" onClick={copy}>
                {copied ? <LuCheck /> : <LuCopy />} {t('room.copyInvite')}
              </button>
              {inTelegram && (
                <button className="btn btn-primary" onClick={() => shareRoomInTelegram(code, t('room.inviteText', { code })) || copy()}>
                  <LuSend /> {t('room.shareTelegram')}
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-primary" onClick={create} disabled={busy !== null}>
              {busy === 'create' ? <LuLoader className="spin" /> : <LuLink />} {t('room.create')}
            </button>
          )}
        </div>
        <div className="option-card">
          <strong>{t('room.join')}</strong>
          <label className="field">
            <span className="sr-only">{t('room.code')}</span>
            <input className="input input-code" value={join} onChange={(e) => setJoin(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={8} autoCapitalize="characters" />
          </label>
          <button className="btn btn-primary" onClick={doJoin} disabled={busy !== null}>
            {busy === 'join' && <LuLoader className="spin" />} {t('room.joinBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Bot & practice --------------------------- */

function BotPanel({ practice }: { practice: boolean }) {
  const { t } = useI18n();
  const { mode, signedIn } = useAuth();
  const { toast } = useToast();
  // With the backend, "Play against bot" is a RATED game whose bot runs on the server (±5).
  // Practice always stays local and unrated.
  const serverBot = !practice && mode === 'live';
  const [level, setLevel] = useState<Difficulty | 'random'>(practice ? 'easy' : serverBot ? 'random' : 'medium');
  const [side, setSide] = useState<'w' | 'b' | 'r'>('w');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!serverBot || !signedIn) return;
    botGamesLeft().then(setLeft, () => setLeft(null));
  }, [serverBot, signedIn]);
  const levels: Array<{ id: Difficulty | 'random'; title: TKey; desc: TKey }> = [
    ...(serverBot ? [{ id: 'random' as const, title: 'bot.random' as TKey, desc: 'bot.randomDesc' as TKey }] : []),
    { id: 'easy', title: 'bot.easy', desc: 'bot.easyDesc' },
    { id: 'medium', title: 'bot.medium', desc: 'bot.mediumDesc' },
    { id: 'hard', title: 'bot.hard', desc: 'bot.hardDesc' },
  ];
  if (serverBot && !signedIn) return <SignInPrompt text={t('bot.needAccount')} />;

  const start = async () => {
    if (serverBot) {
      setBusy(true);
      try {
        const r = await startBotMatch(level);
        navigate(`/game?online=${r.match_id}`);
      } catch {
        toast('error', t('bot.startFailed'));
      } finally {
        setBusy(false);
      }
      return;
    }
    const s = side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
    navigate(`/game?mode=${practice ? 'practice' : 'bot'}&level=${level === 'random' ? 'medium' : level}&side=${s}`);
  };
  return (
    <div>
      <h2>{practice ? t('mode.practice') : t('mode.bot')}</h2>
      <p className="muted">{practice ? t('practice.desc') : t('mode.botDesc')}</p>
      <div className="notice">
        {serverBot && left !== 0 ? <span className="badge badge-free">{t('bot.ratedBadge')}</span> : <span className="badge">{t('common.unrated')}</span>}
        <span>{practice ? t('practice.unrated') : serverBot ? (left === 0 ? t('bot.limitReached') : t('bot.rated')) : t('bot.unrated')}</span>
      </div>
      {serverBot && left !== null && left > 0 && <p className="muted small">{t('bot.ratedLeft', { n: left })}</p>}
      <fieldset className="fieldset">
        <legend>{t('bot.difficulty')}</legend>
        <div className={`radio-cards ${levels.length === 4 ? 'radio-cards-4' : ''}`}>
          {levels.map((l) => (
            <label key={l.id} className={`radio-card ${level === l.id ? 'radio-card-on' : ''}`}>
              <input type="radio" name="level" checked={level === l.id} onChange={() => setLevel(l.id)} />
              <strong>{t(l.title)}</strong>
              <span className="muted small">{t(l.desc)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {!serverBot && (
        <fieldset className="fieldset">
          <legend>{t('bot.side')}</legend>
          <div className="seg" role="radiogroup">
            {(['w', 'b', 'r'] as const).map((sd) => (
              <button key={sd} role="radio" aria-checked={side === sd} className={`seg-btn ${side === sd ? 'seg-on' : ''}`} onClick={() => setSide(sd)}>
                {t(sd === 'w' ? 'side.white' : sd === 'b' ? 'side.black' : 'side.random')}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <button className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
        {busy ? <LuLoader className="spin" /> : <LuSwords />} {t('game.start')}
      </button>
    </div>
  );
}

export { backendConfigured };
