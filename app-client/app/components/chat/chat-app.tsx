"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { RichText, type Emoji } from "@/app/components/common/rich-text";
import { Sparkline } from "@/app/components/common/sparkline";
import { SiteShell } from "@/app/components/layout/site-shell";
import { ChatComposer } from "@/app/components/chat/chat-composer";
import { RoomRail } from "@/app/components/chat/room-rail";
import { apiFetch } from "@/app/lib/api";
import { markSeries, unitName } from "@/app/lib/market-units";
import { normalizeChatChannel, normalizeChatMessage } from "@/app/lib/normalizers";
import { money, signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { ChatChannel, ChatMessage, MarketAsset } from "@/app/lib/types";
import { getChatWsUrl } from "@/app/lib/ws";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useTradeStore } from "@/app/stores/trade-store";
import styles from "@/app/components/chat/chat.module.scss";

// ── Rooms ────────────────────────────────────────────────────────────────
type Room = {
  channel: ChatChannel;
  section: "global" | "unit" | "asset";
  key: string;
  label: string;
  short: string;
  symbol: string | null;
  icon: string | null;
  subtitle: string | null;
  unit: string | null;
};

type WsEvent =
  | { type: "chat.message.created" | "chat.message.updated"; channel_key: string; message: Record<string, unknown> }
  | { type: "chat.channel.updated"; channel_key: string; channel: Record<string, unknown> }
  | { type: string };

type Page = { messages: Array<Record<string, unknown>>; has_more: boolean; next_cursor: string | null; history_limited: boolean; visible_days: number | null; minimum_messages?: number | null };
type Worth = { rank: number; total_equity: number };

const PINS_KEY = "nasfaq.chat.pinned_channels";
const GROUP_MS = 5 * 60_000;

function buildRooms(channels: ChatChannel[], assets: MarketAsset[]): Room[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const rooms: Room[] = [];
  for (const channel of channels) {
    if (!channel.is_active || channel.scope_type === "meta") continue;
    if (channel.scope_type === "market") {
      rooms.push({ channel, section: "global", key: channel.channel_key, label: "Global", short: "ALL", symbol: null, icon: null, subtitle: channel.description || "The whole floor", unit: null });
    } else if (channel.scope_type === "unit") {
      const unit = channel.metadata.unit || channel.display_name.replace(/\s+Unit Chat$/i, "");
      rooms.push({ channel, section: "unit", key: channel.channel_key, label: unitName(unit), short: unitName(unit), symbol: null, icon: null, subtitle: channel.metadata.asset_count ? `${channel.metadata.asset_count} talents` : channel.description, unit });
    } else if (channel.scope_type === "asset") {
      const asset = channel.metadata.asset_id ? byId.get(channel.metadata.asset_id) : undefined;
      const symbol = (channel.metadata.symbol || asset?.symbol || "").toUpperCase() || null;
      rooms.push({ channel, section: "asset", key: channel.channel_key, label: channel.metadata.display_name || asset?.display_name || channel.display_name, short: symbol ?? "CHAT", symbol, icon: channel.metadata.icon || asset?.icon || null, subtitle: channel.metadata.unit || asset?.unit || null, unit: channel.metadata.unit || asset?.unit || null });
    }
  }
  const order = { global: 0, unit: 1, asset: 2 };
  return rooms.sort((a, b) => order[a.section] - order[b.section] || a.short.localeCompare(b.short));
}

function readPins(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PINS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writePins(keys: string[]) {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(keys));
  } catch {
    /* storage blocked */
  }
}

function upsert(list: ChatMessage[], message: ChatMessage) {
  const index = list.findIndex((item) => item.id === message.id);
  if (index === -1) return [...list, message].sort((a, b) => a.id - b.id);
  const next = [...list];
  next[index] = message;
  return next;
}

