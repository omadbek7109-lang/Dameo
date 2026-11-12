import { useEffect, useMemo, useRef, useState } from 'react';
import { LuCheck, LuLoader, LuPlus, LuShoppingBag, LuSparkles } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useAuthDialog } from '../components/AuthDialog.tsx';
import { Modal } from '../components/Modal.tsx';
import { CoinBadge, FullPreview, MiniPreview, RarityBadge } from '../components/ShopParts.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import { FramePicker } from '../components/FramePicker.tsx';
import { LimitedShop } from '../components/LimitedBoards.tsx';
import { StonesShop } from '../components/StonesShop.tsx';
import { GiftShop } from '../components/GiftShop.tsx';
import { boardStock, limitedStock, coins, equipItem, itemDesc, itemName, newKey, pricingSettings, shopBuy, shopCatalog, type BoardStock, type Catalog, type ShopItem } from '../services/shop.ts';
import { registerSkins } from '../services/skins.ts';
import { SbError } from '../services/supabase.ts';
import { haptic } from '../services/telegram.ts';

const COLLECTION_ORDER = ['football', 'signature', 'classic', 'girls', 'boys', 'chess', 'trend', 'premium', 'fx'];

/** DAMEO Shop: categories, collections, previews, buying with DAMEO Coins and equipping. */
export function Shop() {
  const { t, lang } = useI18n();
  const route = useRoute();
  const { signedIn, mode } = useAuth();
  const cos = useCosmetics();
  const [picked, setCat] = useState<string | null>(route.query.get('cat'));
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [stock, setStock] = useState<BoardStock[] | null>(null);
  const [stoneStock, setStoneStock] = useState<BoardStock[]>([]);
  const [rate, setRate] = useState(25); // Telegram Stars per 1 000 coins

  const load = async () => {
    try {
      const [c, st, pr, ss] = await Promise.all([shopCatalog(), boardStock(), pricingSettings().catch(() => null), limitedStock('piece').catch(() => [])]);
      setStoneStock(Array.isArray(ss) ? ss : []);
      registerSkins(c.items.map((i) => ({ slug: i.slug, slot: i.slot, style: i.style })));
      setStock(Array.isArray(st) ? st : null);
      if (pr) setRate(Number(pr.stars_per_1000));
      setData(c);
      setError(false);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    void load();
  }, [signedIn]);
  useEffect(() => {
    const c = route.query.get('cat');
    if (c) setCat(c);
  }, [route.query]);

  // the Football tab shows the football collection (those sets also stay on the main pieces page)
  // default tab: the server's first category (Toshlar)
  const cat = picked ?? data?.categories[0]?.id ?? 'stones';
  const items = useMemo(() => (data?.items ?? []).filter((i) => (cat === 'football' ? i.collection === 'football' : i.category_id === cat)), [data, cat]);
  const groups = useMemo(() => {
    const m = new Map<string, ShopItem[]>();
    for (const i of items) m.set(i.collection, [...(m.get(i.collection) ?? []), i]);
    return [...m.entries()].sort((a, b) => COLLECTION_ORDER.indexOf(a[0]) - COLLECTION_ORDER.indexOf(b[0]));
  }, [items]);
  const equipped = data?.equipped ?? null;
  // the open item always reflects the latest server state (owned / equipped after a purchase)
  const open = openSlug ? (data?.items.find((i) => i.slug === openSlug) ?? null) : null;

  if (mode !== 'live') return <div className="page"><EmptyState title={t('shop.needOnline')} /></div>;
  return (
    <div className="page shop-page">
      <div className="page-head">
        <div>
          <h1 className="h1">
            <LuShoppingBag /> {t('shop.title')}
          </h1>
          <p className="muted">{t('shop.sub')}</p>
        </div>
        {signedIn && (
          <div className="shop-wallet">
            <CoinBadge value={cos?.balance ?? null} to="/wallet" />
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/wallet')}>
              <LuPlus /> {t('wallet.topUp')}
            </button>
          </div>
        )}
      </div>

      <div className="chip-tabs" role="tablist" aria-label={t('shop.categories')}>
        {(data?.categories ?? []).map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={`chip-tab ${cat === c.id ? 'chip-tab-on' : ''}`} onClick={() => setCat(c.id)}>
            {lang === 'uz' ? c.name_uz : c.name_en}
          </button>
        ))}
        <button role="tab" aria-selected={cat === 'gifts'} className={`chip-tab chip-tab-gift ${cat === 'gifts' ? 'chip-tab-on' : ''}`} onClick={() => setCat('gifts')}>
          {t('gift.tab')}
        </button>
      </div>

      {error && !data ? (
        <ErrorState onRetry={load} />
      ) : !data ? (
        <Spinner />
      ) : cat === 'gifts' ? (
        <GiftShop balance={cos?.balance ?? null} onBalance={() => void cos?.refreshWallet()} />
      ) : cat === 'frames' ? (
        <FramePicker variant="shop" />
      ) : cat === 'stones' ? (
        <StonesShop
          items={items}
          stock={stoneStock}
          starsPer1000={rate}
          equippedSlug={equipped?.piece ?? null}
          onChanged={async () => {
            await load();
            await cos?.refreshWallet();
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState title={t('shop.empty')} />
      ) : cat === 'boards' && stock ? (
        <LimitedShop
          items={items.filter((i) => i.collection === 'limited')}
          stock={stock}
          starsPer1000={rate}
          equippedSlug={equipped?.board ?? null}
          onChanged={async () => {
            await load();
            await cos?.refreshWallet();
          }}
        />
      ) : (
        groups.map(([col, list]) => (
          <section key={col} className="shop-group" aria-label={t(`collection.${col}` as TKey)}>
            {groups.length > 1 && <h2 className="shop-group-title">{t(`collection.${col}` as TKey)}</h2>}
            <div className="shop-grid">
              {list.map((i) => (
                <ItemCard key={i.slug} item={i} equipped={equipped ? equipped[i.slot] === i.slug || (!equipped[i.slot] && i.is_default) : i.is_default} onOpen={() => setOpenSlug(i.slug)} />
              ))}
            </div>
          </section>
        ))
      )}
      {open && (
        <ItemModal
          item={open}
          equipped={equipped ? equipped[open.slot] === open.slug || (!equipped[open.slot] && open.is_default) : open.is_default}
          onClose={() => setOpenSlug(null)}
          onChanged={async () => {
            await load();
            await cos?.refreshWallet();
          }}
        />
      )}
    </div>
  );
}

