"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { FiChevronDown, FiMenu, FiRadio, FiSend, FiStar, FiWifi, FiWifiOff, FiX } from "react-icons/fi";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import { getIconUrl, normalizeChatChannel, normalizeChatMessage } from "@/app/lib/normalizers";
import type { ChatChannel, ChatMessage, MarketAsset } from "@/app/lib/types";
import { getChatWsUrl } from "@/app/lib/ws";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/chat-page.module.scss";

type ChatEntry = {
  channel: ChatChannel;
  section: "global" | "unit" | "asset";
  ticker: string;
  label: string;
  icon: string | null;
  color: string | null;
  subtitle: string | null;
};

type ChatWsEvent =
  | { type: "chat.hello"; authenticated: boolean }
  | { type: "chat.subscribed"; channel_keys: string[] }
  | { type: "chat.unsubscribed"; channel_keys: string[] }
  | { type: "chat.message.created"; channel_key: string; message: Record<string, unknown> }
  | { type: "chat.message.updated"; channel_key: string; message: Record<string, unknown> }
  | { type: "chat.channel.updated"; channel_key: string; channel: Record<string, unknown> }
  | { type: "chat.read_state.updated"; channel_key: string; user_id: number; last_read_message_id: number | null }
  | { type: "chat.error"; error: string };

type MessageListResponse = {
  messages: Array<Record<string, unknown>>;
  has_more: boolean;
  next_cursor: string | null;
  history_limited: boolean;
  visible_days: number | null;
  oldest_visible_at: string | null;
};

type AuthorNetWorthEntry = {
  user_id: number;
  username: string;
  total_equity: number;
  rank: number;
  updated_at: string | null;
};

type EmojiAsset = {
  id: number;
  name: string;
  filename: string;
  url: string;
};

type ComposerTrigger =
  | { type: "mention"; query: string; start: number; end: number }
  | { type: "emoji"; query: string; start: number; end: number }
  | null;

type ComposerSuggestion =
  | { key: string; type: "mention"; username: string }
  | { key: string; type: "emoji"; emoji: EmojiAsset };

const PINNED_CHANNELS_STORAGE_KEY = "nasfaq.chat.pinned_channels";
const MESSAGE_BOTTOM_THRESHOLD = 24;
const MESSAGE_MAX_LINES = 4;

function normalizeEmojiAsset(value: Record<string, unknown>): EmojiAsset {
  return {
    id: Number(value.id || 0),
    name: String(value.name || ""),
    filename: String(value.filename || ""),
    url: String(value.url || ""),
  };
}

function normalizeUnitKey(value: string | null | undefined) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function buildPreview(body: string | null | undefined) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "No messages yet.";
  return text.length > 72 ? `${text.slice(0, 72).trimEnd()}…` : text;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildChatEntries(channels: ChatChannel[], assets: MarketAsset[]) {
  const assetById = new Map<number, MarketAsset>();
  const assetByUnit = new Map<string, MarketAsset[]>();

  for (const asset of assets) {
    assetById.set(asset.id, asset);
    const unitKey = normalizeUnitKey(asset.unit);
    if (!unitKey) continue;
    const current = assetByUnit.get(unitKey) || [];
    current.push(asset);
    current.sort((left, right) => left.symbol.localeCompare(right.symbol));
    assetByUnit.set(unitKey, current);
  }

  const entries: ChatEntry[] = [];
  for (const channel of channels) {
    if (!channel.is_active) continue;
    if (channel.scope_type === "meta") continue;

    if (channel.scope_type === "market" && channel.scope_key === "global") {
      entries.push({
        channel,
        section: "global",
        ticker: "ALL",
        label: "Global Chat",
        icon: null,
        color: null,
        subtitle: channel.description,
      });
      continue;
    }

    if (channel.scope_type === "unit") {
      const representative = (assetByUnit.get(channel.scope_key) || [])[0] || null;
      const unitLabel = channel.metadata.unit || channel.display_name.replace(/\s+Unit Chat$/i, "");
      entries.push({
        channel,
        section: "unit",
        ticker: unitLabel || "UNIT",
        label: channel.display_name,
        icon: representative?.icon || null,
        color: representative?.color || null,
        subtitle:
          channel.metadata.asset_count && channel.metadata.asset_count > 0
            ? `${fmtInteger(channel.metadata.asset_count)} active chats in this unit`
            : channel.description,
      });
      continue;
    }

    if (channel.scope_type === "asset") {
      const asset = channel.metadata.asset_id ? assetById.get(channel.metadata.asset_id) || null : null;
      entries.push({
        channel,
        section: "asset",
        ticker: channel.metadata.symbol || asset?.symbol || "CHAT",
        label: channel.metadata.display_name || asset?.display_name || channel.display_name,
        icon: channel.metadata.icon || asset?.icon || null,
        color: channel.metadata.color || asset?.color || null,
        subtitle: channel.metadata.unit || asset?.unit || channel.description,
      });
    }
  }

  const global = entries.filter((entry) => entry.section === "global");
  const units = entries
    .filter((entry) => entry.section === "unit")
    .sort((left, right) => left.ticker.localeCompare(right.ticker));
  const assetsOnly = entries
    .filter((entry) => entry.section === "asset")
    .sort((left, right) => left.ticker.localeCompare(right.ticker));

  return [...global, ...units, ...assetsOnly];
}

