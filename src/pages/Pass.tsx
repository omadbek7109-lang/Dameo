import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LuBot,
  LuCalendarCheck,
  LuCheck,
  LuChevronRight,
  LuCrown,
  LuGift,
  LuListChecks,
  LuLock,
  LuShield,
  LuStar,
  LuSwords,
  LuTrophy,
  LuUserPlus,
  LuX,
  LuZap,
} from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { BadgeArt, EmojiArt, PassFrame, ProfileBg, RewardArt, TitleTag } from '../components/PassArt.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { Modal } from '../components/Modal.tsx';
import { useI18n } from '../i18n/index.tsx';
import type { TKey } from '../i18n/uz.ts';
import { Link } from '../router.tsx';
import { backendConfigured } from '../services/config.ts';
import { readString, writeString } from '../services/localStore.ts';
import { DEFAULT_RULES, LEVEL_XP, MAX_LEVEL, PASS_ADMIN_USERNAME, priceDiscount, type CosmeticKind, type RewardView, type Track, type XpSource } from '../services/pass/core.ts';
import { buyElite, claimPass, equipCosmetic, getPass, passCheckin, type PassState } from '../services/pass/index.ts';
import { MissionsHomeCard } from './Missions.tsx';
import { coins } from '../services/shop.ts';
import { haptic, openTelegramUrl } from '../services/telegram.ts';

const img = (p: string) => new URL(p, document.baseURI).href;
const som = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function useCountdown(to: number | undefined, t: (k: TKey, p?: Record<string, string | number>) => string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const left = to ? Math.max(0, to - now) : 0;
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return d > 0 ? t('pass.dh', { d, h }) : t('pass.hm', { h, m });
}