function PriceTag({ item }: { item: ShopItem }) {
  const { t } = useI18n();
  if (item.is_free || item.is_default) return <span className="price price-free">{t('shop.free')}</span>;
  return (
    <span className="price">
      {item.discount_percent > 0 && <s className="muted">{coins(item.price)}</s>} 🪙 {coins(item.final_price)}
    </span>
  );
}

function ItemCard({ item, equipped, onOpen }: { item: ShopItem; equipped: boolean; onOpen: () => void }) {
  const { t, lang } = useI18n();
  return (
    <button className={`shop-card rarity-edge-${item.rarity} ${equipped ? 'shop-card-on' : ''}`} onClick={onOpen}>
      {item.discount_percent > 0 && <span className="shop-sale">−{item.discount_percent}%</span>}
      <MiniPreview item={item} />
      <span className="shop-card-name">{itemName(item, lang)}</span>
      <span className="shop-card-meta">
        <RarityBadge r={item.rarity} />
      </span>
      <span className="shop-card-foot">
        {equipped ? (
          <span className="owned owned-on">
            <LuCheck /> {t('shop.equipped')}
          </span>
        ) : item.owned ? (
          <span className="owned">{t('shop.owned')}</span>
        ) : item.retired ? (
          <span className="muted small">{t('shop.retired')}</span>
        ) : (
          <PriceTag item={item} />
        )}
      </span>
    </button>
  );
}