const preview = (body: string | null | undefined) => {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

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
  const [pins, setPins] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const activeKey = params.get("channel") || "market:global";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [history, setHistory] = useState<{ limited: boolean; days: number | null; minimum: number | null }>({ limited: false, days: null, minimum: null });
  const [worth, setWorth] = useState<Record<number, Worth>>({});
  const [socket, setSocket] = useState<"connecting" | "open" | "closed">("connecting");
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const viewport = useRef<HTMLDivElement | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const subscribed = useRef<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const loadedRef = useRef<string | null>(null);
  const stickToBottom = useRef(false);
  const olderBusy = useRef(false);
  const atBottomRef = useRef(true);

  const rooms = useMemo(() => buildRooms(channels, assets), [assets, channels]);
  const room = useMemo(() => rooms.find((entry) => entry.key === activeKey) ?? rooms[0] ?? null, [activeKey, rooms]);
  const roomKey = room?.key ?? null;
  activeRef.current = roomKey;
  const shown = useMemo(() => (roomKey && roomKey === loadedKey ? messages : []), [loadedKey, messages, roomKey]);

  // Rooms, emoji and pins.
  useEffect(() => {
    setPins(readPins());
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

  const markRead = useCallback(
    (key: string, id: number) => {
      if (!user) return;
      void apiFetch(`/api/chat/channels/${encodeURIComponent(key)}/read`, { method: "POST", body: JSON.stringify({ last_read_message_id: id }) }).catch(() => undefined);
      setChannels((current) => current.map((channel) => (channel.channel_key === key ? { ...channel, unread_count: 0 } : channel)));
    },
    [user],
  );

  // Load the selected room.
  useEffect(() => {
    if (!roomKey) return;
    let cancelled = false;
    setLoadingMessages(true);
    setMessagesError(null);
    setUnseen(0);
    apiFetch<Page>(`/api/chat/channels/${encodeURIComponent(roomKey)}/messages?limit=50`)
      .then((page) => {
        if (cancelled) return;
        const list = (page.messages || []).map(normalizeChatMessage);
        loadedRef.current = roomKey;
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
        setLoadedKey(roomKey);
        setMessages([]);
        setMessagesError(String((reason as Error).message || reason));
      })
      .finally(() => !cancelled && setLoadingMessages(false));
    return () => {
      cancelled = true;
    };
  }, [markRead, roomKey]);

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
    try {
      const page = await apiFetch<Page>(`/api/chat/channels/${encodeURIComponent(roomKey)}/messages?limit=50&before=${encodeURIComponent(cursor)}`);
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

  // Live updates.
  useEffect(() => {
    let disposed = false;
    let retry: number | null = null;
    const connect = () => {
      const url = getChatWsUrl();
      if (!url || disposed) return;
      setSocket("connecting");
      const socketNow = new WebSocket(url);
      ws.current = socketNow;
      socketNow.onopen = () => {
        setSocket("open");
        const key = activeRef.current;
        if (key) {
          socketNow.send(JSON.stringify({ action: "subscribe", channel_keys: [key] }));
          subscribed.current = key;
        }
      };
      socketNow.onmessage = (event) => {
        let payload: WsEvent;
        try {
          payload = JSON.parse(String(event.data || "")) as WsEvent;
        } catch {
          return;
        }
        if ((payload.type === "chat.message.created" || payload.type === "chat.message.updated") && "message" in payload) {
          const message = normalizeChatMessage(payload.message);
          const created = payload.type === "chat.message.created";
          if (message.channel_key === loadedRef.current) {
            if (created && atBottomRef.current) stickToBottom.current = true;
            else if (created && !message.is_mine) setUnseen((count) => count + 1);
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
                    unread_count: channel.channel_key === activeRef.current ? 0 : channel.unread_count + (created ? 1 : 0),
                  }
                : channel,
            ),
          );
          if (message.channel_key === activeRef.current && created) markRead(message.channel_key, message.id);
        } else if (payload.type === "chat.channel.updated" && "channel" in payload) {
          const next = normalizeChatChannel(payload.channel);
          setChannels((current) => current.map((channel) => (channel.channel_key === next.channel_key ? next : channel)));
        }
      };
      socketNow.onclose = () => {
        if (ws.current === socketNow) ws.current = null;
        subscribed.current = null;
        setSocket("closed");
        if (!disposed) retry = window.setTimeout(connect, 2000);
      };
      socketNow.onerror = () => socketNow.close();
    };
    connect();
    return () => {
      disposed = true;
      if (retry !== null) window.clearTimeout(retry);
      ws.current?.close();
      ws.current = null;
    };
  }, [markRead, user]);

  useEffect(() => {
    const socketNow = ws.current;
    if (!socketNow || socketNow.readyState !== WebSocket.OPEN || !roomKey) return;
    if (subscribed.current && subscribed.current !== roomKey) socketNow.send(JSON.stringify({ action: "unsubscribe", channel_keys: [subscribed.current] }));
    socketNow.send(JSON.stringify({ action: "subscribe", channel_keys: [roomKey] }));
    subscribed.current = roomKey;
  }, [roomKey, socket]);

  const blockedReason = !room
    ? null
    : room.channel.muted_until
      ? `You're muted here until ${new Date(room.channel.muted_until).toLocaleString()}.`
      : room.channel.posting_policy === "read_only"
        ? "This room is read-only."
        : room.channel.posting_policy === "admins_only" && !user?.is_admin
          ? "Only admins can post in this room right now."
          : null;
  const canPost = Boolean(room && user?.email_verified && !blockedReason);

  const send = useCallback(
    async (body: string) => {
      if (!room) return;
      const raw = await apiFetch<{ message: Record<string, unknown> }>(`/api/chat/channels/${encodeURIComponent(room.key)}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      const message = normalizeChatMessage(raw.message);
      stickToBottom.current = true;
      setMessages((current) => upsert(current, message));
      markRead(room.key, message.id);
    },
    [markRead, room],
  );

  const togglePin = (key: string) =>
    setPins((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [key, ...current];
      writePins(next);
      return next;
    });

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
                <Messages messages={shown} worth={worth} me={user?.username ?? null} options={{ assets: assetMap, emoji: emojiMap, me: user?.username ?? null }} />
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
              <ChatComposer user={user} roomKey={room.key} roomLabel={room.section === "asset" ? `#${room.short.toLowerCase()}` : room.section === "global" ? "#global" : `#${room.short.toLowerCase().replace(/\s+/g, "-")}`} canPost={canPost} blockedReason={blockedReason} emojis={emojis} usernames={usernames} onSend={send} />
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
                        <span className={styles.roomPrev}>{preview(room.channel.last_message_preview) || (room.section === "asset" ? room.label : room.subtitle) || "No messages yet"}</span>
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
      <button type="button" className={styles.railBtn} onClick={onOpenRail}>
        {room.section === "asset" ? "CHART" : "STATS"}
      </button>
    </header>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────
function Messages({ messages, worth, me, options }: { messages: ChatMessage[]; worth: Record<number, Worth>; me: string | null; options: Parameters<typeof RichText>[0]["options"] }) {
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
                  <PlayerAvatar username={author.username} pictureUrl={author.profile_picture_url} color={author.profile_color} size={28} />
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
                    {rank && rank.rank > 0 ? (
                      <span className={`${styles.rank} ${rank.rank <= 3 ? styles.rankTop : rank.rank <= 10 ? styles.rankTen : ""}`} title={`Net worth ${money(rank.total_equity)}`}>
                        #{rank.rank.toLocaleString("en-US")} <span>{money(rank.total_equity, { compact: true })}</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {removed ? <p className={styles.removed}>{message.status === "moderated" ? "removed by a moderator" : "deleted"}</p> : <RichText text={message.body} options={options} className={styles.text} />}
                {message.edited_at && !removed ? <small className={styles.edited}>edited</small> : null}
              </div>
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
