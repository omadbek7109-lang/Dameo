import { useEffect, useState, type FormEvent } from 'react';
import { LuCamera, LuLoader, LuPencil } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar, LevelBadge, isPhoto } from '../components/Avatar.tsx';
import { Modal } from '../components/Modal.tsx';
import { FramePicker } from '../components/FramePicker.tsx';
import { RatingChart } from '../components/RatingChart.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { DemoNotice, Delta, SectionHead, SignInPrompt, Stat, winRate } from '../components/ui.tsx';
import { useAsync } from '../hooks/useAsync.ts';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link, useRoute } from '../router.tsx';
import { AchievementStrip } from '../components/Achievements.tsx';
import { DEMO_PLAYERS, isOnline } from '../services/demoData.ts';
import { fetchLeaderboard } from '../services/leaderboard.ts';
import { validateUsername } from '../services/localProfile.ts';
import { levelOf } from '../services/levels.ts';
import { prepareAvatar, uploadAvatar } from '../services/profiles.ts';
import { tg } from '../services/telegram.ts';
import { loadPublicProfile } from '../services/profiles.ts';
import { SbError } from '../services/supabase.ts';
import type { MatchSummary, Player, RatingPoint } from '../types/models.ts';

const HUES = [212, 262, 330, 8, 32, 150, 180, 100];

interface View {
  player: Player;
  rank: number | null;
  matches: MatchSummary[];
  history: RatingPoint[];
  own: boolean;
}

export function Profile() {
  const { segments } = useRoute();
  const { me, mode, signedIn, rank: myRank, matches, history } = useAuth();
  const { t } = useI18n();
  const id = segments[1];
  const own = !id || id === me?.id || id === 'local';

  const other = useAsync(async (): Promise<View | null> => {
    if (own || !id) return null;
    const demo = DEMO_PLAYERS.find((p) => p.id === id);
    if (demo) {
      const lb = await fetchLeaderboard({ scope: 'all', search: demo.username, page: 0, pageSize: 5 }, { me, friendIds: [] });
      return { player: demo, rank: lb.rows.find((r) => r.id === demo.id)?.rank ?? null, matches: [], history: [], own: false };
    }
    const b = await loadPublicProfile(id);
    return b ? { ...b, own: false } : null;
  }, [id, own, mode]);

  const lbMe = useAsync(() => (own && me ? fetchLeaderboard({ scope: 'all', search: '', page: 0, pageSize: 1 }, { me, friendIds: [] }) : Promise.resolve(null)), [own, me?.rating, mode]);

  if (own) {
    if (!signedIn || !me) return <div className="page"><SignInPrompt text={t('profile.needAccount')} /></div>;
    return <ProfileView view={{ player: me, rank: myRank ?? lbMe.data?.me?.rank ?? null, matches, history, own: true }} />;
  }
  if (other.loading) return <div className="page"><Spinner /></div>;
  if (other.error) return <div className="page"><ErrorState onRetry={other.reload} /></div>;
  if (!other.data) return <div className="page"><EmptyState title={t('profile.notFound')} action={<Link to="/leaderboard" className="btn btn-secondary">{t('nav.leaderboard')}</Link>} /></div>;
  return <ProfileView view={other.data} />;
}

