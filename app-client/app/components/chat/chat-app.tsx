"use client";

import { CosmeticChip } from "@/app/components/common/cosmetic-chip";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { parseSticker } from "@/app/lib/stickers";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { RichText, type Emoji } from "@/app/components/common/rich-text";
import { Sparkline } from "@/app/components/common/sparkline";
import { SiteShell } from "@/app/components/layout/site-shell";
import { ChatComposer } from "@/app/components/chat/chat-composer";
import { MessageMenu } from "@/app/components/chat/message-menu";
import { RoomNotifyButton } from "@/app/components/chat/room-notify-button";
import { RoomRail } from "@/app/components/chat/room-rail";
import { apiFetch } from "@/app/lib/api";
import { buildRooms, GLOBAL_ROOM, messagePreview, postingBlockedReason, roomTag, type Room } from "@/app/lib/chat-rooms";
import { holdChatSocket, onChatSocketEvent, retainChatRooms, useChatSocketStatus } from "@/app/lib/chat-socket";
import { markSeries, unitName } from "@/app/lib/market-units";
import { normalizeChatChannel, normalizeChatMessage } from "@/app/lib/normalizers";
import { money, signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { AuthUser, ChatChannel, ChatMessage, MarketAsset } from "@/app/lib/types";
import { useReadReceipts } from "@/app/lib/use-read-receipts";
import { useStoredState } from "@/app/lib/use-stored-state";
import { useAuth } from "@/app/providers/auth-provider";
import { notePosted, setForegroundRoom, useChatNotifyStore } from "@/app/stores/chat-notify-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/chat/chat.module.scss";

type Page = { channel?: Record<string, unknown>; messages: Array<Record<string, unknown>>; has_more: boolean; next_cursor: string | null; history_limited: boolean; visible_days: number | null; minimum_messages?: number | null };
type Worth = { rank: number; total_equity: number };

const PINS_KEY = "nasfaq.chat.pinned_channels";
const GROUP_MS = 5 * 60_000;
/** Pages of 50 a reconnect fetches to close the gap before giving up and starting the room over. */
const CATCH_UP_PAGES = 5;

const NO_PINS: string[] = [];
const parsePins = (stored: unknown) => (Array.isArray(stored) ? stored.map(String).filter(Boolean) : null);

function upsert(list: ChatMessage[], message: ChatMessage) {
  const index = list.findIndex((item) => item.id === message.id);
  if (index === -1) return [...list, message].sort((a, b) => a.id - b.id);
  const next = [...list];
  next[index] = message;
  return next;
}

function mergeMessages(list: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(list.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const clock = (value: string) => new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function RoomBadge({ room, size = 26 }: { room: Room; size?: number }) {
  if (room.symbol) return <Oshimark icon={room.icon} symbol={room.symbol} size={size} />;
  return (
    <span className={`${styles.badge} ${room.section === "global" ? styles.badgeAll : ""}`} style={{ width: size, height: size }}>
      {room.section === "global" ? "◆" : room.short.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

// ── App ──────────────────────────────────────────────────────────────────
export function ChatApp() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [pins, setPins] = useStoredState(PINS_KEY, NO_PINS, { parse: parsePins });
  const [filter, setFilter] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const activeKey = params.get("channel") || GLOBAL_ROOM;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [history, setHistory] = useState<{ limited: boolean; days: number | null; minimum: number | null }>({ limited: false, days: null, minimum: null });
  const [worth, setWorth] = useState<Record<number, Worth>>({});
  const socket = useChatSocketStatus();
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const viewport = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<string | null>(null);
  const loadedRef = useRef<string | null>(null);
  const stickToBottom = useRef(false);
  const olderBusy = useRef(false);
  const atBottomRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  /** Bumped whenever the list is replaced rather than added to, so a page fetched for the old list is dropped. */
  const listGen = useRef(0);
  const [reloads, setReloads] = useState(0);

  const rooms = useMemo(() => buildRooms(channels, assets), [assets, channels]);
  const room = useMemo(() => rooms.find((entry) => entry.key === activeKey) ?? rooms[0] ?? null, [activeKey, rooms]);
  const roomKey = room?.key ?? null;
  // A layout effect so these are current before any effect below, and before any socket message or click.
  useLayoutEffect(() => {
    activeRef.current = roomKey;
    messagesRef.current = messages;
  }, [messages, roomKey]);
  const shown = useMemo(() => (roomKey && roomKey === loadedKey ? messages : []), [loadedKey, messages, roomKey]);

  // Rooms and emoji.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ channels: Array<Record<string, unknown>> }>("/api/chat/channels")
      .then((raw) => !cancelled && setChannels((raw.channels || []).map(normalizeChatChannel)))
      .catch((reason) => !cancelled && setRoomsError(String((reason as Error).message || reason)))
      .finally(() => !cancelled && setLoadingRooms(false));
    apiFetch<{ emojis: Array<Record<string, unknown>> }>("/api/assets/emojis")
      .then((raw) => !cancelled && setEmojis((raw.emojis || []).map((item) => ({ id: Number(item.id || 0), name: String(item.name || ""), filename: String(item.filename || ""), url: String(item.url || "") }))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  // An admin muted, banned or lifted the viewer: reload the rooms so the composer says so.
  const [restrictionRevision, setRestrictionRevision] = useState(0);
  useEffect(() => {
    if (!restrictionRevision) return;
    let cancelled = false;
    apiFetch<{ channels: Array<Record<string, unknown>> }>("/api/chat/channels")
      .then((raw) => !cancelled && setChannels((raw.channels || []).map(normalizeChatChannel)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [restrictionRevision]);

  const emojiMap = useMemo(() => new Map(emojis.map((emoji) => [emoji.name.toLowerCase(), emoji])), [emojis]);

  const selectRoom = useCallback(
    (key: string) => {
      setDrawer(false);
      setRailOpen(false);
      if (key === activeRef.current) return;
      setUnseen(0);
      router.replace(`/chat?channel=${encodeURIComponent(key)}`, { scroll: false });
    },
    [router],
  );

  // Read receipts: the badge clears at once; the hook keeps the server from hearing about every message.
  const sendReceipt = useReadReceipts(user ? Number(user.id) : null, roomKey);
  const markRead = useCallback(
    (key: string, id: number) => {
      if (!user) return;
      setChannels((current) => current.map((channel) => (channel.channel_key === key ? { ...channel, unread_count: 0 } : channel)));
      sendReceipt(key, id);
    },
    [sendReceipt, user],
  );

  // The room on screen doesn't pop up.
  useEffect(() => {
    setForegroundRoom("page", roomKey);
    return () => setForegroundRoom("page", null);
  }, [roomKey]);

  // Load the selected room.
  useEffect(() => {
    if (!roomKey) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fetch's loading state: on for the request this effect sends.
    setLoadingMessages(true);
    setMessagesError(null);
    setUnseen(0);
    apiFetch<Page>(`/api/chat/channels/${encodeURIComponent(roomKey)}/messages?limit=50`)
      .then((page) => {
        if (cancelled) return;
        const list = (page.messages || []).map(normalizeChatMessage);
        loadedRef.current = roomKey;
        listGen.current += 1;
        stickToBottom.current = true;
        setMessages(list);
        setLoadedKey(roomKey);
        setHasMore(Boolean(page.has_more));
        setCursor(page.next_cursor || null);
        setHistory({ limited: Boolean(page.history_limited), days: page.visible_days ?? null, minimum: page.minimum_messages ?? null });
        const last = list[list.length - 1];
        if (last) markRead(roomKey, last.id);
      })
      .catch((reason) => {
        if (cancelled) return;
        loadedRef.current = roomKey;
        listGen.current += 1;
        setLoadedKey(roomKey);
        setMessages([]);
        setMessagesError(String((reason as Error).message || reason));
      })
      .finally(() => !cancelled && setLoadingMessages(false));
    return () => {
      cancelled = true;
    };
    // reloads: a reconnect while this load was in flight asks for it again (see catchUp).
  }, [markRead, roomKey, reloads]);

  // Net worth badges for anyone who posted.
  useEffect(() => {
    const missing = [...new Set(messages.map((message) => message.author?.id).filter((id): id is number => typeof id === "number" && id > 0 && !worth[id]))];
    if (!missing.length) return;
    let cancelled = false;
    apiFetch<{ entries: Array<Record<string, unknown>> }>(`/api/leaderboard/net-worth?user_ids=${missing.join(",")}`)
      .then((raw) => {
        if (cancelled) return;
        setWorth((current) => {
          const next = { ...current };
          for (const entry of raw.entries || []) {
            const id = Number(entry.user_id || 0);
            if (id) next[id] = { rank: Number(entry.rank || 0), total_equity: Number(entry.total_equity || 0) };
          }
          for (const id of missing) if (!next[id]) next[id] = { rank: 0, total_equity: 0 };
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [messages, worth]);

  // Ranks and net worth move all day: refresh the badges we've shown every few minutes.
  const worthIds = useRef<number[]>([]);
  useEffect(() => {
    worthIds.current = Object.keys(worth).map(Number);
  }, [worth]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const ids = worthIds.current.slice(-200);
      if (!ids.length) return;
      apiFetch<{ entries: Array<Record<string, unknown>> }>(`/api/leaderboard/net-worth?user_ids=${ids.join(",")}`)
        .then((raw) =>
          setWorth((current) => {
            const next = { ...current };
            for (const entry of raw.entries || []) {
              const id = Number(entry.user_id || 0);
              if (id) next[id] = { rank: Number(entry.rank || 0), total_equity: Number(entry.total_equity || 0) };
            }
            return next;
          })
        )
        .catch(() => undefined);
    }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Keep the view pinned to the newest message when we should.
  useEffect(() => {
    const el = viewport.current;
    if (!el || !stickToBottom.current) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      stickToBottom.current = false;
    });
  }, [messages, loadedKey]);

  const loadOlder = useCallback(async () => {
    if (!roomKey || roomKey !== loadedRef.current || !cursor || !hasMore || olderBusy.current) return;
    const el = viewport.current;
    olderBusy.current = true;
    setLoadingOlder(true);
    const height = el?.scrollHeight ?? 0;
    const top = el?.scrollTop ?? 0;
    const gen = listGen.current;
    try {
      const page = await apiFetch<Page>(`/api/chat/channels/${encodeURIComponent(roomKey)}/messages?limit=50&before=${encodeURIComponent(cursor)}`);
      // The list started over meanwhile (another room, or a reconnect after a long gap): this page no longer joins on.
      if (gen !== listGen.current) return;
      const older = (page.messages || []).map(normalizeChatMessage);
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...older.filter((item) => !known.has(item.id)), ...current];
      });
      setHasMore(Boolean(page.has_more));
      setCursor(page.next_cursor || null);
      setHistory({ limited: Boolean(page.history_limited), days: page.visible_days ?? null, minimum: page.minimum_messages ?? null });
      requestAnimationFrame(() => {
        if (el) el.scrollTop = top + (el.scrollHeight - height);
      });
    } catch (reason) {
      setMessagesError(String((reason as Error).message || reason));
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }, [cursor, hasMore, roomKey]);

  const onScroll = () => {
    const el = viewport.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop < 40;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
    if (el.scrollTop < 120) void loadOlder();
  };

  // Live updates, on the tab's one chat socket (lib/chat-socket.ts). It also carries the rooms this
  // player gets popups from, which keeps their previews and unread counts in the list moving too.
  useEffect(() => holdChatSocket(), []);
  useEffect(() => (roomKey ? retainChatRooms([roomKey]) : undefined), [roomKey]);
  useEffect(
    () =>
      onChatSocketEvent((payload) => {
        if ((payload.type === "chat.message.created" || payload.type === "chat.message.updated") && payload.message) {
          const parsed = normalizeChatMessage(payload.message);
          // On a broadcast, is_mine is about the author, so work it out for this reader.
          const mine = Boolean(user && parsed.author?.id === Number(user.id));
          const message = { ...parsed, is_mine: mine };
          const created = payload.type === "chat.message.created";
          if (message.channel_key === loadedRef.current) {
            if (created && atBottomRef.current) stickToBottom.current = true;
            else if (created && !mine) setUnseen((count) => count + 1);
            setMessages((current) => upsert(current, message));
          }
          setChannels((current) =>
            current.map((channel) =>
              channel.channel_key === message.channel_key
                ? {
                    ...channel,
                    last_message_id: message.id,
                    last_message_at: message.created_at,
                    last_message_preview: message.body,
                    message_count: created && channel.last_message_id !== message.id ? channel.message_count + 1 : channel.message_count,
                    unread_count: channel.channel_key === activeRef.current ? 0 : channel.unread_count + (created && !mine ? 1 : 0),
                  }
                : channel,
            ),
          );
          if (message.channel_key === activeRef.current && created) markRead(message.channel_key, message.id);
        } else if (payload.type === "chat.channel.updated" && payload.channel) {
          const next = normalizeChatChannel(payload.channel);
          setChannels((current) => current.map((channel) => (channel.channel_key === next.channel_key ? next : channel)));
        } else if (payload.type === "chat.user.moderated" && user && Number(payload.user_id) === Number(user.id)) {
          setRestrictionRevision((value) => value + 1);
        }
      }),
    [markRead, user],
  );

  // The socket dropped and came back: fetch what was said while it was gone and add it on, keeping the
  // older pages already loaded and the reader's place. After a long gap (more than CATCH_UP_PAGES
  // pages missed) the room starts over from its newest page, as a reload would.
  const catchUp = useCallback(async () => {
    const key = activeRef.current;
    if (!key) return;
    if (loadedRef.current !== key) {
      // The room is still loading, and that request may have gone out before the drop.
      setReloads((count) => count + 1);
      return;
    }
    const gen = listGen.current;
    const newestKnown = messagesRef.current[messagesRef.current.length - 1]?.id ?? 0;
    try {
      let fetched: ChatMessage[] = [];
      let first: Page | null = null;
      let page: Page | null = null;
      let before: string | null = null;
      let joined = false;
      for (let count = 0; count < CATCH_UP_PAGES; count += 1) {
        const query: string = before ? `&before=${encodeURIComponent(before)}` : "";
        page = await apiFetch<Page>(`/api/chat/channels/${encodeURIComponent(key)}/messages?limit=50${query}`);
        if (gen !== listGen.current || activeRef.current !== key) return;
        first ??= page;
        const list = (page.messages || []).map(normalizeChatMessage);
        fetched = [...list, ...fetched];
        // Joined: this reaches back to what we had, or to the start of the room.
        joined = Boolean(newestKnown) && (!page.has_more || !list.length || list[0].id <= newestKnown);
        before = page.next_cursor;
        if (joined || !newestKnown || !before) break;
      }
      if (!page || !first) return;

      const newest = fetched[fetched.length - 1];
      const highest = newest?.id ?? 0;
      if (!joined) {
        listGen.current += 1;
        stickToBottom.current = true;
        // Anything the socket brought after these pages were read stays.
        setMessages((current) => [...fetched, ...current.filter((message) => message.id > highest)]);
        setHasMore(Boolean(page.has_more));
        setCursor(page.next_cursor || null);
        setHistory({ limited: Boolean(page.history_limited), days: page.visible_days ?? null, minimum: page.minimum_messages ?? null });
        setMessagesError(null);
        setUnseen(0);
      } else {
        // The pages hold every live message from `lowest` up, so one of ours in that range that's missing
        // was deleted or removed while the socket was down.
        const ids = new Set(fetched.map((message) => message.id));
        const lowest = page.has_more ? (fetched[0]?.id ?? 0) : 0;
        if (atBottomRef.current) stickToBottom.current = true;
        else {
          const have = new Set(messagesRef.current.map((message) => message.id));
          const unseenCount = fetched.filter((message) => !have.has(message.id) && message.status === "active" && !message.is_mine).length;
          if (unseenCount) setUnseen((count) => count + unseenCount);
        }
        setMessages((current) =>
          mergeMessages(
            current.filter((message) => message.id < lowest || message.id > highest || ids.has(message.id) || message.status !== "active"),
            fetched,
          ),
        );
      }
      if (first.channel) {
        const fresh = normalizeChatChannel(first.channel);
        setChannels((current) => current.map((channel) => (channel.channel_key === key ? { ...fresh, unread_count: 0 } : channel)));
      }
      if (newest && newest.id > newestKnown) markRead(key, newest.id);
    } catch {
      // The next reconnect tries again.
    }
  }, [markRead]);

  // Not on the first connection: loading the room already fetched its newest page.
  const socketSeen = useRef<"never" | "open" | "lost">("never");
  useEffect(() => {
    if (socket === "open") {
      if (socketSeen.current === "lost") void catchUp();
      socketSeen.current = "open";
    } else if (socketSeen.current === "open") socketSeen.current = "lost";
  }, [catchUp, socket]);

  const blockedReason = postingBlockedReason(room?.channel ?? null, user);
  const canPost = Boolean(room && user?.email_verified && !blockedReason);

  const send = useCallback(
    async (body: string) => {
      if (!room) return;
      const raw = await apiFetch<{ message: Record<string, unknown> }>(`/api/chat/channels/${encodeURIComponent(room.key)}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      const message = normalizeChatMessage(raw.message);
      stickToBottom.current = true;
      setMessages((current) => upsert(current, message));
      markRead(room.key, message.id);
      notePosted(room.key);
    },
    [markRead, room],
  );

  const togglePin = (key: string) => setPins((current) => (current.includes(key) ? current.filter((item) => item !== key) : [key, ...current]));

  const usernames = useMemo(() => [...new Set(shown.map((message) => message.author?.username).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b)), [shown]);
  const voices = useMemo(() => {
    const seen = new Map<number, { id: number; username: string; color: string | null; picture: string | null; at: string; count: number }>();
    for (const message of [...shown].reverse()) {
      const author = message.author;
      if (!author) continue;
      const current = seen.get(author.id);
      if (current) current.count += 1;
      else seen.set(author.id, { id: author.id, username: author.username, color: author.profile_color, picture: author.profile_picture_url, at: message.created_at, count: 1 });
    }
    return [...seen.values()].slice(0, 12);
  }, [shown]);

  const unreadTotal = rooms.reduce((sum, entry) => sum + entry.channel.unread_count, 0);

  return (
    <SiteShell fullBleed hideFooter>
      <div className={`${styles.app} ${room?.section === "asset" ? styles.appWide : ""}`}>
        <div
          className={`${styles.scrim} ${drawer || railOpen ? styles.scrimOn : ""} ${railOpen ? styles.scrimRail : ""}`}
          onClick={() => {
            setDrawer(false);
            setRailOpen(false);
          }}
          aria-hidden="true"
        />
        <RoomList rooms={rooms} active={roomKey} pins={pins} filter={filter} onFilter={setFilter} onSelect={selectRoom} onPin={togglePin} loading={loadingRooms} error={roomsError} open={drawer} assetMap={assetMap} />

        <section className={styles.main}>
          {room ? (
            <>
              <RoomHeader room={room} socket={socket} count={Math.max(room.channel.message_count, shown.length)} unreadElsewhere={unreadTotal - room.channel.unread_count} onOpenRooms={() => setDrawer(true)} onOpenRail={() => setRailOpen(true)} assetMap={assetMap} assets={assets} />
              <div className={styles.viewport} ref={viewport} onScroll={onScroll}>
                {loadingOlder ? <p className={styles.sys}>loading older messages…</p> : null}
                {!hasMore && history.limited && shown.length ? (
                  <p className={styles.sys}>
                    {history.days && history.minimum ? `History here keeps the newest ${history.minimum} messages plus anything from the last ${history.days} days.` : history.days ? `History here goes back ${history.days} days.` : "Older history is hidden in this room."}
                  </p>
                ) : null}
                {!hasMore && !history.limited && shown.length ? <p className={styles.sys}>This is the start of #{room.short.toLowerCase()}.</p> : null}
                {messagesError ? <p className={styles.sysErr}>Couldn&apos;t load messages ({messagesError}).</p> : null}
                {loadingMessages && roomKey !== loadedKey ? <Skeleton /> : null}
                {!loadingMessages && roomKey === loadedKey && !shown.length && !messagesError ? <p className={styles.sys}>No messages yet. Say something.</p> : null}
                <Messages
                  messages={shown}
                  worth={worth}
                  me={user?.username ?? null}
                  viewer={user}
                  onUpdated={(message) => setMessages((current) => upsert(current, message))}
                  options={{ assets: assetMap, emoji: emojiMap, me: user?.username ?? null }}
                />
              </div>
              {unseen > 0 && !atBottom ? (
                <button
                  type="button"
                  className={styles.jump}
                  onClick={() => {
                    const el = viewport.current;
                    if (el) el.scrollTop = el.scrollHeight;
                    setUnseen(0);
                  }}
                >
                  {unseen} new message{unseen === 1 ? "" : "s"} ↓
                </button>
              ) : null}
              <ChatComposer user={user} roomKey={room.key} roomLabel={roomTag(room)} canPost={canPost} blockedReason={blockedReason} emojis={emojis} usernames={usernames} onSend={send} />
            </>
          ) : (
            <p className={styles.sys}>{loadingRooms ? "Loading rooms…" : "No chat rooms are open."}</p>
          )}
        </section>

        {room ? <RoomRail room={room} voices={voices} worth={worth} open={railOpen} onClose={() => setRailOpen(false)} /> : null}
      </div>
    </SiteShell>
  );
}

// ── Room list ────────────────────────────────────────────────────────────
function RoomList({
  rooms,
  active,
  pins,
  filter,
  onFilter,
  onSelect,
  onPin,
  loading,
  error,
  open,
  assetMap,
}: {
  rooms: Room[];
  active: string | null;
  pins: string[];
  filter: string;
  onFilter: (value: string) => void;
  onSelect: (key: string) => void;
  onPin: (key: string) => void;
  loading: boolean;
  error: string | null;
  open: boolean;
  assetMap: Map<string, MarketAsset>;
}) {
  const needle = filter.trim().toLowerCase();
  const visible = needle ? rooms.filter((room) => `${room.short} ${room.label} ${room.unit ?? ""}`.toLowerCase().includes(needle)) : rooms;
  const pinned = visible.filter((room) => pins.includes(room.key));
  const sections: Array<[string, Room[]]> = [
    ["Pinned", pinned],
    ["Floor", visible.filter((room) => room.section === "global" && !pins.includes(room.key))],
    ["Units", visible.filter((room) => room.section === "unit" && !pins.includes(room.key))],
    ["Talents", visible.filter((room) => room.section === "asset" && !pins.includes(room.key))],
  ];

  return (
    <aside className={`${styles.rooms} ${open ? styles.roomsOpen : ""}`} aria-label="Chat rooms">
      <div className={styles.roomSearch}>
        <span aria-hidden="true">⌕</span>
        <input value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Find a room" aria-label="Find a room" />
      </div>
      {error ? <p className={styles.sysErr}>Couldn&apos;t load rooms ({error}).</p> : null}
      {loading ? <p className={styles.sys}>Loading rooms…</p> : null}
      <div className={styles.roomScroll}>
        {sections.map(([title, list]) =>
          list.length ? (
            <section key={title}>
              <h2 className={styles.roomHead}>
                {title} <small>{list.length}</small>
              </h2>
              {list.map((room) => {
                const asset = room.symbol ? assetMap.get(room.symbol) : undefined;
                const pinnedNow = pins.includes(room.key);
                return (
                  <div key={room.key} className={`${styles.room} ${room.key === active ? styles.roomOn : ""} ${room.channel.unread_count ? styles.roomUnread : ""}`}>
                    <button type="button" className={styles.roomPick} onClick={() => onSelect(room.key)} aria-current={room.key === active ? "true" : undefined}>
                      <RoomBadge room={room} size={22} />
                      <span className={styles.roomText}>
                        <span className={styles.roomTop}>
                          <b>{room.section === "asset" ? room.short : room.label}</b>
                          {asset ? <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span> : null}
                          {room.channel.last_message_at ? (
                            <time suppressHydrationWarning className={styles.roomTime}>
                              {timeAgo(room.channel.last_message_at).replace(" ago", "")}
                            </time>
                          ) : null}
                        </span>
                        <span className={styles.roomPrev}>{messagePreview(room.channel.last_message_preview) || (room.section === "asset" ? room.label : room.subtitle) || "No messages yet"}</span>
                      </span>
                      {room.channel.unread_count ? <span className={styles.unread}>{room.channel.unread_count > 99 ? "99+" : room.channel.unread_count}</span> : null}
                    </button>
                    <button type="button" className={`${styles.pin} ${pinnedNow ? styles.pinOn : ""}`} onClick={() => onPin(room.key)} aria-label={pinnedNow ? `Unpin ${room.label}` : `Pin ${room.label}`} aria-pressed={pinnedNow}>
                      ★
                    </button>
                  </div>
                );
              })}
            </section>
          ) : null,
        )}
        {!loading && !visible.length ? <p className={styles.sys}>No rooms match.</p> : null}
      </div>
    </aside>
  );
}

// ── Room header ──────────────────────────────────────────────────────────
function RoomHeader({ room, socket, count, unreadElsewhere, onOpenRooms, onOpenRail, assetMap, assets }: { room: Room; socket: "connecting" | "open" | "closed"; count: number; unreadElsewhere: number; onOpenRooms: () => void; onOpenRail: () => void; assetMap: Map<string, MarketAsset>; assets: MarketAsset[] }) {
  const openTrade = useTradeStore((state) => state.openTrade);
  const asset = room.symbol ? assetMap.get(room.symbol) : undefined;
  const members = room.section === "unit" ? assets.filter((entry) => entry.unit && room.unit && unitName(entry.unit) === unitName(room.unit)) : [];
  return (
    <header className={styles.head}>
      <button type="button" className={styles.roomsBtn} onClick={onOpenRooms} aria-label="Rooms">
        ☰{unreadElsewhere > 0 ? <i>{unreadElsewhere > 99 ? "99+" : unreadElsewhere}</i> : null}
      </button>
      <RoomBadge room={room} size={34} />
      <div className={styles.headText}>
        <h1>
          {room.section === "asset" ? (
            <>
              {room.label} <small>{room.short}</small>
            </>
          ) : room.section === "global" ? (
            "Global chat"
          ) : (
            `${room.label} chat`
          )}
        </h1>
        <p>
          <span className={`${styles.live} ${styles[socket]}`}>{socket === "open" ? "LIVE" : socket === "connecting" ? "CONNECTING" : "OFFLINE"}</span>
          <span>{count.toLocaleString("en-US")} messages</span>
          {room.channel.posting_policy !== "authenticated" ? <span>{room.channel.posting_policy === "read_only" ? "read-only" : "admins only"}</span> : null}
        </p>
      </div>
      {asset ? (
        <div className={styles.headStock}>
          <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.headPx} data-peek-stock={asset.symbol}>
            <Sparkline values={markSeries(asset)} tone={toneOf(asset.move_24h_pct) === "down" ? "down" : "up"} width={72} height={24} />
            <span>
              <b>{asset.current_mid_price?.toFixed(2)}</b>
              <small className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct)}</small>
            </span>
          </Link>
          <button type="button" className={styles.trade} onClick={() => openTrade(asset.symbol, "buy")}>
            TRADE
          </button>
        </div>
      ) : members.length ? (
        <div className={styles.headMembers}>
          {members.slice(0, 8).map((member) => (
            <Link key={member.symbol} href={`/chat?channel=${encodeURIComponent(`asset:${member.id}`)}`} title={`${member.display_name} ${signedPct(member.move_24h_pct)}`} data-peek-stock={member.symbol}>
              <Oshimark icon={member.icon} symbol={member.symbol} size={20} />
            </Link>
          ))}
        </div>
      ) : null}
      <RoomNotifyButton roomKey={room.key} roomName={roomTag(room)} className={styles.notifyBtn} />
      <button type="button" className={styles.railBtn} onClick={onOpenRail}>
        {room.section === "asset" ? "CHART" : "STATS"}
      </button>
    </header>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────
function Messages({
  messages,
  worth,
  me,
  viewer,
  onUpdated,
  options,
}: {
  messages: ChatMessage[];
  worth: Record<number, Worth>;
  me: string | null;
  viewer: AuthUser | null;
  onUpdated: (message: ChatMessage) => void;
  options: Parameters<typeof RichText>[0]["options"];
}) {
  const mutedIds = useChatNotifyStore((state) => state.mutedIds);
  const mentionRe = useMemo(() => (me ? new RegExp(`(^|[^\\w])@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\w])`, "i") : null), [me]);
  return (
    <>
      {messages.map((message, index) => {
        const prev = messages[index - 1];
        const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(message.created_at).toDateString();
        const grouped = !newDay && prev && prev.author?.id === message.author?.id && Date.parse(message.created_at) - Date.parse(prev.created_at) < GROUP_MS;
        const author = message.author;
        const rank = author ? worth[author.id] : undefined;
        const mentioned = Boolean(mentionRe && mentionRe.test(message.body));
        const removed = message.status !== "active";
        const sticker = removed ? null : parseSticker(message.body);
        return (
          <div key={message.id}>
            {newDay ? (
              <div className={styles.day}>
                <span suppressHydrationWarning>{dayLabel(message.created_at)}</span>
              </div>
            ) : null}
            <article className={`${styles.msg} ${grouped ? styles.grouped : ""} ${mentioned ? styles.mentioned : ""} ${message.is_mine ? styles.mine : ""}`}>
              <time className={styles.msgTime} dateTime={message.created_at} title={new Date(message.created_at).toLocaleString()} suppressHydrationWarning>
                {clock(message.created_at)}
              </time>
              {grouped ? (
                <span />
              ) : author ? (
                <Link href={`/profile/${encodeURIComponent(author.username)}`} className={styles.msgAvatar} tabIndex={-1} aria-hidden="true">
                  <PlayerAvatar username={author.username} pictureUrl={author.profile_picture_url} color={author.profile_color} equipped={author.equipped} size={28} />
                </Link>
              ) : (
                <span />
              )}
              <div className={styles.msgBody}>
                {!grouped ? (
                  <div className={styles.msgHead}>
                    {author ? (
                      <Link href={`/profile/${encodeURIComponent(author.username)}`} className={styles.msgName} style={author.profile_color ? { color: author.profile_color } : undefined}>
                        {author.username}
                      </Link>
                    ) : (
                      <span className={styles.msgName}>unknown</span>
                    )}
                    {author?.oshi_coin ? <Oshimark icon={author.oshi_coin.icon} symbol={author.oshi_coin.symbol} size={14} /> : null}
                    <CosmeticChip cosmetic={author?.equipped?.chat_flair} size={16} />
                    <CosmeticChip cosmetic={author?.equipped?.item} size={16} />
                    {rank && rank.rank > 0 ? (
                      <span className={`${styles.rank} ${rank.rank <= 3 ? styles.rankTop : rank.rank <= 10 ? styles.rankTen : ""}`} title={`Net worth ${money(rank.total_equity)}`}>
                        #{rank.rank.toLocaleString("en-US")} <span>{money(rank.total_equity, { compact: true })}</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {removed ? (
                  <p className={styles.removed}>{message.status === "moderated" ? "removed by a moderator" : "deleted"}</p>
                ) : author && mutedIds.has(author.id) ? (
                  <p className={styles.removed}>from a player you muted</p>
                ) : sticker ? (
                  <ReactionFace symbol={sticker.symbol} pose={sticker.pose} size={136} crop="full" className={styles.sticker} />
                ) : (
                  <RichText text={message.body} options={options} className={styles.text} />
                )}
                {message.edited_at && !removed ? <small className={styles.edited}>edited</small> : null}
              </div>
              <MessageMenu message={message} viewer={viewer} onUpdated={onUpdated} />
            </article>
          </div>
        );
      })}
    </>
  );
}

function Skeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index}>
          <i />
          <span style={{ width: `${40 + ((index * 37) % 50)}%` }} />
        </div>
      ))}
    </div>
  );
}