function upsertMessage(list: ChatMessage[], message: ChatMessage) {
  const existingIndex = list.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) {
    return [...list, message].sort((left, right) => left.id - right.id);
  }
  const next = [...list];
  next[existingIndex] = message;
  return next;
}

function profileInitial(username: string | null | undefined) {
  const trimmed = String(username || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function activateChatRow(event: ReactKeyboardEvent<HTMLElement>, onActivate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onActivate();
}

function readPinnedChannels() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_CHANNELS_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || "")).filter(Boolean);
  } catch {
    return [];
  }
}

function writePinnedChannels(channelKeys: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PINNED_CHANNELS_STORAGE_KEY, JSON.stringify(channelKeys));
}

function isNearBottom(viewport: HTMLDivElement | null) {
  if (!viewport) return true;
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= MESSAGE_BOTTOM_THRESHOLD;
}

function findComposerTrigger(value: string, cursor: number): ComposerTrigger {
  const beforeCursor = value.slice(0, cursor);
  const mentionMatch = beforeCursor.match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
  if (mentionMatch) {
    return {
      type: "mention",
      query: mentionMatch[1] || "",
      start: cursor - mentionMatch[1].length - 1,
      end: cursor,
    };
  }

  const emojiMatch = beforeCursor.match(/(?:^|\s):([A-Za-z0-9_-]*)$/);
  if (emojiMatch) {
    return {
      type: "emoji",
      query: emojiMatch[1] || "",
      start: cursor - emojiMatch[1].length - 1,
      end: cursor,
    };
  }

  return null;
}

function messageMentionsUser(body: string, username: string | null | undefined) {
  const nextUsername = String(username || "").trim();
  if (!nextUsername) return false;
  const escaped = nextUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w])@${escaped}(?=$|[^\\w])`, "i").test(body);
}

function renderMessageBody(body: string, emojiMap: Map<string, EmojiAsset>) {
  const parts: ReactNode[] = [];
  const tokenPattern = /:([A-Za-z0-9_-]+):/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = tokenPattern.exec(body))) {
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }

    const emoji = emojiMap.get(match[1].toLowerCase());
    if (emoji) {
      parts.push(
        <img
          key={`emoji-${emoji.id}-${match.index}`}
          src={`https://images.nasfaq.biz/emojis/${emoji.filename}`}
          alt={`:${emoji.name}:`}
          className={styles.inlineEmoji}
        />
      );
    } else {
      parts.push(match[0]);
    }

    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }

  return parts;
}

