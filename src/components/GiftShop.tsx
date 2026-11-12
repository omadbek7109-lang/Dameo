import { useCallback, useEffect, useState } from 'react';
import { LuCheck, LuCopy, LuGift, LuLoader, LuSend } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { buyGift, giftCatalog, GIFT_SUPPORT_URL, myGiftOrders, newGiftKey, type GiftItem, type GiftOrder } from '../services/gifts.ts';
import { coins } from '../services/shop.ts';
import { haptic, tg } from '../services/telegram.ts';
import { useAuthDialog } from './AuthDialog.tsx';
import { Modal } from './Modal.tsx';
import { ErrorState, Spinner } from './States.tsx';
import { useToast } from './Toast.tsx';

/** Gift picture: the artwork if present, otherwise the gift's emoji on a glowing tile. */
export function GiftArt({ gift, emoji, image, size = 'md' }: { gift: string; emoji: string; image: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const [ok, setOk] = useState(!!image);
  return (
    <span className={`gift-art gift-art-${gift} gift-art-${size}`} aria-hidden="true">
      {ok && image ? <img src={image} alt="" loading="lazy" onError={() => setOk(false)} /> : <span className="gift-emoji">{emoji}</span>}
    </span>
  );
}

const openSupport = () => {
  try {
    if (tg?.openTelegramLink) tg.openTelegramLink(GIFT_SUPPORT_URL);
    else window.open(GIFT_SUPPORT_URL, '_blank', 'noopener');
  } catch {
    window.open(GIFT_SUPPORT_URL, '_blank', 'noopener');
  }
};

/** Shop → "Telegram sovg'alar": buy Bear / Heart / Rose / Gift Box with coins; the order code is shown afterwards. */
export function GiftShop({ balance, onBalance }: { balance: number | null; onBalance: () => void }) {
  const { t, dateTime } = useI18n();
  const { signedIn } = useAuth();
  const { openAuth } = useAuthDialog();
  const { toast } = useToast();
  const [items, setItems] = useState<GiftItem[] | null>(null);
  const [orders, setOrders] = useState<GiftOrder[]>([]);
  const [failed, setFailed] = useState(false);
  const [ask, setAsk] = useState<{ g: GiftItem; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ g: GiftItem; code: string; username: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([giftCatalog(), signedIn ? myGiftOrders().catch(() => []) : Promise.resolve([])]);
      setItems(c);
      setOrders(Array.isArray(o) ? o : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [signedIn]);
  useEffect(() => {
    void load();
  }, [load]);

  if (failed && !items) return <ErrorState onRetry={load} />;
  if (!items) return <Spinner />;
  const byId = new Map(items.map((g) => [g.id, g]));
  const name = (id: string) => t(`gift.${id}` as TKey);

  const start = (g: GiftItem) => {
    if (!signedIn) return openAuth();
    if (balance !== null && balance < g.price) {
      toast('error', t('gift.err.insufficient'));
      return;
    }
    haptic('move');
    setAsk({ g, key: newGiftKey() }); // one key per purchase: retries never charge twice
  };
  const buy = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      const r = await buyGift(ask.g.id, ask.key);
      if (r.ok) {
        haptic('win');
        setDone({ g: ask.g, code: r.code, username: r.username });
        setAsk(null);
        onBalance();
        void load();
      } else {
        toast('error', t(r.reason === 'insufficient' ? 'gift.err.insufficient' : r.reason === 'no-telegram' ? 'gift.err.noTelegram' : r.reason === 'restricted' ? 'gift.err.restricted' : r.reason === 'sold-out' ? 'gift.err.soldOut' : 'gift.err.generic'));
        if (r.reason === 'insufficient' || r.reason === 'no-telegram' || r.reason === 'restricted') setAsk(null);
      }
    } catch {
      toast('error', t('gift.err.generic')); // the same key is kept: pressing again cannot charge twice
    } finally {
      setBusy(false);
    }
  };
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard blocked: the code is on screen */
    }
    toast('success', t('gift.copied'));
  };

  return (
    <section className="gift-shop" aria-labelledby="gift-h">
      <div className="gift-head">
        <h2 className="h3" id="gift-h">
          <LuGift /> {t('gift.title')}
        </h2>
        <p className="muted small">{t('gift.sub')}</p>
      </div>
      <div className="gift-grid">
        {items.map((g) => {
          const short = balance !== null && balance < g.price;
          return (
            <article key={g.id} className={`card gift-card gift-card-${g.id}`}>
              <GiftArt gift={g.id} emoji={g.emoji} image={g.image} />
              <strong className="gift-name">{name(g.id)}</strong>
              <span className="gift-price">
                <span aria-hidden="true">🪙</span> {coins(g.price)}
              </span>
              <button className={`btn btn-sm btn-block ${short ? 'btn-secondary' : 'btn-primary'}`} onClick={() => start(g)}>
                {short ? t('gift.notEnough') : t('gift.buy')}
              </button>
            </article>
          );
        })}
      </div>
      <p className="muted small gift-note">{t('gift.note')}</p>

      {orders.length > 0 && (
        <div className="card gift-orders">
          <h3 className="h3">{t('gift.myOrders')}</h3>
          <ul>
            {orders.map((o) => {
              const g = byId.get(o.gift);
              return (
                <li key={o.id}>
                  <GiftArt gift={o.gift} emoji={g?.emoji ?? '🎁'} image={g?.image ?? null} size="sm" />
                  <span className="gift-o-main">
                    <strong>{name(o.gift)}</strong>
                    <span className="muted small">
                      {t('gift.code')}: <b className="gift-o-code">{o.code}</b> · {dateTime(Date.parse(o.created_at))}
                    </span>
                  </span>
                  {o.status === 'delivered' ? (
                    <span className="gift-chip gift-chip-ok">
                      <LuCheck /> {t('gift.delivered')}
                    </span>
                  ) : (
                    <span className="gift-chip">{t('gift.pending')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ask && (
        <Modal open onClose={() => !busy && setAsk(null)} title={t('gift.confirmTitle')} locked={busy}>
          <div className="gift-confirm">
            <GiftArt gift={ask.g.id} emoji={ask.g.emoji} image={ask.g.image} size="lg" />
            <p>{t('gift.confirmText', { gift: name(ask.g.id), price: coins(ask.g.price) })}</p>
            {balance !== null && <p className="muted small">{t('gift.after', { n: coins(balance - ask.g.price) })}</p>}
            <div className="row-actions">
              <button className="btn btn-ghost" onClick={() => setAsk(null)} disabled={busy}>
                {t('gift.cancel')}
              </button>
              <button className="btn btn-primary" onClick={buy} disabled={busy}>
                {busy ? <LuLoader className="spin" /> : <LuGift />} {t('gift.confirmBtn')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {done && (
        <Modal open onClose={() => setDone(null)} title={t('gift.readyTitle')}>
          <div className="gift-done">
            <GiftArt gift={done.g.id} emoji={done.g.emoji} image={done.g.image} size="lg" />
            <span className="gift-code-label">{t('gift.code')}</span>
            <strong className="gift-code" aria-live="polite">
              {done.code}
            </strong>
            <p className="gift-done-text">{done.username ? t('gift.withUsername', { u: done.username, code: done.code }) : t('gift.noUsername', { code: done.code })}</p>
            <div className="gift-done-actions">
              {!done.username && (
                <button className="btn btn-primary btn-block" onClick={openSupport}>
                  <LuSend /> {t('gift.openSupport')}
                </button>
              )}
              <button className="btn btn-secondary btn-block" onClick={() => copy(done.code)}>
                <LuCopy /> {t('gift.copyCode')}
              </button>
              <button className="btn btn-ghost btn-block" onClick={() => setDone(null)}>
                {t('gift.close')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