export function Pass() {
  const { t, lang } = useI18n();
  const { signedIn, me } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<PassState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'rewards' | 'tasks'>('rewards');
  const [kind, setKind] = useState<CosmeticKind>('emoji');
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [detail, setDetail] = useState<RewardView | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; items: RewardView[] } | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await getPass());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (signedIn || !backendConfigured) void load();
  }, [signedIn, load]);
  const ends = useCountdown(data?.season.end, t);

  // level-up: compare with the level this device saw last time
  useEffect(() => {
    if (!data) return;
    const key = `dameobeta.pass5.seen.${data.season.n}`;
    const seen = Number(readString(key) ?? '0');
    const lv = data.level.level;
    if (seen && lv > seen) {
      haptic('win');
      setLevelUp({ level: lv, items: data.rewards.filter((r) => r.level > seen && r.level <= lv && (r.track === 'free' || data.elite)) });
    }
    if (lv !== seen) writeString(key, String(lv));
  }, [data]);

  useLayoutEffect(() => {
    if (!data || scrolled.current || !track.current) return;
    const first = data.rewards.find((r) => r.state === 'ready')?.level ?? data.level.level;
    const col = track.current.querySelector<HTMLElement>(`[data-lvl="${Math.max(1, first - 1)}"]`);
    if (col) track.current.scrollLeft = col.offsetLeft - 8;
    scrolled.current = true;
  }, [data]);

  const name = (r: { label_uz: string; label_en: string }) => (lang === 'en' ? r.label_en : r.label_uz);

  const claim = async (r: RewardView, silent = false) => {
    const res = await claimPass(r.level, r.track);
    if (!res.ok) {
      if (!silent) {
        haptic('error');
        toast('error', t(`pass.err.${res.error}` as TKey));
      }
      return false;
    }
    if (!silent) {
      haptic('win');
      const sub =
        r.kind === 'item' && !res.item
          ? t('pass.gotOwned', { name: name(r), n: coins(res.coins) })
          : r.kind === 'box' && res.item
            ? t('pass.gotChest', { name: res.itemName ? (lang === 'en' ? res.itemName.en : res.itemName.uz) : '' })
          : r.kind === 'xp_boost'
            ? r.keepDays
              ? t('pass.gotBoostStored', { n: res.boost, h: r.hours ?? 1, d: r.keepDays })
              : r.hours
              ? t('pass.gotBoostH', { n: res.boost, h: r.hours })
              : t('pass.gotBoost', { n: res.boost, d: r.days ?? 1 })
            : r.kind === 'coins' || r.kind === 'box'
              ? null
              : r.kind === 'currency' || r.kind === 'perk' || r.kind === 'item' || r.kind === 'combo' || r.kind === 'victory'
                ? (lang === 'en' ? r.note_en : r.note_uz) ?? null
                : t('pass.revealWear');
      setReveal({ items: [r], coins: res.coins, sub });
    }
    return true;
  };
  const claimOne = async (r: RewardView) => {
    if (busy) return;
    setDetail(null);
    setBusy(`${r.track}:${r.level}`);
    await claim(r);
    setBusy(null);
    void load();
  };
  const claimAll = async () => {
    if (!data || busy) return;
    setBusy('all');
    const got: RewardView[] = [];
    for (const r of data.rewards.filter((x) => x.state === 'ready')) if (await claim(r, true)) got.push(r);
    setBusy(null);
    haptic('win');
    setReveal({ items: got, coins: 0, sub: t('pass.gotAll', { n: got.length }) });
    void load();
  };
  const checkin = async () => {
    if (busy) return;
    setBusy('checkin');
    try {
      await passCheckin();
      haptic('move');
    } finally {
      setBusy(null);
      void load();
    }
  };
  // beta: a test Stars payment is confirmed in our own sheet first (the main app opens Telegram's Stars invoice)
  const [payAsk, setPayAsk] = useState(false);
  const premium = async (confirmed = false) => {
    if (busy) return;
    if (!confirmed) {
      setDetail(null);
      setPayAsk(true);
      return;
    }
    setPayAsk(false);
    setBusy('elite');
    setDetail(null);
    const r = await buyElite(lang);
    setBusy(null);
    if (r.ok) {
      haptic('win');
      setReveal({ items: (data?.rewards ?? []).filter((x) => x.track === 'elite').slice(0, 8), coins: 0, sub: r.test ? t('pass.premiumTest') : t('pass.premiumOk') });
    } else {
      haptic('error');
      toast(r.error === 'pending' ? 'info' : 'error', t(`pass.pay.${r.error}` as TKey));
    }
    void load();
  };
  const wear = async (k: CosmeticKind, id: string | null) => {
    await equipCosmetic(k, id);
    haptic('move');
    void load();
  };

  if (backendConfigured && !signedIn) return <div className="page"><SignInPrompt text={t('ms.needAccount')} /></div>;
  if (failed) return <div className="page"><ErrorState onRetry={load} /></div>;
  if (!data) return <div className="page"><Spinner /></div>;

  const lv = data.level;
  const pct = lv.nextAt === null ? 100 : Math.round((lv.into / lv.step) * 100);
  const levels = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
  const at = (level: number, tr: Track) => data.rewards.find((r) => r.level === level && r.track === tr);
  const theme = lang === 'en' ? data.season.theme.name_en : data.season.theme.name_uz;

  const cell = (r: RewardView | undefined) => {
    if (!r) return <span className="ps-rw ps-empty" />;
    const ready = r.state === 'ready';
    return (
      <button
        type="button"
        className={`ps-rw ps-${r.track} ps-${r.state} ps-r-${r.rarity}`}
        onClick={() => setDetail(r)}
        aria-label={`${t('pass.level', { n: r.level })}: ${name(r)}`}
        disabled={busy === `${r.track}:${r.level}`}
      >
        <RewardArt r={r} />
        {r.state === 'claimed' && (
          <span className="ps-rw-badge ps-ok" aria-hidden>
            <LuCheck />
          </span>
        )}
        {(r.state === 'locked' || r.state === 'elite_locked') && (
          <span className="ps-rw-badge" aria-hidden>
            <LuLock />
          </span>
        )}
        {ready && <span className="ps-rw-claim">{t('pass.claim')}</span>}
      </button>
    );
  };

  const KINDS: { k: CosmeticKind; key: TKey }[] = [
    { k: 'emoji', key: 'pass.k.emoji' },
    { k: 'frame', key: 'pass.k.frame' },
    { k: 'background', key: 'pass.k.background' },
    { k: 'badge', key: 'pass.k.badge' },
    { k: 'title', key: 'pass.k.title' },
  ];
  const mine = data.owned.filter((o) => o.kind === kind);
  const w = data.equipped;
  const ownedArt = (k: CosmeticKind, id: string) => data.rewards.find((r) => r.kind === k && r.value.split(',').includes(id));

  const SRC: { s: XpSource; xp: number; icon: typeof LuZap; limit?: string }[] = [
    { s: 'live_game', xp: DEFAULT_RULES.liveGame, icon: LuSwords, limit: t('pass.limit.liveGames', { n: DEFAULT_RULES.liveGamesPerDay }) },
    { s: 'live_win', xp: DEFAULT_RULES.liveWin, icon: LuTrophy, limit: t('pass.limit.noLimit') },
    { s: 'first_win', xp: DEFAULT_RULES.firstWin, icon: LuTrophy },
    { s: 'bot_game', xp: DEFAULT_RULES.botGame, icon: LuBot, limit: t('pass.limit.day', { n: DEFAULT_RULES.botGamesPerDay }) },
    { s: 'bot_win', xp: DEFAULT_RULES.botWin, icon: LuBot, limit: t('pass.limit.day', { n: DEFAULT_RULES.botWinsPerDay }) },
    { s: 'checkin', xp: DEFAULT_RULES.checkin, icon: LuCalendarCheck },
    { s: 'streak', xp: DEFAULT_RULES.streak, icon: LuCalendarCheck },
    { s: 'mission', xp: DEFAULT_RULES.mission, icon: LuListChecks },
    { s: 'mission_bonus', xp: DEFAULT_RULES.missionBonus, icon: LuGift },
    { s: 'referral', xp: DEFAULT_RULES.referral, icon: LuUserPlus, limit: t('pass.limit.day', { n: DEFAULT_RULES.referralsPerDay }) },
  ];

  return (
    <div
      className="page page-narrow ps-page"
      style={{
        ['--pv-bg' as string]: `url(${img('pass/hall-arena.webp')})`,
        ['--pv-hero' as string]: `url(${img('pass/hall-throne.webp')})`,
        ['--pv-card-free' as string]: `url(${img('pass/card-1.webp')})`,
        ['--pv-card-prem' as string]: `url(${img('pass/card-3.webp')})`,
        ['--pv-card-detail' as string]: `url(${img('pass/card-2.webp')})`,
      }}
    >
      <span className="pv-page-bg" aria-hidden />
      {reveal && <RewardReveal reveal={reveal} onClose={() => setReveal(null)} />}
      {levelUp && <LevelUp up={levelUp} onClose={() => setLevelUp(null)} />}
      {payAsk && (
        <Modal open onClose={() => setPayAsk(false)} title={t('pass.payTitle')}>
          <div className="ps-pay">
            {/* 1) Telegram Stars: paid in Telegram, Premium opens by itself */}
            <div className="ps-pay-opt ps-pay-stars">
              <div className="ps-pay-price">
                {data.price.starsBefore ? <s>{data.price.starsBefore} ⭐</s> : null}
                <b>{data.price.stars} ⭐</b>
                {priceDiscount(data.price) > 0 && <span className="ps-off">−{priceDiscount(data.price)}%</span>}
              </div>
              <p className="muted small">{data.test ? t('pass.payBeta') : t('pass.payStarsAuto')}</p>
              <button className="btn btn-primary btn-block" onClick={() => premium(true)} disabled={busy !== null}>
                ⭐ {data.test ? t('pass.payTest', { n: data.price.stars }) : t('pass.buyStars', { n: data.price.stars })}
              </button>
            </div>
            {/* 2) so'm: for players without Stars — they pay the admin, the admin opens Premium in the admin panel */}
            <div className="ps-pay-opt">
              <div className="ps-pay-price">
                <b>{som(data.price.som)} so'm</b>
              </div>
              <p className="muted small">{t('pass.paySomHow')}</p>
              {me?.id && (
                <button
                  className="ps-pay-id"
                  onClick={() => {
                    void navigator.clipboard?.writeText(me.id).then(() => toast('success', t('pass.idCopied')), () => undefined);
                  }}
                >
                  ID: <code>{me.id}</code>
                </button>
              )}
              <button
                className="btn btn-secondary btn-block"
                onClick={() => {
                  const text = `DAMEO Pass Premium (${som(data.price.som)} so'm). ID: ${me?.id ?? ''}`;
                  const url = PASS_ADMIN_USERNAME ? `https://t.me/${PASS_ADMIN_USERNAME}?text=${encodeURIComponent(text)}` : '';
                  if (!url) return toast('info', t('pass.paySomSoon'));
                  if (!openTelegramUrl(url)) window.open(url, '_blank', 'noopener');
                }}
              >
                {t('pass.paySomBtn')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {detail && (
        <RewardDetail
          r={detail}
          xp={data.xp}
          elite={data.elite}
          stars={data.price.stars}
          busy={busy !== null}
          onClose={() => setDetail(null)}
          onClaim={() => claimOne(detail)}
          onPremium={() => premium()}
        />
      )}

      <section className="ps-banner">
        <img className="ps-banner-crown" src={img('pass/prem-19.webp')} alt="" aria-hidden />
        <img className="ps-banner-pieces" src={img('pass/prem-02.webp')} alt="" aria-hidden />
        <div className="ps-banner-top">
          <span className="ps-chip-season">
            Season {String(data.season.n).padStart(2, '0')} · {theme} {data.test && <span className="badge badge-demo">BETA</span>}
          </span>
        </div>
        <h1 className="ps-banner-title">
          DAMEO <span>PASS</span>
        </h1>
        <span className="ps-ends">
          <LuZap aria-hidden /> {t('pass.endsIn', { time: ends })}
        </span>
        <div className="ps-lvl-row">
          <span className={`ps-lvl ${data.elite ? 'ps-lvl-elite' : ''}`}>
            {data.elite && <LuCrown className="ps-lvl-crown" aria-hidden />}
            <small>LV</small>
            <strong>{lv.level}</strong>
          </span>
          <div className="ps-lvl-main">
            <div className="ps-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="ps-xp">{lv.nextAt === null ? t('pass.max') : t('pass.xpTo', { xp: coins(data.xp), next: coins(lv.nextAt) })}</span>
          </div>
        </div>
        <div className="ps-wallet">
          <span className={`ps-pill ${data.elite ? 'ps-pill-gold' : ''}`}>
            <LuCrown aria-hidden /> {data.elite ? t('pass.premiumHas') : t('pass.freeOnly')}
          </span>
          {data.boostToday > 0 && <span className="ps-pill ps-pill-gold">XP +{data.boostToday}%</span>}
        </div>
      </section>

      <div className="seg ps-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'rewards'} className={`seg-btn ${tab === 'rewards' ? 'seg-on' : ''}`} onClick={() => setTab('rewards')}>
          <LuGift /> {t('pass.tabRewards')}
          {data.readyCount > 0 && <span className="ps-tab-n">{data.readyCount}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'tasks'} className={`seg-btn ${tab === 'tasks' ? 'seg-on' : ''}`} onClick={() => setTab('tasks')}>
          <LuListChecks /> {t('pass.tabTasks')}
          {!data.checkedInToday && <span className="ps-tab-n">1</span>}
        </button>
      </div>

      {tab === 'rewards' ? (
        <>
          {data.readyCount > 0 && (
            <button className="btn btn-primary btn-block pv-claim-all" onClick={claimAll} disabled={busy !== null}>
              <LuGift /> {t('pass.claimAll', { n: data.readyCount })}
            </button>
          )}
          {/* the road: levels side by side (PUBG style) — Free on top, the level in the middle, Premium below */}
          <section className="pv-road">
            <div className="pv-road-head">
              <span className="pv-tag pv-tag-free">
                <LuShield aria-hidden /> FREE PASS
              </span>
              <span className="pv-tag pv-tag-prem">
                <LuCrown aria-hidden /> PREMIUM PASS
              </span>
              {!data.elite && (
                <button className="pv-buy-mini" onClick={() => premium()} disabled={busy !== null}>
                  ⭐ {data.price.stars}
                  {priceDiscount(data.price) > 0 && <i className="pv-off">−{priceDiscount(data.price)}%</i>}
                </button>
              )}
            </div>
            <div className="pv-road-scroll" ref={track}>
              {levels.map((lv) => {
                const reached = lv <= data.level.level;
                const next = lv === data.level.level + 1;
                const fill = reached ? 1 : next && data.level.step ? data.level.into / data.level.step : 0;
                return (
                  <div key={lv} data-lvl={lv} className={`pv-col ${lv === MAX_LEVEL ? 'pv-col-final' : ''} ${reached ? 'pv-col-on' : ''}`}>
                    {(['free', 'elite'] as Track[]).map((tr, k) => {
                      const r = at(lv, tr);
                      const card = r ? (
                        <div className={`pv-cell pv-${tr}`}>
                          <button type="button" className={`pv-card pv-${r.state} pv-r-${r.rarity}`} onClick={() => setDetail(r)}>
                            <RewardArt r={r} />
                            <span className="pv-name">{name(r)}</span>
                            {r.state === 'claimed' && <LuCheck className="pv-st pv-ok" aria-hidden />}
                            {(r.state === 'locked' || r.state === 'elite_locked') && <LuLock className="pv-st" aria-hidden />}
                            {r.state === 'ready' && <span className="pv-get">{t('pass.claim')}</span>}
                          </button>
                        </div>
                      ) : (
                        <div className="pv-cell" />
                      );
                      return k === 0 ? (
                        <div key={tr} className="pv-top">
                          {card}
                          <div className="pv-node" style={{ ['--p' as string]: fill }}>
                            <span>{lv === MAX_LEVEL ? <LuCrown aria-hidden /> : null}{lv}</span>
                          </div>
                        </div>
                      ) : (
                        <div key={tr}>{card}</div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>

          {!data.elite && (
            <section className="ps-elite-card">
              <img className="ps-elite-art" src={img('pass/frame-prem-royal.webp')} alt="" aria-hidden />
              <div className="ps-elite-top">
                <div>
                  <div className="ps-elite-title">PREMIUM PASS</div>
                  <div className="ps-elite-sub">{t('pass.premiumPerks')}</div>
                </div>
              </div>
              {priceDiscount(data.price) > 0 && (
                <div className="ps-price">
                  <s>{data.price.starsBefore} ⭐</s>
                  <b>{data.price.stars} ⭐</b>
                  <span className="ps-off">−{priceDiscount(data.price)}% {t('pass.discount')}</span>
                </div>
              )}
              <button className="btn ps-buy ps-buy-stars-big" onClick={() => premium()} disabled={busy !== null}>
                <LuCrown /> {t('pass.buyStars', { n: data.price.stars })}
              </button>
              <span className="ps-elite-note">{data.test ? t('pass.premiumBetaNote') : t('pass.premiumStarsNote')}</span>
            </section>
          )}


          <section className="card pv-info">
            <h2>{t('pass.infoTitle')}</h2>
            <ul>
              <li>{t('pass.info1')}</li>
              <li>{t('pass.info2')}</li>
              <li>{t('pass.info3')}</li>
              <li>{t('pass.info4')}</li>
            </ul>
          </section>

          <section className="card ps-coll">
            <div className="pv-coll-head">
              <h2>{t('pass.collection')}</h2>
              <strong>
                {data.rewards.filter((r) => r.state === 'claimed').length} / {data.rewards.length}
              </strong>
            </div>
            <div className="ps-bar ps-bar-sm" aria-hidden>
              <span style={{ width: `${Math.round((data.rewards.filter((r) => r.state === 'claimed').length / data.rewards.length) * 100)}%` }} />
            </div>
            <h2 className="pv-sub">{t('pass.myStyle')}</h2>
            <div className={`ps-preview ${w.background ? 'has-pbg' : ''}`}>
              <ProfileBg id={w.background} />
              <PassFrame id={w.frame} size={w.frame ? 56 : 72}>
                <Avatar name={me?.username ?? 'DAMEO'} seed={me?.avatar} size={w.frame ? 56 : 72} userId={me?.id} />
              </PassFrame>
              <div className="ps-preview-id">
                <strong>
                  {me?.username ?? 'DAMEO'} {w.emoji && <EmojiArt id={w.emoji} size={20} className="pa-name-emoji" />}
                </strong>
                <span className="ps-preview-tags">
                  {w.title && <TitleTag id={w.title} lang={lang} />}
                  {w.badge && <BadgeArt id={w.badge} size={30} />}
                </span>
              </div>
            </div>
            <div className="seg ps-kinds" role="tablist">
              {KINDS.map(({ k, key }) => (
                <button key={k} role="tab" aria-selected={kind === k} className={`seg-btn ${kind === k ? 'seg-on' : ''}`} onClick={() => setKind(k)}>
                  {t(key)}
                </button>
              ))}
            </div>
            {mine.length === 0 ? (
              <p className="muted small">{t('pass.emptyKind')}</p>
            ) : (
              <div className="ps-own">
                {mine.map((o) => {
                  const on = w[o.kind] === o.id;
                  const left = o.until ? Math.max(0, Math.ceil((o.until - Date.now()) / 86_400_000)) : null;
                  const src = ownedArt(o.kind, o.id);
                  return (
                    <button key={o.id} className={`ps-own-item ${on ? 'ps-on' : ''}`} onClick={() => wear(o.kind, on ? null : o.id)}>
                      {o.kind === 'emoji' ? <EmojiArt id={o.id} size={44} /> : o.kind === 'title' ? <TitleTag id={o.id} lang={lang} /> : src ? <RewardArt r={src} /> : null}
                      <span className="ps-own-s">{on ? t('pass.equipped') : t('pass.equip')}</span>
                      {left !== null && <span className="ps-own-days">{t('pass.daysLeft', { n: left })}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <Link to="/profile" className="ps-to-profile">
              {t('pass.seeProfile')} <LuChevronRight />
            </Link>
          </section>
        </>
      ) : (
        <>
          <section className={`card ps-checkin ${data.checkedInToday ? 'ps-done' : 'ms-ready'}`}>
            <span className="ms-ico ms-ico-gold" aria-hidden>
              <LuCalendarCheck />
            </span>
            <div className="ms-main">
              <div className="ms-title">{t('pass.checkin')}</div>
              <span className="muted small">{t('pass.checkinSub', { n: DEFAULT_RULES.checkin })}</span>
            </div>
            {data.checkedInToday ? (
              <span className="ms-done">
                <LuCheck /> {t('pass.checkedIn')}
              </span>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={checkin} disabled={busy !== null}>
                {t('pass.checkinBtn', { n: DEFAULT_RULES.checkin })}
              </button>
            )}
          </section>
          <MissionsHomeCard />
          <section className="card ps-how">
            <h2>{t('pass.howTitle')}</h2>
            <p className="muted small ps-today-line">
              <LuZap aria-hidden /> {DEFAULT_RULES.dailyCap > 0 ? t('pass.today', { n: data.today.today, cap: DEFAULT_RULES.dailyCap }) : t('pass.todayNoCap', { n: data.today.today })}
              {data.today.capped && <span className="ps-capped"> · {t('pass.capped')}</span>}
            </p>
            <ul>
              {SRC.map(({ s, xp, icon: Icon, limit }) => {
                const today = data.today.todayLines.find((x) => x.source === s);
                return (
                  <li key={s}>
                    <span className="ps-how-ico" aria-hidden>
                      <Icon />
                    </span>
                    <span className="ps-how-l">
                      {t(`pass.src.${s}` as TKey)}
                      {limit && <span className="muted small"> · {limit}</span>}
                    </span>
                    {today && <span className="ps-how-today">{today.count}×</span>}
                    <span className="ps-how-xp">+{xp} XP</span>
                  </li>
                );
              })}
            </ul>
          </section>
          {data.perks.length > 0 && (
            <section className="card ps-how">
              <h2>{t('pass.perks')}</h2>
              <ul>
                {data.perks.map((p, i) => (
                  <li key={i}>
                    <span className="ps-how-ico" aria-hidden>
                      <LuListChecks />
                    </span>
                    <span className="ps-how-l">{t('pass.perk.mission_slot', { n: p.amount })}</span>
                    <span className="ps-how-today">{t('pass.daysLeft', { n: Math.max(0, Math.ceil((p.until - Date.now()) / 86_400_000)) })}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

    </div>
  );
}

/** Reward details: big artwork, rarity, what it gives, state and the right action. */
function RewardDetail({
  r,
  xp,
  elite,
  stars,
  busy,
  onClose,
  onClaim,
  onPremium,
}: {
  r: RewardView;
  xp: number;
  elite: boolean;
  stars: number;
  busy: boolean;
  onClose: () => void;
  onClaim: () => void;
  onPremium: () => void;
}) {
  const { t, lang } = useI18n();
  const need = Math.max(0, LEVEL_XP[r.level] - xp);
  const note = lang === 'en' ? r.note_en : r.note_uz;
  return createPortal(
    <div className="pd-veil" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`pd-sheet pd-${r.track} pr-r-${r.rarity}`}
        style={{ backgroundImage: `linear-gradient(180deg, rgba(22,6,50,.35), rgba(22,6,50,.9)), url(${img('pass/card-2.webp')})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn pd-close" onClick={onClose} aria-label={t('common.close')}>
          <LuX />
        </button>
        <span className="pr-lv">
          {r.track === 'elite' ? 'PREMIUM PASS' : 'FREE PASS'} · LV.{r.level}
        </span>
        <span className="pr-rarity">{t(RARITY_KEY[r.rarity])}</span>
        <div className="pd-stage">
          <RewardArt r={r} big />
        </div>
        <div className="pd-name">{lang === 'en' ? r.label_en : r.label_uz}</div>
        {note && <div className="pd-note">{note}</div>}
        <div className="pd-kind">{t(`pass.kind.${r.kind}` as TKey)}</div>
        {r.state === 'ready' && (
          <button className="pr-btn" onClick={onClaim} disabled={busy}>
            {t('pass.claim')}
          </button>
        )}
        {r.state === 'claimed' && (
          <span className="pd-state pd-ok">
            <LuCheck /> {t('pass.claimed')}
          </span>
        )}
        {r.state === 'locked' && <span className="pd-state">{t('pass.needXp', { lv: r.level, n: coins(need) })}</span>}
        {r.state === 'elite_locked' && !elite && (
          <button className="pr-btn" onClick={onPremium} disabled={busy}>
            <LuCrown /> {t('pass.buyStars', { n: stars })}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Level up: big level number, burst, and the rewards that just opened. */
function LevelUp({ up, onClose }: { up: { level: number; items: RewardView[] }; onClose: () => void }) {
  const { t, lang } = useI18n();
  return createPortal(
    <div className="pr-veil pr-prem lu-veil" onClick={onClose} role="dialog" aria-modal="true">
      <span className="pr-rays" />
      <div className="pr-card" onClick={(e) => e.stopPropagation()}>
        <span className="lu-label">LEVEL UP!</span>
        <div className="lu-num">{up.level}</div>
        <span className="pr-sub">{t('pass.levelUpSub', { n: up.items.length })}</span>
        <div className="pr-grid">
          {up.items.map((r, i) => (
            <div key={`${r.track}${r.level}`} className={`ps-card ps-r-${r.rarity}`} style={{ animationDelay: `${0.3 + i * 0.08}s` }}>
              <span className="ps-card-lv">Lv.{r.level}</span>
              <RewardArt r={r} />
              <span className="ps-card-l">{lang === 'en' ? r.label_en : r.label_uz}</span>
            </div>
          ))}
        </div>
        <button className="pr-btn" onClick={onClose}>
          {t('pass.revealOk')}
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface Reveal {
  items: RewardView[];
  coins: number;
  sub: string | null;
}
const RARITY_KEY: Record<string, TKey> = {
  common: 'pass.r.common',
  rare: 'pass.r.rare',
  epic: 'pass.r.epic',
  legendary: 'pass.r.legendary',
  mythic: 'pass.r.mythic',
};
/** Full-screen reward reveal: flash, rotating rays, lightning for Premium, confetti, the reward popping in. */
function RewardReveal({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  const { t, lang } = useI18n();
  const one = reveal.items.length === 1 ? reveal.items[0] : null;
  const prem = reveal.items.some((r) => r.track === 'elite');
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!one || !reveal.coins) return;
    let n = 0;
    const step = Math.max(1, Math.round(reveal.coins / 30));
    const id = setInterval(() => {
      n = Math.min(reveal.coins, n + step);
      setShown(n);
      if (n >= reveal.coins) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [one, reveal.coins]);
  const bits = useMemo(
    () =>
      Array.from({ length: prem ? 14 : 10 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 1.8 + Math.random() * 1.4,
        color: prem ? ['#fde68a', '#f59e0b', '#fff7d1', '#c084fc'][i % 4] : ['#c4b5fd', '#a855f7', '#fde68a', '#22d3ee'][i % 4],
      })),
    [prem],
  );
  const name = (r: RewardView) => (lang === 'en' ? r.label_en : r.label_uz);
  return createPortal(
    <div className={`pr-veil ${prem ? 'pr-prem' : ''}`} role="dialog" aria-modal="true" onClick={onClose}>
      <span className="pr-rays" />
      {prem && one && (one.rarity === 'legendary' || one.rarity === 'mythic') && (
        <svg className="pr-bolts" viewBox="0 0 400 800" preserveAspectRatio="none" aria-hidden>
          <path d="M40 60l40 70-24 6 50 90-20 8 40 80" fill="none" stroke="#fde68a" strokeWidth="3" strokeLinejoin="round" />
          <path d="M360 90l-36 64 22 8-46 84 20 6-36 78" fill="none" stroke="#fde68a" strokeWidth="3" strokeLinejoin="round" />
          <path d="M60 760l30-70-22-6 42-80-18-8 34-70" fill="none" stroke="#fef3c7" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M340 740l-34-66 22-8-40-76 20-6-30-64" fill="none" stroke="#fef3c7" strokeWidth="2.4" strokeLinejoin="round" />
        </svg>
      )}
      <span className="pr-confetti" aria-hidden>
        {bits.map((b, i) => (
          <i key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, background: b.color }} />
        ))}
      </span>
      {one ? (
        <div className={`pr-card pr-r-${one.rarity} ${prem ? 'pr-prem-c' : ''}`} onClick={(e) => e.stopPropagation()}>
          <span className="pr-lv">
            {one.track === 'elite' ? 'PREMIUM PASS' : 'FREE PASS'} · LV.{one.level}
          </span>
          <span className="pr-rarity">{t(RARITY_KEY[one.rarity])}</span>
          <div className="pr-stage">
            <RewardArt r={one} big />
          </div>
          <div className="pr-name">{name(one)}</div>
          {reveal.coins > 0 && <div className="pr-coins">+{coins(shown)} coin</div>}
          {reveal.sub && <div className="pr-sub">{reveal.sub}</div>}
          <button className="pr-btn" onClick={onClose}>
            {t('pass.revealOk')}
          </button>
        </div>
      ) : (
        <div className="pr-card" onClick={(e) => e.stopPropagation()}>
          <span className="pr-rarity">{reveal.sub}</span>
          <div className="pr-grid">
            {reveal.items.map((r, i) => (
              <div key={`${r.track}${r.level}`} className={`ps-card ps-r-${r.rarity}`} style={{ animationDelay: `${i * 0.06}s` }}>
                <span className="ps-card-lv">Lv.{r.level}</span>
                <RewardArt r={r} />
                <span className="ps-card-l">{name(r)}</span>
              </div>
            ))}
          </div>
          <button className="pr-btn" onClick={onClose}>
            {t('pass.revealOk')}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Compact entry on Home: season level, rewards waiting. */
export function PassHomeCard() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const [data, setData] = useState<PassState | null>(null);
  useEffect(() => {
    if (signedIn || !backendConfigured) getPass().then(setData, () => setData(null));
  }, [signedIn]);
  if (!data) return null;
  const lv = data.level;
  const pct = lv.nextAt === null ? 100 : Math.round((lv.into / lv.step) * 100);
  return (
    <Link to="/pass" className={`ps-home ${data.readyCount > 0 ? 'ps-home-ready' : ''}`}>
      <img className="ps-home-art" src={img('pass/prem-19.webp')} alt="" aria-hidden />
      <span className="ps-home-main">
        <span className="ps-home-title">{t('pass.home', { lvl: lv.level })}</span>
        <span className="ps-bar ps-bar-sm" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="ps-home-sub">{data.readyCount > 0 ? t('pass.homeSub', { n: data.readyCount }) : t('pass.homeSub0')}</span>
      </span>
      {data.readyCount > 0 && <span className="ms-dot" aria-hidden />}
      <LuChevronRight className="ps-home-go" aria-hidden />
    </Link>
  );
}
