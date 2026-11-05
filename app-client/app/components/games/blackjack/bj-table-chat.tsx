"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FaChevronDown } from "react-icons/fa6";
import { ChatComposer } from "@/app/components/chat/chat-composer";
import { MessageMenu } from "@/app/components/chat/message-menu";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { RichText, type Emoji } from "@/app/components/common/rich-text";
import { apiErrorCode, apiFetch } from "@/app/lib/api";
import { normalizeChatChannel, normalizeChatMessage } from "@/app/lib/normalizers";
import { parseSticker } from "@/app/lib/stickers";
import type { ChatChannel, ChatMessage } from "@/app/lib/types";
import { getChatWsUrl } from "@/app/lib/ws";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import chat from "@/app/components/chat/chat.module.scss";
import styles from "@/app/components/games/blackjack/bj-table-chat.module.scss";

// A table's chat. It's an ordinary chat room (table:blackjack-low, api/src/chatDb.js TABLE_ROOMS)
// with a smaller face: same routes, socket and composer, and the same ⋯ menu for reports and admin
// actions, so mutes, bans, reports and rate limits all apply as they do in /chat.

const roomKeyOf = (tableKey: string) => `table:blackjack-${tableKey}`;

const GROUP_MS = 5 * 60_000;

const SEND_ERRORS: Record<string, string> = {
  chat_rate_limited: "wait a few seconds between messages",
  chat_user_muted: "you're muted",
  chat_user_banned: "you're banned from chat",
  chat_channel_locked: "this table's chat is locked",
};

function upsert(list: ChatMessage[], message: ChatMessage) {
  const index = list.findIndex((item) => item.id === message.id);
  if (index === -1) return [...list, message].sort((a, b) => a.id - b.id);
  const next = [...list];
  next[index] = message;
  return next;
}

