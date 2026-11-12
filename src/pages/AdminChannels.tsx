import { useCallback, useEffect, useState } from 'react';
import { LuCheck, LuLoader, LuPencil, LuPlus, LuRefreshCw, LuSearch, LuTrash2, LuTriangleAlert } from 'react-icons/lu';
import { Modal } from '../components/Modal.tsx';
import { Spinner, ErrorState } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n/index.tsx';
import { adminChannelDelete, adminChannelProbe, adminChannels, adminChannelSave, type AdminChannel, type ChannelProbe } from '../services/missions.ts';
import { SbError } from '../services/supabase.ts';

const MAX_ACTIVE = 3;
function useL() {
  const { lang } = useI18n();
  return useCallback((uz: string, en: string) => (lang === 'uz' ? uz : en), [lang]);
}
const ERR: Record<string, [string, string]> = {
  'too many active': ["Bir vaqtda ko'pi bilan 3 ta faol kanal bo'lishi mumkin.", 'At most 3 channels can be active at a time.'],
  'duplicate chat': ["Bu kanal allaqachon qo'shilgan.", 'This channel is already added.'],
  'bad chat': ["Kanal @username yoki -100… ID ko'rinishida bo'lsin.", 'Use @username or a -100… id.'],
  'bad reward': ["Mukofot 1 dan 10 000 gacha bo'lsin.", 'Reward must be 1–10,000.'],
  'bad title': ['Kanal nomini kiriting.', 'Enter the channel name.'],
  'bad username': ["Username noto'g'ri.", 'Invalid username.'],
  'bad link': ['Havola https://t.me/ bilan boshlansin.', 'The link must start with https://t.me/.'],
  'need link': ["Yopiq kanal uchun taklif havolasini kiriting (yoki botni admin qilib «Tekshirish»ni bosing).", 'A private channel needs an invite link (or make the bot admin and press “Check”).'],
  'reason required': ['Sabab yozing.', 'Enter a reason.'],
};

