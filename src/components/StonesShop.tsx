import { useMemo, useRef, useState } from 'react';
import { LuCheck, LuCrown, LuLoader, LuPlus, LuShoppingBag, LuSparkles } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { useI18n } from '../i18n/index.tsx';
import { navigate } from '../router.tsx';
import { boardArt, coins, equipItem, itemDesc, itemName, newKey, serialLabel, shopBuy, type BoardStock, type ShopItem } from '../services/shop.ts';
import { registerSkins, skinClasses } from '../services/skins.ts';
import { SbError } from '../services/supabase.ts';
import { haptic } from '../services/telegram.ts';
import { useAuthDialog } from './AuthDialog.tsx';
import { EditionBadge, EditionPlate, Remaining } from './LimitedBoards.tsx';
import { Modal } from './Modal.tsx';
import { FullPreview, RarityBadge } from './ShopParts.tsx';
import { useToast } from './Toast.tsx';

const starsFor = (c: number, rate: number) => Math.max(1, Math.ceil((c * rate) / 1000 - 1e-9));

/** "Standard" (free) / "Premium" / "Limited · 30 dona" */
function TypeBadge({ item, stock }: { item: ShopItem; stock?: BoardStock }) {
  const { t, num } = useI18n();
  if (stock) return <span className="st-badge st-badge-ltd">{stock.supply ? t('stones.limited', { n: num(stock.supply) }) : 'Limited'}</span>;
  return <span className={`st-badge ${item.is_free ? 'st-badge-std' : 'st-badge-prem'}`}>{t(item.is_free ? 'stones.standard' : 'stones.premium')}</span>;
}

