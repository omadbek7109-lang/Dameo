import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuBan, LuCheck, LuEyeOff, LuFlag, LuHandshake, LuRotateCcw, LuX } from 'react-icons/lu';
import { useI18n } from '../i18n/index.tsx';
import { navigate } from '../router.tsx';
import { blockUser, chatErrorKey, matchChatHistory, matchChatSend, respondDraw, respondRematch, watchMatchChat, type ChatMsg } from '../services/live.ts';
import { reportCreate } from '../services/shop.ts';
import { SbError } from '../services/supabase.ts';
import { playSound } from '../services/sound.ts';
import { haptic } from '../services/telegram.ts';
import { useSettings } from '../settings/SettingsProvider.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

interface Props {
  matchId: string;
  myId: string;
  opponentId: string;
  names: Record<string, string>;
  active: boolean;
}

/** Players' private chat + draw / rematch offers for a player-vs-player game. Offers stay visible even with the chat hidden. */
export function MatchChat({ matchId, myId, opponentId, names, active }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { settings, update } = useSettings();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMsgs(await matchChatHistory(matchId));
    } catch {
      /* optional */
    }
  }, [matchId]);
  useEffect(() => {
    void load();
    return watchMatchChat(matchId, (m) => {
      setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
      if (m.user_id !== myId) {
        if (m.kind === 'draw_offer' || m.kind === 'rematch_offer') {
          playSound('notify');
          haptic('move');
        }
      }
      // both players jump into the new game when a rematch is accepted
      if (m.kind === 'rematch_accept' && typeof m.data?.match_id === 'string') navigate(`/game?online=${m.data.match_id}`);
    });
  }, [matchId, myId, load]);

  // the latest open offer of each kind
  const openOffer = useCallback(
    (kind: 'draw' | 'rematch') => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.kind === `${kind}_accept` || m.kind === `${kind}_decline`) return null;
        if (m.kind === `${kind}_offer`) return m;
      }
      return null;
    },
    [msgs],
  );
  const draw = active ? openOffer('draw') : null;
  const drawFresh = draw && Date.now() - Date.parse(draw.created_at) < 2 * 60_000 ? draw : null;
  const rematch = !active ? openOffer('rematch') : null;
  const chatMsgs = useMemo(() => msgs.filter((m) => m.kind === 'text' || m.kind === 'emoji'), [msgs]);

  const answer = async (kind: 'draw' | 'rematch', accept: boolean) => {
    setBusy(true);
    try {
      if (kind === 'draw') await respondDraw(matchId, accept);
      else {
        const r = await respondRematch(matchId, accept);
        if (accept && r.match_id) navigate(`/game?online=${r.match_id}`);
      }
      await load();
    } catch (e) {
      toast('error', t(chatErrorKey(e instanceof SbError ? e.message : '')));
    } finally {
      setBusy(false);
    }
  };

  const offerBanner = (m: ChatMsg | null, kind: 'draw' | 'rematch') =>
    m ? (
      m.user_id === myId ? (
        <div className="notice offer-banner" role="status">
          {kind === 'draw' ? <LuHandshake /> : <LuRotateCcw />} <span>{t(kind === 'draw' ? 'chat.drawSent' : 'chat.rematchSent')}</span>
        </div>
      ) : (
        <div className="notice offer-banner offer-incoming" role="alert">
          {kind === 'draw' ? <LuHandshake /> : <LuRotateCcw />}
          <span>{t(kind === 'draw' ? 'chat.drawOffered' : 'chat.rematchOffered', { name: names[m.user_id] ?? '' })}</span>
          <span className="row-actions">
            <button className="btn btn-primary btn-sm" onClick={() => answer(kind, true)} disabled={busy}>
              <LuCheck /> {t('lobby.accept')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => answer(kind, false)} disabled={busy}>
              <LuX /> {t('lobby.decline')}
            </button>
          </span>
        </div>
      )
    ) : null;

  return (
    <>
      {offerBanner(drawFresh, 'draw')}
      {offerBanner(rematch, 'rematch')}
      {!settings.chatHidden && (
        <ChatPanel
          title={t('chat.matchTitle')}
          messages={chatMsgs}
          myId={myId}
          names={names}
          open={open}
          setOpen={setOpen}
          canWrite
          onIncoming={() => playSound('notify')}
          onSend={async (kind, body) => {
            try {
              await matchChatSend(matchId, kind, body);
            } catch (e) {
              toast('error', t(chatErrorKey(e instanceof SbError ? e.message : '')));
              throw e;
            }
          }}
          headerExtra={
            <span className="chat-tools">
              <button className="icon-btn" onClick={() => setConfirmBlock(true)} aria-label={t('chat.block')}>
                <LuBan />
              </button>
              <button
                className="icon-btn"
                aria-label={t('chat.report')}
                onClick={async () => {
                  try {
                    await reportCreate('chat', `In-game chat report (game ${matchId})`, opponentId, matchId);
                    toast('success', t('report.sent'));
                  } catch {
                    toast('error', t('report.failed'));
                  }
                }}
              >
                <LuFlag />
              </button>
              <button
                className="icon-btn"
                aria-label={t('chat.hide')}
                onClick={() => {
                  update({ chatHidden: true });
                  toast('info', t('chat.hiddenToast'));
                }}
              >
                <LuEyeOff />
              </button>
            </span>
          }
        />
      )}
      <Modal open={confirmBlock} onClose={() => setConfirmBlock(false)} title={t('chat.blockTitle', { name: names[opponentId] ?? '' })}>
        <p className="muted">{t('chat.blockBody')}</p>
        <div className="row-actions">
          <button
            className="btn btn-danger"
            onClick={async () => {
              setConfirmBlock(false);
              try {
                await blockUser(opponentId, true);
                toast('success', t('chat.blocked'));
                await load();
              } catch {
                toast('error', t('chat.err.generic'));
              }
            }}
          >
            <LuBan /> {t('chat.block')}
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmBlock(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </Modal>
    </>
  );
}
