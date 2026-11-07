import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuEyeOff, LuGem, LuLock, LuStore } from 'react-icons/lu';
import { useI18n } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { boardStock, collectionOf, serialLabel, setCollectionPublic, type BoardStock, type Collection as Coll, type CollectionItem } from '../services/shop.ts';
import { BoardArt } from './LimitedBoards.tsx';
import { Modal } from './Modal.tsx';
import { FullPreview, RarityBadge } from './ShopParts.tsx';
import { Spinner } from './States.tsx';
import { useToast } from './Toast.tsx';

type Sort = 'rarity' | 'new' | 'old';
const rareFirst = (a: CollectionItem, b: CollectionItem) => b.tier - a.tier || (a.supply ?? 1e9) - (b.supply ?? 1e9) || a.serial - b.serial;

/** DAMEO Collection on a profile: stats, Showcase (3 rarest), every owned Limited board with its serial. */
export function BoardCollection({ userId, own }: { userId: string; own: boolean }) {
  const { t, lang, num } = useI18n();
  const { toast } = useToast();
  const [c, setC] = useState<Coll | null>(null);
  const [all, setAll] = useState<BoardStock[]>([]);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<Sort>('rarity');
  const [open, setOpen] = useState<CollectionItem | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [col, st] = await Promise.all([collectionOf(userId), boardStock()]);
      if (!col || typeof col !== 'object') throw new Error('empty');
      setC(col);
      setAll(Array.isArray(st) ? st : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => {
    const list = [...(c?.items ?? [])];
    if (sort === 'rarity') list.sort(rareFirst);
    else list.sort((a, b) => (sort === 'new' ? -1 : 1) * (Date.parse(a.acquired_at) - Date.parse(b.acquired_at)));
    return list;
  }, [c, sort]);
  const showcase = useMemo(() => [...(c?.items ?? [])].sort(rareFirst).slice(0, 3), [c]);
  const missing = useMemo(() => all.filter((s) => !c?.items?.some((i) => i.slug === s.slug)), [all, c]);

  const toggle = async (on: boolean) => {
    setSaving(true);
    try {
      await setCollectionPublic(on);
      toast('success', t(on ? 'col.visibleOn' : 'col.visibleOff'));
      await load();
    } catch {
      toast('error', t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (failed) return null; // the rest of the profile still works
  return (
    <section className="card col-card" aria-label={t('col.name')}>
      <div className="col-head">
        <span className="col-ico" aria-hidden="true">
          <LuGem />
        </span>
        <div className="col-title">
          <h2 className="h3">{t('col.name')}</h2>
          <span className="muted small">{own ? t('col.my') : `${t('col.public')} · ${c?.owner ?? ''}`}</span>
        </div>
      </div>

      {!c ? (
        <Spinner />
      ) : !c.visible ? (
        <p className="col-hidden muted">
          <LuEyeOff /> {t('col.hidden')}
        </p>
      ) : (
        <>
          <div className="col-stats">
            <div>
              <strong>
                {num(c.owned ?? 0)}
                <small>/{num(c.total)}</small>
              </strong>
              <span>{t('col.boards')}</span>
            </div>
            <div>
              <strong>{num(c.limited ?? 0)}</strong>
              <span>{t('col.limited')}</span>
            </div>
            <div>
              <strong>{c.complete_pct ?? 0}%</strong>
              <span>{t('col.complete')}</span>
            </div>
          </div>
          <div className="col-progress" aria-hidden="true">
            <i style={{ width: `${c.complete_pct ?? 0}%` }} />
          </div>

          {showcase.length > 0 && (
            <div className="col-showcase">
              <h3 className="col-sub">{t('col.showcase')}</h3>
              <ol>
                {showcase.map((i) => (
                  <li key={i.id}>
                    <button className={`col-show ltd-tier-${i.tier}`} onClick={() => setOpen(i)}>
                      <BoardArt url={i.image_url} alt="" />
                      <span className="col-show-txt">
                        <span className="col-show-name">
                          {i.icon} {lang === 'uz' ? i.name_uz : i.name_en}
                        </span>
                        <strong className="col-serial">{serialLabel(i.serial, i.supply)}</strong>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {items.length === 0 ? (
            <div className="col-empty">
              <p className="muted">{t('col.empty')}</p>
              {own && (
                <>
                  <p className="muted small">{t('col.emptyOwn')}</p>
                  <Link to="/shop?cat=boards" className="btn btn-primary btn-sm">
                    <LuStore /> {t('col.toShop')}
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="col-bar">
                <h3 className="col-sub">{t('col.all')}</h3>
                <div className="chip-tabs chip-tabs-sm" role="tablist" aria-label={t('col.sort')}>
                  {(['rarity', 'new', 'old'] as Sort[]).map((k) => (
                    <button key={k} role="tab" aria-selected={sort === k} className={`chip-tab ${sort === k ? 'chip-tab-on' : ''}`} onClick={() => setSort(k)}>
                      {t(k === 'rarity' ? 'col.sortRarity' : k === 'new' ? 'col.sortNew' : 'col.sortOld')}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="col-grid">
                {items.map((i) => (
                  <li key={i.id}>
                    <button className={`col-item ltd-tier-${i.tier}`} onClick={() => setOpen(i)}>
                      <BoardArt url={i.image_url} alt="" />
                      <span className="col-item-name">{lang === 'uz' ? i.name_uz : i.name_en}</span>
                      <RarityBadge r={i.rarity} />
                      <strong className="col-serial">{serialLabel(i.serial, i.supply)}</strong>
                      <span className="muted small">{fmtDate(i.acquired_at, lang)}</span>
                    </button>
                  </li>
                ))}
                {missing.map((s) => (
                  <li key={s.slug}>
                    <Link to="/shop?cat=boards" className="col-item col-locked" aria-label={`${lang === 'uz' ? s.name_uz : s.name_en} — ${t('col.locked')}`}>
                      <BoardArt url={s.image_url} alt="" />
                      <span className="col-item-name">{lang === 'uz' ? s.name_uz : s.name_en}</span>
                      <span className="muted small">
                        <LuLock /> {t('col.locked')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {own && (
            <label className="check col-public">
              <input type="checkbox" checked={c.public} disabled={saving} onChange={(e) => toggle(e.target.checked)} /> {t('col.visible')}
            </label>
          )}
        </>
      )}
      {open && <CopyDetail item={open} owner={c?.owner ?? ''} onClose={() => setOpen(null)} />}
    </section>
  );
}

const fmtDate = (s: string, lang: 'uz' | 'en') =>
  new Date(s).toLocaleDateString(lang === 'uz' ? 'uz-UZ' : 'en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric' });

/** One copy, enlarged: artwork (or in-game look), LIMITED EDITION, serial, owner, date, copy ID. */
function CopyDetail({ item, owner, onClose }: { item: CollectionItem; owner: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<'art' | 'game'>('art');
  const name = lang === 'uz' ? item.name_uz : item.name_en;
  return (
    <Modal open onClose={onClose} title={name} wide>
      <div className="ltd-detail">
        <div className="ltd-detail-view">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === 'art'} className={`seg-btn ${tab === 'art' ? 'seg-on' : ''}`} onClick={() => setTab('art')}>
              {t('lb.artwork')}
            </button>
            <button role="tab" aria-selected={tab === 'game'} className={`seg-btn ${tab === 'game' ? 'seg-on' : ''}`} onClick={() => setTab('game')}>
              {t('lb.inGame')}
            </button>
          </div>
          {tab === 'art' ? <BoardArt url={item.image_url} size="lg" alt={name} className="ltd-detail-art" /> : <FullPreview item={{ slug: item.slug, slot: 'board', style: item.style }} />}
        </div>
        <div className="item-info col-cert">
          <p className="col-cert-name">{name.toUpperCase()}</p>
          <p className="ltd-kicker">LIMITED EDITION</p>
          <p className="col-cert-serial">{serialLabel(item.serial, item.supply)}</p>
          <RarityBadge r={item.rarity} />
          <p>{t('col.ownedBy', { name: owner })}</p>
          <p className="muted small">{t('col.acquired', { d: fmtDate(item.acquired_at, lang) })}</p>
          <p className="muted small mono">
            {t('col.copyId')}: {item.id.slice(0, 8).toUpperCase()}
          </p>
        </div>
      </div>
    </Modal>
  );
}
