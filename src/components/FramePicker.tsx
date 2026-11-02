import { useEffect, useRef, useState } from 'react';
import { LuCheck, LuLoader, LuLock } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useFrames } from '../cosmetics/FramesProvider.tsx';
import { useI18n } from '../i18n/index.tsx';
import { useRoute } from '../router.tsx';
import { frameEquip, framesMine, type FrameId } from '../services/frames.ts';
import { SbError } from '../services/supabase.ts';
import { Avatar } from './Avatar.tsx';
import { useToast } from './Toast.tsx';

/** "Ramka" card on my profile: none / DAMEO (everyone) / Champion (only while #1). Frames are not sold. */
export function FramePicker() {
  const { t } = useI18n();
  const { me, mode } = useAuth();
  const frames = useFrames();
  const { toast } = useToast();
  const { query } = useRoute();
  const ref = useRef<HTMLElement>(null);
  const [mine, setMine] = useState<{ equipped: FrameId | null; champion_ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'live' || !me) return;
    framesMine().then(setMine, () => setMine({ equipped: null, champion_ok: false }));
  }, [mode, me?.id, me?.rating]);
  // opened from the menu ("Ramkalar") → bring the card into view
  useEffect(() => {
    if (query.get('section') === 'frames') setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [query]);

  if (mode !== 'live' || !me) return null;
  const choose = async (f: FrameId | null) => {
    if (!mine || busy) return;
    setBusy(f ?? 'none');
    try {
      const r = await frameEquip(f);
      setMine({ ...mine, equipped: r.equipped });
      frames?.refresh();
      toast('success', t(f ? 'frame.on' : 'frame.off'));
    } catch (e) {
      toast('error', t(e instanceof SbError && /#1/.test(e.message) ? 'frame.notFirst' : 'frame.failed'));
    } finally {
      setBusy(null);
    }
  };
  const opts: Array<{ id: FrameId | null; title: string; sub: string; locked: boolean }> = [
    { id: null, title: t('frame.none'), sub: t('frame.noneSub'), locked: false },
    { id: 'dameo', title: t('frame.dameo'), sub: t('frame.dameoSub'), locked: false },
    { id: 'champion', title: t('frame.champion'), sub: t(mine?.champion_ok ? 'frame.championSub' : 'frame.championLocked'), locked: !mine?.champion_ok },
  ];
  return (
    <section className="card frame-card" ref={ref} id="frames" aria-label={t('frame.title')}>
      <div className="frame-card-head">
        <h2 className="h2">{t('frame.title')}</h2>
        <span className="muted small">{t('frame.notSold')}</span>
      </div>
      <div className="frame-opts" role="radiogroup" aria-label={t('frame.title')}>
        {opts.map((o) => {
          const on = (mine?.equipped ?? null) === o.id && !(o.id === 'champion' && o.locked);
          return (
            <button
              key={o.id ?? 'none'}
              role="radio"
              aria-checked={on}
              className={`frame-opt ${on ? 'frame-opt-on' : ''} ${o.locked ? 'frame-opt-locked' : ''}`}
              disabled={!mine || o.locked || busy !== null}
              onClick={() => choose(o.id)}
            >
              <span className="frame-opt-av">
                <Avatar name={me.username} seed={me.avatar} size={52} frame={o.id} />
              </span>
              <strong>{o.title}</strong>
              <span className="muted small">{o.sub}</span>
              <span className="frame-opt-state">
                {busy === (o.id ?? 'none') ? <LuLoader className="spin" /> : o.locked ? <LuLock /> : on ? <LuCheck /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
