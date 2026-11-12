import { useCallback, useEffect, useState } from 'react';
import { LuCheck, LuCopy, LuExternalLink, LuLoader, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu';
import { Avatar } from '../components/Avatar.tsx';
import { GiftArt } from '../components/GiftShop.tsx';
import { Modal } from '../components/Modal.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { adminGiftConfirm, adminGiftCounts, adminGiftOrders, GIFT_SUPPORT, type AdminGiftOrder } from '../services/gifts.ts';
import { coins } from '../services/shop.ts';
import { appActive, tg } from '../services/telegram.ts';

function useL() {
  const { lang } = useI18n();
  return useCallback((uz: string, en: string) => (lang === 'uz' ? uz : en), [lang]);
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—');
const openTg = (url: string) => {
  try {
    if (url.startsWith('https://t.me/') && tg?.openTelegramLink) return tg.openTelegramLink(url);
  } catch {
    /* fall through */
  }
  window.open(url, '_blank', 'noopener');
};

/** Admin → "Sovg'a buyurtmalari": every gift purchase; the admin sends the gift by hand and presses "Tasdiqlash". */
export function GiftOrdersTab() {
  const L = useL();
  const { toast } = useToast();
  const [view, setView] = useState<'pending' | 'delivered'>('pending');
  const [rows, setRows] = useState<AdminGiftOrder[] | null>(null);
  const [counts, setCounts] = useState<{ pending: number; delivered: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [ask, setAsk] = useState<AdminGiftOrder | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([adminGiftOrders(view), adminGiftCounts()]);
      setRows(r);
      setCounts(c);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [view]);
  useEffect(() => {
    setRows(null);
    void load();
    // new orders show up on their own
    const id = setInterval(() => appActive() && void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  const confirm = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      const r = await adminGiftConfirm(ask.id);
      if (r.ok) toast(r.notified ? 'success' : 'info', r.notified ? L('Tasdiqlandi. Xaridorga bot orqali xabar yuborildi.', 'Confirmed. The buyer was notified by the bot.') : L(`Tasdiqlandi, lekin bot xabar yubora olmadi: ${r.notify_error ?? ''}`, `Confirmed, but the bot could not message the buyer: ${r.notify_error ?? ''}`));
      else toast('info', r.reason === 'already' ? L('Bu buyurtma allaqachon tasdiqlangan.', 'This order is already confirmed.') : L('Xatolik', 'Error'));
      setAsk(null);
      void load();
    } catch {
      toast('error', L('Xatolik. Qayta urinib ko‘ring.', 'Error. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast('success', L('Nusxalandi', 'Copied'));
    } catch {
      /* ignore */
    }
  };

  if (failed && !rows) return <ErrorState onRetry={load} />;
  return (
    <div className="admin-section">
      <div className="card">
        <div className="wk-table-head">
          <h3>{L("Sovg'a buyurtmalari", 'Gift orders')}</h3>
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
            <LuRefreshCw /> {L('Yangilash', 'Refresh')}
          </button>
        </div>
        <p className="muted small">
          {L(
            "Sovg'ani xaridorning shaxsiy Telegram akkauntiga qo'lda yuboring, keyin «Tasdiqlash»ni bosing — buyurtma «Yuborildi» bo'ladi va bot xaridorga xabar beradi. Username bo'lmasa, xaridor @" + GIFT_SUPPORT + " ga kod bilan yozadi.",
            'Send the gift by hand to the buyer’s personal Telegram account, then press “Confirm” — the order becomes Delivered and the bot notifies the buyer. Buyers without a username message @' + GIFT_SUPPORT + ' with their code.',
          )}
        </p>
        <div className="tabs" role="tablist">
          {(['pending', 'delivered'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={`tab ${view === v ? 'tab-active' : ''}`} onClick={() => setView(v)}>
              {v === 'pending' ? L('Kutilmoqda', 'Pending') : L('Yuborilgan', 'Delivered')}
              {counts && <span className="tab-count">{counts[v]}</span>}
            </button>
          ))}
        </div>
      </div>

      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="card muted">{view === 'pending' ? L("Kutilayotgan buyurtma yo'q.", 'No pending orders.') : L("Hali yuborilgan buyurtma yo'q.", 'No delivered orders yet.')}</p>
      ) : (
        rows.map((o) => (
          <article key={o.id} className={`card adm-gift ${o.status === 'delivered' ? 'is-done' : ''}`}>
            <div className="adm-gift-top">
              <GiftArt gift={o.gift} emoji={o.emoji} image={o.image} size="sm" />
              <span className="adm-gift-title">
                <strong>{o.gift_title}</strong>
                <span className="muted small">
                  #{o.id} · 🪙 {coins(o.price)} · {when(o.created_at)}
                </span>
              </span>
              <button className="adm-gift-code" onClick={() => copy(o.code)} title={L('Kodni nusxalash', 'Copy code')}>
                {o.code} <LuCopy />
              </button>
            </div>
            <div className="adm-gift-buyer">
              <Link to={`/profile/${o.user_id}`} className="adm-gift-player">
                <Avatar name={o.player} seed={o.avatar} size={34} userId={o.user_id} />
                <span>
                  <strong>{o.player}</strong>
                  <span className="muted small">DAMEO {L('profili', 'profile')}</span>
                </span>
              </Link>
              <span className="adm-gift-tg">
                {o.tg_username ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => openTg(`https://t.me/${o.tg_username}`)}>
                    @{o.tg_username} <LuExternalLink />
                  </button>
                ) : (
                  <span className="adm-gift-nouser small">
                    <LuTriangleAlert /> {L(`Username yo'q — xaridor @${GIFT_SUPPORT} ga kod bilan yozadi`, `No username — the buyer messages @${GIFT_SUPPORT} with the code`)}
                  </span>
                )}
                <button className="adm-gift-id small" onClick={() => copy(o.tg_id)} title="Telegram ID">
                  TG ID: <code>{o.tg_id}</code> <LuCopy />
                </button>
              </span>
            </div>
            {o.status === 'delivered' ? (
              <p className="adm-gift-done small">
                <LuCheck /> {L('Yuborildi', 'Delivered')}: {when(o.delivered_at)} · {o.delivered_by ?? '—'} ·{' '}
                {o.notified_at ? L('bot xabar berdi', 'bot notified') : o.notify_error ? `${L('bot xabari yetmadi', 'bot message failed')}: ${o.notify_error}` : '—'}
              </p>
            ) : (
              <div className="row-actions">
                <button className="btn btn-primary btn-sm" onClick={() => setAsk(o)}>
                  <LuCheck /> {L('Tasdiqlash', 'Confirm')}
                </button>
              </div>
            )}
          </article>
        ))
      )}

      {ask && (
        <Modal open onClose={() => !busy && setAsk(null)} title={L('Yetkazishni tasdiqlash', 'Confirm delivery')} locked={busy}>
          <div className="admin-form">
            <p>
              {L(
                `#${ask.id} (${ask.gift_title}, kod ${ask.code}) sovg'asini ${ask.tg_username ? '@' + ask.tg_username : 'TG ID ' + ask.tg_id} ga yubordingizmi? Tasdiqlangach bekor qilib bo'lmaydi.`,
                `Did you send order #${ask.id} (${ask.gift_title}, code ${ask.code}) to ${ask.tg_username ? '@' + ask.tg_username : 'TG ID ' + ask.tg_id}? This cannot be undone.`,
              )}
            </p>
            <div className="row-actions">
              <button className="btn btn-ghost" onClick={() => setAsk(null)} disabled={busy}>
                {L('Bekor qilish', 'Cancel')}
              </button>
              <button className="btn btn-primary" onClick={confirm} disabled={busy}>
                {busy ? <LuLoader className="spin" /> : <LuCheck />} {L('Ha, yuborildi', 'Yes, delivered')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
