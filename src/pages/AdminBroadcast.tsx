import { useCallback, useEffect, useRef, useState } from 'react';
import { LuCheck, LuLoader, LuMegaphone, LuPlay, LuSend, LuSquare } from 'react-icons/lu';
import { Modal } from '../components/Modal.tsx';
import { ErrorState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { useI18n } from '../i18n/index.tsx';
import { db, SbError } from '../services/supabase.ts';

/**
 * Admin → Broadcast: one message to everyone who uses the bot (/start or Telegram sign-in).
 * Every step runs in the `broadcast` Edge Function (super admin check in SQL, bot token on the server). Sending happens
 * in batches while this page is open; if it is closed, "Davom ettirish" picks up exactly where it stopped.
 */
interface Audience { total: number; reachable: number; blocked: number; my_tg: number | null }
interface Broadcast { id: number; text: string; status: 'sending' | 'done' | 'cancelled'; total: number; sent: number; failed: number; blocked: number; remaining: number; created_at: string; finished_at: string | null; admin: string | null }

const fn = <T,>(body: object) => db.invokeFunction<T & { ok: boolean; error?: string; detail?: string }>('broadcast', body);
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const when = (s: string) => new Date(s).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Telegram-HTML preview: everything escaped, then only <b> <i> <u> <s> <code> are let back in (no attributes). */
function previewHtml(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;(\/?)(b|i|u|s|code)&gt;/g, '<$1$2>').replace(/\n/g, '<br>');
}