export const TableChat = memo(function TableChat({ tableKey, seated }: { tableKey: string; seated: string[] }) {
  const roomKey = roomKeyOf(tableKey);
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const assets = useMarketStore((state) => state.assets);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);

  const [channel, setChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  // Below the desktop layout this block starts closed and says how many came in.
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  // Each new socket bumps this, which reloads the messages: anything said while it was down.
  const [connection, setConnection] = useState(0);
  const [restrictionRevision, setRestrictionRevision] = useState(0);

  const viewport = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ channel: Record<string, unknown>; messages: Array<Record<string, unknown>> }>(`/api/chat/channels/${encodeURIComponent(roomKey)}/messages?limit=50`)
      .then((page) => {
        if (cancelled) return;
        setChannel(normalizeChatChannel(page.channel));
        setMessages((page.messages || []).map(normalizeChatMessage));
        setLoadError(null);
      })
      .catch((reason) => !cancelled && setLoadError(String((reason as Error).message || reason)));
    return () => {
      cancelled = true;
    };
  }, [connection, roomKey, viewerId]);

  // An admin muted, banned or lifted the viewer: the composer has to say so.
  useEffect(() => {
    if (!restrictionRevision) return;
    let cancelled = false;
    apiFetch<{ channel: Record<string, unknown> }>(`/api/chat/channels/${encodeURIComponent(roomKey)}`)
      .then((raw) => !cancelled && setChannel(normalizeChatChannel(raw.channel)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [restrictionRevision, roomKey]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ emojis: Array<Record<string, unknown>> }>("/api/assets/emojis")
      .then((raw) => !cancelled && setEmojis((raw.emojis || []).map((item) => ({ id: Number(item.id || 0), name: String(item.name || ""), filename: String(item.filename || ""), url: String(item.url || "") }))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates, on the chat socket like /chat. Only this room's events arrive on it.
  useEffect(() => {
    let disposed = false;
    let retry: number | null = null;
    let socket: WebSocket | null = null;
    let opened = false;
    const connect = () => {
      const url = getChatWsUrl();
      if (!url || disposed) return;
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "subscribe", channel_keys: [roomKey] }));
        if (opened) setConnection((value) => value + 1);
        opened = true;
      };
      ws.onmessage = (event) => {
        let payload: { type?: string; channel_key?: string; message?: Record<string, unknown>; channel?: Record<string, unknown>; user_id?: number };
        try {
          payload = JSON.parse(String(event.data || ""));
        } catch {
          return;
        }
        if ((payload.type === "chat.message.created" || payload.type === "chat.message.updated") && payload.message && payload.channel_key === roomKey) {
          const message = normalizeChatMessage(payload.message);
          setMessages((current) => upsert(current, message));
          const hidden = !viewport.current?.clientHeight;
          // By author id: is_mine on a pushed message describes the sender, whoever receives it.
          if (payload.type === "chat.message.created" && message.author?.id !== viewerId && (hidden || !atBottom.current)) setUnseen((count) => count + 1);
        } else if (payload.type === "chat.channel.updated" && payload.channel && payload.channel_key === roomKey) {
          setChannel(normalizeChatChannel(payload.channel));
        } else if (payload.type === "chat.user.moderated" && viewerId && Number(payload.user_id) === viewerId) {
          setRestrictionRevision((value) => value + 1);
        }
      };
      ws.onclose = () => {
        if (!disposed) retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      disposed = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
    };
  }, [roomKey, viewerId]);

  // Stay on the newest message unless they've scrolled up to read. Only this list scrolls, never the page.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const onScroll = () => {
    const el = viewport.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 40;
    if (atBottom.current) setUnseen(0);
  };

  const send = useCallback(
    async (body: string) => {
      try {
        const raw = await apiFetch<{ message: Record<string, unknown> }>(`/api/chat/channels/${encodeURIComponent(roomKey)}/messages`, { method: "POST", body: JSON.stringify({ body }) });
        atBottom.current = true;
        setMessages((current) => upsert(current, normalizeChatMessage(raw.message)));
      } catch (reason) {
        throw new Error(SEND_ERRORS[apiErrorCode(reason)] ?? String((reason as Error).message || reason));
      }
    },
    [roomKey],
  );

  const restriction = channel?.chat_restriction ?? null;
  const blockedReason = !channel
    ? null
    : user?.suspension
      ? "Your account is suspended, so you can't post."
      : restriction?.type === "ban"
        ? restriction.until
          ? `You're banned from chat until ${new Date(restriction.until).toLocaleString()}.`
          : "You're banned from chat."
        : restriction?.type === "mute" || channel.muted_until
          ? restriction?.until || channel.muted_until
            ? `You're muted until ${new Date(String(restriction?.until || channel.muted_until)).toLocaleString()}.`
            : "You're muted in chat until an admin lifts it."
          : channel.posting_policy === "read_only"
            ? "This table's chat is read-only."
            : channel.posting_policy === "admins_only" && !user?.is_admin
              ? "Only admins can post here right now."
              : null;
  const canPost = Boolean(channel && user?.email_verified && !blockedReason);

  const usernames = useMemo(() => {
    const names = new Set(seated);
    for (const message of messages) if (message.author?.username) names.add(message.author.username);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [messages, seated]);

  const options = useMemo(() => ({ assets: assetMap, emoji: new Map(emojis.map((emoji) => [emoji.name.toLowerCase(), emoji])), me: user?.username ?? null }), [assetMap, emojis, user?.username]);

  return (
    <section className={styles.chat} aria-label="Table chat" data-open={open || undefined}>
      <h2 className={styles.head}>
        {/* Plain text on desktop, where it's always open; a button below that (one or the other is display: none). */}
        <span className={styles.headText}>Table chat</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            atBottom.current = true;
            setUnseen(0);
          }}
        >
          <span>Table chat</span>
          {unseen > 0 ? <em aria-label={`${unseen} new`}>{unseen > 99 ? "99+" : unseen}</em> : null}
          <FaChevronDown aria-hidden="true" />
        </button>
      </h2>
      <div className={styles.body}>
        <div className={styles.feedWrap}>
          <div className={styles.feed} ref={viewport} onScroll={onScroll}>
            {loadError ? <p className={styles.quiet}>Couldn&apos;t load the chat ({loadError}).</p> : !messages.length ? <p className={styles.quiet}>Nothing said at this table yet.</p> : null}
            {messages.map((message, index) => {
              const previous = messages[index - 1];
              const author = message.author;
              const grouped = Boolean(previous && previous.author?.id === author?.id && Date.parse(message.created_at) - Date.parse(previous.created_at) < GROUP_MS);
              const removed = message.status !== "active";
              const sticker = removed ? null : parseSticker(message.body);
              return (
                <article key={message.id} className={`${chat.msg} ${styles.row} ${grouped ? styles.rowGrouped : ""}`}>
                  <div className={chat.msgBody}>
                    {!grouped ? (
                      author ? (
                        <Link href={`/profile/${encodeURIComponent(author.username)}`} className={chat.msgName} style={author.profile_color ? { color: author.profile_color } : undefined}>
                          {author.username}
                        </Link>
                      ) : (
                        <span className={chat.msgName}>unknown</span>
                      )
                    ) : null}
                    {removed ? (
                      <p className={chat.removed}>{message.status === "moderated" ? "removed by a moderator" : "deleted"}</p>
                    ) : sticker ? (
                      <ReactionFace symbol={sticker.symbol} pose={sticker.pose} size={88} crop="full" className={styles.sticker} />
                    ) : (
                      <RichText text={message.body} options={options} className={styles.text} />
                    )}
                  </div>
                  <MessageMenu message={message} viewer={user} onUpdated={(next) => setMessages((current) => upsert(current, next))} />
                </article>
              );
            })}
          </div>
          {unseen > 0 ? (
            <button
              type="button"
              className={styles.jump}
              onClick={() => {
                const el = viewport.current;
                if (el) el.scrollTop = el.scrollHeight;
                setUnseen(0);
              }}
            >
              {unseen} new ↓
            </button>
          ) : null}
        </div>
        <div className={styles.composer}>
          <ChatComposer user={user} roomKey={roomKey} roomLabel="the table" canPost={canPost} blockedReason={blockedReason} emojis={emojis} usernames={usernames} onSend={send} />
        </div>
      </div>
    </section>
  );
});
