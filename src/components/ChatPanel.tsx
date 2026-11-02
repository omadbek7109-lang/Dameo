import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LuMessageCircle, LuSend, LuX } from 'react-icons/lu';
import { useI18n } from '../i18n/index.tsx';
import { EMOTES, type ChatMsg } from '../services/live.ts';

interface Props {
  title: string;
  messages: ChatMsg[];
  myId: string | null;
  /** names for the player chat (realtime rows carry only user ids) */
  names?: Record<string, string>;
  onSend: (kind: 'text' | 'emoji', body: string) => Promise<void>;
  /** extra controls above the input (draw / rematch offers…) */
  actions?: ReactNode;
  headerExtra?: ReactNode;
  canWrite: boolean;
  placeholder?: string;
  /** sound/notify hook for new messages from others */
  onIncoming?: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** render system rows (offers) */
  renderSystem?: (m: ChatMsg) => ReactNode;
}

/** Compact chat: a floating button with an unread badge; opens as a bottom sheet on phones, a side card on desktop. */
export function ChatPanel({ title, messages, myId, names, onSend, actions, headerExtra, canWrite, placeholder, onIncoming, open, setOpen, renderSystem }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const lastCount = useRef(messages.length);

  useEffect(() => {
    if (messages.length > lastCount.current) {
      const fresh = messages.slice(lastCount.current);
      if (fresh.some((m) => m.user_id !== myId)) onIncoming?.();
    }
    lastCount.current = messages.length;
    if (open) setSeen(messages.length);
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, open]);
  const unread = Math.max(0, messages.filter((m) => m.user_id !== myId).length - messages.slice(0, seen).filter((m) => m.user_id !== myId).length);

  const send = async (kind: 'text' | 'emoji', body: string) => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(kind, body);
      if (kind === 'text') setText('');
    } finally {
      setBusy(false);
    }
  };

  // rendered into <body>: inside a page it would share main's stacking context and sit under the footer / tab bar
  return createPortal(
    <>
      {!open && (
        <button className="chat-fab" onClick={() => setOpen(true)} aria-label={title}>
          <LuMessageCircle />
          {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
      {open && (
        <section className="chat-sheet" aria-label={title}>
          <header className="chat-head">
            <strong>{title}</strong>
            {headerExtra}
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t('common.close')}>
              <LuX />
            </button>
          </header>
          <div className="chat-list" ref={list} aria-live="polite">
            {messages.length === 0 && <p className="muted small chat-empty">{t('chat.empty')}</p>}
            {messages.map((m) =>
              m.kind === 'text' || m.kind === 'emoji' ? (
                <div key={m.id} className={`chat-msg ${m.user_id === myId ? 'chat-mine' : ''} ${m.kind === 'emoji' ? 'chat-emoji' : ''}`}>
                  {m.user_id !== myId && <span className="chat-name">{m.username ?? names?.[m.user_id] ?? ''}</span>}
                  <span className="chat-body">{m.body}</span>
                </div>
              ) : (
                <div key={m.id} className="chat-system">
                  {renderSystem?.(m)}
                </div>
              ),
            )}
          </div>
          {actions}
          {canWrite ? (
            <>
              <div className="chat-emotes" role="group" aria-label={t('chat.reactions')}>
                {EMOTES.map((e) => (
                  <button key={e} className="chat-emote" onClick={() => send('emoji', e)} disabled={busy}>
                    {e}
                  </button>
                ))}
              </div>
              <form
                className="chat-input"
                onSubmit={(e: any) => {
                  e.preventDefault();
                  void send('text', text);
                }}
              >
                <input value={text} maxLength={200} onChange={(e: any) => setText(e.target.value)} placeholder={placeholder ?? t('chat.placeholder')} aria-label={t('chat.placeholder')} />
                <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !text.trim()} aria-label={t('chat.send')}>
                  <LuSend />
                </button>
              </form>
            </>
          ) : (
            <p className="muted small chat-empty">{t('chat.readOnly')}</p>
          )}
        </section>
      )}
    </>,
    document.body,
  );
}