function ProfileView({ view }: { view: View }) {
  const { t, num, relative, dateTime } = useI18n();
  const { mode } = useAuth();
  const { player: p, rank, matches, history, own } = view;
  const [editing, setEditing] = useState(false);
  const games = p.wins + p.losses + p.draws;
  const online = own ? true : isOnline(p);
  const lv = levelOf(p.rating);

  return (
    <div className="page">
      <DemoNotice text={own ? t('demo.profileNotice') : t('demo.otherProfileNotice')} />
      <section className="card profile-head">
        <div className="profile-avatar">
          <Avatar name={p.username} seed={p.avatar} size={96} online={online} ring={rank === 1 ? 'gold' : undefined} userId={p.id} />
        </div>
        <div className="profile-id">
          <h1 className="h1">
            {p.username}
            {p.demo && !own && <span className="badge badge-demo">{t('demo.badge')}</span>}
          </h1>
          <div className="chips">
            <span className="chip">ID: {p.id === 'local' ? 'LOCAL' : p.id.replace(/-/g, '').slice(0, 8).toUpperCase()}</span>
            <LevelBadge rating={p.rating} label={(n) => t('level.short', { n })} />
            <span className={`chip ${online ? 'chip-on' : ''}`}>
              <span className={`dot ${online ? 'dot-on' : 'dot-off'}`} /> {online ? t('common.online') : `${t('common.offline')} · ${relative(p.lastSeen)}`}
            </span>
            {p.country && <span className="chip">{p.country}</span>}
          </div>
          {own && (
            <button className="btn btn-secondary btn-sm profile-edit" onClick={() => setEditing(true)}>
              <LuPencil /> {t('profile.edit')}
            </button>
          )}
        </div>
        <div className="profile-rating">
          <div className="pr-block">
            <span className="pr-value">{num(p.rating)}</span>
            <span className="pr-label">{t('common.rating')}</span>
            <Delta value={p.lastDelta} />
          </div>
          <div className="pr-block">
            <span className="pr-value">{rank ? `#${num(rank)}` : '—'}</span>
            <span className="pr-label">{t('common.rank')}</span>
          </div>
        </div>
      </section>

      {own && <FramePicker />}

      <section className="card level-card" aria-label={t('level.title')}>
        <div>
          <div className="level-num">{t('level.name', { n: lv.level })}</div>
          <div className="muted small">{lv.next === null ? t('level.max') : t('level.toNext', { n: lv.next - p.rating, next: lv.level + 1 })}</div>
        </div>
        <div className="level-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lv.progress * 100)} aria-label={t('level.title')}>
          <span style={{ width: `${Math.round(lv.progress * 100)}%` }} />
        </div>
      </section>

      <section className="stats-grid" aria-label={t('profile.stats')}>
        <Stat label={t('common.games')} value={num(games)} />
        <Stat label={t('common.wins')} value={num(p.wins)} tone="win" />
        <Stat label={t('common.losses')} value={num(p.losses)} tone="loss" />
        <Stat label={t('common.draws')} value={num(p.draws)} />
        <Stat label={t('common.winRate')} value={`${winRate(p.wins, p.losses, p.draws)}%`} tone="gold" />
      </section>

      <div className="grid-2 wide-left">
        <section className="card">
          <SectionHead title={t('profile.ratingHistory')} sub={own && mode === 'demo' ? t('profile.demoRatingHint') : undefined} />
          {history.length === 0 ? <EmptyState title={t('profile.noHistory')} /> : <RatingChart points={history} />}
          {history.length === 1 && <p className="muted small">{t('profile.playToSee')}</p>}
          <details className="how">
            <summary>{t('rating.how')}</summary>
            <p className="muted small">{t('rating.explain')}</p>
          </details>
        </section>

        <AchievementStrip player={p} matches={matches} history={history} own={own} />
      </div>

      <section className="card">
        <SectionHead title={t('profile.recentMatches')} />
        {matches.length === 0 ? (
          <EmptyState title={t('profile.noMatches')} hint={own ? t('home.noGamesHint') : undefined} />
        ) : (
          <ul className="rows">
            {matches.slice(0, 10).map((m) => (
              <li key={m.id} className="row row-static">
                <span className={`result-chip result-${m.result}`}>{t(`result.${m.result}` as 'result.win')}</span>
                <span className="row-main">
                  <span className="row-title">{m.opponent}</span>
                  <span className="row-sub">
                    {dateTime(m.ts)} · {t('home.movesN', { n: m.moves })}
                  </span>
                </span>
                {m.rated ? <Delta value={m.delta} /> : <span className="badge">{t('common.unrated')}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {own && <EditProfile open={editing} onClose={() => setEditing(false)} player={p} />}
    </div>
  );
}

function EditProfile({ open, onClose, player }: { open: boolean; onClose: () => void; player: Player }) {
  const { t } = useI18n();
  const { updateProfile, me } = useAuth();
  const { toast } = useToast();
  // Everything here is optional: the player can change only the name, only the picture, or nothing.
  const [name, setName] = useState(player.username);
  const [avatar, setAvatar] = useState(player.avatar);
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const tgPhoto = tg?.initDataUnsafe?.user && (tg.initDataUnsafe.user as { photo_url?: string }).photo_url;

  useEffect(() => {
    if (open) {
      setName(player.username);
      setAvatar(player.avatar);
      setFile(null);
      setPreview(null);
      setErr(null);
    }
  }, [open, player.username, player.avatar]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const currentHue = Number(isPhoto(avatar) ? NaN : avatar.split(':')[0]);
  const changed = name.trim() !== player.username || avatar !== player.avatar || file !== null;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try {
      const blob = await prepareAvatar(f);
      setFile(blob);
      setPreview(URL.createObjectURL(blob));
    } catch {
      setErr('profile.err.photo');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed) return onClose();
    const trimmed = name.trim();
    if (trimmed !== player.username) {
      const bad = validateUsername(trimmed);
      if (bad) return setErr(bad);
    }
    setBusy(true);
    try {
      let nextAvatar = avatar;
      if (file && me) nextAvatar = await uploadAvatar(me.id, file);
      const patch: { username?: string; avatar?: string } = {};
      if (trimmed !== player.username) patch.username = trimmed;
      if (nextAvatar !== player.avatar) patch.avatar = nextAvatar;
      await updateProfile(patch);
      toast('success', t('profile.saved'));
      onClose();
    } catch (ex) {
      setErr(ex instanceof SbError && (ex.status === 409 || ex.code === '23505') ? 'profile.err.taken' : file ? 'profile.err.upload' : 'profile.err.save');
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? avatar;
  return (
    <Modal open={open} onClose={onClose} title={t('profile.edit')} locked={busy}>
      <form onSubmit={submit} className="form" noValidate>
        <div className="edit-photo">
          <Avatar name={name || '?'} seed={shown} size={88} />
          <div className="edit-photo-actions">
            <label className="btn btn-secondary btn-sm file-btn">
              <LuCamera /> {t('profile.uploadPhoto')}
              <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            {tgPhoto && /^https:\/\/t\.me\/i\/userpic\//.test(tgPhoto) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setFile(null), setPreview(null), setAvatar(tgPhoto))}>
                {t('profile.useTelegramPhoto')}
              </button>
            )}
          </div>
        </div>
        <fieldset className="fieldset">
          <legend>{t('profile.orColor')}</legend>
          <div className="swatches">
            {HUES.map((h) => (
              <button
                type="button"
                key={h}
                className={`swatch ${!preview && currentHue === h ? 'swatch-on' : ''}`}
                style={{ ['--h' as string]: h }}
                onClick={() => (setFile(null), setPreview(null), setAvatar(`${h}:0`))}
                aria-label={`${t('profile.avatarColor')} ${h}`}
                aria-pressed={!preview && currentHue === h}
              />
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>{t('auth.username')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="off" />
        </label>
        <p className="muted small">{t('profile.optionalHint')}</p>
        {err && (
          <div className="form-error" role="alert">
            {t(err)}
          </div>
        )}
        <div className="row-actions">
          <button className="btn btn-primary" disabled={busy || !changed}>
            {busy && <LuLoader className="spin" />} {t('common.save')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
