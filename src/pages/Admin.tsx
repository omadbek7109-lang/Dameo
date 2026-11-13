import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { appActive } from '../services/telegram.ts';
import {
  LuBan, LuCheck, LuChevronRight, LuCoins, LuGauge, LuHistory, LuImage, LuLoader, LuPackage, LuPlus, LuRefreshCw, LuSearch,
  LuBot, LuGift, LuMegaphone, LuSend, LuShieldCheck, LuShoppingBag, LuTrophy, LuTriangleAlert, LuUndo2, LuUserCog, LuUsers, LuVolumeX,
} from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { BroadcastTab } from './AdminBroadcast.tsx';
import { ChannelsTab } from './AdminChannels.tsx';
import { GiftOrdersTab } from './AdminGifts.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Modal } from '../components/Modal.tsx';
import { MiniPreview, RarityBadge } from '../components/ShopParts.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import * as A from '../services/admin.ts';
import { boardArt, coins, newKey, RARITIES, serialLabel, type ShopItem } from '../services/shop.ts';
import { registerSkins } from '../services/skins.ts';
import { SbError, db } from '../services/supabase.ts';

/* The admin panel is internal: strings live here (uz / en) instead of the main dictionaries. */
function useL() {
  const { lang } = useI18n();
  return useCallback((uz: string, en: string) => (lang === 'uz' ? uz : en), [lang]);
}
const errText = (e: unknown) => (e instanceof SbError ? e.message : e instanceof Error ? e.message : 'error');

type Tab = 'dash' | 'users' | 'payments' | 'shop' | 'gifts' | 'packages' | 'reports' | 'weekly' | 'virtual' | 'channels' | 'broadcast' | 'roles' | 'audit';
const TABS: Array<{ id: Tab; perm: string; icon: typeof LuGauge; uz: string; en: string }> = [
  { id: 'dash', perm: 'dashboard', icon: LuGauge, uz: 'Dashboard', en: 'Dashboard' },
  { id: 'users', perm: 'users.view', icon: LuUsers, uz: 'Foydalanuvchilar', en: 'Users' },
  { id: 'payments', perm: 'payments.view', icon: LuCoins, uz: "To'lovlar", en: 'Payments' },
  { id: 'shop', perm: 'shop.manage', icon: LuShoppingBag, uz: "Do'kon", en: 'Shop' },
  { id: 'gifts', perm: 'shop.manage', icon: LuGift, uz: "Sovg'a buyurtmalari", en: 'Gift orders' },
  { id: 'packages', perm: 'shop.manage', icon: LuPackage, uz: 'Narxlar', en: 'Pricing' },
  { id: 'reports', perm: 'reports.view', icon: LuTriangleAlert, uz: 'Shikoyatlar', en: 'Reports' },
  { id: 'weekly', perm: 'tournaments.manage', icon: LuTrophy, uz: 'Turnirlar', en: 'Tournaments' },
  { id: 'virtual', perm: 'virtual.manage', icon: LuBot, uz: 'Virtual raqiblar', en: 'Virtual opponents' },
  { id: 'channels', perm: 'missions.manage', icon: LuSend, uz: 'Telegram kanallar', en: 'Telegram channels' },
  { id: 'broadcast', perm: 'roles.manage', icon: LuMegaphone, uz: 'Xabar yuborish', en: 'Broadcast' },
  { id: 'roles', perm: 'roles.manage', icon: LuUserCog, uz: 'Rollar', en: 'Roles' },
  { id: 'audit', perm: 'audit.view', icon: LuHistory, uz: 'Audit log', en: 'Audit log' },
];
const ROLE_LABEL: Record<A.Role, [string, string]> = {
  super_admin: ['Super Admin', 'Super Admin'],
  admin: ['Admin', 'Admin'],
  moderator: ['Moderator', 'Moderator'],
  support: ["Qo'llab-quvvatlash", 'Support'],
};

