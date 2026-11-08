import { useCallback, useEffect, useRef, useState } from 'react';
import { LuCheck, LuLoader, LuLock, LuPlus, LuShoppingBag } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useAuthDialog } from './AuthDialog.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { useFrames } from '../cosmetics/FramesProvider.tsx';
import { useI18n } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import { frameBuy, frameCatalog, frameEquip, framesMine, type FrameId, type FrameItem } from '../services/frames.ts';
import { coins, newKey } from '../services/shop.ts';
import { SbError } from '../services/supabase.ts';
import { haptic } from '../services/telegram.ts';
import { Avatar } from './Avatar.tsx';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

/**
 * Profile Frames: the free ones (none / Classic / Champion while #1) and the artwork frames sold for coins.
 * `variant="profile"` sits on my profile; `variant="shop"` is the shop's Frames tab. Buying and wearing are server calls;
 * one frame at a time; it can be changed or taken off at any moment.
 */
export function FramePicker({ variant = 'profile' }: { variant?: 'profile' | 'shop' }) {
  const { t, lang } = useI18n();
  const { me, mode, signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const frames = useFrames();
  const cos = useCosmetics();
  const { toast } = useToast();
  const { query } = useRoute();
  const ref = useRef<HTMLElement>(null);
  const [mine, setMine] = useState<{ equipped: FrameId | null; champion_ok: boolean; owned: string[] } | null>(null);
  const [catalog, setCatalog] = useState<FrameItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<FrameItem | null>(null);

  const load = useCallback(async () => {
    if (mode !== 'live') return;
    const [cat, m] = await Promise.all([frameCatalog().catch(() => []), signedIn ? framesMine().catch(() => null) : Promise.resolve(null)]);
    setCatalog(Array.isArray(cat) ? cat : []);
    setMine(m ? { equipped: m.equipped ?? null, champion_ok: !!m.champion_ok, owned: m.owned ?? [] } : { equipped: null, champion_ok: false, owned: [] });
  }, [mode, signedIn]);
  useEffect(() => {
    void load();
  }, [load, me?.id, me?.rating]);
  // opened from the menu ("Ramkalar") → bring the card into view
  useEffect(() => {
    if (variant === 'profile' && query.get('section') === 'frames') setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [query, variant]);

  if (mode !== 'live') return null;
  const name = (f: FrameItem) => (lang === 'uz' ? f.name_uz : f.name_en);
  const owned = (slug: string) => !!mine?.owned.includes(slug) || catalog.some((c) => c.slug === slug && c.owned);

  const wear = async (f: FrameId | null) => {
    if (!mine || busy) return;
    if (!signedIn) return openAuth();
    setBusy(f ?? 'none');
    try {
      const r = await frameEquip(f);
      setMine({ ...mine, equipped: r.equipped });
      frames?.refresh();
      haptic('move');
      toast('success', t(f ? 'frame.on' : 'frame.off'));
    } catch (e) {
      toast('error', t(e instanceof SbError && /#1/.test(e.message) ? 'frame.notFirst' : 'frame.failed'));
    } finally {
      setBusy(null);
    }
  };

  const free: Array<{ id: FrameId | null; title: string; sub: string; locked: boolean }> = [
    { id: null, title: t('frame.none'), sub: t('frame.noneSub'), locked: false },
    { id: 'dameo', title: t('frame.classic'), sub: t('shop.free'), locked: false },
    { id: 'champion', title: t('frame.champion'), sub: t(mine?.champion_ok ? 'frame.championSub' : 'frame.championLocked'), locked: !mine?.champion_ok },
  ];
  const avName = me?.username ?? 'DAMEO';
  const avSeed = me?.avatar;
  return (
    <section className={`card frame-card ${variant === 'shop' ? 'frame-card-shop' : ''}`} ref={ref} id="frames" aria-label={t('frame.collection')}>
      <div className="frame-card-head">
        <h2 className="h2">{t('frame.collection')}</h2>
        <span className="muted small">{t('frame.collectionSub')}</span>
      </div>
      <div className="frame-opts" role="radiogroup" aria-label={t('frame.collection')}>
        {free.map((o) => {
          const on = (mine?.equipped ?? null) === o.id && !(o.id === 'champion' && o.locked);
          return (
            <button
              key={o.id ?? 'none'}
              role="radio"
              aria-checked={on}
              className={`frame-opt ${on ? 'frame-opt-on' : ''} ${o.locked ? 'frame-opt-locked' : ''}`}
              disabled={!mine || o.locked || busy !== null || !signedIn}
              onClick={() => wear(o.id)}
            >
              <span className="frame-opt-av">
                <Avatar name={avName} seed={avSeed} size={52} frame={o.id} />
              </span>
              <strong>{o.title}</strong>
              <span className="muted small">{o.sub}</span>
              <span className="frame-opt-state">{busy === (o.id ?? 'none') ? <LuLoader className="spin" /> : o.locked ? <LuLock /> : on ? <LuCheck /> : null}</span>
            </button>
          );
        })}
        {catalog.map((f) => {
          const have = owned(f.slug);
          const on = (mine?.equipped ?? null) === f.slug;
          return (
            <button
              key={f.slug}
              role="radio"
              aria-checked={on}
              className={`frame-opt frame-opt-art ${on ? 'frame-opt-on' : ''}`}
              disabled={busy !== null}
              onClick={() => (have ? wear(f.slug) : setOpen(f))}
            >
              <span className="frame-opt-av frame-opt-av-art">
                <Avatar name={avName} seed={avSeed} size={52} frame={f.slug} />
              </span>
              <strong>{name(f)}</strong>
              <span className={`small ${have ? 'muted' : 'frame-price'}`}>{have ? t(on ? 'shop.equipped' : 'shop.owned') : `🪙 ${coins(f.price)}`}</span>
              <span className="frame-opt-state">{busy === f.slug ? <LuLoader className="spin" /> : on ? <LuCheck /> : null}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <FrameBuyDialog
          item={open}
          avatar={{ name: avName, seed: avSeed }}
          onClose={() => setOpen(null)}
          onBought={async (slug) => {
            await load();
            await cos?.refreshWallet();
            await wear(slug);
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

function FrameBuyDialog({ item, avatar, onClose, onBought }: { item: FrameItem; avatar: { name: string; seed?: string }; onClose: () => void; onBought: (slug: string) => Promise<void> }) {
  const { t, lang } = useI18n();
  const { signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const { toast } = useToast();
  const cos = useCosmetics();
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey()); // one key per purchase attempt: a retry is never charged twice
  const balance = cos?.balance ?? 0;
  const name = lang === 'uz' ? item.name_uz : item.name_en;
  const buy = async () => {
    if (!signedIn) return openAuth();
    setBusy(true);
    try {
      await frameBuy(item.slug, key.current);
      haptic('win');
      toast('success', t('shop.bought', { name }));
      key.current = newKey();
      await onBought(item.slug);
    } catch (e) {
      const msg = e instanceof SbError ? e.message : '';
      toast('error', t(/insufficient/.test(msg) ? 'shop.err.funds' : /owned/.test(msg) ? 'shop.err.owned' : /restricted/.test(msg) ? 'shop.err.restricted' : 'shop.err.generic'));
      haptic('error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={name}>
      <div className="frame-buy">
        <div className="frame-buy-av">
          <Avatar name={avatar.name} seed={avatar.seed} size={132} frame={item.slug} />
        </div>
        <p className="muted small">{t('frame.buyHint')}</p>
        <p className="frame-buy-price">🪙 {coins(item.price)}</p>
        {!signedIn ? (
          <button className="btn btn-primary btn-block" onClick={openAuth}>
            {t('auth.signIn')}
          </button>
        ) : balance < item.price ? (
          <>
            <p className="muted small">{t('shop.needMore', { n: coins(item.price - balance) })}</p>
            <button className="btn btn-primary btn-block" onClick={() => navigate('/wallet')}>
              <LuPlus /> {t('wallet.topUp')}
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-block btn-lg" onClick={buy} disabled={busy}>
            {busy ? <LuLoader className="spin" /> : <LuShoppingBag />} {t('frame.buyWear')}
          </button>
        )}
        {signedIn && (
          <p className="muted small">
            {t('wallet.balance')}: 🪙 {coins(balance)}
          </p>
        )}
      </div>
    </Modal>
  );
}
