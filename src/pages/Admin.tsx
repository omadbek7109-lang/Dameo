import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LuBan, LuCheck, LuChevronRight, LuCoins, LuGauge, LuHistory, LuImage, LuLoader, LuPackage, LuPlus, LuRefreshCw, LuSearch,
  LuShieldCheck, LuShoppingBag, LuTrophy, LuTriangleAlert, LuUndo2, LuUserCog, LuUsers, LuVolumeX,
} from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { Modal } from '../components/Modal.tsx';
import { MiniPreview, RarityBadge } from '../components/ShopParts.tsx';
import { EmptyState, ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n/index.tsx';
import { navigate, useRoute } from '../router.tsx';
import * as A from '../services/admin.ts';
import { coins, newKey, RARITIES, type CoinPackage, type ShopItem } from '../services/shop.ts';
import { registerSkins } from '../services/skins.ts';
import { SbError } from '../services/supabase.ts';

/* The admin panel is internal: strings live here (uz / en) instead of the main dictionaries. */
function useL() {
  const { lang } = useI18n();
  return useCallback((uz: string, en: string) => (lang === 'uz' ? uz : en), [lang]);
}
const errText = (e: unknown) => (e instanceof SbError ? e.message : e instanceof Error ? e.message : 'error');

type Tab = 'dash' | 'users' | 'payments' | 'shop' | 'packages' | 'reports' | 'weekly' | 'roles' | 'audit';
const TABS: Array<{ id: Tab; perm: string; icon: typeof LuGauge; uz: string; en: string }> = [
  { id: 'dash', perm: 'dashboard', icon: LuGauge, uz: 'Dashboard', en: 'Dashboard' },
  { id: 'users', perm: 'users.view', icon: LuUsers, uz: 'Foydalanuvchilar', en: 'Users' },
  { id: 'payments', perm: 'payments.view', icon: LuCoins, uz: "To'lovlar", en: 'Payments' },
  { id: 'shop', perm: 'shop.manage', icon: LuShoppingBag, uz: "Do'kon", en: 'Shop' },
  { id: 'packages', perm: 'shop.manage', icon: LuPackage, uz: 'Paketlar', en: 'Packages' },
  { id: 'reports', perm: 'reports.view', icon: LuTriangleAlert, uz: 'Shikoyatlar', en: 'Reports' },
  { id: 'weekly', perm: 'tournaments.manage', icon: LuTrophy, uz: 'Turnirlar', en: 'Tournaments' },
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
      {current === 'dash' && <DashboardTab />}
      {current === 'users' && <UsersTab can={can} superAdmin={me.role === 'super_admin'} />}
      {current === 'payments' && <PaymentsTab canRefund={can('payments.refund')} />}
      {current === 'shop' && <ShopTab />}
      {current === 'packages' && <PackagesTab />}
      {current === 'reports' && <ReportsTab canManage={can('reports.manage')} />}
      {current === 'weekly' && <WeeklyTab />}
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
function DashboardTab() {
  const L = useL();
  const [d, setD] = useState<A.Dashboard | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(() => A.adminDashboard().then(setD, () => setErr(true)), []);
  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
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
    <div className="admin-tiles">
      {tiles.map(([k, v]) => (
        <div key={k} className="card admin-tile">
          <span className="muted small">{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
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
      <label className="field">
        <span>{L('Miqdor', 'Amount')}</span>
        <input type="number" min={1} max={10000000} value={amount} onChange={(e: any) => setAmount(Math.max(1, Math.min(10000000, Number(e.target.value) || 0)))} />
      </label>
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
          <label className="field">
            <span>{L('Narx (Coins)', 'Price (Coins)')}</span>
            <input type="number" min={0} value={f.price ?? 0} onChange={(e: any) => set('price', Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label className="field">
            <span>{L('Chegirma %', 'Discount %')}</span>
            <input type="number" min={0} max={90} value={f.discount_percent ?? 0} onChange={(e: any) => set('discount_percent', Math.max(0, Math.min(90, Number(e.target.value) || 0)))} />
          </label>
          <label className="field">
            <span>{L('Tartib', 'Order')}</span>
            <input type="number" value={f.sort ?? 0} onChange={(e: any) => set('sort', Number(e.target.value) || 0)} />
          </label>
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
          <button className="btn btn-primary" disabled={!styleOk || !f.slug || !f.name_uz || !f.name_en} onClick={() => setSaving(true)}>
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

/* ------------------------------------------------------------------ packages */
function PackagesTab() {
  const L = useL();
  const [rows, setRows] = useState<CoinPackage[] | null>(null);
  const [edit, setEdit] = useState<CoinPackage | null>(null);
  const load = useCallback(() => A.adminPackages().then(setRows), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="admin-section">
      <p className="muted small">{L("Narxlar Telegram Stars'da. O'zgarish faqat yangi to'lovlarga ta'sir qiladi.", 'Prices are in Telegram Stars. Changes apply to new payments only.')}</p>
      <button className="btn btn-primary btn-sm" onClick={() => setEdit({ id: '', coins: 1000, bonus_coins: 0, stars: 10, active: true, sort: 10 })}>
        <LuPlus /> {L('Yangi paket', 'New package')}
      </button>
      {!rows ? (
        <Spinner />
      ) : (
        <ul className="admin-list">
          {rows.map((p) => (
            <li key={p.id}>
              <button className="admin-row" onClick={() => setEdit(p)}>
                <span className="admin-row-main">
                  <strong>
                    🪙 {coins(p.coins)} {p.bonus_coins ? `+${coins(p.bonus_coins)}` : ''} → ⭐ {p.stars}
                  </strong>
                  <span className="muted small">
                    {p.id} {p.active ? '' : `· ${L('nofaol', 'inactive')}`}
                  </span>
                </span>
                <LuChevronRight />
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <ReasonDialog title={L('Paket', 'Package')} onClose={() => setEdit(null)} onSubmit={(r) => A.adminPackageSave(edit, r).then(load)}>
          <div className="admin-grid2">
            <label className="field">
              <span>ID</span>
              <input value={edit.id} onChange={(e: any) => setEdit({ ...edit, id: e.target.value.toLowerCase() })} placeholder="coins_250k" />
            </label>
            <label className="field">
              <span>Coins</span>
              <input type="number" value={edit.coins} onChange={(e: any) => setEdit({ ...edit, coins: Number(e.target.value) || 0 })} />
            </label>
            <label className="field">
              <span>{L('Bonus coins', 'Bonus coins')}</span>
              <input type="number" value={edit.bonus_coins} onChange={(e: any) => setEdit({ ...edit, bonus_coins: Number(e.target.value) || 0 })} />
            </label>
            <label className="field">
              <span>Stars ⭐</span>
              <input type="number" value={edit.stars} onChange={(e: any) => setEdit({ ...edit, stars: Number(e.target.value) || 0 })} />
            </label>
            <label className="field">
              <span>{L('Tartib', 'Order')}</span>
              <input type="number" value={edit.sort} onChange={(e: any) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={edit.active} onChange={(e: any) => setEdit({ ...edit, active: e.target.checked })} /> {L('Faol', 'Active')}
            </label>
          </div>
        </ReasonDialog>
      )}
    </div>
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