/** Admin → "Telegram kanallar": channel subscription missions (max 3 active), each with its own coin reward. */
export function ChannelsTab() {
  const L = useL();
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminChannel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState<AdminChannel | 'new' | null>(null);
  const [del, setDel] = useState<AdminChannel | null>(null);
  const [checking, setChecking] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await adminChannels());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  // re-check the bot's rights in every channel when the section opens
  const recheck = useCallback(async (list: AdminChannel[]) => {
    for (const c of list) {
      setChecking(c.id);
      try {
        await adminChannelProbe(c.chat_id, c.id);
      } catch {
        /* shown as unknown */
      }
    }
    setChecking(null);
    void load();
  }, [load]);
  useEffect(() => {
    void (async () => {
      try {
        const r = await adminChannels();
        setRows(r);
        if (r.length) void recheck(r);
      } catch {
        setFailed(true);
      }
    })();
  }, [recheck]);

  if (failed && !rows) return <ErrorState onRetry={load} />;
  if (!rows) return <Spinner />;
  const active = rows.filter((r) => r.active).length;

  return (
    <div className="admin-section">
      <div className="card">
        <div className="wk-table-head">
          <h3>{L('Telegram kanallar', 'Telegram channels')}</h3>
          <span className="muted small">
            {L('Faol', 'Active')}: {active}/{MAX_ACTIVE}
          </span>
        </div>
        <p className="muted small">
          {L(
            "Har bir kanal alohida bir martalik topshiriq. O'yinchi obuna bo'ladi, bot getChatMember orqali tekshiradi, o'yinchi «Olish»ni bosganda coin beriladi. Bot har bir kanalda administrator bo'lishi shart.",
            'Each channel is a separate one-time mission. The player subscribes, the bot verifies with getChatMember, and coins are paid when the player presses “Claim”. The bot must be an administrator in every channel.',
          )}
        </p>
        <div className="row-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}>
            <LuPlus /> {L("Kanal qo'shish", 'Add channel')}
          </button>
          {rows.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => void recheck(rows)} disabled={checking !== null}>
              <LuRefreshCw className={checking !== null ? 'spin' : ''} /> {L('Botni qayta tekshirish', 'Re-check bot')}
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 && <p className="card muted">{L("Hali kanal qo'shilmagan.", 'No channels yet.')}</p>}
      {rows.map((c) => (
        <div key={c.id} className={`card adm-ch ${c.active ? 'is-active' : ''}`}>
          <div className="adm-ch-top">
            <span className="adm-ch-name">
              <strong>{c.title}</strong>
              <span className="muted small">
                {c.username ? `@${c.username}` : c.chat_id} {c.username && c.chat_id !== `@${c.username}` ? `· ${c.chat_id}` : ''}
              </span>
            </span>
            <span className={`badge ${c.active ? 'badge-free' : ''}`}>{c.active ? L('Faol', 'Active') : L('Nofaol', 'Inactive')}</span>
          </div>
          <ul className="adm-ch-stats">
            <li>
              <span className="muted small">{L('Mukofot', 'Reward')}</span>
              <strong>🪙 {c.reward}</strong>
            </li>
            <li>
              <span className="muted small">{L('Mukofot olganlar', 'Rewarded users')}</span>
              <strong>{c.rewarded}</strong>
            </li>
            <li>
              <span className="muted small">{L("Jami to'langan", 'Coins paid')}</span>
              <strong>🪙 {c.coins_paid}</strong>
            </li>
          </ul>
          {checking === c.id ? (
            <p className="small muted">
              <LuLoader className="spin" /> {L('Bot huquqlari tekshirilmoqda…', 'Checking bot rights…')}
            </p>
          ) : c.bot_ok === false ? (
            <p className="adm-ch-warn">
              <LuTriangleAlert /> {L("Bot bu kanalda administrator emas — obunani tekshira olmaydi! Botni kanalga admin qiling.", 'The bot is not an administrator here — it cannot verify subscriptions! Make the bot an admin.')}{' '}
              <span className="muted small">({c.bot_status})</span>
            </p>
          ) : c.bot_ok ? (
            <p className="adm-ch-ok small">
              <LuCheck /> {L('Bot administrator — obuna tekshiriladi', 'Bot is an administrator — subscriptions can be verified')}
            </p>
          ) : null}
          <div className="row-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setEdit(c)}>
              <LuPencil /> {L('Tahrirlash', 'Edit')}
            </button>
            <button className="btn btn-ghost btn-sm adm-danger" onClick={() => setDel(c)}>
              <LuTrash2 /> {L("O'chirish", 'Delete')}
            </button>
          </div>
        </div>
      ))}

      {edit && (
        <EditDialog
          c={edit === 'new' ? null : edit}
          canActivate={edit !== 'new' && edit.active ? true : active < MAX_ACTIVE}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            toast('success', L('Saqlandi', 'Saved'));
            void adminChannels().then((r) => (setRows(r), void recheck(r)));
          }}
        />
      )}
      {del && <DeleteDialog c={del} onClose={() => setDel(null)} onDone={() => (setDel(null), toast('success', L("O'chirildi", 'Deleted')), void load())} />}
    </div>
  );
}

