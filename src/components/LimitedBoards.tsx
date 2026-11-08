import { useRef, useState } from 'react';
import { LuCheck, LuLoader, LuPlus, LuShoppingBag, LuSparkles } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { useI18n } from '../i18n/index.tsx';
import { navigate } from '../router.tsx';
import { boardArt, coins, equipItem, itemDesc, itemName, newKey, serialLabel, shopBuy, type BoardStock, type ShopItem } from '../services/shop.ts';
import { SbError } from '../services/supabase.ts';
import { haptic } from '../services/telegram.ts';
import { useAuthDialog } from './AuthDialog.tsx';
import { Modal } from './Modal.tsx';
import { FullPreview, RarityBadge } from './ShopParts.tsx';
import { useToast } from './Toast.tsx';

/** a coin price in Telegram Stars at the current rate (whole Stars, rounded up — the same rule as the server's packages) */
const starsFor = (coinsAmount: number, starsPer1000: number) => Math.max(1, Math.ceil((coinsAmount * starsPer1000) / 1000 - 1e-9));

/** board artwork (thumbnail on cards, full size when opened) */
export function BoardArt({ url, size = 'sm', alt, className = '' }: { url: string | null; size?: 'sm' | 'lg'; alt: string; className?: string }) {
  if (!url) return null;
  const full = boardArt(url);
  const sm = full.replace(/\.webp$/, '-sm.webp');
  return (
    <img
      className={`board-art ${className}`}
      src={size === 'sm' ? sm : full}
      srcSet={size === 'sm' ? `${sm} 256w, ${full} 512w` : undefined}
      sizes={size === 'sm' ? '(max-width: 600px) 46vw, 220px' : undefined}
      width={512}
      height={512}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
}

/** Gold plate under a board preview: LIMITED EDITION + the player's own serial (from the database) or the edition size. */
export function EditionPlate({ serial, supply }: { serial: number | null; supply: number | null }) {
  const { t, num } = useI18n();
  return (
    <div className="ltd-plate" aria-label={serial ? `LIMITED EDITION ${serialLabel(serial, supply)}` : 'LIMITED EDITION'}>
      <span className="ltd-plate-k">LIMITED EDITION</span>
      {serial ? (
        <strong className="ltd-plate-serial">{serialLabel(serial, supply)}</strong>
      ) : (
        <span className="ltd-plate-sub">{supply ? t('lb.plateTotal', { n: num(supply) }) : t('lb.plateOpen')}</span>
      )}
    </div>
  );
}

/** "LIMITED — 30 DONA" / limit not set / SOLD OUT */
export function EditionBadge({ stock }: { stock: Pick<BoardStock, 'supply' | 'sold_out'> }) {
  const { t, num } = useI18n();
  return (
    <>
      <span className="ltd-badge">{stock.supply ? t('lb.limitedN', { n: num(stock.supply) }) : t('lb.limited')}</span>
      {stock.sold_out && <span className="ltd-badge ltd-badge-out">SOLD OUT</span>}
    </>
  );
}

export function Remaining({ stock }: { stock: BoardStock }) {
  const { t, num } = useI18n();
  if (stock.supply === null) return <span className="ltd-left muted small">{t('lb.noLimit')}</span>;
  const pct = Math.round((100 * (stock.remaining ?? 0)) / stock.supply);
  return (
    <span className="ltd-left">
      <span className="small">{t('lb.left', { n: num(stock.remaining ?? 0), total: num(stock.supply) })}</span>
      <span className="ltd-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** The Limited Collection grid in the shop's Boards category. */
export function LimitedShop({ items, stock, starsPer1000, equippedSlug, onChanged }: {
  items: ShopItem[];
  stock: BoardStock[];
  starsPer1000: number;
  equippedSlug: string | null;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  const rows = stock.filter((s) => bySlug.has(s.slug));
  const cur = open ? rows.find((s) => s.slug === open) : null;
  return (
    <section className="ltd-shop" aria-label={t('lb.title')}>
      <div className="ltd-head">
        <h2 className="h2">{t('lb.title')}</h2>
        <p className="muted small">{t('lb.sub')}</p>
      </div>
      <div className="ltd-grid">
        {rows.map((s) => (
          <LimitedCard key={s.slug} item={bySlug.get(s.slug)!} stock={s} starsPer1000={starsPer1000} equipped={equippedSlug === s.slug} onOpen={() => setOpen(s.slug)} />
        ))}
      </div>
      {cur && <LimitedModal item={bySlug.get(cur.slug)!} stock={cur} starsPer1000={starsPer1000} equipped={equippedSlug === cur.slug} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </section>
  );
}

function LimitedCard({ item, stock, starsPer1000, equipped, onOpen }: { item: ShopItem; stock: BoardStock; starsPer1000: number; equipped: boolean; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const price = item.final_price;
  return (
    <article className={`ltd-card ltd-tier-${stock.tier} ${stock.sold_out && !stock.mine ? 'is-out' : ''} ${equipped ? 'is-on' : ''}`}>
      <button className="ltd-card-art" onClick={onOpen} aria-label={itemName(item, lang)}>
        <BoardArt url={item.image_url} alt="" />
      </button>
      <div className="ltd-card-body">
        <h3 className="ltd-name">{itemName(item, lang)}</h3>
        <div className="ltd-tags">
          <EditionBadge stock={stock} />
          <RarityBadge r={item.rarity} />
        </div>
        {stock.mine ? (
          <span className="ltd-mine">
            <LuCheck /> {t('lb.yours', { serial: serialLabel(stock.mine.serial, stock.supply) })}
          </span>
        ) : (
          <Remaining stock={stock} />
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
        <button className={`btn btn-block btn-sm ${stock.mine ? 'btn-secondary' : 'btn-primary'}`} onClick={onOpen} disabled={!stock.mine && stock.sold_out}>
          {stock.mine ? (equipped ? t('shop.equipped') : t('shop.equip')) : stock.sold_out ? 'SOLD OUT' : price === 0 ? t('lb.claim') : t('lb.buy')}
        </button>
      </div>
    </article>
  );
}

function LimitedModal({ item, stock, starsPer1000, equipped, onClose, onChanged }: {
  item: ShopItem; stock: BoardStock; starsPer1000: number; equipped: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const { signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const { toast } = useToast();
  const cos = useCosmetics();
  const [busy, setBusy] = useState<null | 'buy' | 'equip'>(null);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState<'art' | 'game'>('art');
  const key = useRef(newKey()); // one key per purchase attempt: a retry is never charged twice
  const balance = cos?.balance ?? 0;
  const price = item.final_price;
  const short = !stock.mine && balance < price;
  const name = itemName(item, lang);

  const buy = async () => {
    if (!signedIn) return openAuth();
    setBusy('buy');
    try {
      const r = await shopBuy(item.slug, key.current) as { serial?: number; supply?: number | null };
      haptic('win');
      toast('success', t('lb.bought', { name, serial: serialLabel(r.serial ?? 0, r.supply ?? stock.supply) }));
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
    setBusy('equip');
    try {
      await equipItem('board', on ? item.slug : null);
      cos?.setEquipped('board', on ? { slug: item.slug, style: item.style } : null);
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
    <Modal open onClose={onClose} title={name} wide>
      <div className="ltd-detail">
        <div className="ltd-detail-view">
          <div className="seg ltd-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'art'} className={`seg-btn ${tab === 'art' ? 'seg-on' : ''}`} onClick={() => setTab('art')}>
              {t('lb.artwork')}
            </button>
            <button role="tab" aria-selected={tab === 'game'} className={`seg-btn ${tab === 'game' ? 'seg-on' : ''}`} onClick={() => setTab('game')}>
              {t('lb.inGame')}
            </button>
          </div>
          {tab === 'art' ? <BoardArt url={item.image_url} size="lg" alt={name} className="ltd-detail-art" /> : <FullPreview item={item} />}
          <EditionPlate serial={stock.mine?.serial ?? null} supply={stock.supply} />
        </div>
        <div className="item-info">
          <div className="item-tags">
            <EditionBadge stock={stock} />
            <RarityBadge r={item.rarity} />
          </div>
          <p className="muted">{itemDesc(item, lang)}</p>
          {!stock.mine && <Remaining stock={stock} />}
          <p className="muted small">{t('lb.serialNote')}</p>
          {stock.mine ? (
            <>
              <p className="ltd-mine ltd-mine-lg">
                <LuCheck /> {t('lb.yours', { serial: serialLabel(stock.mine.serial, stock.supply) })}
              </p>
              {equipped ? (
                <button className="btn btn-secondary btn-block" onClick={() => equip(false)} disabled={busy !== null}>
                  {busy === 'equip' ? <LuLoader className="spin" /> : <LuCheck />} {t('shop.unequip')}
                </button>
              ) : (
                <button className="btn btn-primary btn-block" onClick={() => equip(true)} disabled={busy !== null}>
                  {busy === 'equip' ? <LuLoader className="spin" /> : <LuSparkles />} {t('shop.equip')}
                </button>
              )}
            </>
          ) : stock.sold_out ? (
            <p className="ltd-badge ltd-badge-out ltd-out-lg">SOLD OUT</p>
          ) : !signedIn ? (
            <button className="btn btn-primary btn-block" onClick={openAuth}>
              {t('auth.signIn')}
            </button>
          ) : short ? (
            <div className="item-short">
              <p className="muted small">{t('shop.needMore', { n: coins(price - balance) })}</p>
              <button className="btn btn-primary btn-block" onClick={() => navigate('/wallet')}>
                <LuPlus /> {t('wallet.topUp')}
              </button>
            </div>
          ) : confirm ? (
            <div className="item-confirm">
              <p>{price === 0 ? t('lb.confirmFree', { name }) : t('lb.confirm', { name, n: coins(price) })}</p>
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
                {price === 0 ? (
                  <strong className="price-free">{t('shop.free')}</strong>
                ) : (
                  <>
                    <strong>🪙 {coins(price)}</strong>
                    <span className="ltd-stars">⭐ {coins(starsFor(price, starsPer1000))}</span>
                  </>
                )}
              </div>
              <button className="btn btn-primary btn-block btn-lg" onClick={() => setConfirm(true)}>
                <LuShoppingBag /> {price === 0 ? t('lb.claim') : t('lb.buy')}
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
