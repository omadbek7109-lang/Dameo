import { useEffect, useMemo, useState } from 'react';
import { LuBackpack, LuCheck, LuLoader, LuShoppingBag } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { FullPreview, MiniPreview, RarityBadge } from '../components/ShopParts.tsx';
import { Modal } from '../components/Modal.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { equipItem, itemName, shopCatalog, type Catalog, type ShopItem } from '../services/shop.ts';
import { registerSkins, type Slot } from '../services/skins.ts';
import { haptic } from '../services/telegram.ts';
import { equipCosmetic, getBoosters, getPass, activateBooster, type BoosterState, type PassState } from '../services/pass/index.ts';
import { PASS_EVENT } from '../services/pass/index.ts';
import { COSMETIC_ART } from '../services/pass/core.ts';
import { VictoryFx } from '../components/VictoryFx.tsx';
import { playSound } from '../services/sound.ts';

type PassTab = 'combo' | 'victory' | 'boost';
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
/** "22-dekabr" / "22 December" (Uzbek month names written out: browsers' uz locale prints "M12") */
const dayMonth = (ms: number, lang: string) => {
  const d = new Date(ms);
  return lang === 'en' ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`;
};
type Tab = Slot | PassTab;
const PASS_TABS: PassTab[] = ['boost', 'combo', 'victory'];

const SLOTS: Slot[] = ['piece', 'board', 'effect'];

/** Everything the player owns, by slot; one active piece set, board and move effect at a time. */
export function Inventory() {
  const { t, lang } = useI18n();
  const { signedIn } = useAuth();
  const { toast } = useToast();
  const cos = useCosmetics();
  const [tab, setTab] = useState<Tab>('piece');
  const slot: Slot = (PASS_TABS as string[]).includes(tab) ? 'piece' : (tab as Slot);
  const [pass, setPass] = useState<PassState | null>(null);
  const [preview, setPreview] = useState(0);
  const [boosters, setBoosters] = useState<BoosterState>({ stored: [], active: null });
  const [, tick] = useState(0);
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<ShopItem | null>(null);

  const load = async () => {
    try {
      const c = await shopCatalog();
      registerSkins(c.items.map((i) => ({ slug: i.slug, slot: i.slot, style: i.style })));
      setData(c);
      setError(false);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn]);
  // DAMEO Pass combo effects and victory animations live in the Pass store
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const lp = () => {
      getPass().then((p) => alive && setPass(p), () => undefined);
      getBoosters().then((b) => alive && setBoosters(b), () => undefined);
    };
    void lp();
    window.addEventListener(PASS_EVENT, lp);
    return () => {
      alive = false;
      window.removeEventListener(PASS_EVENT, lp);
    };
  }, [signedIn]);
  // the running booster's countdown (once a minute; nothing when none runs)
  useEffect(() => {
    if (!boosters.active) return;
    const id = setInterval(() => {
      if (boosters.active && Date.now() >= boosters.active.until) void getBoosters().then(setBoosters);
      tick((n) => n + 1);
    }, 30_000);
    return () => clearInterval(id);
  }, [boosters.active]);
  const passOwned = (k: PassTab) => (k === 'boost' ? [] : (pass?.owned ?? []).filter((o) => o.kind === k));
  const tabCount = (k: PassTab) => (k === 'boost' ? boosters.stored.length + (boosters.active ? 1 : 0) : passOwned(k).length);
  const left = (ms: number) => {
    const m = Math.max(0, Math.ceil(ms / 60_000));
    return t('inv.boost.left', { h: Math.floor(m / 60), m: m % 60 });
  };
  const turnOn = async (id: string) => {
    setBusy(id);
    const r = await activateBooster(id);
    setBusy(null);
    if (r.ok) {
      haptic('win');
      toast('success', t('inv.boost.on'));
      setBoosters(await getBoosters());
    } else toast('error', t(r.error === 'active' ? 'inv.boost.errActive' : r.error === 'expired' ? 'inv.boost.errExpired' : 'shop.err.generic'));
  };
  const passName = (k: PassTab, id: string) => {
    const r = pass?.rewards.find((x) => x.kind === k && x.value === id);
    return r ? (lang === 'en' ? r.label_en : r.label_uz) : id;
  };
  const passNote = (k: PassTab, id: string) => {
    const r = pass?.rewards.find((x) => x.kind === k && x.value === id);
    return r ? ((lang === 'en' ? r.note_en : r.note_uz) ?? '') : '';
  };
  const wearVictory = async (id: string | null) => {
    setBusy(id ?? 'off');
    if (await equipCosmetic('victory', id)) haptic('move');
    else toast('error', t('shop.err.generic'));
    setBusy(null);
  };

  const owned = useMemo(() => (data?.items ?? []).filter((i) => i.owned && i.slot === slot), [data, slot]);
  if (!signedIn) return <div className="page"><SignInPrompt text={t('inv.needAccount')} /></div>;
  const active = (i: ShopItem) => (data?.equipped?.[i.slot] ? data.equipped[i.slot] === i.slug : i.is_default);

  const equip = async (i: ShopItem, on: boolean) => {
    setBusy(i.slug);
    try {
      await equipItem(i.slot, on ? i.slug : null);
      cos?.setEquipped(i.slot, on ? { slug: i.slug, style: i.style } : null);
      haptic('move');
      await load();
    } catch {
      toast('error', t('shop.err.generic'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="h1">
            <LuBackpack /> {t('inv.title')}
          </h1>
          <p className="muted">{t('inv.sub')}</p>
        </div>
        <Link to="/shop" className="btn btn-secondary btn-sm">
          <LuShoppingBag /> {t('shop.title')}
        </Link>
      </div>
      <div className="chip-tabs" role="tablist">
        {SLOTS.map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} className={`chip-tab ${tab === s ? 'chip-tab-on' : ''}`} onClick={() => setTab(s)}>
            {t(`slot.${s}s` as TKey)} <span className="tab-count">{(data?.items ?? []).filter((i) => i.owned && i.slot === s).length}</span>
          </button>
        ))}
        {PASS_TABS.map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} className={`chip-tab ${tab === s ? 'chip-tab-on' : ''}`} onClick={() => setTab(s)}>
            {t(`inv.tab.${s}` as TKey)} <span className="tab-count">{tabCount(s)}</span>
          </button>
        ))}
      </div>
      {tab === 'boost' ? (
        boosters.stored.length === 0 && !boosters.active ? (
          <EmptyState title={t('inv.passEmpty.boost')} action={<Link to="/pass" className="btn btn-primary">DAMEO Pass</Link>} />
        ) : (
          <>
            <p className="muted small inv-pass-note">{t('inv.boost.how')}</p>
            {boosters.active && (
              <div className="card inv-boost-on">
                <img src={new URL('pass/free-03.webp', document.baseURI).href} alt="" />
                <div>
                  <b>XP +{boosters.active.pct}% · {t('inv.boost.running')}</b>
                  <span className="muted small">{left(boosters.active.until - Date.now())}</span>
                </div>
              </div>
            )}
            <div className="shop-grid">
              {boosters.stored.map((b) => (
                <div key={b.id} className="shop-card inv-card inv-pass rarity-edge-rare">
                  <img className="inv-pass-art inv-boost-art" src={new URL(b.pct >= 30 ? 'pass/prem-03.webp' : 'pass/free-03.webp', document.baseURI).href} alt="" loading="lazy" />
                  <span className="shop-card-name">{lang === 'en' ? b.label_en : b.label_uz}</span>
                  <span className="muted small inv-pass-desc">{t('inv.boost.until', { d: dayMonth(b.expires, lang) })}</span>
                  <button className="btn btn-primary btn-sm btn-block" onClick={() => turnOn(b.id)} disabled={busy !== null || !!boosters.active}>
                    {busy === b.id ? <LuLoader className="spin" /> : null} {t('inv.boost.use')}
                  </button>
                </div>
              ))}
            </div>
          </>
        )
      ) : tab === 'combo' || tab === 'victory' ? (
        passOwned(tab).length === 0 ? (
          <EmptyState title={t(`inv.passEmpty.${tab}` as TKey)} action={<Link to="/pass" className="btn btn-primary">DAMEO Pass</Link>} />
        ) : (
          <>
            {tab === 'combo' && <p className="muted small inv-pass-note">{t('inv.comboHow')}</p>}
            <div className="shop-grid">
              {passOwned(tab).map((o) => {
                const on = tab === 'combo' || pass?.equipped.victory === o.id;
                return (
                  <div key={o.id} className={`shop-card inv-card inv-pass rarity-edge-legendary ${on ? 'shop-card-on' : ''}`}>
                    {COSMETIC_ART[o.id] && <img className="inv-pass-art" src={new URL(COSMETIC_ART[o.id], document.baseURI).href} alt="" loading="lazy" />}
                    <span className="shop-card-name">{passName(tab, o.id)}</span>
                    <span className="muted small inv-pass-desc">{passNote(tab, o.id)}</span>
                    {tab === 'victory' && (
                      <button
                        className="btn btn-ghost btn-sm btn-block"
                        onClick={() => {
                          playSound('victory');
                          setPreview((n) => n + 1);
                        }}
                      >
                        {t('inv.preview')}
                      </button>
                    )}
                    {tab === 'combo' ? (
                      <span className="owned owned-on">
                        <LuCheck /> {t('inv.alwaysOn')}
                      </span>
                    ) : on ? (
                      <button className="btn btn-secondary btn-sm btn-block" onClick={() => wearVictory(null)} disabled={busy !== null}>
                        <LuCheck /> {t('shop.unequip')}
                      </button>
                    ) : (
                      <button className="btn btn-primary btn-sm btn-block" onClick={() => wearVictory(o.id)} disabled={busy !== null}>
                        {busy === o.id ? <LuLoader className="spin" /> : null} {t('shop.equip')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )
      ) : error && !data ? (
        <ErrorState onRetry={load} />
      ) : !data ? (
        <Spinner />
      ) : owned.length === 0 ? (
        <EmptyState title={t('inv.empty')} action={<Link to={`/shop?cat=${slot === 'piece' ? 'pieces' : slot === 'board' ? 'boards' : 'animations'}`} className="btn btn-primary">{t('shop.title')}</Link>} />
      ) : (
        <div className="shop-grid">
          {owned.map((i) => (
            <div key={i.slug} className={`shop-card inv-card rarity-edge-${i.rarity} ${active(i) ? 'shop-card-on' : ''}`}>
              <button className="inv-view" onClick={() => setView(i)} aria-label={itemName(i, lang)}>
                <MiniPreview item={i} />
              </button>
              <span className="shop-card-name">{itemName(i, lang)}</span>
              <span className="shop-card-meta">
                <RarityBadge r={i.rarity} />
              </span>
              {active(i) ? (
                <span className="owned owned-on">
                  <LuCheck /> {t('shop.equipped')}
                </span>
              ) : (
                <button className="btn btn-primary btn-sm btn-block" onClick={() => equip(i, true)} disabled={busy !== null}>
                  {busy === i.slug ? <LuLoader className="spin" /> : null} {t('shop.equip')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {preview > 0 && <VictoryFx key={preview} />}
      {view && (
        <Modal open onClose={() => setView(null)} title={itemName(view, lang)} wide>
          <FullPreview item={view} />
        </Modal>
      )}
    </div>
  );
}
