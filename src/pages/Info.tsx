import { useEffect, useState } from 'react';
import { LuBan, LuCircleHelp, LuInfo, LuLoader, LuMessageSquareWarning, LuSend } from 'react-icons/lu';
import { useAuth } from '../auth/AuthProvider.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState, Spinner } from '../components/States.tsx';
import { useToast } from '../components/Toast.tsx';
import { SignInPrompt } from '../components/ui.tsx';
import { useI18n, type TKey } from '../i18n/index.tsx';
import { Link } from '../router.tsx';
import { blockedUsers, blockUser } from '../services/live.ts';
import { reportCreate } from '../services/shop.ts';
import { db, SbError } from '../services/supabase.ts';

const FAQ: Array<[TKey, TKey]> = [
  ['help.q.rules', 'help.a.rules'],
  ['help.q.rating', 'help.a.rating'],
  ['help.q.clock', 'help.a.clock'],
  ['help.q.weekly', 'help.a.weekly'],
  ['help.q.coins', 'help.a.coins'],
  ['help.q.skins', 'help.a.skins'],
  ['help.q.live', 'help.a.live'],
  ['help.q.private', 'help.a.private'],
  ['help.q.support', 'help.a.support'],
];

export function Help() {
  const { t } = useI18n();
  return (
    <div className="page page-narrow">
      <h1 className="h1">
        <LuCircleHelp /> {t('menu.help')}
      </h1>
      <div className="faq">
        {FAQ.map(([q, a]) => (
          <details key={q} className="card faq-item">
            <summary>{t(q)}</summary>
            <p className="muted">{t(a)}</p>
          </details>
        ))}
      </div>
      <p className="muted small">
        <Link to="/feedback">{t('menu.feedback')}</Link>
      </p>
    </div>
  );
}

export function About() {
  const { t } = useI18n();
  return (
    <div className="page page-narrow">
      <h1 className="h1">
        <LuInfo /> {t('menu.about')}
      </h1>
      <div className="card about">
        <p>
          <strong>DAMEO</strong> — {t('about.body')}
        </p>
        <ul className="muted small">
          <li>{t('about.rules')}</li>
          <li>{t('about.fair')}</li>
          <li>{t('about.payments')}</li>
          <li>{t('about.privacy')}</li>
        </ul>
        <p className="muted small">© {new Date().getFullYear()} DAMEO · Every Move Matters.</p>
      </div>
    </div>
  );
}

const KINDS = ['suggestion', 'bug', 'player', 'cheating', 'payment', 'other'] as const;
export function Feedback() {
  const { t, dateTime } = useI18n();
  const { me, signedIn, mode } = useAuth();
  const { toast } = useToast();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('suggestion');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Array<{ id: string; kind: string; body: string; status: string; admin_note: string | null; created_at: string }> | null>(null);
  const load = () =>
    me && db.select<any>('reports', { select: 'id,kind,body,status,admin_note,created_at', filter: { reporter_id: `eq.${me.id}` }, order: 'created_at.desc', limit: 20 }).then(setMine, () => setMine([]));
  useEffect(() => {
    if (signedIn && mode === 'live') void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, mode, me?.id]);
  if (!signedIn) return <div className="page"><SignInPrompt text={t('feedback.needAccount')} /></div>;
  const send = async () => {
    setBusy(true);
    try {
      await reportCreate(kind, body.trim());
      setBody('');
      toast('success', t('report.sent'));
      void load();
    } catch (e) {
      toast('error', t(e instanceof SbError && /too many/.test(e.message) ? 'feedback.tooMany' : 'report.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page page-narrow">
      <h1 className="h1">
        <LuMessageSquareWarning /> {t('menu.feedback')}
      </h1>
      <div className="card admin-form">
        <div className="chip-tabs chip-tabs-sm" role="radiogroup" aria-label={t('feedback.kind')}>
          {KINDS.map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={`chip-tab ${kind === k ? 'chip-tab-on' : ''}`} onClick={() => setKind(k)}>
              {t(`feedback.k.${k}` as TKey)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t('feedback.body')}</span>
          <textarea rows={4} maxLength={1000} value={body} onChange={(e: any) => setBody(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={send} disabled={busy || body.trim().length < 3}>
          {busy ? <LuLoader className="spin" /> : <LuSend />} {t('feedback.send')}
        </button>
      </div>
      <h2 className="h2">{t('feedback.mine')}</h2>
      {!mine ? (
        <Spinner />
      ) : mine.length === 0 ? (
        <p className="muted">{t('feedback.none')}</p>
      ) : (
        <ul className="ledger">
          {mine.map((r) => (
            <li key={r.id}>
              <span className="ledger-main">
                <strong>{t(`feedback.k.${r.kind}` as TKey)}</strong>
                <span className="muted small">{r.body}</span>
                {r.admin_note && <span className="small">↳ {r.admin_note}</span>}
                <span className="muted small">{dateTime(Date.parse(r.created_at))}</span>
              </span>
              <span className={`pay-status ${r.status === 'resolved' ? 'pay-paid' : ''}`}>{t(`feedback.s.${r.status}` as TKey)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Blocked() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof blockedUsers>> | null>(null);
  const load = () => blockedUsers().then(setRows, () => setRows([]));
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn]);
  if (!signedIn) return <div className="page"><SignInPrompt text={t('feedback.needAccount')} /></div>;
  return (
    <div className="page page-narrow">
      <h1 className="h1">
        <LuBan /> {t('menu.blocked')}
      </h1>
      <p className="muted">{t('blocked.sub')}</p>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={t('blocked.empty')} />
      ) : (
        <ul className="admin-list">
          {rows.map((r) => (
            <li key={r.user_id} className="admin-row admin-row-static">
              <Avatar name={r.username} seed={r.avatar} size={32} />
              <span className="admin-row-main">
                <strong>{r.username}</strong>
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  await blockUser(r.user_id, false).catch(() => toast('error', t('chat.err.generic')));
                  void load();
                }}
              >
                {t('blocked.unblock')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
