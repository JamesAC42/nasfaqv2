"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FaUpRightAndDownLeftFromCenter } from "react-icons/fa6";
import { ChatComposer } from "@/app/components/chat/chat-composer";
import { MessageMenu } from "@/app/components/chat/message-menu";
import { RoomNotifyButton } from "@/app/components/chat/room-notify-button";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { RichText, type Emoji, type RichOptions } from "@/app/components/common/rich-text";
import { apiFetch } from "@/app/lib/api";
import { buildRooms, postingBlockedReason, roomTag, tagFromChannel, type Room } from "@/app/lib/chat-rooms";
import { onChatSocketEvent, retainChatRooms, useChatSocketStatus } from "@/app/lib/chat-socket";
import { bottomInset, clamp, FLOAT_MARGIN, leftClearOfKeepOuts, onKeepClearChange, readOffset, saveOffset, type Offset } from "@/app/lib/floating";
import { normalizeChatChannel, normalizeChatMessage } from "@/app/lib/normalizers";
import { parseSticker } from "@/app/lib/stickers";
import type { AuthUser, ChatChannel, ChatMessage, MarketAsset } from "@/app/lib/types";
import { useReadReceipts } from "@/app/lib/use-read-receipts";
import { useAuth } from "@/app/providers/auth-provider";
import { isRoomOn, markRoomSeen, notePosted, setForegroundRoom, useChatNotifyStore } from "@/app/stores/chat-notify-store";
import { closeChatWindow, setChatWindowRoom, useChatWindowStore } from "@/app/stores/chat-window-store";
import { useMarketStore } from "@/app/stores/market-store";
import chatStyles from "@/app/components/chat/chat.module.scss";
import styles from "@/app/components/chat/chat-everywhere.module.scss";

// Read and post in one room from any page, floating like the miniplayer (stream-dock.tsx): drag it by
// the bar, it remembers where it was, and it stays inside the window and above the bottom nav. It also
// keeps off the order ticket: see place(). A phone gets a sheet above the nav instead.
//
// Heavy pages are why it's careful about rendering. It isn't mounted at all when hidden. Messages
// arrive at most four times a second however fast the room is, rows are memoized and only the newest
// HISTORY are kept, and it doesn't re-render on price ticks (ticker links need the list of stocks, not
// their prices).

const POSITION_KEY = "nasfaq.chat.window.position";
const PHONE = "(max-width: 720px)";
const HISTORY = 100;
const FIRST_PAGE = 40;
const FLUSH_MS = 250;
const GROUP_MS = 5 * 60_000;

type Page = { channel: Record<string, unknown>; messages: Array<Record<string, unknown>> };

// The emoji list doesn't change in a session; fetched once, the first time a window opens.
let emojiLoad: Promise<Emoji[]> | null = null;
function loadEmojis() {
  emojiLoad ??= apiFetch<{ emojis: Array<Record<string, unknown>> }>("/api/assets/emojis")
    .then((raw) => (raw.emojis || []).map((item) => ({ id: Number(item.id || 0), name: String(item.name || ""), filename: String(item.filename || ""), url: String(item.url || "") })))
    .catch(() => {
      emojiLoad = null;
      return [];
    });
  return emojiLoad;
}

function merge(list: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(list.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-HISTORY);
}

const clock = (value: string) => new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const onChange = () => setPhone(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}