/** Server-protected management panel (#/admin). */
export function Admin() {
  const L = useL();
  const route = useRoute();
  const { signedIn, mode } = useAuth();
  const [me, setMe] = useState<A.AdminMe | null>(null);
  const [failed, setFailed] = useState(false);
  const tab = (route.query.get('tab') as Tab) || 'dash';

  useEffect(() => {
    if (!signedIn || mode !== 'live') return;
    A.adminMe().then(setMe, () => setFailed(true));
  }, [signedIn, mode]);

  if (!signedIn) return <div className="page"><EmptyState title={L('Kirish talab qilinadi', 'Sign in required')} /></div>;
  if (failed) return <div className="page"><ErrorState /></div>;
  if (!me) return <div className="page"><Spinner /></div>;
  if (!me.role) return <div className="page"><EmptyState title={L("Bu bo'lim faqat administratorlar uchun", 'This area is for administrators only')} /></div>;
  const can = (p: string) => me.perms.includes(p);
  const tabs = TABS.filter((x) => can(x.perm));
  const current = tabs.find((x) => x.id === tab) ? tab : 'dash';

  return (
    <div className="page admin-page">
      <div className="page-head">
        <div>
          <h1 className="h1">
            <LuShieldCheck /> {L('Admin panel', 'Admin panel')}
          </h1>
          <p className="muted small">
            {L('Rol', 'Role')}: <strong>{L(...ROLE_LABEL[me.role])}</strong> · {L("Barcha amallar audit log'ga yoziladi", 'Every action is written to the audit log')}
          </p>
        </div>
      </div>
      <div className="chip-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={current === x.id} className={`chip-tab ${current === x.id ? 'chip-tab-on' : ''}`} onClick={() => navigate(`/admin?tab=${x.id}`)}>
            <x.icon /> {L(x.uz, x.en)}
          </button>
        ))}
      </div>
      {current === 'dash' && <DashboardTab superAdmin={me.role === 'super_admin'} />}
      {current === 'users' && <UsersTab can={can} superAdmin={me.role === 'super_admin'} />}
      {current === 'payments' && <PaymentsTab canRefund={can('payments.refund')} />}
      {current === 'shop' && <ShopTab />}
      {current === 'packages' && <PricingTab />}
      {current === 'reports' && <ReportsTab canManage={can('reports.manage')} />}
      {current === 'weekly' && <WeeklyTab />}
      {current === 'channels' && <ChannelsTab />}
      {current === 'gifts' && <GiftOrdersTab />}
      {current === 'virtual' && <VirtualTab />}
      {current === 'broadcast' && <BroadcastTab />}
      {current === 'roles' && <RolesTab />}
      {current === 'audit' && <AuditTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ shared */
/** Asks for the mandatory reason, then runs the action; shows the server's answer. */
function ReasonDialog({ title, children, onSubmit, onClose, danger }: { title: string; children?: ReactNode; onSubmit: (reason: string) => Promise<unknown>; onClose: () => void; danger?: boolean }) {
  const L = useL();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onSubmit(reason.trim());
      toast('success', L('Bajarildi', 'Done'));
      onClose();
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title} locked={busy}>
      <div className="admin-form">
        {children}
        <label className="field">
          <span>{L('Sabab (majburiy)', 'Reason (required)')}</span>
          <textarea value={reason} onChange={(e: any) => setReason(e.target.value)} rows={2} maxLength={500} />
        </label>
        <div className="row-actions">
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={go} disabled={busy || reason.trim().length < 3}>
            {busy ? <LuLoader className="spin" /> : <LuCheck />} {L('Tasdiqlash', 'Confirm')}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {L('Bekor qilish', 'Cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/* ------------------------------------------------------------------ dashboard */
function DashboardTab({ superAdmin = false }: { superAdmin?: boolean }) {
  const L = useL();
  const [d, setD] = useState<A.Dashboard | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(() => A.adminDashboard().then(setD, () => setErr(true)), []);
  useEffect(() => {
    void load();
    const id = setInterval(() => appActive() && void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);
  if (err && !d) return <ErrorState onRetry={load} />;
  if (!d) return <Spinner />;
  const tiles: Array<[string, string | number]> = [
    [L('Jami foydalanuvchilar', 'Total users'), d.users_total],
    [L('Hozir onlayn', 'Online now'), d.users_online],
    [L("Bugun qo'shilgan", 'New today'), d.users_today],
    [L("Faol o'yinlar", 'Active games'), d.games_active],
    [L('Jonli tomoshabinlar', 'Live viewers'), d.live_viewers ?? 0],
    [L("Bugungi o'yinlar", 'Games today'), d.games_today],
    [L("To'langan tranzaksiyalar", 'Paid transactions'), d.payments_paid],
    [L('Bugungi tushum', 'Revenue today'), `⭐ ${d.stars_today}`],
    [L('Jami tushum', 'Total revenue'), `⭐ ${d.stars_total}`],
    [L('Coins muomalada', 'Coins in circulation'), `🪙 ${coins(d.coins_circulation)}`],
    [L('Bugungi xaridlar', 'Purchases today'), d.purchases_today],
    [L('Ochiq shikoyatlar', 'Open reports'), d.reports_open],
    [L('Cheklangan akkauntlar', 'Restricted accounts'), d.banned],
  ];
  return (
    <>
      <div className="admin-tiles">
        {tiles.map(([k, v]) => (
          <div key={k} className="card admin-tile">
            <span className="muted small">{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      {superAdmin && <RealtimeSwitch />}
    </>
  );
}

/** Super admin: which live-update path the apps use (migration 0035). One tap back to the old path. */
function RealtimeSwitch() {
  const L = useL();
  const { toast } = useToast();
  const [mode, setMode] = useState<'changes' | 'broadcast' | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => db.rpc<string>('rt_mode').then((m) => setMode(m === 'broadcast' ? 'broadcast' : 'changes'), () => {}), []);
  useEffect(() => {
    void load();
  }, [load]);
  const flip = async () => {
    if (!mode) return;
    const next = mode === 'broadcast' ? 'changes' : 'broadcast';
    setBusy(true);
    try {
      await db.rpc('admin_rt_mode_set', { p_mode: next, p_reason: next === 'broadcast' ? 'Realtime: Broadcast yoqildi (yengil rejim)' : "Realtime: eski usulga qaytarildi" });
      setMode(next);
      toast('success', L("O'zgartirildi. O'yinchilar ilovasi 5 daqiqa ichida (yoki qayta ochganda) yangi usulga o'tadi.", 'Switched. Apps follow within 5 minutes (or on reopen).'));
    } catch {
      toast('error', L('Xatolik', 'Error'));
    } finally {
      setBusy(false);
    }
  };
  if (!mode) return null;
  return (
    <div className="card adm-rt">
      <div>
        <strong>{L('Jonli yangilanish usuli', 'Live update method')}</strong>
        <p className="muted small">
          {mode === 'broadcast'
            ? L("Yengil rejim (Broadcast) yoqilgan — bazaga yuk kam. Muammo bo'lsa eski usulga qaytaring.", 'Light mode (Broadcast) is on — low database load. Switch back if anything goes wrong.')
            : L('Eski usul (postgres_changes) — bazaga yuk ko‘proq.', 'Old method (postgres_changes) — more database load.')}
        </p>
      </div>
      <button className={`btn btn-sm ${mode === 'broadcast' ? 'btn-secondary' : 'btn-primary'}`} onClick={flip} disabled={busy}>
        {mode === 'broadcast' ? L('Eski usulga qaytarish', 'Switch back to old') : L('Yengil rejimni yoqish', 'Turn on light mode')}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ users */
function UsersTab({ can, superAdmin }: { can: (p: string) => boolean; superAdmin: boolean }) {
  const L = useL();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<A.AdminUser[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const search = useCallback(async (offset = 0) => {
    const r = await A.adminUsers(q, offset);
    setRows((cur) => (offset ? [...(cur ?? []), ...r] : r));
  }, [q]);
  useEffect(() => {
    const id = setTimeout(() => void search(0), 300);
    return () => clearTimeout(id);
  }, [search]);
  return (
    <div className="admin-section">
      <label className="search">
        <LuSearch />
        <input value={q} onChange={(e: any) => setQ(e.target.value)} placeholder={L('Username, Telegram ID yoki user ID', 'Username, Telegram ID or user ID')} />
      </label>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={L('Topilmadi', 'Nothing found')} />
      ) : (
        <ul className="admin-list">
          {rows.map((u) => (
            <li key={u.id}>
              <button className="admin-row" onClick={() => setOpen(u.id)}>
                <Avatar name={u.username} seed={u.avatar} size={34} />
                <span className="admin-row-main">
                  <strong>
                    {u.username} {u.role && <span className="badge">{ROLE_LABEL[u.role][0]}</span>}
                    {u.banned_until && Date.parse(u.banned_until) > Date.now() && <span className="badge badge-danger">{L('Bloklangan', 'Restricted')}</span>}
                  </strong>
                  <span className="muted small">
                    TG {u.tg_id ?? '—'} · {u.rating} · 🪙 {coins(u.balance)}
                  </span>
                </span>
                <LuChevronRight />
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length > 0 && rows.length < rows[0].total && (
        <button className="btn btn-ghost btn-block" onClick={() => search(rows.length)}>
          {L("Ko'proq", 'More')}
        </button>
      )}
      {open && <UserDetail id={open} can={can} superAdmin={superAdmin} onClose={() => setOpen(null)} onChanged={() => search(0)} />}
    </div>
  );
}

function UserDetail({ id, can, superAdmin, onClose, onChanged }: { id: string; can: (p: string) => boolean; superAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const L = useL();
  const [d, setD] = useState<any>(null);
  const [act, setAct] = useState<null | 'ban' | 'unban' | 'mute' | 'credit' | 'debit' | 'role'>(null);
  const [hours, setHours] = useState(24);
  const [amount, setAmount] = useState(1000);
  const [role, setRole] = useState<A.Role | ''>('');
  const load = useCallback(() => A.adminUserDetail(id).then(setD), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const p = d?.profile;
  const banned = p?.banned_until && Date.parse(p.banned_until) > Date.now();
  const done = async () => {
    await load();
    onChanged();
  };
  return (
    <Modal open onClose={onClose} title={p?.username ?? '…'} wide>
      {!d ? (
        <Spinner />
      ) : (
        <div className="admin-detail">
          <div className="admin-kv">
            <span>Telegram ID</span>
            <strong>{p.tg_id ?? '—'}</strong>
            <span>{L('Reyting', 'Rating')}</span>
            <strong>
              {p.rating} ({p.wins}/{p.losses}/{p.draws})
            </strong>
            <span>{L("Ro'yxatdan o'tgan", 'Joined')}</span>
            <strong>{when(p.created_at)}</strong>
            <span>{L('Oxirgi faollik', 'Last seen')}</span>
            <strong>{when(p.last_seen)}</strong>
            <span>{L('Holat', 'Status')}</span>
            <strong className={banned ? 'delta-down' : 'delta-up'}>{banned ? `${L('Bloklangan', 'Restricted')} → ${when(p.banned_until)} (${p.ban_reason ?? ''})` : L('Faol', 'Active')}</strong>
            {p.muted_until && Date.parse(p.muted_until) > Date.now() && (
              <>
                <span>{L('Chat', 'Chat')}</span>
                <strong>{L('Ovozsiz', 'Muted')} → {when(p.muted_until)}</strong>
              </>
            )}
            <span>{L('Rol', 'Role')}</span>
            <strong>{p.role ? ROLE_LABEL[p.role as A.Role][0] : '—'}</strong>
            {d.balance !== null && d.balance !== undefined && (
              <>
                <span>{L('Balans', 'Balance')}</span>
                <strong>🪙 {coins(d.balance)}</strong>
              </>
            )}
            <span>{L("O'yinlar / inventar", 'Games / items')}</span>
            <strong>
              {d.games} / {d.inventory}
            </strong>
          </div>
          <div className="row-actions admin-actions">
            {can('users.ban') && !banned && (
              <button className="btn btn-danger btn-sm" onClick={() => setAct('ban')}>
                <LuBan /> {L('Bloklash', 'Restrict')}
              </button>
            )}
            {can('users.ban') && banned && (
              <button className="btn btn-secondary btn-sm" onClick={() => setAct('unban')}>
                <LuUndo2 /> {L('Blokdan chiqarish', 'Lift restriction')}
              </button>
            )}
            {can('chat.moderate') && (
              <button className="btn btn-secondary btn-sm" onClick={() => setAct('mute')}>
                <LuVolumeX /> {L('Chat cheklovi', 'Chat mute')}
              </button>
            )}
            {can('balance.adjust') && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => setAct('credit')}>
                  <LuPlus /> {L("Coins qo'shish", 'Add coins')}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setAct('debit')}>
                  − {L('Coins yechish', 'Remove coins')}
                </button>
              </>
            )}
            {superAdmin && p.role !== 'super_admin' && (
              <button className="btn btn-secondary btn-sm" onClick={() => setAct('role')}>
                <LuUserCog /> {L('Rol berish', 'Set role')}
              </button>
            )}
          </div>
          {d.ledger && (
            <details className="admin-more">
              <summary>{L('Balans tarixi', 'Balance history')}</summary>
              <ul className="ledger">
                {d.ledger.map((r: any) => (
                  <li key={r.id}>
                    <span className="ledger-main">
                      <strong>{r.kind}</strong>
                      <span className="muted small">
                        {r.note ?? ''} · {when(r.created_at)}
                      </span>
                    </span>
                    <span className={`ledger-amt ${r.amount > 0 ? 'delta-up' : 'delta-down'}`}>{r.amount > 0 ? `+${coins(r.amount)}` : `−${coins(-r.amount)}`}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {d.payments && d.payments.length > 0 && (
            <details className="admin-more">
              <summary>{L("To'lovlar", 'Payments')}</summary>
              <ul className="ledger">
                {d.payments.map((r: any) => (
                  <li key={r.id}>
                    <span className="ledger-main">
                      <strong>
                        ⭐ {r.stars} → 🪙 {coins(r.coins)}
                      </strong>
                      <span className="muted small">{when(r.created_at)}</span>
                    </span>
                    <span className={`pay-status pay-${r.status}`}>{r.status}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {d.reports_against?.length > 0 && (
            <details className="admin-more" open>
              <summary>
                {L('Shikoyatlar', 'Reports')} ({d.reports_against.length})
              </summary>
              <ul className="ledger">
                {d.reports_against.map((r: any) => (
                  <li key={r.id}>
                    <span className="ledger-main">
                      <strong>{r.kind}</strong>
                      <span className="muted small">{r.body}</span>
                    </span>
                    <span className={`pay-status`}>{r.status}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {d.audit?.length > 0 && (
            <details className="admin-more">
              <summary>{L('Admin amallari', 'Admin actions')}</summary>
              <ul className="ledger">
                {d.audit.map((r: any) => (
                  <li key={r.id}>
                    <span className="ledger-main">
                      <strong>{r.action}</strong>
                      <span className="muted small">
                        {r.admin ?? 'system'} · {r.reason ?? ''} · {when(r.created_at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {act === 'ban' && (
        <ReasonDialog title={L('Vaqtincha bloklash', 'Temporary restriction')} danger onClose={() => setAct(null)} onSubmit={(r) => A.adminBan(id, new Date(Date.now() + hours * 3600_000).toISOString(), r).then(done)}>
          <label className="field">
            <span>{L('Muddat', 'Duration')}</span>
            <select value={hours} onChange={(e: any) => setHours(Number(e.target.value))}>
              <option value={1}>1 {L('soat', 'hour')}</option>
              <option value={24}>24 {L('soat', 'hours')}</option>
              <option value={72}>3 {L('kun', 'days')}</option>
              <option value={168}>7 {L('kun', 'days')}</option>
              <option value={720}>30 {L('kun', 'days')}</option>
              <option value={87600}>{L('Doimiy (10 yil)', 'Permanent (10 years)')}</option>
            </select>
          </label>
        </ReasonDialog>
      )}
      {act === 'unban' && <ReasonDialog title={L('Blokdan chiqarish', 'Lift restriction')} onClose={() => setAct(null)} onSubmit={(r) => A.adminUnban(id, r).then(done)} />}
      {act === 'mute' && (
        <ReasonDialog title={L('Chat cheklovi', 'Chat mute')} onClose={() => setAct(null)} onSubmit={(r) => A.adminMute(id, hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null, r).then(done)}>
          <label className="field">
            <span>{L('Muddat', 'Duration')}</span>
            <select value={hours} onChange={(e: any) => setHours(Number(e.target.value))}>
              <option value={0}>{L('Cheklovni olib tashlash', 'Remove mute')}</option>
              <option value={1}>1 {L('soat', 'hour')}</option>
              <option value={24}>24 {L('soat', 'hours')}</option>
              <option value={168}>7 {L('kun', 'days')}</option>
            </select>
          </label>
        </ReasonDialog>
      )}
      {(act === 'credit' || act === 'debit') && (
        <AdjustDialog id={id} sign={act === 'credit' ? 1 : -1} amount={amount} setAmount={setAmount} onClose={() => setAct(null)} onDone={done} />
      )}
      {act === 'role' && (
        <ReasonDialog title={L('Rol berish', 'Set role')} onClose={() => setAct(null)} onSubmit={(r) => A.adminRoleSet(id, (role || null) as A.Role | null, r).then(done)}>
          <label className="field">
            <span>{L('Rol', 'Role')}</span>
            <select value={role} onChange={(e: any) => setRole(e.target.value)}>
              <option value="">{L("Rolni olib tashlash (oddiy o'yinchi)", 'Remove role (regular player)')}</option>
              <option value="admin">Admin</option>
              <option value="moderator">Moderator</option>
              <option value="support">Support</option>
            </select>
          </label>
        </ReasonDialog>
      )}
    </Modal>
  );
}

function AdjustDialog({ id, sign, amount, setAmount, onClose, onDone }: { id: string; sign: 1 | -1; amount: number; setAmount: (n: number) => void; onClose: () => void; onDone: () => Promise<void> }) {
  const L = useL();
  const [key] = useState(newKey); // one key per dialog: a double tap is never applied twice
  return (
    <ReasonDialog title={sign > 0 ? L("Coins qo'shish", 'Add coins') : L('Coins yechish', 'Remove coins')} danger={sign < 0} onClose={onClose} onSubmit={(r) => A.adminAdjust(id, sign * amount, r, key).then(onDone)}>
      <NumField label={L('Miqdor', 'Amount')} value={amount || null} onChange={(v) => setAmount(v ?? 0)} min={1} />
    </ReasonDialog>
  );
}

/* ------------------------------------------------------------------ payments */
function PaymentsTab({ canRefund }: { canRefund: boolean }) {
  const L = useL();
  const [status, setStatus] = useState<string | null>(null);
  const [rows, setRows] = useState<A.Payment[] | null>(null);
  const [act, setAct] = useState<null | { kind: 'refund' | 'reject'; p: A.Payment }>(null);
  const load = useCallback(async (offset = 0) => {
    const r = await A.adminPayments(status, offset);
    setRows((cur) => (offset ? [...(cur ?? []), ...r] : r));
  }, [status]);
  useEffect(() => {
    setRows(null);
    void load(0);
  }, [load]);
  return (
    <div className="admin-section">
      <div className="chip-tabs chip-tabs-sm">
        {[null, 'pending', 'paid', 'rejected', 'refunded'].map((s) => (
          <button key={s ?? 'all'} className={`chip-tab ${status === s ? 'chip-tab-on' : ''}`} onClick={() => setStatus(s)}>
            {s ?? L('Hammasi', 'All')}
          </button>
        ))}
      </div>
      <p className="muted small">{L("To'lovlar Telegram Stars orqali avtomatik tasdiqlanadi (successful_payment). Qo'lda tasdiqlash yo'q — faqat refund yoki to'lanmagan buyurtmani bekor qilish.", 'Payments are confirmed automatically by Telegram Stars (successful_payment). No manual approval — only refunds or cancelling unpaid orders.')}</p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={L("To'lovlar yo'q", 'No payments')} />
      ) : (
        <ul className="admin-list">
          {rows.map((p) => (
            <li key={p.id} className="admin-row admin-row-static">
              <span className="admin-row-main">
                <strong>
                  {p.username ?? '—'} · ⭐ {p.stars} → 🪙 {coins(p.coins)}
                </strong>
                <span className="muted small">
                  {when(p.created_at)} · {p.id.slice(0, 8)} {p.telegram_payment_charge_id ? `· ${p.telegram_payment_charge_id.slice(0, 14)}…` : ''} {p.status_reason ? `· ${p.status_reason}` : ''}
                </span>
              </span>
              <span className={`pay-status pay-${p.status}`}>{p.status}</span>
              {canRefund && p.status === 'paid' && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAct({ kind: 'refund', p })}>
                  {L('Refund', 'Refund')}
                </button>
              )}
              {canRefund && p.status === 'pending' && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAct({ kind: 'reject', p })}>
                  {L('Rad etish', 'Reject')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length > 0 && rows.length < rows[0].total && (
        <button className="btn btn-ghost btn-block" onClick={() => load(rows.length)}>
          {L("Ko'proq", 'More')}
        </button>
      )}
      {act?.kind === 'refund' && (
        <ReasonDialog
          danger
          title={L('Refund', 'Refund')}
          onClose={() => setAct(null)}
          onSubmit={async (r) => {
            const res = await A.adminRefund(act.p.id, r);
            if (!res.ok) throw new Error(res.error === 'coins-spent' ? L("Foydalanuvchi coins'ni sarflab bo'lgan", 'The coins were already spent') : res.detail ?? res.error ?? 'error');
            await load(0);
          }}
        >
          <p className="muted small">
            {L(`${coins(act.p.coins)} coins balansdan yechiladi va ⭐ ${act.p.stars} Telegram orqali qaytariladi.`, `${coins(act.p.coins)} coins are removed and ⭐ ${act.p.stars} returned via Telegram.`)}
          </p>
        </ReasonDialog>
      )}
      {act?.kind === 'reject' && <ReasonDialog title={L('Buyurtmani rad etish', 'Reject order')} onClose={() => setAct(null)} onSubmit={(r) => A.adminPaymentReject(act.p.id, r).then(() => load(0))} />}
    </div>
  );
}

/* ------------------------------------------------------------------ shop */
const SLOT_LABEL: Record<string, [string, string]> = { piece: ['Donacha', 'Pieces'], board: ['Doska', 'Board'], effect: ['Animatsiya', 'Animation'] };
function ShopTab() {
  const L = useL();
  const { lang } = useI18n();
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [cats, setCats] = useState<Awaited<ReturnType<typeof A.adminCategories>>>([]);
  const [edit, setEdit] = useState<Partial<ShopItem> | null>(null);
  const [catEdit, setCatEdit] = useState<{ id: string; name_uz: string; name_en: string; sort: number; visible: boolean } | null>(null);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    const [i, c] = await Promise.all([A.adminShopItems(), A.adminCategories()]);
    registerSkins(i.map((x) => ({ slug: x.slug, slot: x.slot, style: x.style })));
    setItems(i);
    setCats(c);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const shown = useMemo(() => (items ?? []).filter((i) => !filter || i.category_id === filter), [items, filter]);
  return (
    <div className="admin-section">
      <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={() => setEdit({ slot: 'piece', category_id: 'pieces', collection: 'classic', rarity: 'common', price: 6000, discount_percent: 0, active: true, style: {}, sort: 100 } as any)}>
          <LuPlus /> {L('Yangi skin', 'New skin')}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setCatEdit({ id: '', name_uz: '', name_en: '', sort: 10, visible: true })}>
          <LuPlus /> {L('Yangi kategoriya', 'New category')}
        </button>
      </div>
      <div className="chip-tabs chip-tabs-sm">
        <button className={`chip-tab ${!filter ? 'chip-tab-on' : ''}`} onClick={() => setFilter('')}>
          {L('Hammasi', 'All')}
        </button>
        {cats.map((c) => (
          <button key={c.id} className={`chip-tab ${filter === c.id ? 'chip-tab-on' : ''} ${c.visible ? '' : 'chip-tab-off'}`} onClick={() => setFilter(c.id)} onDoubleClick={() => setCatEdit(c)}>
            {lang === 'uz' ? c.name_uz : c.name_en}
          </button>
        ))}
        {filter && (
          <button className="chip-tab" onClick={() => setCatEdit(cats.find((c) => c.id === filter) ?? null)}>
            ✎ {L('Kategoriyani tahrirlash', 'Edit category')}
          </button>
        )}
      </div>
      {!items ? (
        <Spinner />
      ) : (
        <div className="admin-shop-grid">
          {shown.map((i) => (
            <button key={i.slug} className={`shop-card admin-shop-card rarity-edge-${i.rarity} ${!i.active ? 'is-hidden' : ''}`} onClick={() => setEdit(i)}>
              <MiniPreview item={i} />
              <span className="shop-card-name">{i.name_uz}</span>
              <span className="shop-card-meta">
                <RarityBadge r={i.rarity} />
              </span>
              <span className="small">
                {i.is_free ? L('Bepul', 'Free') : `🪙 ${coins(i.price)}`}
                {i.discount_percent > 0 ? ` −${i.discount_percent}%` : ''}
              </span>
              <span className="admin-flags">
                {!i.active && <span className="badge">{L('Yashirin', 'Hidden')}</span>}
                {i.retired && <span className="badge badge-danger">{L('Sotuvda emas', 'Off sale')}</span>}
                {i.premium_only && <span className="badge badge-free">Premium</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {edit && <ItemEditor item={edit} cats={cats} onClose={() => setEdit(null)} onSaved={load} />}
      {catEdit && (
        <ReasonDialog title={L('Kategoriya', 'Category')} onClose={() => setCatEdit(null)} onSubmit={(r) => A.adminCategorySave(catEdit, r).then(load)}>
          <CategoryFields c={catEdit} set={setCatEdit} />
        </ReasonDialog>
      )}
    </div>
  );
}

function CategoryFields({ c, set }: { c: { id: string; name_uz: string; name_en: string; sort: number; visible: boolean }; set: (c: any) => void }) {
  const L = useL();
  return (
    <div className="admin-grid2">
      <label className="field">
        <span>ID</span>
        <input value={c.id} onChange={(e: any) => set({ ...c, id: e.target.value.toLowerCase() })} placeholder="summer-2026" />
      </label>
      <label className="field">
        <span>{L('Tartib', 'Order')}</span>
        <input type="number" value={c.sort} onChange={(e: any) => set({ ...c, sort: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>{L('Nomi (uz)', 'Name (uz)')}</span>
        <input value={c.name_uz} onChange={(e: any) => set({ ...c, name_uz: e.target.value })} />
      </label>
      <label className="field">
        <span>{L('Nomi (en)', 'Name (en)')}</span>
        <input value={c.name_en} onChange={(e: any) => set({ ...c, name_en: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={c.visible} onChange={(e: any) => set({ ...c, visible: e.target.checked })} /> {L("Do'konda ko'rinadi", 'Visible in shop')}
      </label>
    </div>
  );
}

function ItemEditor({ item, cats, onClose, onSaved }: { item: Partial<ShopItem>; cats: Array<{ id: string; name_uz: string }>; onClose: () => void; onSaved: () => Promise<void> }) {
  const L = useL();
  const { toast } = useToast();
  const isNew = !item.name_uz;
  const [f, setF] = useState<any>({ ...item });
  const [styleText, setStyleText] = useState(JSON.stringify(item.style ?? {}, null, 2));
  const [styleOk, setStyleOk] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const preview = useMemo(() => {
    try {
      const s = JSON.parse(styleText);
      setStyleOk(true);
      return { slug: `prev-${(f.slug || 'new').replace(/[^a-z0-9-]/g, '')}-${styleText.length}`, slot: f.slot ?? 'piece', style: s };
    } catch {
      setStyleOk(false);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleText, f.slot, f.slug]);
  const upload = async (file: File | undefined) => {
    if (!file || !f.slug) return;
    setUploading(true);
    try {
      set('image_url', await A.uploadShopImage(f.slug, file));
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setUploading(false);
    }
  };
  if (saving) {
    return (
      <ReasonDialog
        title={isNew ? L('Yangi skin', 'New skin') : L("O'zgarishlarni saqlash", 'Save changes')}
        onClose={() => setSaving(false)}
        onSubmit={async (r) => {
          await A.adminShopSave({ ...f, style: JSON.parse(styleText) }, r);
          await onSaved();
          onClose();
        }}
      />
    );
  }
  return (
    <Modal open onClose={onClose} title={isNew ? L('Yangi skin', 'New skin') : f.name_uz} wide>
      <div className="admin-form">
        {preview && <div className="admin-preview"><MiniPreview item={preview as any} /></div>}
        <div className="admin-grid2">
          <label className="field">
            <span>Slug (ID)</span>
            <input value={f.slug ?? ''} disabled={!isNew} onChange={(e: any) => set('slug', e.target.value.toLowerCase())} placeholder="neon-tiger" />
          </label>
          <label className="field">
            <span>{L('Kategoriya', 'Category')}</span>
            <select value={f.category_id} onChange={(e: any) => set('category_id', e.target.value)}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_uz}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{L('Turi', 'Slot')}</span>
            <select value={f.slot} onChange={(e: any) => set('slot', e.target.value)}>
              {Object.entries(SLOT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {L(v[0], v[1])}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{L('Kolleksiya', 'Collection')}</span>
            <input value={f.collection ?? ''} onChange={(e: any) => set('collection', e.target.value)} placeholder="classic / girls / boys / trend / premium" />
          </label>
          <label className="field">
            <span>{L('Nomi (uz)', 'Name (uz)')}</span>
            <input value={f.name_uz ?? ''} onChange={(e: any) => set('name_uz', e.target.value)} />
          </label>
          <label className="field">
            <span>{L('Nomi (en)', 'Name (en)')}</span>
            <input value={f.name_en ?? ''} onChange={(e: any) => set('name_en', e.target.value)} />
          </label>
          <label className="field">
            <span>{L('Tavsif (uz)', 'Description (uz)')}</span>
            <input value={f.desc_uz ?? ''} onChange={(e: any) => set('desc_uz', e.target.value)} />
          </label>
          <label className="field">
            <span>{L('Tavsif (en)', 'Description (en)')}</span>
            <input value={f.desc_en ?? ''} onChange={(e: any) => set('desc_en', e.target.value)} />
          </label>
          <label className="field">
            <span>Rarity</span>
            <select value={f.rarity} onChange={(e: any) => set('rarity', e.target.value)}>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <NumField label={L('Narx (Coins)', 'Price (Coins)')} value={f.price ?? 0} onChange={(v) => set('price', v)} />
          <NumField label={L('Chegirma %', 'Discount %')} value={f.discount_percent ?? 0} onChange={(v) => set('discount_percent', v)} max={90} />
          <NumField label={L('Tartib', 'Order')} value={f.sort ?? 0} onChange={(v) => set('sort', v)} max={100000} />
        </div>
        <div className="admin-checks">
          <label className="check">
            <input type="checkbox" checked={f.active ?? true} onChange={(e: any) => set('active', e.target.checked)} /> {L("Do'konda ko'rinadi", 'Visible in shop')}
          </label>
          <label className="check">
            <input type="checkbox" checked={f.retired ?? false} onChange={(e: any) => set('retired', e.target.checked)} /> {L('Sotuvdan olingan', 'Off sale')}
          </label>
          <label className="check">
            <input type="checkbox" checked={f.is_free ?? false} onChange={(e: any) => set('is_free', e.target.checked)} /> {L('Bepul', 'Free')}
          </label>
          <label className="check">
            <input type="checkbox" checked={f.premium_only ?? false} onChange={(e: any) => set('premium_only', e.target.checked)} /> {L('Faqat Premium', 'Premium only')}
          </label>
        </div>
        <label className="field">
          <span>
            {L("Ko'rinish (style JSON)", 'Look (style JSON)')} {!styleOk && <strong className="delta-down">— {L("JSON noto'g'ri", 'invalid JSON')}</strong>}
          </span>
          <textarea className="mono" rows={8} value={styleText} onChange={(e: any) => setStyleText(e.target.value)} />
        </label>
        <div className="row-actions">
          <label className={`btn btn-secondary btn-sm ${!f.slug ? 'is-disabled' : ''}`}>
            {uploading ? <LuLoader className="spin" /> : <LuImage />} {L('Rasm yuklash', 'Upload image')}
            <input type="file" accept="image/webp,image/png,image/jpeg" hidden disabled={!f.slug} onChange={(e: any) => upload(e.target.files?.[0])} />
          </label>
          {f.image_url && (
            <a href={f.image_url} target="_blank" rel="noreferrer" className="small">
              {L("Rasmni ko'rish", 'View image')}
            </a>
          )}
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" disabled={!styleOk || !f.slug || !f.name_uz || !f.name_en || f.price === null || f.discount_percent === null || f.sort === null} onClick={() => setSaving(true)}>
            <LuCheck /> {L('Saqlash', 'Save')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            {L('Bekor qilish', 'Cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ number input
 * Android + Telegram: a text input with a numeric keyboard. The typed text is kept as typed (no `Number(v) || 0`
 * rewriting, which turned an emptied field into "0" and fought the keyboard); the parent gets the parsed value or null.
 * Declared at module level so its identity is stable — an inline component would remount and drop focus. */
function NumField({ label, value, onChange, min = 0, max = 10_000_000, decimals = false, hint, error, disabled }: {
  label: string; value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; decimals?: boolean; hint?: string; error?: string | null; disabled?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  // follow outside changes (e.g. Cancel) without overwriting what is being typed
  useEffect(() => {
    setText((t) => (parseNum(t, decimals) === value ? t : value === null ? '' : String(value)));
  }, [value, decimals]);
  const n = parseNum(text, decimals);
  const bad = error ?? (text.trim() === '' ? null : n === null ? 'nan' : n < min || n > max ? 'range' : null);
  return (
    <label className={`field ${bad ? 'field-bad' : ''}`}>
      <span>{label}</span>
      <input
        type="text"
        inputMode={decimals ? 'decimal' : 'numeric'}
        pattern={decimals ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
        autoComplete="off"
        enterKeyHint="done"
        value={text}
        disabled={disabled}
        aria-invalid={bad ? true : undefined}
        onChange={(e) => {
          const t = e.target.value.replace(decimals ? /[^0-9.,]/g : /[^0-9]/g, '');
          setText(t);
          const v = parseNum(t, decimals);
          onChange(v !== null && v >= min && v <= max ? v : null);
        }}
      />
      {bad === 'nan' || bad === 'range' ? <small className="field-err">{bad === 'nan' ? 'Faqat raqam kiriting · Numbers only' : `${min} – ${max}`}</small> : bad ? <small className="field-err">{bad}</small> : hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}
function parseNum(t: string, decimals: boolean): number | null {
  const s = t.trim().replace(',', '.');
  if (s === '' || (decimals ? !/^\d+(\.\d+)?$/.test(s) : !/^\d+$/.test(s))) return null;
  return Number(s);
}

/* ------------------------------------------------------------------ pricing: rate, packages, Limited boards, history */
function PricingTab() {
  const L = useL();
  const [data, setData] = useState<A.AdminPricing | null>(null);
  const [boards, setBoards] = useState<A.AdminBoard[] | null>(null);
  const [hist, setHist] = useState<A.PriceChange[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<A.PricingPackage | null>(null);
  const [rateEdit, setRateEdit] = useState(false);
  const [boardEdit, setBoardEdit] = useState<A.AdminBoard | null>(null);
  const [owners, setOwners] = useState<A.AdminBoard | null>(null);
  const [frames, setFrames] = useState<A.AdminFrame[]>([]);
  const [frameEdit, setFrameEdit] = useState<A.AdminFrame | null>(null);
  const load = useCallback(async () => {
    try {
      const [p, b, h, fr] = await Promise.all([A.adminPricing(), A.adminBoards(), A.adminPriceHistory(), A.adminFrames().catch(() => [])]);
      setFrames(Array.isArray(fr) ? fr : []);
      if (!p?.settings || !Array.isArray(p.packages)) throw new Error('bad pricing response');
      setData(p);
      setBoards(Array.isArray(b) ? b : []);
      setHist(Array.isArray(h) ? h : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed) return <ErrorState onRetry={load} />;
  if (!data || !boards || !hist) return <Spinner />;
  const rate = Number(data.settings.stars_per_1000);
  const som = Number(data.settings.som_per_coin);
  return (
    <div className="admin-section">
      <section className="card admin-rate">
        <div>
          <span className="muted small">{L('Asosiy kurs', 'Base rate')}</span>
          <strong className="admin-rate-v">🪙 1 000 = ⭐ {fmtNum(rate)}</strong>
          <span className="muted small">🪙 1 = {fmtNum(som)} so'm · {L("Paketlar shu kurs bo'yicha hisoblanadi (yuqoriga yaxlitlanadi)", 'Packages follow this rate (rounded up)')}</span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setRateEdit(true)}>
          ✎ {L("Kursni o'zgartirish", 'Change rate')}
        </button>
      </section>

      <h2 className="h3">{L('Coin paketlari (Telegram Stars)', 'Coin packages (Telegram Stars)')}</h2>
      <p className="muted small">{L("O'zgarish faqat yangi to'lovlarga ta'sir qiladi. To'lov narxini server bazadan oladi.", 'Changes apply to new payments only. The server takes the price from the database.')}</p>
      <button className="btn btn-primary btn-sm" onClick={() => setEdit({ id: '', coins: 1000, bonus_coins: 0, stars: A.starsFor(1000, rate), stars_manual: false, active: true, sort: 10, updated_at: '' })}>
        <LuPlus /> {L('Yangi paket', 'New package')}
      </button>
      <ul className="admin-list">
        {data.packages.map((p) => (
          <li key={p.id}>
            <button className={`admin-row ${p.active ? '' : 'is-hidden'}`} onClick={() => setEdit(p)}>
              <span className="admin-row-main">
                <strong>
                  🪙 {coins(p.coins)} {p.bonus_coins ? `+${coins(p.bonus_coins)}` : ''} → ⭐ {p.stars}
                </strong>
                <span className="muted small">
                  {p.id} · {p.stars_manual ? L("qo'lda belgilangan", 'manual price') : L('kurs bo‘yicha', 'by rate')}
                  {p.stars_manual && p.stars !== A.starsFor(p.coins + p.bonus_coins, rate) ? ` (${L('kurs', 'rate')}: ⭐ ${A.starsFor(p.coins + p.bonus_coins, rate)})` : ''}
                  {p.active ? '' : ` · ${L('nofaol', 'inactive')}`}
                </span>
              </span>
              <LuChevronRight />
            </button>
          </li>
        ))}
      </ul>

      <h2 className="h3">{L('Limited: doskalar va toshlar', 'Limited: boards and stones')}</h2>
      <ul className="admin-list">
        {boards.map((b) => (
          <li key={b.slug} className="admin-board-row">
            <button className="admin-row" onClick={() => setBoardEdit(b)}>
              <img src={boardArt(b.image_url)} alt="" width={44} height={44} loading="lazy" />
              <span className="admin-row-main">
                <strong>
                  {b.name} · 🪙 {coins(b.price)}
                </strong>
                <span className="muted small">
                  {L('Sotilgan', 'Sold')}: {b.sold}/{b.supply ?? '—'} {b.supply === null ? `· ${L('limit belgilanmagan', 'limit not set')}` : b.sold >= b.supply ? '· SOLD OUT' : ''} · 🪙 {coins(b.revenue)}
                </span>
              </span>
              <LuChevronRight />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOwners(b)} disabled={b.sold === 0}>
              <LuUsers /> {b.sold}
            </button>
          </li>
        ))}
      </ul>

      <h2 className="h3">{L('Profil ramkalari', 'Profile frames')}</h2>
      <ul className="admin-list">
        {frames.map((f) => (
          <li key={f.slug} className="admin-board-row">
            <button className={`admin-row ${f.active ? '' : 'is-hidden'}`} onClick={() => setFrameEdit(f)}>
              <img src={new URL(`frames/${f.slug}.webp`, document.baseURI).href} alt="" width={44} height={44} loading="lazy" />
              <span className="admin-row-main">
                <strong>
                  {f.name_en} · 🪙 {coins(f.price)}
                </strong>
                <span className="muted small">
                  {L('Egalari', 'Owners')}: {f.owners} · 🪙 {coins(f.revenue)}
                  {f.active ? '' : ` · ${L('nofaol', 'inactive')}`}
                </span>
              </span>
              <LuChevronRight />
            </button>
          </li>
        ))}
      </ul>

      <h2 className="h3">{L('Narxlar tarixi', 'Price history')}</h2>
      {hist.length === 0 ? (
        <p className="muted small">{L("Hali o'zgarish yo'q", 'No changes yet')}</p>
      ) : (
        <ul className="admin-list admin-hist">
          {hist.map((h) => (
            <li key={h.id}>
              <span className="admin-row-main">
                <strong>
                  {histLabel(h, L)}: {h.old_value === null ? '—' : fmtNum(Number(h.old_value))} → {h.new_value === null ? '—' : fmtNum(Number(h.new_value))}
                </strong>
                <span className="muted small">
                  {when(h.created_at)} · {h.admin ?? L('tizim', 'system')}
                  {h.reason ? ` · ${h.reason}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {edit && <PackageEditor pkg={edit} rate={rate} onClose={() => setEdit(null)} onSaved={load} />}
      {rateEdit && <RateEditor rate={rate} som={som} packages={data.packages} onClose={() => setRateEdit(false)} onSaved={load} />}
      {boardEdit && <BoardEditor board={boardEdit} onClose={() => setBoardEdit(null)} onSaved={load} />}
      {owners && <BoardOwners board={owners} onClose={() => setOwners(null)} />}
      {frameEdit && <FrameEditor frame={frameEdit} onClose={() => setFrameEdit(null)} onSaved={load} />}
    </div>
  );
}
const fmtNum = (n: number) => (Number.isInteger(n) ? coins(n) : String(n));
function histLabel(h: A.PriceChange, L: (uz: string, en: string) => string) {
  if (h.entity === 'rate') return h.field === 'som_per_coin' ? L("1 Coin, so'm", '1 Coin, so‘m') : L('Kurs: ⭐ / 1000 Coin', 'Rate: ⭐ / 1000 Coin');
  if (h.entity === 'package') return `${L('Paket', 'Package')} ${h.entity_id} (${h.field === 'stars' ? '⭐' : '🪙'})`;
  return `${h.entity === 'board' ? L('Doska', 'Board') : L('Mahsulot', 'Item')} ${h.entity_id} (🪙)`;
}

/** Save / Cancel dialog with the mandatory reason; fields are validated before Save is enabled. */
function EditDialog({ title, children, valid, onSave, onClose }: { title: string; children: ReactNode; valid: boolean; onSave: (reason: string) => Promise<unknown>; onClose: () => void }) {
  const L = useL();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onSave(reason.trim());
      toast('success', L('Saqlandi', 'Saved'));
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title} locked={busy}>
      <div className="admin-form">
        {children}
        <label className="field">
          <span>{L('Sabab (majburiy)', 'Reason (required)')}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </label>
        {err && <p className="field-err">{err}</p>}
        <div className="row-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy || !valid || reason.trim().length < 3}>
            {busy ? <LuLoader className="spin" /> : <LuCheck />} {L('Saqlash', 'Save')}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {L('Bekor qilish', 'Cancel')}
          </button>
        </div>
        {!valid && <p className="muted small">{L("Qiymatlarni to'g'ri kiriting", 'Enter valid values')}</p>}
      </div>
    </Modal>
  );
}

function PackageEditor({ pkg, rate, onClose, onSaved }: { pkg: A.PricingPackage; rate: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const L = useL();
  const isNew = !pkg.id;
  const [id, setId] = useState(pkg.id);
  const [c, setC] = useState<number | null>(pkg.coins);
  const [bonus, setBonus] = useState<number | null>(pkg.bonus_coins);
  const [manual, setManual] = useState(pkg.stars_manual);
  const [stars, setStars] = useState<number | null>(pkg.stars);
  const [sort, setSort] = useState<number | null>(pkg.sort);
  const [active, setActive] = useState(pkg.active);
  const auto = c !== null ? A.starsFor(c + (bonus ?? 0), rate) : null;
  const idOk = /^[a-z0-9_-]{2,32}$/.test(id);
  const valid = idOk && c !== null && c >= 1 && bonus !== null && sort !== null && (!manual || (stars !== null && stars >= 1));
  return (
    <EditDialog
      title={isNew ? L('Yangi paket', 'New package') : `${L('Paket', 'Package')} ${pkg.id}`}
      valid={valid}
      onClose={onClose}
      onSave={async (r) => {
        await A.adminPackageSave({ id, coins: c!, bonus_coins: bonus!, sort: sort!, active, stars_manual: manual, ...(manual ? { stars: stars! } : {}) } as any, r);
        await onSaved();
      }}
    >
      {!isNew && (
        <p className="muted small">
          {L('Hozirgi narx', 'Current price')}: 🪙 {coins(pkg.coins)} → ⭐ {pkg.stars} ({pkg.stars_manual ? L("qo'lda", 'manual') : L('kurs bo‘yicha', 'by rate')})
        </p>
      )}
      <div className="admin-grid2">
        <label className={`field ${id && !idOk ? 'field-bad' : ''}`}>
          <span>ID</span>
          <input value={id} disabled={!isNew} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="coins_2500" autoComplete="off" />
          {id && !idOk && <small className="field-err">a-z 0-9 _ - (2–32)</small>}
        </label>
        <NumField label="Coins" value={c} onChange={setC} min={1} />
        <NumField label={L('Bonus coins', 'Bonus coins')} value={bonus} onChange={setBonus} />
        <NumField label={L('Tartib', 'Order')} value={sort} onChange={setSort} max={10000} />
      </div>
      <label className="check">
        <input type="checkbox" checked={manual} onChange={(e) => (setManual(e.target.checked), e.target.checked && stars === null && setStars(auto))} /> {L("Stars narxini qo'lda belgilash", 'Set the Stars price manually')}
      </label>
      {manual ? (
        <NumField label="Stars ⭐" value={stars} onChange={setStars} min={1} max={100000} hint={auto !== null ? `${L('Kurs bo‘yicha', 'By rate')}: ⭐ ${auto}` : undefined} />
      ) : (
        <p className="admin-auto">
          ⭐ <strong>{auto ?? '—'}</strong> <span className="muted small">{L("kurs bo'yicha avtomatik", 'automatic, by rate')}</span>
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {L('Faol', 'Active')}
      </label>
    </EditDialog>
  );
}

function RateEditor({ rate, som, packages, onClose, onSaved }: { rate: number; som: number; packages: A.PricingPackage[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const L = useL();
  const [r, setR] = useState<number | null>(rate);
  const [s, setS] = useState<number | null>(som);
  const auto = packages.filter((p) => !p.stars_manual && p.active);
  return (
    <EditDialog
      title={L('Coin / Stars kursi', 'Coin / Stars rate')}
      valid={r !== null && r > 0 && s !== null}
      onClose={onClose}
      onSave={async (reason) => {
        await A.adminPricingSet(r!, s!, reason);
        await onSaved();
      }}
    >
      <p className="muted small">
        {L('Hozir', 'Now')}: 🪙 1 000 = ⭐ {fmtNum(rate)} · 🪙 1 = {fmtNum(som)} so'm
      </p>
      <div className="admin-grid2">
        <NumField label={L('⭐ 1 000 Coin uchun', '⭐ per 1 000 Coins')} value={r} onChange={setR} min={0.001} max={10000} decimals />
        <NumField label={L("1 Coin = so'm", '1 Coin = so‘m')} value={s} onChange={setS} max={100000} decimals />
      </div>
      {r !== null && r > 0 && (
        <ul className="admin-preview-list">
          {auto.map((p) => (
            <li key={p.id}>
              🪙 {coins(p.coins + p.bonus_coins)}: ⭐ {p.stars} → <strong>⭐ {A.starsFor(p.coins + p.bonus_coins, r)}</strong>
            </li>
          ))}
          <li className="muted small">{L("Qo'lda belgilangan narxlar o'zgarmaydi", 'Manual prices stay as they are')}</li>
        </ul>
      )}
    </EditDialog>
  );
}

function BoardEditor({ board, onClose, onSaved }: { board: A.AdminBoard; onClose: () => void; onSaved: () => Promise<void> }) {
  const L = useL();
  const [price, setPrice] = useState<number | null>(board.price);
  const [supply, setSupply] = useState<number | null>(board.supply);
  const supplyLocked = board.supply !== null;
  const supplyErr = !supplyLocked && supply !== null && supply < Math.max(1, board.sold) ? `≥ ${Math.max(1, board.sold)}` : null;
  return (
    <EditDialog
      title={board.name}
      valid={price !== null && !supplyErr}
      onClose={onClose}
      onSave={async (r) => {
        await A.adminBoardSave(board.slug, price!, supplyLocked ? board.supply : supply, r);
        await onSaved();
      }}
    >
      <p className="muted small">
        {L('Hozirgi narx', 'Current price')}: 🪙 {coins(board.price)} · {L('Sotilgan', 'Sold')}: {board.sold}
      </p>
      <div className="admin-grid2">
        <NumField label={L('Narx (Coin)', 'Price (Coins)')} value={price} onChange={setPrice} />
        <NumField
          label={L('Nusxalar limiti', 'Copies limit')}
          value={supply}
          onChange={setSupply}
          min={1}
          max={100000}
          disabled={supplyLocked}
          error={supplyErr}
          hint={supplyLocked ? L("Limit belgilangan — o'zgartirib bo'lmaydi", 'Limit is final') : L("Bir marta belgilanadi, keyin o'zgarmaydi", 'Set once, final afterwards')}
        />
      </div>
    </EditDialog>
  );
}

function FrameEditor({ frame, onClose, onSaved }: { frame: A.AdminFrame; onClose: () => void; onSaved: () => Promise<void> }) {
  const L = useL();
  const [price, setPrice] = useState<number | null>(frame.price);
  const [active, setActive] = useState(frame.active);
  return (
    <EditDialog
      title={frame.name_en}
      valid={price !== null}
      onClose={onClose}
      onSave={async (r) => {
        await A.adminFrameSave(frame.slug, price!, active, r);
        await onSaved();
      }}
    >
      <p className="muted small">
        {L('Hozirgi narx', 'Current price')}: 🪙 {coins(frame.price)} · {L('Egalari', 'Owners')}: {frame.owners}
      </p>
      <NumField label={L('Narx (Coin)', 'Price (Coins)')} value={price} onChange={setPrice} />
      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {L("Do'konda ko'rinsin", 'Show in the shop')}
      </label>
    </EditDialog>
  );
}

function BoardOwners({ board, onClose }: { board: A.AdminBoard; onClose: () => void }) {
  const L = useL();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof A.adminBoardOwners>> | null>(null);
  useEffect(() => {
    A.adminBoardOwners(board.slug).then(setRows, () => setRows([]));
  }, [board.slug]);
  return (
    <Modal open onClose={onClose} title={`${board.name} — ${L('egalar', 'owners')}`}>
      {!rows ? (
        <Spinner />
      ) : (
        <ul className="admin-list">
          {rows.map((o) => (
            <li key={o.serial} className="admin-row admin-row-static">
              <span className="admin-row-main">
                <strong>
                  {serialLabel(o.serial, board.supply)} · {o.username}
                </strong>
                <span className="muted small">
                  {when(o.acquired_at)} · 🪙 {coins(o.price_paid)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ reports */
function ReportsTab({ canManage }: { canManage: boolean }) {
  const L = useL();
  const [status, setStatus] = useState<string | null>('open');
  const [rows, setRows] = useState<A.Report[] | null>(null);
  const [act, setAct] = useState<null | { r: A.Report; to: string }>(null);
  const load = useCallback(() => A.adminReports(status).then(setRows), [status]);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);
  return (
    <div className="admin-section">
      <div className="chip-tabs chip-tabs-sm">
        {['open', 'in_review', 'resolved', 'rejected', null].map((s) => (
          <button key={s ?? 'all'} className={`chip-tab ${status === s ? 'chip-tab-on' : ''}`} onClick={() => setStatus(s)}>
            {s ?? L('Hammasi', 'All')}
          </button>
        ))}
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={L("Shikoyatlar yo'q", 'No reports')} />
      ) : (
        <ul className="admin-list">
          {rows.map((r) => (
            <li key={r.id} className="admin-row admin-row-static admin-report">
              <span className="admin-row-main">
                <strong>
                  {r.kind} · {r.reporter ?? '—'}
                  {r.target ? ` → ${r.target}` : ''}
                </strong>
                <span>{r.body}</span>
                <span className="muted small">
                  {when(r.created_at)} {r.admin_note ? `· ${r.admin_note}` : ''}
                </span>
              </span>
              <span className="pay-status">{r.status}</span>
              {canManage && (
                <span className="row-actions">
                  {r.status !== 'in_review' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setAct({ r, to: 'in_review' })}>
                      {L("Ko'rib chiqilmoqda", 'In review')}
                    </button>
                  )}
                  {r.status !== 'resolved' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setAct({ r, to: 'resolved' })}>
                      {L('Hal qilindi', 'Resolved')}
                    </button>
                  )}
                  {r.status !== 'rejected' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setAct({ r, to: 'rejected' })}>
                      {L('Rad etish', 'Reject')}
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {act && <ReasonDialog title={L('Izoh', 'Note')} onClose={() => setAct(null)} onSubmit={(n) => A.adminReportUpdate(act.r.id, act.to, n).then(load)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ weekly tournaments */
function WeeklyTab() {
  const L = useL();
  const [rows, setRows] = useState<A.WeeklyAdmin[] | null>(null);
  const [prizes, setPrizes] = useState<A.Prize[] | null>(null);
  const [act, setAct] = useState<null | { kind: 'confirm'; t: A.WeeklyAdmin } | { kind: 'delivered'; t: A.WeeklyAdmin; user: string } | { kind: 'prizes' }>(null);
  const load = useCallback(async () => {
    const [w, p] = await Promise.all([A.adminWeekly(), A.weeklyPrizes()]);
    setRows(w);
    setPrizes(p);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows || !prizes) return <Spinner />;
  return (
    <div className="admin-section">
      <div className="card">
        <div className="wk-table-head">
          <h3>{L('Sovrinlar', 'Prizes')}</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => setAct({ kind: 'prizes' })}>
            ✎ {L("O'zgartirish", 'Edit')}
          </button>
        </div>
        <ul className="ledger">
          {prizes.map((p) => (
            <li key={p.place}>
              <span className="ledger-main">
                <strong>
                  {p.place}. {p.icon} {p.title_uz}
                </strong>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {rows.map((w) => (
        <div key={w.id} className="card admin-weekly">
          <div className="wk-table-head">
            <h3>{w.name}</h3>
            <span className="muted small">
              {when(w.starts_at)} → {when(w.ends_at)} · {w.participants} {L('ishtirokchi', 'players')}
            </span>
          </div>
          <p className="small">
            {w.status === 'active' ? L('Davom etmoqda', 'Running') : w.confirmed_at ? `${L('Tasdiqlangan', 'Confirmed')}: ${w.confirmed_by ?? ''} · ${when(w.confirmed_at)}` : L('Yakunlangan — tasdiqlanmagan', 'Finished — not confirmed')}
          </p>
          {w.winners.length > 0 && (
            <ul className="ledger">
              {w.winners.map((x) => (
                <li key={x.user_id}>
                  <span className="ledger-main">
                    <strong>
                      {x.rank}. {x.username} (TG {x.tg_id ?? '—'})
                    </strong>
                    <span className="muted small">
                      {x.delta > 0 ? '+' : ''}
                      {x.delta} · {x.games} {L("o'yin", 'games')} · {x.prize_status ?? L('kutilmoqda', 'pending')}
                    </span>
                  </span>
                  {x.prize_status === 'confirmed' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setAct({ kind: 'delivered', t: w, user: x.user_id })}>
                      {L('Yuborildi', 'Delivered')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {w.status === 'finished' && !w.confirmed_at && (
            <button className="btn btn-primary btn-sm" onClick={() => setAct({ kind: 'confirm', t: w })}>
              <LuCheck /> {L("G'oliblarni tasdiqlash", 'Confirm winners')}
            </button>
          )}
        </div>
      ))}
      {act?.kind === 'confirm' && <ReasonDialog title={L("G'oliblarni tasdiqlash", 'Confirm winners')} onClose={() => setAct(null)} onSubmit={(r) => A.adminWeeklyConfirm(act.t.id, r).then(load)} />}
      {act?.kind === 'delivered' && <ReasonDialog title={L('Sovrin yuborildi', 'Prize delivered')} onClose={() => setAct(null)} onSubmit={(r) => A.adminWeeklyDelivered(act.t.id, act.user, r).then(load)} />}
      {act?.kind === 'prizes' && <PrizesEditor prizes={prizes} onClose={() => setAct(null)} onSaved={load} />}
    </div>
  );
}
function PrizesEditor({ prizes, onClose, onSaved }: { prizes: A.Prize[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const L = useL();
  const [p, setP] = useState(prizes.map((x) => ({ ...x })));
  const upd = (i: number, k: keyof A.Prize, v: string) => setP((cur) => cur.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <ReasonDialog title={L('Sovrinlar', 'Prizes')} onClose={onClose} onSubmit={(r) => A.adminPrizesSave(p, r).then(onSaved)}>
      {p.map((x, i) => (
        <div key={x.place} className="admin-grid3">
          <label className="field">
            <span>{x.place}</span>
            <input value={x.icon} maxLength={4} onChange={(e: any) => upd(i, 'icon', e.target.value)} />
          </label>
          <label className="field">
            <span>uz</span>
            <input value={x.title_uz} onChange={(e: any) => upd(i, 'title_uz', e.target.value)} />
          </label>
          <label className="field">
            <span>en</span>
            <input value={x.title_en} onChange={(e: any) => upd(i, 'title_en', e.target.value)} />
          </label>
        </div>
      ))}
    </ReasonDialog>
  );
}

/* ------------------------------------------------------------------ roles */
function RolesTab() {
  const L = useL();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof A.adminRoles>> | null>(null);
  const load = useCallback(() => A.adminRoles().then(setRows), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="admin-section">
      <p className="muted small">
        {L(
          "Super Admin Telegram ID 7550418397 ga bog'langan va o'zgartirib bo'lmaydi. Boshqa rollarni berish uchun Foydalanuvchilar bo'limida o'yinchini oching → \"Rol berish\".",
          'The Super Admin is bound to Telegram ID 7550418397 and cannot be changed. To grant other roles open a player in Users → "Set role".',
        )}
      </p>
      {!rows ? (
        <Spinner />
      ) : (
        <ul className="admin-list">
          {rows.filter((r) => r.role).map((r) => (
            <li key={r.user_id} className="admin-row admin-row-static">
              <span className="admin-row-main">
                <strong>{r.username}</strong>
                <span className="muted small">
                  TG {r.tg_id ?? '—'} · {r.granted_by ? `${L('bergan', 'by')} ${r.granted_by} · ` : ''}
                  {when(r.granted_at)}
                </span>
              </span>
              <span className="badge">{r.role ? ROLE_LABEL[r.role][0] : '—'}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="card small">
        <strong>{L('Huquqlar', 'Permissions')}</strong>
        <ul>
          <li>Super Admin — {L('hammasi + rollarni boshqarish', 'everything + role management')}</li>
          <li>Admin — {L("foydalanuvchilar, balans, to'lovlar/refund, do'kon, turnirlar, shikoyatlar, chat, audit", 'users, balances, payments/refunds, shop, tournaments, reports, chat, audit')}</li>
          <li>Moderator — {L('bloklash, chat cheklovi, shikoyatlar', 'restrictions, chat mutes, reports')}</li>
          <li>Support — {L("ko'rish: foydalanuvchilar, balans, to'lovlar, shikoyatlar", 'read-only: users, balances, payments, reports')}</li>
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ audit */
function AuditTab() {
  const L = useL();
  const [rows, setRows] = useState<A.AuditRow[] | null>(null);
  const [filter, setFilter] = useState('');
  const load = useCallback(async (offset = 0) => {
    const r = await A.adminAudit(offset, filter || null);
    setRows((cur) => (offset ? [...(cur ?? []), ...r] : r));
  }, [filter]);
  useEffect(() => {
    const id = setTimeout(() => void load(0), 300);
    return () => clearTimeout(id);
  }, [load]);
  return (
    <div className="admin-section">
      <div className="row-actions">
        <label className="search">
          <LuSearch />
          <input value={filter} onChange={(e: any) => setFilter(e.target.value)} placeholder="wallet. / user. / payment. / shop." />
        </label>
        <button className="btn btn-ghost btn-sm" onClick={() => load(0)} aria-label="refresh">
          <LuRefreshCw />
        </button>
      </div>
      {!rows ? (
        <Spinner />
      ) : (
        <ul className="admin-list">
          {rows.map((r) => (
            <li key={r.id} className="admin-row admin-row-static">
              <span className="admin-row-main">
                <strong>
                  {r.action} {r.target_type ? `· ${r.target_type}` : ''}
                </strong>
                <span className="muted small">
                  {r.admin ?? 'system'} · {when(r.created_at)} {r.reason ? `· "${r.reason}"` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length > 0 && rows.length < rows[0].total && (
        <button className="btn btn-ghost btn-block" onClick={() => load(rows.length)}>
          {L("Ko'proq", 'More')}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ virtual opponents */
const VLEVELS: Array<['beginner' | 'normal' | 'pro', string, string]> = [
  ['beginner', "Boshlang'ich", 'Beginner'],
  ['normal', "O'rta", 'Normal'],
  ['pro', 'Pro', 'Pro'],
];
function VirtualTab() {
  const L = useL();
  const [data, setData] = useState<A.VirtualOverview | null>(null);
  const [err, setErr] = useState(false);
  const [dlg, setDlg] = useState<null | { title: string; run: (reason: string) => Promise<unknown>; body?: ReactNode; danger?: boolean }>(null);
  const [form, setForm] = useState({ off: '', on: '', pool: '' });
  const load = useCallback(
    () =>
      A.adminVirtual().then(
        (d) => {
          setData(d);
          setForm({ off: String(d.settings.auto_off_threshold), on: String(d.settings.auto_on_threshold), pool: String(d.settings.pool_size) });
        },
        () => setErr(true),
      ),
    [],
  );
  useEffect(() => void load(), [load]);
  if (err) return <ErrorState onRetry={() => { setErr(false); void load(); }} />;
  if (!data) return <Spinner />;
  const st = data.settings;
  const total = data.players.reduce((a, p) => ({ w: a.w + p.wins, l: a.l + p.losses, d: a.d + p.draws }), { w: 0, l: 0, d: 0 });
  const ask = (title: string, run: (reason: string) => Promise<unknown>, danger = false, body?: ReactNode) => setDlg({ title, run: async (r) => { await run(r); await load(); }, danger, body });
  return (
    <div className="admin-stack">
      <section className="card admin-form">
        <div className="vadm-head">
          <div>
            <strong>{L('Virtual raqiblar', 'Virtual opponents')}</strong>
            <p className="muted small">
              {data.active_now ? L('Hozir faol: raqib topilmasa 20–35 soniyada virtual raqib chiqadi.', 'Active now: when nobody is found, a virtual opponent appears after 20–35 s.') : L("Hozir o'chiq: o'yinchilar faqat haqiqiy raqib kutadi.", 'Off right now: players only wait for real opponents.')}
            </p>
          </div>
          <span className={`pay-status ${data.active_now ? 'pay-paid' : ''}`}>{data.active_now ? L('Faol', 'On') : L("O'chiq", 'Off')}</span>
        </div>
        <div className="admin-kpis">
          <span><strong>{data.online_real}</strong> {L('haqiqiy onlayn (5 daq)', 'real players online (5 min)')}</span>
          <span><strong>{data.live_games}</strong> {L("hozir o'ynalayotgan", 'games now')}</span>
          <span><strong>{total.w}</strong> {L("botlar yutgan", 'bot wins')} · <strong>{total.l}</strong> {L("yutqazgan", 'losses')} · <strong>{total.d}</strong> {L('durang', 'draws')}</span>
        </div>
        <div className="row-actions">
          <button className={`btn ${st.enabled ? 'btn-danger' : 'btn-primary'}`} onClick={() => ask(st.enabled ? L("Barcha virtual raqiblarni o'chirish", 'Switch all virtual opponents off') : L('Virtual raqiblarni yoqish', 'Switch virtual opponents on'), (r) => A.adminVirtualSettings2({ enabled: !st.enabled }, r), st.enabled)}>
            <LuBot /> {st.enabled ? L("Hammasini o'chirish", 'Switch all off') : L('Yoqish', 'Switch on')}
          </button>
        </div>
        <label className="vadm-auto">
          <input type="checkbox" checked={st.auto_off} onChange={() => ask(st.auto_off ? L("Avto-o'chirishni bekor qilish", 'Disable auto-off') : L("Avto-o'chirishni yoqish", 'Enable auto-off'), (r) => A.adminVirtualSettings2({ autoOff: !st.auto_off }, r))} />{' '}
          <span>{L("Haqiqiy o'yinchilar ko'p bo'lsa avtomatik o'chsin", 'Switch off automatically when enough real players are online')}</span>
        </label>
        <div className="vadm-threshold">
          <label className="field">
            <span>{L("O'chadi: onlayn ko'proq bo'lsa", 'Off when online above')}</span>
            <input type="number" min={1} max={100000} value={form.off} onChange={(e: any) => setForm({ ...form, off: e.target.value })} />
          </label>
          <label className="field">
            <span>{L('Qayta yonadi: onlayn kamroq bo\'lsa', 'Back on when online below')}</span>
            <input type="number" min={0} max={100000} value={form.on} onChange={(e: any) => setForm({ ...form, on: e.target.value })} />
          </label>
          <label className="field">
            <span>{L('Bir vaqtda tayyor botlar', 'Bots on duty at once')}</span>
            <input type="number" min={1} max={12} value={form.pool} onChange={(e: any) => setForm({ ...form, pool: e.target.value })} />
          </label>
          <button
            className="btn btn-secondary btn-sm"
            disabled={
              !Number(form.off) || !Number(form.pool) || Number(form.on) > Number(form.off) ||
              (Number(form.off) === st.auto_off_threshold && Number(form.on) === st.auto_on_threshold && Number(form.pool) === st.pool_size)
            }
            onClick={() => ask(L('Sozlamalarni saqlash', 'Save settings'), (r) => A.adminVirtualSettings2({ off: Number(form.off), on: Number(form.on), pool: Number(form.pool) }, r))}
          >
            <LuCheck /> {L('Saqlash', 'Save')}
          </button>
        </div>
        <p className="muted small">
          {st.auto_off
            ? L(`Avto rejim: onlayn ${st.auto_off_threshold} dan oshsa o'chadi, ${st.auto_on_threshold} dan kamaysa qayta yonadi. Hozir: ${st.auto_state ? 'yoqiq' : "o'chiq"}.`,
                `Auto: off above ${st.auto_off_threshold} online, back on below ${st.auto_on_threshold}. Now: ${st.auto_state ? 'on' : 'off'}.`)
            : L('Avto rejim o\'chiq: faqat yuqoridagi tugma boshqaradi.', 'Auto mode off: only the switch above controls them.')}
        </p>
      </section>
      <ul className="admin-list">
        {data.players.map((p) => (
          <li key={p.id} className="admin-row admin-row-static vadm-row">
            <Avatar name={p.nickname} seed={p.avatar} size={40} />
            <span className="admin-row-main">
              <strong>
                {p.nickname} <span className="ai-badge">AI</span> {!p.enabled && <span className="pay-status">{L("o'chiq", 'off')}</span>}
                {data.on_duty.includes(p.id) && <span className="pay-status pay-paid">{L('navbatda', 'on duty')}</span>}
              </strong>
              <span className="muted small">
                {p.rating} · {p.wins}{L('G', 'W')} {p.losses}{L('M', 'L')} {p.draws}{L('D', 'D')} · {L('bugun', 'today')} {p.games_today} · {p.style}
                {p.playing > 0 ? ` · ${L("o'ynayapti", 'playing')}` : ''}
              </span>
            </span>
            <span className="vadm-actions">
              <select
                value={p.level}
                aria-label={L('Kuch darajasi', 'Strength')}
                onChange={(e: any) => {
                  const lvl = e.target.value;
                  ask(`${p.nickname}: ${L('kuch darajasi', 'strength')} → ${L(...(VLEVELS.find((x) => x[0] === lvl)!.slice(1) as [string, string]))}`, (r) => A.adminVirtualSave(p.id, null, lvl, r));
                }}
              >
                {VLEVELS.map(([v, uz, en]) => (
                  <option key={v} value={v}>{L(uz, en)}</option>
                ))}
              </select>
              <button className={`btn btn-sm ${p.enabled ? 'btn-ghost' : 'btn-primary'}`} onClick={() => ask(`${p.nickname}: ${p.enabled ? L("o'chirish", 'switch off') : L('yoqish', 'switch on')}`, (r) => A.adminVirtualSave(p.id, !p.enabled, null, r), p.enabled)}>
                {p.enabled ? L("O'chirish", 'Off') : L('Yoqish', 'On')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {dlg && (
        <ReasonDialog title={dlg.title} onSubmit={dlg.run} onClose={() => setDlg(null)} danger={dlg.danger}>
          {dlg.body}
        </ReasonDialog>
      )}
    </div>
  );
}