export function BroadcastTab() {
  const { lang } = useI18n();
  const L = (uz: string, en: string) => (lang === 'uz' ? uz : en);
  const { toast } = useToast();
  const [aud, setAud] = useState<Audience | null>(null);
  const [list, setList] = useState<Broadcast[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const [withButton, setWithButton] = useState(true);
  const [busy, setBusy] = useState<null | 'test' | 'create'>(null);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const [live, setLive] = useState<Broadcast | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([fn<Audience>({ action: 'audience' }), db.rpc<Broadcast[]>('admin_broadcast_list')]);
      setAud(a);
      setList(Array.isArray(l) ? l : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const err = (e: unknown) => {
    const code = e instanceof SbError ? e.message : '';
    toast('error', /busy/.test(code) ? L('Boshqa xabar hali yuborilmoqda', 'Another broadcast is still sending') : /no-telegram/.test(code) ? L("Akkauntingiz Telegram'ga ulanmagan", 'Your account is not linked to Telegram') : /telegram/.test(code) ? L("Telegram xabarni qabul qilmadi — formatni tekshiring", 'Telegram rejected the message — check the formatting') : L('Xatolik', 'Error'));
  };

  // send batches until done / cancelled / the page is left
  const run = async (id: number) => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const r = await fn<{ broadcast: Broadcast }>({ action: 'run', id });
        if (!alive.current) return;
        setLive(r.broadcast);
        if (r.broadcast.status !== 'sending') {
          toast('success', L(`Yuborildi: ${fmt(r.broadcast.sent)} ta`, `Sent: ${fmt(r.broadcast.sent)}`));
          break;
        }
      }
    } catch (e) {
      err(e);
    } finally {
      running.current = false;
      if (alive.current) void load();
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      await fn({ action: 'test', text, with_button: withButton });
      toast('success', L("Sinov xabari sizning Telegram'ingizga yuborildi", 'Test sent to your Telegram'));
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
  const create = async () => {
    setBusy('create');
    try {
      const r = await fn<{ id: number; total: number }>({ action: 'create', text, with_button: withButton, reason });
      setConfirm(false);
      setReason('');
      setText('');
      setLive({ id: r.id, text, status: 'sending', total: r.total, sent: 0, failed: 0, blocked: 0, remaining: r.total, created_at: new Date().toISOString(), finished_at: null, admin: null });
      void run(r.id);
    } catch (e) {
      err(e);
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (id: number) => {
    try {
      await fn({ action: 'cancel', id, reason: 'Admin to‘xtatdi' });
      toast('info', L("To'xtatildi", 'Stopped'));
      await load();
    } catch (e) {
      err(e);
    }
  };

  if (failed) return <ErrorState onRetry={load} />;
  if (!aud || !list) return <Spinner />;
  const valid = text.trim().length > 0 && text.length <= 4000;
  const pct = live && live.total ? Math.round((100 * (live.sent + live.failed + live.blocked)) / live.total) : 0;
  return (
    <div className="admin-section bc">
      <section className="card bc-aud">
        <LuMegaphone />
        <div>
          <strong>
            {L('Qabul qiluvchilar', 'Recipients')}: {fmt(aud.reachable)}
          </strong>
          <span className="muted small">
            {L("Botda /start bosgan va ilovaga Telegram orqali kirganlar", 'Everyone who pressed /start or signed in with Telegram')}
            {aud.blocked ? ` · ${L('botni bloklaganlar', 'blocked the bot')}: ${fmt(aud.blocked)}` : ''}
          </span>
        </div>
      </section>

      {live && (
        <section className="card bc-live" aria-live="polite">
          <div className="bc-live-head">
            <strong>{live.status === 'sending' ? L('Yuborilmoqda…', 'Sending…') : live.status === 'done' ? L('Yakunlandi', 'Finished') : L("To'xtatildi", 'Stopped')}</strong>
            <span>{pct}%</span>
          </div>
          <div className="bc-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="muted small">
            ✅ {fmt(live.sent)} · 🚫 {fmt(live.blocked)} · ⚠️ {fmt(live.failed)} · {L('jami', 'total')} {fmt(live.total)}
          </span>
          {live.status === 'sending' && (
            <button className="btn btn-ghost btn-sm" onClick={() => cancel(live.id)}>
              <LuSquare /> {L("To'xtatish", 'Stop')}
            </button>
          )}
        </section>
      )}

      <section className="card bc-compose">
        <h2 className="h3">{L('Yangi xabar', 'New message')}</h2>
        <label className="field">
          <span>{L('Matn', 'Text')}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} maxLength={4000} placeholder={L("Masalan: <b>DAMEO yangilandi!</b> Do'konda yangi toshlar…", 'E.g. <b>DAMEO updated!</b> New stones in the shop…')} />
          <small className="muted">
            {text.length}/4000 · {L('Format', 'Formatting')}: &lt;b&gt;{L('qalin', 'bold')}&lt;/b&gt; &lt;i&gt;{L('kursiv', 'italic')}&lt;/i&gt; &lt;u&gt; &lt;s&gt; &lt;code&gt;
          </small>
        </label>
        <label className="check">
          <input type="checkbox" checked={withButton} onChange={(e) => setWithButton(e.target.checked)} /> {L("«♟ O'yinni ochish» tugmasi", '“♟ Open the game” button')}
        </label>
        {valid && (
          <div className="bc-preview">
            <span className="muted small">{L("Ko'rinishi", 'Preview')}</span>
            <div className="bc-bubble">
              <p dangerouslySetInnerHTML={{ __html: previewHtml(text) }} />
              {withButton && <span className="bc-btn">♟ O'yinni ochish</span>}
            </div>
          </div>
        )}
        <div className="row-actions">
          <button className="btn btn-secondary" onClick={test} disabled={!valid || busy !== null || !aud.my_tg}>
            {busy === 'test' ? <LuLoader className="spin" /> : <LuCheck />} {L('Menga sinov', 'Test to me')}
          </button>
          <button className="btn btn-primary" onClick={() => setConfirm(true)} disabled={!valid || busy !== null || live?.status === 'sending'}>
            <LuSend /> {L('Hammaga yuborish', 'Send to everyone')}
          </button>
        </div>
        {!aud.my_tg && <p className="muted small">{L("Sinov uchun akkauntingiz Telegram orqali kirgan bo'lishi kerak", 'For a test your account must be signed in with Telegram')}</p>}
      </section>

      <h2 className="h3">{L('Tarix', 'History')}</h2>
      {list.length === 0 ? (
        <p className="muted small">{L("Hali xabar yuborilmagan", 'Nothing sent yet')}</p>
      ) : (
        <ul className="admin-list">
          {list.map((b) => (
            <li key={b.id} className="admin-row admin-row-static bc-row">
              <span className="admin-row-main">
                <strong className="bc-row-text">{b.text.replace(/<[^>]+>/g, '')}</strong>
                <span className="muted small">
                  {when(b.created_at)} · {b.admin ?? '—'} · ✅ {fmt(b.sent)}/{fmt(b.total)}
                  {b.blocked ? ` · 🚫 ${fmt(b.blocked)}` : ''}
                  {b.failed ? ` · ⚠️ ${fmt(b.failed)}` : ''} · {b.status === 'sending' ? L('yuborilmoqda', 'sending') : b.status === 'done' ? L('yakunlangan', 'done') : L("to'xtatilgan", 'stopped')}
                </span>
              </span>
              {b.status === 'sending' && (
                <span className="row-actions-inline">
                  <button className="btn btn-primary btn-sm" onClick={() => (setLive(b), void run(b.id))} disabled={running.current}>
                    <LuPlay /> {L('Davom ettirish', 'Resume')}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => cancel(b.id)}>
                    <LuSquare />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title={L('Hammaga yuborish', 'Send to everyone')} locked={busy !== null}>
        <div className="admin-form">
          <p>
            {L(`Xabar ${fmt(aud.reachable)} kishiga yuboriladi. Har biriga bir marta boradi, bekor qilib bo'lmaydi (faqat to'xtatish mumkin).`, `The message goes to ${fmt(aud.reachable)} people, once each. It cannot be recalled (only stopped).`)}
          </p>
          <label className="field">
            <span>{L('Sabab (majburiy)', 'Reason (required)')}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
          </label>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={create} disabled={busy !== null || reason.trim().length < 3}>
              {busy === 'create' ? <LuLoader className="spin" /> : <LuSend />} {L('Yuborish', 'Send')}
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)} disabled={busy !== null}>
              {L('Bekor qilish', 'Cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