function EditDialog({ c, canActivate, onClose, onSaved }: { c: AdminChannel | null; canActivate: boolean; onClose: () => void; onSaved: () => void }) {
  const L = useL();
  const [chat, setChat] = useState(c?.chat_id ?? '');
  const [title, setTitle] = useState(c?.title ?? '');
  const [username, setUsername] = useState(c?.username ?? '');
  const [link, setLink] = useState(c?.invite_link ?? '');
  const [reward, setReward] = useState(String(c?.reward ?? 50));
  const [activeOn, setActiveOn] = useState(c ? c.active : canActivate);
  const [reason, setReason] = useState('');
  const [probe, setProbe] = useState<ChannelProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const doProbe = async () => {
    setProbing(true);
    setErr('');
    try {
      const p = await adminChannelProbe(chat, c?.id);
      setProbe(p);
      if (p.found) {
        setChat(p.chat_id ?? chat);
        if (p.title) setTitle(p.title);
        setUsername(p.username ?? '');
        if (!p.username && p.invite_link) setLink(p.invite_link);
      }
    } catch {
      setProbe({ ok: false, found: false, error: 'network' });
    } finally {
      setProbing(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await adminChannelSave({ id: c?.id ?? null, chat_id: chat.trim(), title: title.trim(), username: username.trim(), invite_link: link.trim(), reward: Number(reward), active: activeOn }, reason.trim());
      onSaved();
    } catch (e) {
      const m = e instanceof SbError ? e.message : String(e);
      const k = Object.keys(ERR).find((x) => m.includes(x));
      setErr(k ? L(...ERR[k]) : m);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={c ? L('Kanalni tahrirlash', 'Edit channel') : L("Kanal qo'shish", 'Add channel')} locked={busy}>
      <div className="admin-form">
        <label className="field">
          <span>{L('Kanal: @username yoki ID (-100…)', 'Channel: @username or id (-100…)')}</span>
          <span className="adm-ch-probe">
            <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="@Dameo_channel" />
            <button className="btn btn-secondary btn-sm" onClick={doProbe} disabled={probing || !chat.trim()}>
              {probing ? <LuLoader className="spin" /> : <LuSearch />} {L('Tekshirish', 'Check')}
            </button>
          </span>
        </label>
        {probe && !probe.found && <p className="adm-ch-warn small">{L('Kanal topilmadi yoki bot unga kira olmaydi.', 'Channel not found or the bot cannot access it.')} {probe.error}</p>}
        {probe?.found && (probe.bot_admin ? (
          <p className="adm-ch-ok small">
            <LuCheck /> {probe.title} — {L('bot administrator', 'bot is an administrator')}
          </p>
        ) : (
          <p className="adm-ch-warn small">
            <LuTriangleAlert /> {probe.title} — {L('bot administrator EMAS. Obunani tekshirish uchun botni kanalga admin qiling.', 'bot is NOT an administrator. Make it an admin to verify subscriptions.')}
          </p>
        ))}
        <label className="field">
          <span>{L('Kanal nomi', 'Channel name')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={128} />
        </label>
        <label className="field">
          <span>{L('Ochiq username (ixtiyoriy)', 'Public username (optional)')}</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Dameo_channel" />
        </label>
        <label className="field">
          <span>{L('Taklif havolasi (yopiq kanal uchun)', 'Invite link (private channel)')}</span>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://t.me/+…" />
        </label>
        <label className="field">
          <span>{L('Mukofot (coin)', 'Reward (coins)')}</span>
          <input type="number" min={1} max={10000} value={reward} onChange={(e) => setReward(e.target.value)} />
        </label>
        <label className="adm-ch-toggle">
          <input type="checkbox" checked={activeOn} disabled={!activeOn && !canActivate} onChange={(e) => setActiveOn(e.target.checked)} />
          <span>
            {L('Faol (o‘yinchilarga ko‘rinadi)', 'Active (visible to players)')}
            {!canActivate && !activeOn && <span className="muted small"> — {L('3 ta faol kanal bor', '3 channels already active')}</span>}
          </span>
        </label>
        <label className="field">
          <span>{L('Sabab (majburiy)', 'Reason (required)')}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </label>
        {err && <p className="adm-ch-warn small">{err}</p>}
        <div className="row-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {L('Bekor qilish', 'Cancel')}
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !reason.trim() || !chat.trim() || !title.trim()}>
            {busy ? <LuLoader className="spin" /> : <LuCheck />} {L('Saqlash', 'Save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteDialog({ c, onClose, onDone }: { c: AdminChannel; onClose: () => void; onDone: () => void }) {
  const L = useL();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true);
    try {
      await adminChannelDelete(c.id, reason.trim());
      onDone();
    } catch (e) {
      setErr(e instanceof SbError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={L("Kanalni o'chirish", 'Delete channel')} locked={busy}>
      <div className="admin-form">
        <p>
          <strong>{c.title}</strong> {L(
            "DAMEO topshiriqlaridan olib tashlanadi. Telegram kanalning o'zi o'chmaydi; berilgan coinlar va topshiriq tarixi saqlanib qoladi.",
            'will be removed from DAMEO missions. The Telegram channel itself is not deleted; paid coins and mission history are kept.',
          )}
        </p>
        <label className="field">
          <span>{L('Sabab (majburiy)', 'Reason (required)')}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </label>
        {err && <p className="adm-ch-warn small">{err}</p>}
        <div className="row-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {L('Bekor qilish', 'Cancel')}
          </button>
          <button className="btn btn-danger" onClick={go} disabled={busy || !reason.trim()}>
            {busy ? <LuLoader className="spin" /> : <LuTrash2 />} {L("O'chirish", 'Delete')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
