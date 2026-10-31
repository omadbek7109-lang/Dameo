import { useEffect, useRef, useState } from 'react';
import { LuBot, LuCheck, LuCopy, LuGraduationCap, LuLoader, LuLink, LuSwords, LuUsers, LuWifiOff, LuBookOpen } from 'react-icons/lu';
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
import { cancelQuickMatch, createRoom, joinRoom, quickMatch, watchPairing } from '../services/online.ts';
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
              <button key={m.id} role="tab" aria-selected={panel === m.id} className={`mode-tab ${panel === m.id ? 'mode-tab-active' : ''}`} onClick={() => setPanel(m.id)}>
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
        <div className="card play-panel" role="tabpanel">
          {panel === 'quick' && <QuickPanel />}
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

function QuickPanel() {
  const { t, num } = useI18n();
  const { me, mode, signedIn } = useAuth();
  const { toast } = useToast();
  const [state, setState] = useState<'idle' | 'searching' | 'found'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [opp, setOpp] = useState<Player | null>(null);
  const cancelled = useRef(false);
  const stopWatch = useRef<() => void>(() => {});

  useEffect(() => {
    if (state !== 'searching') return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(
    () => () => {
      cancelled.current = true;
      stopWatch.current();
    },
    [],
  );

  if (mode === 'live' && !signedIn) return <SignInPrompt text={t('quick.needAccount')} />;

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

  const startLive = async () => {
    if (!me) return;
    cancelled.current = false;
    setState('searching');
    try {
      stopWatch.current = watchPairing(me.id, (id) => {
        if (cancelled.current) return;
        setState('found');
        setTimeout(() => navigate(`/game?online=${id}`), 1200);
      });
      const r = await quickMatch();
      if (r.match_id && !cancelled.current) {
        setState('found');
        setTimeout(() => navigate(`/game?online=${r.match_id}`), 1200);
      }
    } catch {
      stopWatch.current();
      setState('idle');
      toast('error', t('quick.failed'));
    }
  };

  const cancel = async () => {
    cancelled.current = true;
    stopWatch.current();
    setState('idle');
    setOpp(null);
    if (mode === 'live') await cancelQuickMatch().catch(() => {});
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
          <button className="btn btn-primary btn-lg" onClick={mode === 'demo' ? startDemo : startLive}>
            <LuSwords /> {mode === 'demo' ? t('quick.startDemo') : t('mode.findOpponent')}
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
            <p className="search-title">{mode === 'demo' ? t('quick.searchingDemo') : t('quick.searching')}</p>
            {mode === 'live' && <p className="muted small">{t('quick.elapsed', { n: elapsed })}</p>}
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
                <strong>{opp?.username ?? t('quick.opponent')}</strong>
                {opp && <span className="muted small">{num(opp.rating)}</span>}
              </div>
            </div>
            <p className="search-title">
              <LuCheck /> {t('quick.found')}
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
  const [level, setLevel] = useState<Difficulty>(practice ? 'easy' : 'medium');
  const [side, setSide] = useState<'w' | 'b' | 'r'>('w');
  const levels: Array<{ id: Difficulty; title: TKey; desc: TKey }> = [
    { id: 'easy', title: 'bot.easy', desc: 'bot.easyDesc' },
    { id: 'medium', title: 'bot.medium', desc: 'bot.mediumDesc' },
    { id: 'hard', title: 'bot.hard', desc: 'bot.hardDesc' },
  ];
  const start = () => {
    const s = side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
    navigate(`/game?mode=${practice ? 'practice' : 'bot'}&level=${level}&side=${s}`);
  };
  return (
    <div>
      <h2>{practice ? t('mode.practice') : t('mode.bot')}</h2>
      <p className="muted">{practice ? t('practice.desc') : t('mode.botDesc')}</p>
      <div className="notice">
        <span className="badge">{t('common.unrated')}</span>
        <span>{practice ? t('practice.unrated') : t('bot.unrated')}</span>
      </div>
      <fieldset className="fieldset">
        <legend>{t('bot.difficulty')}</legend>
        <div className="radio-cards">
          {levels.map((l) => (
            <label key={l.id} className={`radio-card ${level === l.id ? 'radio-card-on' : ''}`}>
              <input type="radio" name="level" checked={level === l.id} onChange={() => setLevel(l.id)} />
              <strong>{t(l.title)}</strong>
              <span className="muted small">{t(l.desc)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>{t('bot.side')}</legend>
        <div className="seg" role="radiogroup">
          {(['w', 'b', 'r'] as const).map((s) => (
            <button key={s} role="radio" aria-checked={side === s} className={`seg-btn ${side === s ? 'seg-on' : ''}`} onClick={() => setSide(s)}>
              {t(s === 'w' ? 'side.white' : s === 'b' ? 'side.black' : 'side.random')}
            </button>
          ))}
        </div>
      </fieldset>
      <button className="btn btn-primary btn-lg" onClick={start}>
        <LuSwords /> {t('game.start')}
      </button>
    </div>
  );
}

export { backendConfigured };