function ItemModal({ item, equipped, onClose, onChanged }: { item: ShopItem; equipped: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const { signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const { toast } = useToast();
  const cos = useCosmetics();
  const [busy, setBusy] = useState<null | 'buy' | 'equip'>(null);
  const [confirm, setConfirm] = useState(false);
  const key = useRef(newKey()); // one key per purchase attempt: retries are never charged twice
  const balance = cos?.balance ?? 0;
  const short = !item.owned && !item.is_free && balance < item.final_price;

  const buy = async () => {
    if (!signedIn) return openAuth();
    setBusy('buy');
    try {
      await shopBuy(item.slug, key.current);
      haptic('win');
      toast('success', t('shop.bought', { name: itemName(item, lang) }));
      key.current = newKey();
      setConfirm(false);
      await onChanged();
    } catch (e) {
      const msg = e instanceof SbError ? e.message : '';
      toast('error', t(/insufficient/.test(msg) ? 'shop.err.funds' : /owned/.test(msg) ? 'shop.err.owned' : /restricted/.test(msg) ? 'shop.err.restricted' : /sale/.test(msg) ? 'shop.retired' : 'shop.err.generic'));
      haptic('error');
    } finally {
      setBusy(null);
    }
  };
  const equip = async (on: boolean) => {
    setBusy('equip');
    try {
      await equipItem(item.slot, on ? item.slug : null);
      cos?.setEquipped(item.slot, on ? { slug: item.slug, style: item.style } : null);
      haptic('move');
      toast('success', t(on ? 'shop.equippedOk' : 'shop.unequippedOk'));
      await onChanged();
    } catch {
      toast('error', t('shop.err.generic'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={itemName(item, lang)} wide>
      <div className="item-detail">
        <FullPreview item={item} />
        <div className="item-info">
          <div className="item-tags">
            <RarityBadge r={item.rarity} />
            <span className="badge">{t(`slot.${item.slot}` as TKey)}</span>
            {item.discount_percent > 0 && <span className="badge badge-free">−{item.discount_percent}%</span>}
          </div>
          <p className="muted">{itemDesc(item, lang)}</p>
          {item.owned || item.is_free ? (
            equipped ? (
              item.is_default ? (
                <p className="owned owned-on">
                  <LuCheck /> {t('shop.equipped')}
                </p>
              ) : (
                <button className="btn btn-secondary btn-block" onClick={() => equip(false)} disabled={busy !== null}>
                  {busy === 'equip' ? <LuLoader className="spin" /> : <LuCheck />} {t('shop.unequip')}
                </button>
              )
            ) : (
              <button className="btn btn-primary btn-block" onClick={() => equip(true)} disabled={busy !== null}>
                {busy === 'equip' ? <LuLoader className="spin" /> : <LuSparkles />} {t('shop.equip')}
              </button>
            )
          ) : item.retired ? (
            <p className="muted">{t('shop.retired')}</p>
          ) : item.premium_only ? (
            <p className="muted">{t('shop.premiumOnly')}</p>
          ) : !signedIn ? (
            <button className="btn btn-primary btn-block" onClick={openAuth}>
              {t('auth.signIn')}
            </button>
          ) : short ? (
            <div className="item-short">
              <p className="muted small">{t('shop.needMore', { n: coins(item.final_price - balance) })}</p>
              <button className="btn btn-primary btn-block" onClick={() => navigate('/wallet')}>
                <LuPlus /> {t('wallet.topUp')}
              </button>
            </div>
          ) : confirm ? (
            <div className="item-confirm">
              <p>{t('shop.confirm', { name: itemName(item, lang), n: coins(item.final_price) })}</p>
              <div className="row-actions">
                <button className="btn btn-primary" onClick={buy} disabled={busy !== null}>
                  {busy === 'buy' ? <LuLoader className="spin" /> : <LuCheck />} {t('common.confirm')}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirm(false)} disabled={busy !== null}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-primary btn-block btn-lg" onClick={() => setConfirm(true)}>
              <LuShoppingBag /> {t('shop.buyFor', { n: coins(item.final_price) })}
            </button>
          )}
          {signedIn && (
            <p className="muted small">
              {t('wallet.balance')}: 🪙 {coins(balance)}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