export function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [authorNetWorthByUserId, setAuthorNetWorthByUserId] = useState<Record<number, AuthorNetWorthEntry>>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyLimited, setHistoryLimited] = useState(false);
  const [visibleDays, setVisibleDays] = useState<number | null>(null);
  const [pinnedChannelKeys, setPinnedChannelKeys] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [emojis, setEmojis] = useState<EmojiAsset[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [socketState, setSocketState] = useState<"connecting" | "open" | "closed">("connecting");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [pendingNewMessageCount, setPendingNewMessageCount] = useState(0);
  const [composerSelection, setComposerSelection] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const subscribedChannelRef = useRef<string | null>(null);
  const selectedChannelKeyRef = useRef<string | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingOlderRef = useRef(false);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shouldScrollToBottomRef = useRef(false);
  const previousLastMessageIdRef = useRef<number | null>(null);

  function netWorthBadgeClassName(rank: number | null | undefined) {
    if (rank === 1) return [styles.messageNetWorth, styles.messageNetWorthTopTen, styles.messageNetWorthFirst].join(" ");
    if (rank === 2 || rank === 3) return [styles.messageNetWorth, styles.messageNetWorthTopTen, styles.messageNetWorthPodium].join(" ");
    if ((rank || 0) > 0 && (rank || 0) <= 10) return [styles.messageNetWorth, styles.messageNetWorthTopTen].join(" ");
    return styles.messageNetWorth;
  }

  function netWorthRankClassName(rank: number | null | undefined) {
    if (rank === 1) return [styles.messageNetWorthRank, styles.messageNetWorthRankTopTen, styles.messageNetWorthRankFirst].join(" ");
    if (rank === 2 || rank === 3) return [styles.messageNetWorthRank, styles.messageNetWorthRankTopTen, styles.messageNetWorthRankPodium].join(" ");
    if ((rank || 0) > 0 && (rank || 0) <= 10) return [styles.messageNetWorthRank, styles.messageNetWorthRankTopTen].join(" ");
    return styles.messageNetWorthRank;
  }
  const shouldRestoreComposerFocusRef = useRef(false);

  const requestedChannelKey = searchParams.get("channel") || "market:global";
  const chatEntries = useMemo(() => buildChatEntries(channels, assets), [assets, channels]);
  const emojiMap = useMemo(() => new Map(emojis.map((emoji) => [emoji.name.toLowerCase(), emoji])), [emojis]);
  const pinnedChannelKeySet = useMemo(() => new Set(pinnedChannelKeys), [pinnedChannelKeys]);
  const pinnedEntries = useMemo(
    () => chatEntries.filter((entry) => pinnedChannelKeySet.has(entry.channel.channel_key)),
    [chatEntries, pinnedChannelKeySet]
  );
  const selectedEntry = useMemo(
    () => chatEntries.find((entry) => entry.channel.channel_key === requestedChannelKey) || chatEntries[0] || null,
    [chatEntries, requestedChannelKey]
  );
  const knownUsernames = useMemo(() => {
    const usernames = new Set<string>();
    for (const message of messages) {
      const username = String(message.author?.username || "").trim();
      if (username) {
        usernames.add(username);
      }
    }
    return Array.from(usernames).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [messages]);
  const composerTrigger = useMemo(() => findComposerTrigger(draft, composerSelection), [composerSelection, draft]);
  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!composerTrigger) return [];
    const query = composerTrigger.query.toLowerCase();

    if (composerTrigger.type === "mention") {
      return knownUsernames
        .filter((username) => !query || username.toLowerCase().includes(query))
        .slice(0, 8)
        .map((username) => ({ key: `mention-${username.toLowerCase()}`, type: "mention", username }));
    }

    return emojis
      .filter((emoji) => !query || emoji.name.toLowerCase().includes(query))
      .slice(0, 12)
      .map((emoji) => ({ key: `emoji-${emoji.id}`, type: "emoji", emoji }));
  }, [composerTrigger, emojis, knownUsernames]);
  const displayedMessageCount = selectedEntry ? Math.max(selectedEntry.channel.message_count, messages.length) : 0;
  const selectedChannelKey = selectedEntry?.channel.channel_key || null;

  useEffect(() => {
    if (assets.length) return;
    void refreshOverview();
  }, [assets.length, refreshOverview]);

  useEffect(() => {
    setPinnedChannelKeys(readPinnedChannels());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchChannels() {
      setIsLoadingChannels(true);
      setChannelsError(null);
      try {
        const result = await apiFetch<{ channels: Array<Record<string, unknown>> }>("/api/chat/channels");
        if (cancelled) return;
        setChannels((result.channels || []).map(normalizeChatChannel));
      } catch (error) {
        if (cancelled) return;
        setChannelsError(String((error as Error).message || error));
        setChannels([]);
      } finally {
        if (!cancelled) {
          setIsLoadingChannels(false);
        }
      }
    }

    async function fetchEmojis() {
      try {
        const result = await apiFetch<{ emojis: Array<Record<string, unknown>> }>("/api/assets/emojis");
        if (cancelled) return;
        setEmojis((result.emojis || []).map(normalizeEmojiAsset));
      } catch {
        if (!cancelled) {
          setEmojis([]);
        }
      }
    }

    void fetchChannels();
    void fetchEmojis();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedEntry) return;
    if (selectedEntry.channel.channel_key === requestedChannelKey) return;
    startTransition(() => {
      router.replace(`/chat?channel=${encodeURIComponent(selectedEntry.channel.channel_key)}`, { scroll: false });
    });
  }, [requestedChannelKey, router, selectedEntry]);

  useEffect(() => {
    selectedChannelKeyRef.current = selectedEntry?.channel.channel_key || null;
  }, [selectedEntry]);

  useEffect(() => {
    setIsDrawerOpen(false);
  }, [selectedEntry?.channel.channel_key]);

  useEffect(() => {
    setPinnedChannelKeys((current) => {
      const valid = current.filter((channelKey) => chatEntries.some((entry) => entry.channel.channel_key === channelKey));
      if (valid.length !== current.length) {
        writePinnedChannels(valid);
      }
      return valid;
    });
  }, [chatEntries]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedChannelKey) {
      setMessages([]);
      setMessagesError(null);
      setIsLoadingMessages(false);
      setIsLoadingOlder(false);
      setHasMoreMessages(false);
      setNextCursor(null);
      setHistoryLimited(false);
      setVisibleDays(null);
      setPendingNewMessageCount(0);
      setIsAtBottom(true);
      setAuthorNetWorthByUserId({});
      previousLastMessageIdRef.current = null;
      return;
    }

    async function fetchMessages() {
      const channelKey = selectedChannelKey;
      if (!channelKey) return;
      setIsLoadingMessages(true);
      setIsLoadingOlder(false);
      setMessagesError(null);
      try {
        const result = await apiFetch<MessageListResponse>(
          `/api/chat/channels/${encodeURIComponent(channelKey)}/messages?limit=50`
        );
        if (cancelled) return;

        const normalized = (result.messages || []).map(normalizeChatMessage);
        previousLastMessageIdRef.current = normalized[normalized.length - 1]?.id || null;
        shouldScrollToBottomRef.current = true;
        setPendingNewMessageCount(0);
        setIsAtBottom(true);
        setMessages(normalized);
        setHasMoreMessages(Boolean(result.has_more));
        setNextCursor(result.next_cursor || null);
        setHistoryLimited(Boolean(result.history_limited));
        setVisibleDays(result.visible_days ?? null);

        const lastMessage = normalized[normalized.length - 1] || null;
        if (user && lastMessage) {
          void apiFetch(`/api/chat/channels/${encodeURIComponent(channelKey)}/read`, {
            method: "POST",
            body: JSON.stringify({ last_read_message_id: lastMessage.id }),
          }).catch(() => {});
        }
      } catch (error) {
        if (cancelled) return;
        setMessages([]);
        setHasMoreMessages(false);
        setNextCursor(null);
        setHistoryLimited(false);
        setVisibleDays(null);
        setMessagesError(String((error as Error).message || error));
      } finally {
        if (!cancelled) {
          setIsLoadingMessages(false);
        }
      }
    }

    void fetchMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedChannelKey, user]);

  useEffect(() => {
    let cancelled = false;
    const missingAuthorIds = Array.from(
      new Set(
        messages
          .map((message) => message.author?.id || null)
          .filter((userId): userId is number => typeof userId === "number" && userId > 0)
          .filter((userId) => !authorNetWorthByUserId[userId])
      )
    );

    if (!missingAuthorIds.length) return;

    async function fetchAuthorNetWorth() {
      try {
        const query = new URLSearchParams();
        query.set("user_ids", missingAuthorIds.join(","));
        const result = await apiFetch<{ entries: Array<Record<string, unknown>> }>(
          `/api/leaderboard/net-worth?${query.toString()}`
        );
        if (cancelled) return;
        const nextEntries = (result.entries || []).map((item) => ({
          user_id: Number(item.user_id || 0),
          username: String(item.username || ""),
          total_equity: Number(item.total_equity || 0),
          rank: Number(item.rank || 0),
          updated_at: item.updated_at ? String(item.updated_at) : null,
        }));
        setAuthorNetWorthByUserId((current) => {
          const next = { ...current };
          for (const entry of nextEntries) {
            if (entry.user_id > 0) next[entry.user_id] = entry;
          }
          return next;
        });
      } catch {
        if (cancelled) return;
      }
    }

    void fetchAuthorNetWorth();
    return () => {
      cancelled = true;
    };
  }, [authorNetWorthByUserId, messages]);

  useEffect(() => {
    if (!suggestions.length) {
      setActiveSuggestionIndex(0);
      suggestionRefs.current = [];
      return;
    }

    setActiveSuggestionIndex(0);
  }, [suggestions]);

  useEffect(() => {
    if (!suggestions.length) return;
    suggestionRefs.current[activeSuggestionIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeSuggestionIndex, suggestions]);

  useEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    const computed = window.getComputedStyle(input);
    const lineHeight = Number.parseFloat(computed.lineHeight || "22") || 22;
    const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;
    const maxHeight = lineHeight * MESSAGE_MAX_LINES + paddingTop + paddingBottom;
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport || !shouldScrollToBottomRef.current) return;

    window.requestAnimationFrame(() => {
      const nextViewport = messageViewportRef.current;
      if (!nextViewport) return;
      nextViewport.scrollTop = nextViewport.scrollHeight;
      shouldScrollToBottomRef.current = false;
      setPendingNewMessageCount(0);
      setIsAtBottom(true);
    });
  }, [messages, selectedChannelKey]);

  useEffect(() => {
    if (!shouldRestoreComposerFocusRef.current) return;
    restoreComposerFocus(0);
    shouldRestoreComposerFocusRef.current = false;
  }, [messages]);

  useEffect(() => {
    const lastMessageId = messages[messages.length - 1]?.id || null;
    if (!lastMessageId) {
      previousLastMessageIdRef.current = null;
      return;
    }

    const previousLastMessageId = previousLastMessageIdRef.current;
    if (previousLastMessageId === null) {
      previousLastMessageIdRef.current = lastMessageId;
      return;
    }

    if (lastMessageId !== previousLastMessageId) {
      if (shouldScrollToBottomRef.current || isAtBottom) {
        shouldScrollToBottomRef.current = true;
      } else {
        setPendingNewMessageCount((current) => current + 1);
      }
      previousLastMessageIdRef.current = lastMessageId;
    }
  }, [isAtBottom, messages]);

  async function loadOlderMessages() {
    if (!selectedChannelKey || !nextCursor || !hasMoreMessages || loadingOlderRef.current) return;
    const channelKey = selectedChannelKey;
    const viewport = messageViewportRef.current;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    const previousHeight = viewport?.scrollHeight || 0;
    const previousTop = viewport?.scrollTop || 0;

    try {
      const result = await apiFetch<MessageListResponse>(
        `/api/chat/channels/${encodeURIComponent(channelKey)}/messages?limit=50&before=${encodeURIComponent(nextCursor)}`
      );
      const normalized = (result.messages || []).map(normalizeChatMessage);
      setMessages((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        const prepended = normalized.filter((item) => !knownIds.has(item.id));
        return [...prepended, ...current];
      });
      setHasMoreMessages(Boolean(result.has_more));
      setNextCursor(result.next_cursor || null);
      setHistoryLimited(Boolean(result.history_limited));
      setVisibleDays(result.visible_days ?? null);

      window.requestAnimationFrame(() => {
        if (!viewport) return;
        const nextHeight = viewport.scrollHeight;
        viewport.scrollTop = previousTop + (nextHeight - previousHeight);
      });
    } catch (error) {
      setMessagesError(String((error as Error).message || error));
    } finally {
      loadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;

    function handleScroll() {
      if (!viewport) return;
      const nextAtBottom = isNearBottom(viewport);
      setIsAtBottom(nextAtBottom);
      if (nextAtBottom) {
        setPendingNewMessageCount(0);
      }
      if (viewport.scrollTop > 96) return;
      void loadOlderMessages();
    }

    setIsAtBottom(isNearBottom(viewport));
    viewport.addEventListener("scroll", handleScroll);
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [hasMoreMessages, nextCursor, selectedChannelKey]);

  useEffect(() => {
    let disposed = false;

    function cleanupSocket() {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function connect() {
      const wsUrl = getChatWsUrl();
      if (!wsUrl || disposed) return;

      setSocketState("connecting");
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setSocketState("open");
        const channelKey = selectedChannelKeyRef.current;
        if (channelKey) {
          socket.send(JSON.stringify({ action: "subscribe", channel_keys: [channelKey] }));
          subscribedChannelRef.current = channelKey;
        }
      };

      socket.onmessage = (event) => {
        let payload: ChatWsEvent | null = null;
        try {
          payload = JSON.parse(String(event.data || "")) as ChatWsEvent;
        } catch {
          return;
        }

        if (!payload) return;
        if (payload.type === "chat.message.created" || payload.type === "chat.message.updated") {
          const message = normalizeChatMessage(payload.message);
          setMessages((current) => (message.channel_key === selectedChannelKeyRef.current ? upsertMessage(current, message) : current));
          setChannels((current) =>
            current.map((channel) =>
              channel.channel_key === message.channel_key
                ? {
                    ...channel,
                    last_message_id: message.id,
                    last_message_at: message.created_at,
                    last_message_preview: buildPreview(message.body),
                    message_count:
                      payload.type === "chat.message.created" && channel.last_message_id !== message.id
                        ? channel.message_count + 1
                        : channel.message_count,
                    unread_count: channel.channel_key === selectedChannelKeyRef.current ? 0 : channel.unread_count,
                  }
                : channel
            )
          );

          if (user && message.channel_key === selectedChannelKeyRef.current) {
            void apiFetch(`/api/chat/channels/${encodeURIComponent(message.channel_key)}/read`, {
              method: "POST",
              body: JSON.stringify({ last_read_message_id: message.id }),
            }).catch(() => {});
          }
          return;
        }

        if (payload.type === "chat.channel.updated") {
          const nextChannel = normalizeChatChannel(payload.channel);
          setChannels((current) =>
            current.map((channel) => (channel.channel_key === nextChannel.channel_key ? nextChannel : channel))
          );
        }
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        subscribedChannelRef.current = null;
        setSocketState("closed");
        if (!disposed) {
          clearReconnectTimer();
          reconnectTimerRef.current = window.setTimeout(connect, 2000);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      cleanupSocket();
    };
  }, [user]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !selectedChannelKey) return;

    const previousChannelKey = subscribedChannelRef.current;
    if (previousChannelKey && previousChannelKey !== selectedChannelKey) {
      socket.send(JSON.stringify({ action: "unsubscribe", channel_keys: [previousChannelKey] }));
    }
    socket.send(JSON.stringify({ action: "subscribe", channel_keys: [selectedChannelKey] }));
    subscribedChannelRef.current = selectedChannelKey;
  }, [selectedChannelKey]);

  const canPost =
    !!selectedEntry &&
    !!user &&
    selectedEntry.channel.posting_policy !== "read_only" &&
    (selectedEntry.channel.posting_policy !== "admins_only" || user.is_admin) &&
    !selectedEntry.channel.muted_until;

  async function sendMessage() {
    if (!selectedEntry || !canPost || !draft.trim()) return;

    setIsSending(true);
    setSendError(null);
    try {
      const body = draft.trim();
      const result = await apiFetch<{ message: Record<string, unknown>; channel: Record<string, unknown> }>(
        `/api/chat/channels/${encodeURIComponent(selectedEntry.channel.channel_key)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ body }),
        }
      );
      const nextMessage = normalizeChatMessage(result.message);
      shouldRestoreComposerFocusRef.current = true;
      shouldScrollToBottomRef.current = true;
      setMessages((current) => upsertMessage(current, nextMessage));
      setDraft("");
      setComposerSelection(0);
      setActiveSuggestionIndex(0);
      await apiFetch(`/api/chat/channels/${encodeURIComponent(selectedEntry.channel.channel_key)}/read`, {
        method: "POST",
        body: JSON.stringify({ last_read_message_id: nextMessage.id }),
      });
    } catch (error) {
      setSendError(String((error as Error).message || error));
    } finally {
      setIsSending(false);
      shouldRestoreComposerFocusRef.current = true;
      restoreComposerFocus(0);
    }
  }

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function syncComposerSelection() {
    const input = composerInputRef.current;
    if (!input) return;
    setComposerSelection(input.selectionStart || 0);
  }

  function scrollToBottom() {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
    setPendingNewMessageCount(0);
    setIsAtBottom(true);
  }

  function applySuggestion(suggestion: ComposerSuggestion) {
    const trigger = composerTrigger;
    if (!trigger) return;

    const insertedText = suggestion.type === "mention" ? `@${suggestion.username} ` : `:${suggestion.emoji.name}: `;
    const nextDraft = `${draft.slice(0, trigger.start)}${insertedText}${draft.slice(trigger.end)}`;
    const nextSelection = trigger.start + insertedText.length;
    setDraft(nextDraft);
    setComposerSelection(nextSelection);
    setActiveSuggestionIndex(0);

    window.requestAnimationFrame(() => {
      const input = composerInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextSelection, nextSelection);
    });
  }

  function restoreComposerFocus(nextSelection = composerSelection) {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const input = composerInputRef.current;
        if (!input) return;
        input.focus();
        const safeSelection = Math.min(nextSelection, input.value.length);
        input.setSelectionRange(safeSelection, safeSelection);
      }, 0);
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      if (event.key === "Enter") {
        applySuggestion(suggestions[activeSuggestionIndex] || suggestions[0]);
        return;
      }
      const nextIndex = (activeSuggestionIndex + 1) % suggestions.length;
      setActiveSuggestionIndex(nextIndex);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isSending && canPost && draft.trim()) {
        void sendMessage();
      }
    }
  }

  function togglePinnedChannel(channelKey: string) {
    setPinnedChannelKeys((current) => {
      const next = current.includes(channelKey) ? current.filter((item) => item !== channelKey) : [channelKey, ...current];
      writePinnedChannels(next);
      return next;
    });
  }

  return (
    <SiteShell fullBleed hideFooter>
      <div className={styles.appShell}>
        <div
          className={[styles.drawerBackdrop, isDrawerOpen ? styles.drawerBackdropVisible : ""].filter(Boolean).join(" ")}
          onClick={() => setIsDrawerOpen(false)}
          aria-hidden="true"
        />

        <aside className={[styles.sidebar, isDrawerOpen ? styles.sidebarOpen : ""].filter(Boolean).join(" ")}>
          <div className={styles.mobileSidebarBar}>
            <button type="button" className={styles.mobileSidebarClose} onClick={() => setIsDrawerOpen(false)} aria-label="Close chat list">
              <FiX aria-hidden="true" />
            </button>
          </div>
          <div className={styles.sidebarScroll}>
            <div className={styles.sidebarHeader}>
              <h2 className={styles.sidebarTitle}>Chats</h2>
              <span className={styles.sidebarMeta}>{fmtInteger(chatEntries.length)} rooms</span>
            </div>

            {channelsError ? <div className="statusMessage statusMessageError">Chat registry error: {channelsError}</div> : null}
            {isLoadingChannels ? <div className={shellStyles.empty}>Loading chats…</div> : null}

            {!isLoadingChannels ? (
              <div className={styles.chatSections}>
                {pinnedEntries.length ? (
                  <section className={styles.chatSection}>
                    <h3 className={styles.chatSectionTitle}>Pinned</h3>
                    <div className={styles.chatList}>
                      {pinnedEntries.map((entry) => {
                        const isActive = entry.channel.channel_key === selectedEntry?.channel.channel_key;
                        return (
                          <div
                            key={`pinned-${entry.channel.channel_key}`}
                            role="button"
                            tabIndex={0}
                            className={[styles.chatButton, isActive ? styles.chatButtonActive : ""].filter(Boolean).join(" ")}
                            onClick={() => {
                              setIsDrawerOpen(false);
                              startTransition(() => {
                                router.replace(`/chat?channel=${encodeURIComponent(entry.channel.channel_key)}`, { scroll: false });
                              });
                            }}
                            onKeyDown={(event) =>
                              activateChatRow(event, () => {
                                setIsDrawerOpen(false);
                                startTransition(() => {
                                  router.replace(`/chat?channel=${encodeURIComponent(entry.channel.channel_key)}`, { scroll: false });
                                });
                              })
                            }
                          >
                            <AssetCoin symbol={entry.ticker} icon={entry.icon} color={entry.color} className={styles.chatCoin} shape="circle" />
                            <div className={styles.chatButtonBody}>
                              <div className={styles.chatButtonTopline}>
                                <span className={styles.chatTicker}>{entry.ticker}</span>
                                <div className={styles.chatButtonActions}>
                                  {entry.channel.unread_count > 0 ? <span className={styles.unreadBadge}>{entry.channel.unread_count}</span> : null}
                                  <button
                                    type="button"
                                    className={[styles.pinButton, styles.pinButtonActive].join(" ")}
                                    aria-label="Unpin chat"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      togglePinnedChannel(entry.channel.channel_key);
                                    }}
                                  >
                                    <FiStar aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                              <div className={styles.chatLabel}>{entry.label}</div>
                              <div className={styles.chatPreview}>{buildPreview(entry.channel.last_message_preview)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
                {[
                  { key: "global", title: "Global" },
                  { key: "unit", title: "Units" },
                  { key: "asset", title: "Channels" },
                ].map((section) => {
                  const sectionEntries = chatEntries.filter(
                    (entry) => entry.section === section.key && !pinnedChannelKeySet.has(entry.channel.channel_key)
                  );
                  if (!sectionEntries.length) return null;

                  return (
                    <section key={section.key} className={styles.chatSection}>
                      <h3 className={styles.chatSectionTitle}>{section.title}</h3>
                      <div className={styles.chatList}>
                        {sectionEntries.map((entry) => {
                          const isActive = entry.channel.channel_key === selectedEntry?.channel.channel_key;
                          return (
                            <div
                              key={entry.channel.channel_key}
                              role="button"
                              tabIndex={0}
                              className={[styles.chatButton, isActive ? styles.chatButtonActive : ""].filter(Boolean).join(" ")}
                              onClick={() => {
                                setIsDrawerOpen(false);
                                startTransition(() => {
                                  router.replace(`/chat?channel=${encodeURIComponent(entry.channel.channel_key)}`, { scroll: false });
                                });
                              }}
                              onKeyDown={(event) =>
                                activateChatRow(event, () => {
                                  setIsDrawerOpen(false);
                                  startTransition(() => {
                                    router.replace(`/chat?channel=${encodeURIComponent(entry.channel.channel_key)}`, { scroll: false });
                                  });
                                })
                              }
                            >
                              <AssetCoin symbol={entry.ticker} icon={entry.icon} color={entry.color} className={styles.chatCoin} shape="circle" />
                              <div className={styles.chatButtonBody}>
                                <div className={styles.chatButtonTopline}>
                                  <span className={styles.chatTicker}>{entry.ticker}</span>
                                  <div className={styles.chatButtonActions}>
                                    {entry.channel.unread_count > 0 ? <span className={styles.unreadBadge}>{entry.channel.unread_count}</span> : null}
                                    <button
                                      type="button"
                                      className={[styles.pinButton, pinnedChannelKeySet.has(entry.channel.channel_key) ? styles.pinButtonActive : ""].filter(Boolean).join(" ")}
                                      aria-label={pinnedChannelKeySet.has(entry.channel.channel_key) ? "Unpin chat" : "Pin chat"}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        togglePinnedChannel(entry.channel.channel_key);
                                      }}
                                    >
                                      <FiStar aria-hidden="true" />
                                    </button>
                                  </div>
                                </div>
                                <div className={styles.chatLabel}>{entry.label}</div>
                                <div className={styles.chatPreview}>{buildPreview(entry.channel.last_message_preview)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : null}
          </div>
        </aside>

        <section className={styles.chatPanel}>
          <header className={styles.topbar}>
            <div className={styles.topbarStart}>
              <button type="button" className={styles.mobileMenuButton} onClick={() => setIsDrawerOpen(true)} aria-label="Open chat list">
                <FiMenu aria-hidden="true" />
              </button>
            </div>
          </header>

          <section className={styles.chatSurface}>
            {selectedEntry ? (
              <>
                <header className={styles.chatHeader}>
                  <div className={styles.chatIdentity}>
                    <AssetCoin
                      symbol={selectedEntry.ticker}
                      icon={selectedEntry.icon}
                      color={selectedEntry.color}
                      className={styles.headerCoin}
                      shape="circle"
                    />
                    <div className={styles.chatIdentityBody}>
                      <div className={styles.chatEyebrow}>{selectedEntry.ticker}</div>
                      <h2 className={styles.chatTitle}>{selectedEntry.label}</h2>
                      <p className={styles.chatSubtitle}>{selectedEntry.subtitle || selectedEntry.channel.description || "Live room"}</p>
                    </div>
                    <div className={styles.chatMeta}>
                      <span>{fmtInteger(displayedMessageCount)} messages</span>
                      <span>{selectedEntry.channel.posting_policy === "read_only" ? "Read only" : "Open"}</span>
                    </div>
                  </div>
            <div className={styles.socketBadge}>
              {socketState === "open" ? <FiWifi aria-hidden="true" /> : socketState === "connecting" ? <FiRadio aria-hidden="true" /> : <FiWifiOff aria-hidden="true" />}
              <span>{socketState === "open" ? "Live" : socketState === "connecting" ? "Connecting" : "Offline"}</span>
            </div>
                </header>

                {messagesError ? <div className="statusMessage statusMessageError">Chat load error: {messagesError}</div> : null}

                <div ref={messageViewportRef} className={styles.messageViewport}>
                  {pendingNewMessageCount > 0 ? (
                    <button type="button" className={styles.newMessagesBanner} onClick={scrollToBottom}>
                      <span>{pendingNewMessageCount} new {pendingNewMessageCount === 1 ? "message" : "messages"}</span>
                      <FiChevronDown aria-hidden="true" />
                    </button>
                  ) : null}
                  {isLoadingOlder ? <div className={styles.historyLoader}>Loading older messages…</div> : null}
                  {isLoadingMessages ? (
                    <div className={styles.messageSkeletonList} aria-hidden="true">
                      {Array.from({ length: 7 }, (_, index) => (
                        <div key={`message-skeleton-${index}`} className={styles.messageSkeletonRow}>
                          <span className={styles.messageSkeletonAvatar} />
                          <div className={styles.messageSkeletonContent}>
                            <div className={styles.messageSkeletonTopline}>
                              <span className={[styles.skeletonBlock, styles.messageSkeletonAuthor].join(" ")} />
                              <span className={[styles.skeletonBlock, styles.messageSkeletonTime].join(" ")} />
                            </div>
                            <span className={[styles.skeletonBlock, styles.messageSkeletonLine].join(" ")} />
                            <span className={[styles.skeletonBlock, styles.messageSkeletonLineShort].join(" ")} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {!isLoadingMessages && !messages.length ? <div className={shellStyles.empty}>No one has posted here yet.</div> : null}

                  {!isLoadingMessages && !isLoadingOlder && historyLimited && messages.length ? (
                    <div className={styles.historyLoader}>
                      {visibleDays ? `Visible history limited to the last ${visibleDays} days.` : "Visible history is limited in this room."}
                    </div>
                  ) : null}
                  
                  {!isLoadingMessages && messages.length
                    ? messages.map((message) => (
                        <article
                          key={message.id}
                          className={[styles.messageRow, messageMentionsUser(message.body, user?.username) ? styles.messageRowMentioned : ""].filter(Boolean).join(" ")}
                        >
                          <div className={styles.messageAvatar}>
                            {message.author?.profile_picture_url ? (
                              <img src={message.author.profile_picture_url} alt="" className={styles.messageAvatarImage} />
                            ) : (
                              <span className={styles.messageAvatarFallback}>{profileInitial(message.author?.username)}</span>
                            )}
                          </div>
                          <div className={styles.messageContent}>
                            {(() => {
                              const authorCoinIconUrl = getIconUrl(message.author?.oshi_coin?.icon);
                              return (
                                <>
                            <div className={styles.messageTopline}>
                              <span
                                className={styles.messageAuthor}
                                style={message.author?.profile_color ? { color: message.author.profile_color } : undefined}
                              >
                                {message.author?.username || "Unknown"}
                              </span>
                              {message.author?.id && authorNetWorthByUserId[message.author.id] ? (
                                <span className={netWorthBadgeClassName(authorNetWorthByUserId[message.author.id]?.rank)}>
                                  <span className={netWorthRankClassName(authorNetWorthByUserId[message.author.id]?.rank)}>
                                    #{fmtInteger(authorNetWorthByUserId[message.author.id]?.rank)}
                                  </span>
                                  <span className={styles.messageNetWorthValue}>{fmtNumber(authorNetWorthByUserId[message.author.id]?.total_equity, "$")}</span>
                                </span>
                              ) : null}
                              {authorCoinIconUrl && message.author?.oshi_coin ? (
                                <img
                                  src={authorCoinIconUrl}
                                  alt={message.author.oshi_coin.symbol}
                                  className={styles.messageAuthorCoin}
                                />
                              ) : null}
                              <time className={styles.messageTime} dateTime={message.created_at}>
                                {formatMessageTime(message.created_at)}
                              </time>
                            </div>
                            <p className={styles.messageBody}>{renderMessageBody(message.body, emojiMap)}</p>
                                </>
                              );
                            })()}
                          </div>
                        </article>
                      ))
                    : null}
                  <div className={styles.messageBottomSpacer} aria-hidden="true" />
                </div>

                <form className={styles.composer} onSubmit={handleSendMessage}>
                  {user && selectedEntry.channel.muted_until ? (
                    <div className="statusMessage statusMessageWarn">
                      You are muted in this room until {formatMessageTime(selectedEntry.channel.muted_until)}.
                    </div>
                  ) : null}
                  {user && selectedEntry.channel.posting_policy === "admins_only" && !user.is_admin ? (
                    <div className="statusMessage statusMessageWarn">This room is currently limited to admins.</div>
                  ) : null}
                  {sendError ? <div className="statusMessage statusMessageError">Send failed: {sendError}</div> : null}
                  <label className={styles.composerLabel} htmlFor="chat-message">
                    Message
                  </label>
                  <div className={styles.composerBox}>
                    {!user ? (
                      <div className={styles.composerPrompt}>
                        Sign in to chat.{" "}
                        <Link href="/login" className="appLink">
                          Login
                        </Link>
                      </div>
                    ) : (
                      <>
                        <div
                          className={styles.composerInputWrap}
                          onClick={() => {
                            composerInputRef.current?.focus();
                          }}
                        >
                          <textarea
                            id="chat-message"
                            ref={composerInputRef}
                            className={styles.composerInput}
                            value={draft}
                            onChange={(event) => {
                              setDraft(event.target.value);
                              setComposerSelection(event.target.selectionStart || 0);
                            }}
                            onClick={syncComposerSelection}
                            onKeyUp={syncComposerSelection}
                            onSelect={syncComposerSelection}
                            onKeyDown={handleComposerKeyDown}
                            placeholder={canPost ? `Message #${selectedEntry.ticker.toLowerCase()}` : "Posting is unavailable in this room"}
                            rows={1}
                            maxLength={1000}
                            disabled={!canPost || isSending}
                          />
                          {composerTrigger && suggestions.length ? (
                            <div className={styles.composerSuggestions} role="listbox">
                              {suggestions.map((suggestion, index) => (
                                <button
                                  key={suggestion.key}
                                  type="button"
                                  ref={(element) => {
                                    suggestionRefs.current[index] = element;
                                  }}
                                  className={[styles.composerSuggestion, index === activeSuggestionIndex ? styles.composerSuggestionActive : ""].filter(Boolean).join(" ")}
                                  onMouseDown={(event) => event.preventDefault()}
                                  tabIndex={-1}
                                  aria-selected={index === activeSuggestionIndex}
                                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                                  onClick={() => applySuggestion(suggestion)}
                                >
                                  {suggestion.type === "mention" ? (
                                    <>
                                      <span className={styles.suggestionPrimary}>@{suggestion.username}</span>
                                      <span className={styles.suggestionSecondary}>mention</span>
                                    </>
                                  ) : (
                                    <>
                                      <img src={suggestion.emoji.url} alt={suggestion.emoji.name} className={styles.suggestionEmoji} />
                                      <div className={styles.suggestionEmojiBody}>
                                        <span className={styles.suggestionPrimary}>{suggestion.emoji.name}</span>
                                        <span className={styles.suggestionSecondary}>:{suggestion.emoji.name}:</span>
                                      </div>
                                    </>
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className={styles.composerFooter}>
                          <span className={styles.composerHint}>{draft.trim().length}/1000</span>
                          <button type="submit" className={styles.sendButton} disabled={!canPost || isSending || !draft.trim()}>
                            <FiSend aria-hidden="true" />
                            <span>{isSending ? "Sending" : "Send"}</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </form>
              </>
            ) : (
              <div className={shellStyles.empty}>No chat rooms are available.</div>
            )}
          </section>
        </section>
      </div>
    </SiteShell>
  );
}
