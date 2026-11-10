import { useCallback, useEffect, useRef, useState } from 'react';
import { LuArrowDownLeft, LuArrowUpRight, LuCheck, LuLoader, LuStar, LuWallet } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { CoinBadge } from '../components/ShopParts.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { useCosmetics } from '../cosmetics/CosmeticsProvider.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { coinPackages, coins, createInvoice, walletHistory, walletMe, type CoinPackage, type LedgerRow } from '../services/shop.ts';
import { haptic, inTelegram, tg } from '../services/telegram.ts';

type PayState = { pkg: string; phase: 'creating' | 'invoice' | 'checking' | 'done' | 'failed'; before: number } | null;

/** DAMEO Coins: balance, Telegram Stars packages, history. Coins arrive only when Telegram confirms the payment. */
export function Wallet() {
  const { t, lang, dateTime } = useI18n();
  const { signedIn, mode } = useAuth();
  const { toast } = useToast();
  const cos = useCosmetics();
  const [pkgs, setPkgs] = useState<CoinPackage[] | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState(false);
  const [pay, setPay] = useState<PayState>(null);
  const payRef = useRef<PayState>(null);
  payRef.current = pay;

  const loadHistory = useCallback(async (reset: boolean) => {
    const last = reset ? undefined : rows[rows.length - 1]?.id;
    const r = await walletHistory(last);
    setRows((cur) => (reset ? r : [...cur, ...r]));
    setMore(r.length === 30);
  }, [rows]);

  useEffect(() => {
    if (!signedIn || mode !== 'live') return;
    Promise.all([coinPackages(), walletHistory()])
      .then(([p, h]) => {
        setPkgs(p);
        setRows(h);
        setMore(h.length === 30);
      })
      .catch(() => setError(true));
  }, [signedIn, mode]);

  // after Telegram says "paid", wait until the server has credited the coins (webhook) — never assume it
  const waitForCredit = useCallback(
    async (before: number) => {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const b = Number((await walletMe().catch(() => ({ balance: before }))).balance);
        if (b > before) {
          await cos?.refreshWallet();
          setPay((p) => (p ? { ...p, phase: 'done' } : p));
          haptic('win');
          toast('success', t('wallet.credited'));
          void loadHistory(true);
          return;
        }
      }
      setPay((p) => (p ? { ...p, phase: 'failed' } : p));
      toast('info', t('wallet.pendingLong'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cos, t, toast],
  );

  const buy = async (p: CoinPackage) => {
    if (payRef.current && payRef.current.phase !== 'done' && payRef.current.phase !== 'failed') return; // one at a time
    const before = cos?.balance ?? Number((await walletMe()).balance);
    setPay({ pkg: p.id, phase: 'creating', before });
    try {
      const r = await createInvoice(p.id, lang);
      if (!r.ok || !r.link) throw new Error(r.error ?? 'server');
      setPay({ pkg: p.id, phase: 'invoice', before });
      if (tg?.openInvoice) {
        tg.openInvoice(r.link, (status) => {
          if (status === 'paid') {
            setPay({ pkg: p.id, phase: 'checking', before });
            void waitForCredit(before);
          } else {
            setPay(null);
            if (status === 'failed') toast('error', t('wallet.payFailed'));
          }
        });
      } else {
        // outside Telegram: open the invoice in Telegram; the balance updates by itself when it is paid
        window.open(r.link, '_blank', 'noopener');
        setPay({ pkg: p.id, phase: 'checking', before });
        void waitForCredit(before);
      }
    } catch (e) {
      setPay(null);
      const code = e instanceof Error ? e.message : '';
      toast('error', t(code === 'restricted' ? 'shop.err.restricted' : code === 'too-many' ? 'wallet.tooMany' : 'wallet.payFailed'));
    }
  };

  if (!signedIn) return <div className="page"><SignInPrompt text={t('wallet.needAccount')} /></div>;
  const kindLabel = (k: string) => t(`ledger.${k}` as TKey);
  return (
    <div className="page wallet-page">
      <div className="wallet-hero">
        <span className="wallet-hero-label">
          <LuWallet /> {t('wallet.balance')}
        </span>
        <CoinBadge value={cos?.balance ?? null} className="coin-badge-xl" />
        <span className="muted small">DAMEO Coins</span>
      </div>
      <Link to="/referral" className="card ref-promo">
        <span className="ref-promo-ico" aria-hidden="true">🎁</span>
        <span className="ref-promo-text">
          <strong>{t('ref.promoTitle')}</strong>
          <span className="muted small">{t('ref.promoSub')}</span>
        </span>
        <LuArrowUpRight />
      </Link>

      <section aria-labelledby="pk-title">
        <h2 id="pk-title" className="h2">
          {t('wallet.topUp')}
        </h2>
        <p className="muted small">{inTelegram ? t('wallet.starsNote') : t('wallet.openInTelegram')}</p>
        {error ? (
          <ErrorState />
        ) : !pkgs ? (
          <Spinner />
        ) : (
          <div className="pkg-grid">
            {pkgs.map((p, idx) => {
              const busy = pay?.pkg === p.id && pay.phase !== 'done' && pay.phase !== 'failed';
              return (
                <button key={p.id} className={`pkg ${idx === pkgs.length - 1 ? 'pkg-best' : ''}`} onClick={() => buy(p)} disabled={!!pay && pay.phase !== 'done' && pay.phase !== 'failed'}>
                  <span className="pkg-coins">🪙 {coins(p.coins)}</span>
                  {p.bonus_coins > 0 && <span className="pkg-bonus">+{coins(p.bonus_coins)}</span>}
                  <span className="pkg-price">
                    {busy ? <LuLoader className="spin" /> : <LuStar />} {p.stars}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {pay && (
          <div className={`notice ${pay.phase === 'failed' ? 'notice-warn' : ''}`} role="status">
            {pay.phase === 'done' ? <LuCheck /> : pay.phase === 'failed' ? null : <LuLoader className="spin" />}
            <span>{t(`wallet.phase.${pay.phase}` as TKey)}</span>
          </div>
        )}
      </section>

      <section aria-labelledby="hist-title">
        <h2 id="hist-title" className="h2">
          {t('wallet.history')}
        </h2>
        {rows.length === 0 ? (
          <p className="muted">{t('wallet.noHistory')}</p>
        ) : (
          <ul className="ledger">
            {rows.map((r) => (
              <li key={r.id}>
                <span className={`ledger-ico ${r.amount > 0 ? 'in' : 'out'}`}>{r.amount > 0 ? <LuArrowDownLeft /> : <LuArrowUpRight />}</span>
                <span className="ledger-main">
                  <strong>{r.ref_type === 'match' ? t(r.note === 'win' ? 'ledger.matchWin' : 'ledger.matchLoss') : r.ref_type === 'referral' ? t(r.note === 'inviter' ? 'ledger.refInviter' : 'ledger.refInvitee') : kindLabel(r.kind)}</strong>
                  <span className="muted small">
                    {r.note && r.ref_type !== 'match' && r.ref_type !== 'referral' ? `${r.note} · ` : ''}
                    {dateTime(Date.parse(r.created_at))}
                  </span>
                </span>
                <span className={`ledger-amt ${r.amount > 0 ? 'delta-up' : 'delta-down'}`}>
                  {r.amount > 0 ? '+' : '−'}
                  {coins(Math.abs(r.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {more && rows.length > 0 && (
          <button className="btn btn-ghost btn-block" onClick={() => loadHistory(false)}>
            {t('common.more')}
          </button>
        )}
        <p className="muted small">
          <Link to="/inventory">{t('inv.title')}</Link> · <Link to="/shop">{t('shop.title')}</Link>
        </p>
      </section>
    </div>
  );
}
