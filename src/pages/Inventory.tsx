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

const SLOTS: Slot[] = ['piece', 'board', 'effect'];

/** Everything the player owns, by slot; one active piece set, board and move effect at a time. */
export function Inventory() {
  const { t, lang } = useI18n();
  const { signedIn } = useAuth();
  const { toast } = useToast();
  const cos = useCosmetics();
  const [slot, setSlot] = useState<Slot>('piece');
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
          <button key={s} role="tab" aria-selected={slot === s} className={`chip-tab ${slot === s ? 'chip-tab-on' : ''}`} onClick={() => setSlot(s)}>
            {t(`slot.${s}s` as TKey)} <span className="tab-count">{(data?.items ?? []).filter((i) => i.owned && i.slot === s).length}</span>
          </button>
        ))}
      </div>
      {error && !data ? (
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
      {view && (
        <Modal open onClose={() => setView(null)} title={itemName(view, lang)} wide>
          <FullPreview item={view} />
        </Modal>
      )}
    </div>
  );
}