/** One stone as it looks in a game (man or king), drawn by the real piece renderer. */
export function StonePiece({ slug, side = 'w', king = false, size = 96 }: { slug: string; side?: 'w' | 'b'; king?: boolean; size?: number }) {
  return (
    <span className={`board-wrap stone-solo ${skinClasses({ piece: slug })}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className={`piece ${side === 'w' ? 'piece-w' : 'piece-b'} ${king ? 'piece-king' : ''}`}>
        <span className="piece-disc">
          <i className="pfx" />
          {king && <LuCrown className="piece-crown" />}
        </span>
      </span>
    </span>
  );
}

/** DAMEO Stones Collection: the shop's Stones tab. */
export function StonesShop({ items, stock, starsPer1000, equippedSlug, onChanged }: {
  items: ShopItem[];
  stock: BoardStock[];
  starsPer1000: number;
  equippedSlug: string | null;
  onChanged: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    registerSkins(items.map((i) => ({ slug: i.slug, slot: i.slot, style: i.style })));
    return [...items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.price - b.price);
  }, [items]);
  const stockOf = (slug: string) => stock.find((s) => s.slug === slug);
  const cur = open ? list.find((i) => i.slug === open) : null;
  return (
    <section className="ltd-shop st-shop" aria-label={t('stones.title')}>
      <div className="ltd-head">
        <h2 className="h2">Stones Collection</h2>
        <p className="muted small">{t('stones.sub')}</p>
      </div>
      <div className="ltd-grid">
        {list.map((i) => {
          const s = stockOf(i.slug);
          const owned = i.owned || i.is_free || !!s?.mine;
          const on = equippedSlug === i.slug;
          const price = i.final_price;
          return (
            <article key={i.slug} className={`ltd-card st-c-${i.slug} ${s?.sold_out && !owned ? 'is-out' : ''} ${on ? 'is-on' : ''}`}>
              <button className="ltd-card-art st-card-art" onClick={() => setOpen(i.slug)} aria-label={itemName(i, lang)}>
                <img className="board-art st-art-img" src={boardArt(i.image_url)} alt="" width={374} height={212} loading="lazy" decoding="async" />
              </button>
              <div className="ltd-card-body">
                <h3 className="ltd-name">{itemName(i, lang)}</h3>
                <div className="ltd-tags">{s ? <EditionBadge stock={s} /> : <TypeBadge item={i} />}</div>
                {s?.mine ? (
                  <span className="ltd-mine">
                    <LuCheck /> {t('lb.yours', { serial: serialLabel(s.mine.serial, s.supply) })}
                  </span>
                ) : owned ? (
                  <span className="ltd-mine">
                    <LuCheck /> {t('shop.owned')}
                  </span>
                ) : s ? (
                  <Remaining stock={s} />
                ) : (
                  <span className="ltd-left muted small">{t('stones.unlimited')}</span>
                )}
                <div className="ltd-price">
                  {price === 0 ? (
                    <strong className="price-free">{t('shop.free')}</strong>
                  ) : (
                    <>
                      <strong>🪙 {coins(price)}</strong>
                      <span className="ltd-stars">⭐ {coins(starsFor(price, starsPer1000))}</span>
                    </>
                  )}
                </div>
                <button className={`btn btn-block btn-sm ${owned ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setOpen(i.slug)} disabled={!owned && !!s?.sold_out}>
                  {owned ? (on ? t('shop.equipped') : t('shop.equip')) : s?.sold_out ? 'SOLD OUT' : t('lb.buy')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {cur && <StoneModal item={cur} stock={stockOf(cur.slug)} starsPer1000={starsPer1000} equipped={equippedSlug === cur.slug} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </section>
  );
}

function StoneModal({ item, stock, starsPer1000, equipped, onClose, onChanged }: {
  item: ShopItem; stock?: BoardStock; starsPer1000: number; equipped: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const { signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const { toast } = useToast();
  const cos = useCosmetics();
  const [busy, setBusy] = useState<null | 'buy' | 'equip'>(null);
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState<'3d' | 'man' | 'king' | 'board'>('3d');
  const key = useRef(newKey());
  const owned = item.owned || item.is_free || !!stock?.mine;
  const price = item.final_price;
  const balance = cos?.balance ?? 0;
  const name = itemName(item, lang);

  const buy = async () => {
    if (!signedIn) return openAuth();
    setBusy('buy');
    try {
      const r = (await shopBuy(item.slug, key.current)) as { serial?: number; supply?: number | null };
      haptic('win');
      toast('success', r.serial ? t('lb.bought', { name, serial: serialLabel(r.serial, r.supply ?? stock?.supply ?? null) }) : t('shop.bought', { name }));
      key.current = newKey();
      setConfirm(false);
      await onChanged();
      await cos?.refreshWallet();
    } catch (e) {
      const msg = e instanceof SbError ? e.message : '';
      toast('error', /sold out/.test(msg) ? t('lb.soldOutErr') : t(/insufficient/.test(msg) ? 'shop.err.funds' : /owned/.test(msg) ? 'shop.err.owned' : /restricted/.test(msg) ? 'shop.err.restricted' : 'shop.err.generic'));
      haptic('error');
      await onChanged();
    } finally {
      setBusy(null);
    }
  };
  const equip = async (on: boolean) => {
    if (!signedIn) return openAuth();
    setBusy('equip');
    try {
      await equipItem('piece', on ? item.slug : null);
      cos?.setEquipped('piece', on ? { slug: item.slug, style: item.style } : null);
      haptic('move');
      toast('success', t(on ? 'shop.equippedOk' : 'shop.unequippedOk'));
      await onChanged();
    } catch {
      toast('error', t('shop.err.generic'));
    } finally {
      setBusy(null);
    }
  };

  const views: Array<[typeof view, string]> = [['3d', t('stones.view3d')], ['man', t('stones.man')], ['king', t('stones.king')], ['board', t('stones.onBoard')]];
  return (
    <Modal open onClose={onClose} title={name} wide>
      <div className="ltd-detail">
        <div className="ltd-detail-view">
          <div className="seg ltd-tabs" role="tablist">
            {views.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={view === id} className={`seg-btn ${view === id ? 'seg-on' : ''}`} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="st-stage">
            {view === '3d' ? (
              <img className="st-stage-art" src={boardArt(item.image_url)} alt={name} width={374} height={212} decoding="async" />
            ) : view === 'board' ? (
              <FullPreview item={item} />
            ) : (
              <span className="st-pair">
                <StonePiece slug={item.slug} side="w" king={view === 'king'} size={118} />
                <StonePiece slug={item.slug} side="b" king={view === 'king'} size={118} />
              </span>
            )}
          </div>
          {stock && <EditionPlate serial={stock.mine?.serial ?? null} supply={stock.supply} />}
        </div>
        <div className="item-info">
          <div className="item-tags">
            <TypeBadge item={item} stock={stock} />
            <RarityBadge r={item.rarity} />
          </div>
          <p className="muted">{itemDesc(item, lang)}</p>
          {owned ? (
            equipped ? (
              item.is_free ? (
                <p className="owned owned-on">
                  <LuCheck /> {t('shop.equipped')}
                </p>
              ) : (
                <>
                <p className="owned owned-on">
                  <LuCheck /> {t('shop.equipped')}
                </p>
                <button className="btn btn-secondary btn-block" onClick={() => equip(false)} disabled={busy !== null}>
                  {busy === 'equip' ? <LuLoader className="spin" /> : <LuCheck />} {t('shop.unequip')}
                </button>
                </>
              )
            ) : (
              <button className="btn btn-primary btn-block" onClick={() => equip(true)} disabled={busy !== null}>
                {busy === 'equip' ? <LuLoader className="spin" /> : <LuSparkles />} {t('stones.select')}
              </button>
            )
          ) : stock?.sold_out ? (
            <p className="ltd-badge ltd-badge-out ltd-out-lg">SOLD OUT</p>
          ) : !signedIn ? (
            <button className="btn btn-primary btn-block" onClick={openAuth}>
              {t('auth.signIn')}
            </button>
          ) : balance < price ? (
            <div className="item-short">
              <p className="muted small">{t('shop.needMore', { n: coins(price - balance) })}</p>
              <button className="btn btn-primary btn-block" onClick={() => navigate('/wallet')}>
                <LuPlus /> {t('wallet.topUp')}
              </button>
            </div>
          ) : confirm ? (
            <div className="item-confirm">
              <p>{stock ? t('lb.confirm', { name, n: coins(price) }) : t('shop.confirm', { name, n: coins(price) })}</p>
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
            <>
              <div className="ltd-price ltd-price-lg">
                <strong>🪙 {coins(price)}</strong>
                <span className="ltd-stars">⭐ {coins(starsFor(price, starsPer1000))}</span>
              </div>
              <button className="btn btn-primary btn-block btn-lg" onClick={() => setConfirm(true)}>
                <LuShoppingBag /> {t('lb.buy')}
              </button>
            </>
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