/** The list of stocks for ticker links, rebuilt only when the list itself changes, not on every tick. */
function useStockList(): MarketAsset[] {
  const count = useMarketStore((state) => state.assets.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `count` is what says the list changed.
  return useMemo(() => useMarketStore.getState().assets, [count]);
}

export function FloatingChat() {
  const { user } = useAuth();
  const pathname = usePathname();
  const roomKey = useChatWindowStore((state) => state.room);
  const phone = usePhone();
  const status = useChatSocketStatus();
  const assets = useStockList();
  const viewerId = user ? Number(user.id) : null;

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [current, setCurrent] = useState<ChatChannel | null>(null);
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [dragging, setDragging] = useState(false);

  const box = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const offset = useRef<Offset | null>(null);
  const stick = useRef(true);
  const pending = useRef<ChatMessage[]>([]);
  const flushTimer = useRef<number | null>(null);
  const liveKey = useRef(roomKey);
  // A layout effect so it's current before any effect below loads the room.
  useLayoutEffect(() => {
    liveKey.current = roomKey;
  }, [roomKey]);

  const markRead = useReadReceipts(viewerId, roomKey);

  // ── Where it sits ───────────────────────────────────────────────────────
  /**
   * Its saved spot, kept inside the window and above the bottom nav. If that would cover the order
   * ticket it moves aside for now, without losing the spot, so other pages still find it there. On
   * a screen too narrow to move aside, it goes away rather than cover the ticket.
   */
  const place = useCallback(() => {
    const el = box.current;
    if (!el || window.matchMedia(PHONE).matches) return;
    offset.current ??= readOffset(POSITION_KEY);
    const { right, bottom } = offset.current ?? { right: FLOAT_MARGIN, bottom: FLOAT_MARGIN };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = clamp(window.innerWidth - w - right, FLOAT_MARGIN, window.innerWidth - w - FLOAT_MARGIN);
    const top = clamp(window.innerHeight - h - bottom, FLOAT_MARGIN, window.innerHeight - h - FLOAT_MARGIN - bottomInset());
    const clearLeft = leftClearOfKeepOuts(left, top, w, h);
    if (clearLeft === null) return closeChatWindow();
    Object.assign(el.style, { left: `${clearLeft}px`, top: `${top}px`, visibility: "visible" });
  }, []);

  useLayoutEffect(() => {
    if (phone) return;
    const el = box.current;
    if (el) Object.assign(el.style, { bottom: "", height: "" });
    place();
    // A page's ticket can arrive after the page does (it announces itself), and a new page has its
    // own bottom bars, so look again a moment after moving.
    const later = window.setTimeout(place, 400);
    const stopWatching = onKeepClearChange(place);
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(later);
      stopWatching();
      window.removeEventListener("resize", place);
    };
  }, [pathname, phone, place]);

  // The sheet: above the nav and any trade bar, and above the keyboard when that's up.
  useLayoutEffect(() => {
    if (!phone) return;
    const el = box.current;
    if (!el) return;
    Object.assign(el.style, { left: "", top: "" });
    const fit = () => {
      const view = window.visualViewport;
      const viewHeight = view?.height ?? window.innerHeight;
      const keyboard = Math.max(0, window.innerHeight - viewHeight - (view?.offsetTop ?? 0));
      const foot = keyboard > 60 ? keyboard : bottomInset();
      el.style.bottom = `${foot}px`;
      el.style.height = `${Math.round(Math.min(viewHeight * 0.62, viewHeight - (keyboard > 60 ? 8 : foot + 48)))}px`;
    };
    fit();
    const later = window.setTimeout(fit, 400);
    window.visualViewport?.addEventListener("resize", fit);
    window.addEventListener("resize", fit);
    return () => {
      window.clearTimeout(later);
      window.visualViewport?.removeEventListener("resize", fit);
      window.removeEventListener("resize", fit);
    };
  }, [phone, pathname]);

  // On a phone it was opened for a look: moving to another page closes it.
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (phone && openedOn.current !== pathname) closeChatWindow();
    openedOn.current = pathname;
  }, [pathname, phone]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = box.current;
    const target = event.target as HTMLElement;
    if (!el || phone || event.button !== 0 || target.closest("button, a, select")) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    const move = (moved: PointerEvent) => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = `${clamp(moved.clientX - dx, FLOAT_MARGIN, window.innerWidth - w - FLOAT_MARGIN)}px`;
      el.style.top = `${clamp(moved.clientY - dy, FLOAT_MARGIN, window.innerHeight - h - FLOAT_MARGIN - bottomInset())}px`;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragging(false);
      const placed = el.getBoundingClientRect();
      offset.current = { right: window.innerWidth - placed.right, bottom: window.innerHeight - placed.bottom };
      saveOffset(POSITION_KEY, offset.current);
      // Dropped on the ticket: it slides off again.
      place();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  // ── The room list and the emoji, once per opening ───────────────────────
  const [roomsRevision, setRoomsRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ channels: Array<Record<string, unknown>> }>("/api/chat/channels")
      .then((raw) => !cancelled && setChannels((raw.channels || []).map(normalizeChatChannel)))
      .catch(() => undefined);
    void loadEmojis().then((loaded) => !cancelled && setEmojis(loaded));
    return () => {
      cancelled = true;
    };
  }, [roomsRevision, viewerId]);

  const rooms = useMemo(() => buildRooms(channels, assets), [assets, channels]);
  const room = useMemo(() => rooms.find((entry) => entry.key === roomKey) ?? null, [roomKey, rooms]);
  // What the room's own page said, or failing that the list: either can arrive first.
  const channel = current?.channel_key === roomKey ? current : (room?.channel ?? null);

  // ── The room itself ─────────────────────────────────────────────────────
  const loadedKeyRef = useRef<string | null>(null);
  const loadLatest = useCallback(async (key: string) => {
    try {
      const page = await apiFetch<Page>(`/api/chat/channels/${encodeURIComponent(key)}/messages?limit=${FIRST_PAGE}`);
      if (liveKey.current !== key) return;
      const fresh = (page.messages || []).map(normalizeChatMessage);
      const el = list.current;
      if (el && el.scrollHeight - el.clientHeight - el.scrollTop < 40) stick.current = true;
      const sameRoom = loadedKeyRef.current === key;
      loadedKeyRef.current = key;
      setCurrent(normalizeChatChannel(page.channel));
      setMessages((existing) => merge(sameRoom ? existing : [], fresh));
      setLoadedKey(key);
      setError(null);
    } catch (reason) {
      if (liveKey.current !== key) return;
      setError(String((reason as Error).message || reason));
      loadedKeyRef.current = key;
      setLoadedKey(key);
    }
  }, []);

  useEffect(() => {
    stick.current = true;
    setUnseen(0);
    pending.current = [];
    void loadLatest(roomKey);
    const release = retainChatRooms([roomKey]);
    return release;
  }, [loadLatest, roomKey]);

  // The socket dropped (or was let go while the tab was hidden): catch up with what it missed.
  const wasOpen = useRef(status === "open");
  useEffect(() => {
    if (status === "open" && !wasOpen.current) void loadLatest(liveKey.current);
    wasOpen.current = status === "open";
  }, [loadLatest, status]);

  // What's on screen doesn't pop up or count as unread.
  useEffect(() => {
    setForegroundRoom("window", roomKey);
    return () => setForegroundRoom("window", null);
  }, [roomKey]);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const batch = pending.current;
    pending.current = [];
    if (!batch.length) return;
    const el = list.current;
    const atBottom = !el || el.scrollHeight - el.clientHeight - el.scrollTop < 40;
    if (atBottom) stick.current = true;
    else setUnseen((count) => count + batch.filter((message) => message.status === "active" && message.author?.id !== viewerId).length);
    setMessages((existing) => merge(existing, batch));
  }, [viewerId]);

  useEffect(
    () =>
      onChatSocketEvent((event) => {
        if (event.type === "chat.user.moderated") {
          // A mute or ban on this player, or lifting one: the composer should say so.
          if (Number(event.user_id) === viewerId) {
            setRoomsRevision((value) => value + 1);
            void loadLatest(liveKey.current);
          }
          return;
        }
        if (event.channel_key !== liveKey.current) return;
        if (event.type === "chat.channel.updated" && event.channel) {
          setCurrent(normalizeChatChannel(event.channel));
          return;
        }
        if ((event.type === "chat.message.created" || event.type === "chat.message.updated") && event.message) {
          pending.current.push(normalizeChatMessage(event.message));
          if (flushTimer.current === null) flushTimer.current = window.setTimeout(flush, FLUSH_MS);
        }
      }),
    [flush, loadLatest, viewerId],
  );

  useEffect(
    () => () => {
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    },
    [],
  );

  // Pinned to the newest message when it should be.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    stick.current = false;
  }, [messages, loadedKey]);

  // Read as long as it's being looked at.
  const newest = loadedKey === roomKey ? messages[messages.length - 1]?.id : undefined;
  useEffect(() => {
    if (!newest) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      markRead(roomKey, newest);
      markRoomSeen(roomKey);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [markRead, newest, roomKey]);

  const send = useCallback(
    async (body: string) => {
      const raw = await apiFetch<{ message: Record<string, unknown> }>(`/api/chat/channels/${encodeURIComponent(roomKey)}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      const message = normalizeChatMessage(raw.message);
      stick.current = true;
      setMessages((existing) => merge(existing, [message]));
      markRead(roomKey, message.id);
      notePosted(roomKey);
    },
    [markRead, roomKey],
  );

  const onUpdated = useCallback((message: ChatMessage) => setMessages((existing) => merge(existing, [message])), []);

  const onScroll = () => {
    const el = list.current;
    if (el && el.scrollHeight - el.clientHeight - el.scrollTop < 40) setUnseen(0);
  };

  const shown = useMemo(() => (loadedKey === roomKey ? messages : []), [loadedKey, messages, roomKey]);
  const usernames = useMemo(() => [...new Set(shown.map((message) => message.author?.username).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b)), [shown]);
  const blockedReason = postingBlockedReason(channel, user);
  const canPost = Boolean(channel && user?.email_verified && !blockedReason);
  const tag = room ? roomTag(room) : channel ? tagFromChannel(channel.scope_type, channel.display_name, channel.metadata) : "chat";

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);
  const emojiMap = useMemo(() => new Map(emojis.map((emoji) => [emoji.name.toLowerCase(), emoji])), [emojis]);
  const options = useMemo<RichOptions>(() => ({ assets: assetMap, emoji: emojiMap, me: user?.username ?? null }), [assetMap, emojiMap, user?.username]);
  const mutedIds = useChatNotifyStore((state) => state.mutedIds);

  return (
    // Not role="dialog": announcement popups wait for dialogs, and this can stay open all day.
    <section ref={box} className={`${styles.window} ${dragging ? styles.dragging : ""}`} data-mode={phone ? "sheet" : "float"} role="region" aria-label={`Chat window: ${tag}`}>
      <div className={styles.bar} onPointerDown={startDrag} title={phone ? undefined : "Drag to move"}>
        <i className={styles.status} data-status={status} aria-label={status === "open" ? "Live" : status === "connecting" ? "Connecting" : "Offline"} />
        <RoomPicker rooms={rooms} roomKey={roomKey} tag={tag} />
        <span className={styles.barGap} />
        <RoomNotifyButton roomKey={roomKey} roomName={tag} />
        <Link href={`/chat?channel=${encodeURIComponent(roomKey)}`} aria-label="Open this room in chat" title="Open in chat" onClick={closeChatWindow}>
          <FaUpRightAndDownLeftFromCenter aria-hidden="true" />
        </Link>
        <button type="button" onClick={closeChatWindow} aria-label="Hide the chat window" title="Hide (the button in the top bar brings it back)">
          ✕
        </button>
      </div>
      <div ref={list} className={styles.list} onScroll={onScroll}>
        {error ? <p className={`${styles.note} ${styles.noteErr}`}>Couldn&apos;t load messages ({error}).</p> : null}
        {!error && loadedKey !== roomKey ? <p className={styles.note}>Loading…</p> : null}
        {!error && loadedKey === roomKey && !shown.length ? <p className={styles.note}>No messages yet. Say something.</p> : null}
        {shown.map((message, index) => {
          const previous = shown[index - 1];
          const grouped = Boolean(previous && previous.author?.id === message.author?.id && Date.parse(message.created_at) - Date.parse(previous.created_at) < GROUP_MS);
          return <Row key={message.id} message={message} grouped={grouped} viewer={user} muted={Boolean(message.author && mutedIds.has(message.author.id))} options={options} onUpdated={onUpdated} />;
        })}
      </div>
      {unseen > 0 ? (
        <button
          type="button"
          className={styles.jump}
          onClick={() => {
            const el = list.current;
            if (el) el.scrollTop = el.scrollHeight;
            setUnseen(0);
          }}
        >
          {unseen} new message{unseen === 1 ? "" : "s"} ↓
        </button>
      ) : null}
      <ChatComposer user={user} roomKey={roomKey} roomLabel={tag} canPost={canPost} blockedReason={blockedReason} emojis={emojis} usernames={usernames} onSend={send} compact />
    </section>
  );
}

function RoomPicker({ rooms, roomKey, tag }: { rooms: Room[]; roomKey: string; tag: string }) {
  const mine = useChatNotifyStore((state) => state.rooms);
  const entry = (room: Room) => {
    const unread = isRoomOn(mine[room.key]) && room.key !== roomKey ? mine[room.key].unread : 0;
    return (
      <option key={room.key} value={room.key}>
        {roomTag(room)}
        {unread ? ` (${unread > 99 ? "99+" : unread})` : ""}
      </option>
    );
  };
  const yours = rooms.filter((room) => isRoomOn(mine[room.key]));
  return (
    <select className={styles.picker} value={roomKey} aria-label="Choose a room" title="Choose a room" onChange={(event) => setChatWindowRoom(event.target.value)}>
      {/* Until the list loads, the room it's already on. */}
      {!rooms.length ? <option value={roomKey}>{tag}</option> : null}
      {yours.length ? <optgroup label="Your rooms">{yours.map(entry)}</optgroup> : null}
      <optgroup label="Floor">{rooms.filter((room) => room.section === "global" && !yours.includes(room)).map(entry)}</optgroup>
      <optgroup label="Units">{rooms.filter((room) => room.section === "unit" && !yours.includes(room)).map(entry)}</optgroup>
      <optgroup label="Talents">{rooms.filter((room) => room.section === "asset" && !yours.includes(room)).map(entry)}</optgroup>
    </select>
  );
}

const Row = memo(function Row({ message, grouped, viewer, muted, options, onUpdated }: { message: ChatMessage; grouped: boolean; viewer: AuthUser | null; muted: boolean; options: RichOptions; onUpdated: (message: ChatMessage) => void }) {
  const author = message.author;
  const removed = message.status !== "active";
  const sticker = removed ? null : parseSticker(message.body);
  return (
    <article className={`${styles.row} ${chatStyles.floatRow} ${grouped ? styles.rowGrouped : ""}`}>
      {grouped || !author ? (
        <span />
      ) : (
        <Link href={`/profile/${encodeURIComponent(author.username)}`} tabIndex={-1} aria-hidden="true">
          <PlayerAvatar username={author.username} pictureUrl={author.profile_picture_url} color={author.profile_color} equipped={author.equipped} size={22} />
        </Link>
      )}
      <div>
        {grouped ? null : (
          <div className={styles.rowHead}>
            {author ? (
              <Link href={`/profile/${encodeURIComponent(author.username)}`} style={author.profile_color ? { color: author.profile_color } : undefined}>
                {author.username}
              </Link>
            ) : null}
            <time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()}>
              {clock(message.created_at)}
            </time>
          </div>
        )}
        {removed ? (
          <p className={styles.gone}>{message.status === "moderated" ? "removed by a moderator" : "deleted"}</p>
        ) : muted ? (
          <p className={styles.gone}>from a player you muted</p>
        ) : sticker ? (
          <ReactionFace symbol={sticker.symbol} pose={sticker.pose} size={208} crop="full" className={styles.sticker} />
        ) : (
          <RichText text={message.body} options={options} className={styles.text} />
        )}
      </div>
      <MessageMenu message={message} viewer={viewer} onUpdated={onUpdated} />
    </article>
  );
});
