"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  FiActivity,
  FiBarChart2,
  FiClock,
  FiExternalLink,
  FiFilter,
  FiHash,
  FiImage,
  FiMessageSquare,
  FiRefreshCcw,
  FiSearch,
  FiTrendingUp,
  FiUser,
  FiZap,
} from "react-icons/fi";
import type { IconType } from "react-icons";
import { LoadingSpinner } from "@/app/components/common/loading-spinner";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/nasfaq-thread-page.module.scss";

const YOU_TRACKING_STORAGE_KEY = "nasfaq-thread-you-state-v1";

type NasfaqThreadPost = {
  post_id: number;
  timestamp: number | null;
  author: string;
  text_content: string;
  image_url: string | null;
  thumbnail_url: string | null;
  op_cdn_image_url: string | null;
};

type NasfaqThreadResponse = {
  key: string;
  board: string;
  thread_id: number;
  subject: string | null;
  updated_at: string | null;
  posts: NasfaqThreadPost[];
};

type QuotePreviewState = {
  postId: number;
  x: number;
  y: number;
};

type ThreadTabKey = "nasfaq" | "hlg" | "numbers" | "news";

type ThreadTabDefinition = {
  key: ThreadTabKey;
  label: string;
  endpoint: string;
  notFoundError: string;
  emptyCopy: string;
};

type ThreadLoadState = {
  data: NasfaqThreadResponse | null;
  error: string | null;
  isLoading: boolean;
};

type PersistedThreadTabState = {
  threadId: number | null;
  youPostIds: number[];
  seenReplyIds: number[];
};

type PersistedYouState = Record<ThreadTabKey, PersistedThreadTabState>;
type ThreadSortMode = "latest" | "oldest" | "replies";
type ThreadMediaMode = "all" | "with-media" | "text-only";

const DEFAULT_THREAD_TAB: ThreadTabKey = "nasfaq";
const TICKER_STOP_WORDS = new Set(["HTTP", "HTTPS", "THIS", "READ", "THE", "AND", "FOR", "YOU", "ARE", "NOT", "YES", "NO", "OP"]);

const THREAD_TABS: ThreadTabDefinition[] = [
  {
    key: "nasfaq",
    label: "/nasfaq/",
    endpoint: "/api/getNasfaqThread",
    notFoundError: "nasfaq_thread_not_found",
    emptyCopy: "No current NASFAQ thread found.",
  },
  {
    key: "hlg",
    label: "/hlg/",
    endpoint: "/api/getHlgThread",
    notFoundError: "hlg_thread_not_found",
    emptyCopy: "No current HLG thread found.",
  },
  {
    key: "numbers",
    label: "/#/",
    endpoint: "/api/getNumbersThread",
    notFoundError: "numbers_thread_not_found",
    emptyCopy: "No current Numbers thread found.",
  },
  {
    key: "news",
    label: "/news/",
    endpoint: "/api/getNewsThread",
    notFoundError: "news_thread_not_found",
    emptyCopy: "No current /news/ thread found.",
  },
];

function buildInitialThreadState() {
  return THREAD_TABS.reduce<Record<ThreadTabKey, ThreadLoadState>>((acc, tab) => {
    acc[tab.key] = { data: null, error: null, isLoading: tab.key === DEFAULT_THREAD_TAB };
    return acc;
  }, {} as Record<ThreadTabKey, ThreadLoadState>);
}

function buildInitialPersistedYouState(): PersistedYouState {
  return THREAD_TABS.reduce<PersistedYouState>((acc, tab) => {
    acc[tab.key] = {
      threadId: null,
      youPostIds: [],
      seenReplyIds: [],
    };
    return acc;
  }, {} as PersistedYouState);
}

function parsePersistedYouState(value: string | null): PersistedYouState {
  if (!value) return buildInitialPersistedYouState();

  try {
    const parsed = JSON.parse(value) as Partial<Record<ThreadTabKey, Partial<PersistedThreadTabState> & { youPostId?: number }>>;
    const next = buildInitialPersistedYouState();

    for (const tab of THREAD_TABS) {
      const entry = parsed?.[tab.key];
      next[tab.key] = {
        threadId: typeof entry?.threadId === "number" ? entry.threadId : null,
        youPostIds: Array.isArray(entry?.youPostIds)
          ? entry.youPostIds.filter((postId): postId is number => typeof postId === "number" && Number.isFinite(postId))
          : typeof entry?.youPostId === "number"
            ? [entry.youPostId]
            : [],
        seenReplyIds: Array.isArray(entry?.seenReplyIds)
          ? entry.seenReplyIds.filter((replyId): replyId is number => typeof replyId === "number" && Number.isFinite(replyId))
          : [],
      };
    }

    return next;
  } catch {
    return buildInitialPersistedYouState();
  }
}

function formatThreadTimestamp(value: number | null) {
  if (!value) return "Unknown time";
  return new Date(value * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "Unknown refresh";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCompactTime(value: number | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value * 1000);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function sanitizePreviewText(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function clampPreview(value: string, maxLength = 260) {
  const clean = sanitizePreviewText(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trim()}...`;
}

function countLinks(value: string) {
  return (String(value || "").match(/https?:\/\/[^\s<]+/g) || []).length;
}

function getPostReplyCount(postId: number, replyIndex: Map<number, number[]>) {
  return (replyIndex.get(postId) || []).length;
}

function getPostMediaLabel(post: NasfaqThreadPost, isOp: boolean) {
  if (isOp && post.op_cdn_image_url) return "Featured OP image placeholder";
  if (post.thumbnail_url || post.image_url) return "Attached thread thumbnail placeholder";
  return "No image attached";
}

function extractThreadTerms(posts: NasfaqThreadPost[]) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const matches = String(post.text_content || "").match(/\b[A-Z][A-Z0-9]{1,5}\b/g) || [];
    for (const match of matches) {
      if (TICKER_STOP_WORDS.has(match)) continue;
      counts.set(match, (counts.get(match) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([term, count]) => ({ term, count }));
}

function calculateThreadVelocity(posts: NasfaqThreadPost[]) {
  const timestamps = posts
    .map((post) => post.timestamp)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (timestamps.length < 2) return "warming up";
  const hours = Math.max((timestamps[timestamps.length - 1] - timestamps[0]) / 3600, 0.25);
  return `${Math.max(1, Math.round(timestamps.length / hours))}/hr`;
}

function ControlLabel({ icon: Icon, children }: { icon: IconType; children: ReactNode }) {
  return (
    <span className={styles.controlLabel}>
      <Icon aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

function StatTile({ label, value, meta, icon: Icon }: { label: string; value: string; meta: string; icon: IconType }) {
  return (
    <div className={styles.statTile}>
      <span className={styles.statIcon}><Icon aria-hidden="true" /></span>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{meta}</em>
    </div>
  );
}

function MediaPlaceholder({ label, featured = false }: { label: string; featured?: boolean }) {
  return (
    <div className={`${styles.mediaPlaceholder} ${featured ? styles.mediaPlaceholderFeatured : ""}`.trim()}>
      <FiImage aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function PostMedia({ post, featured = false }: { post: NasfaqThreadPost; featured?: boolean }) {
  const imageSrc = featured ? post.op_cdn_image_url : post.thumbnail_url;
  const imageHref = featured ? post.image_url || post.op_cdn_image_url : post.image_url;

  if (!imageSrc) {
    if (!featured) return null;
    return <MediaPlaceholder label={getPostMediaLabel(post, featured)} featured={featured} />;
  }

  const image = (
    <img
      src={imageSrc}
      alt=""
      className={`${styles.threadImage} ${featured ? styles.threadImageFeatured : ""}`.trim()}
      loading="lazy"
    />
  );

  if (!imageHref) {
    return image;
  }

  return (
    <a href={imageHref} target="_blank" rel="noreferrer" className={`${styles.mediaLink} ${featured ? styles.mediaLinkFeatured : ""}`.trim()}>
      {image}
    </a>
  );
}

function getQuotePreviewPosition(clientX: number, clientY: number) {
  if (typeof window === "undefined") {
    return { x: clientX + 18, y: clientY + 18 };
  }

  const previewWidth = Math.min(420, Math.floor(window.innerWidth * 0.42));
  const previewHeight = Math.min(320, Math.floor(window.innerHeight * 0.5));

  return {
    x: Math.max(12, Math.min(clientX + 18, window.innerWidth - previewWidth - 12)),
    y: Math.max(12, Math.min(clientY + 18, window.innerHeight - previewHeight - 12)),
  };
}

function buildReplyIndex(posts: NasfaqThreadPost[]) {
  const replyIndex = new Map<number, number[]>();

  for (const post of posts) {
    const matches = String(post.text_content || "").match(/>>(\d+)/g) || [];
    const seen = new Set<number>();
    for (const match of matches) {
      const targetId = Number(match.slice(2));
      if (!Number.isFinite(targetId) || seen.has(targetId)) continue;
      seen.add(targetId);
      const current = replyIndex.get(targetId) || [];
      current.push(post.post_id);
      replyIndex.set(targetId, current);
    }
  }

  return replyIndex;
}

function renderInlinePostText(
  text: string,
  availablePostIds: Set<number>,
  showQuotePreview: (postId: number, clientX: number, clientY: number) => void,
  hideQuotePreview: () => void
) {
  const parts = text.split(/(>>\d+|https?:\/\/[^\s<]+)/g);

  return parts.map((part, index) => {
    const match = /^>>(\d+)$/.exec(part);
    if (match) {
      const targetPostId = Number(match[1]);
      if (!availablePostIds.has(targetPostId)) {
        return <span key={`${part}:${index}`}>{part}</span>;
      }

      return (
        <a
          key={`${part}:${index}`}
          href={`#post-${targetPostId}`}
          className={styles.replyLink}
          onMouseEnter={(event) => {
            showQuotePreview(targetPostId, event.clientX, event.clientY);
          }}
          onMouseMove={(event) => {
            showQuotePreview(targetPostId, event.clientX, event.clientY);
          }}
          onMouseLeave={hideQuotePreview}
        >
          {part}
        </a>
      );
    }

    if (/^https?:\/\/[^\s<]+$/.test(part)) {
      return (
        <a key={`${part}:${index}`} href={part} target="_blank" rel="noreferrer" className={styles.inlineUrl}>
          {part}
        </a>
      );
    }

    return <Fragment key={`${part}:${index}`}>{part}</Fragment>;
  });
}

function renderPostText(
  text: string,
  availablePostIds: Set<number>,
  isOp: boolean,
  showQuotePreview: (postId: number, clientX: number, clientY: number) => void,
  hideQuotePreview: () => void
) {
  const lines = text ? text.split("\n") : [];

  if (!lines.length) {
    return null;
  }

  return lines.map((line, index) => {
    const trimmed = line.trimStart();
    const isQuotedLine = trimmed.startsWith(">") && !trimmed.startsWith(">>");
    const isOpLeadLine = isOp && index === 0;

    return (
      <div
        key={`${index}:${line}`}
        className={`${styles.postLine} ${isQuotedLine ? styles.postLineQuoted : ""} ${isOpLeadLine ? styles.postLineLead : ""}`.trim()}
      >
        {line ? renderInlinePostText(line, availablePostIds, showQuotePreview, hideQuotePreview) : "\u00A0"}
      </div>
    );
  });
}

export function NasfaqThreadPage() {
  const processedThreadSignatureByTabRef = useRef<Record<ThreadTabKey, string>>({
    nasfaq: "",
    hlg: "",
    numbers: "",
    news: "",
  });
  const [activeTab, setActiveTab] = useState<ThreadTabKey>(DEFAULT_THREAD_TAB);
  const [threadStateByKey, setThreadStateByKey] = useState<Record<ThreadTabKey, ThreadLoadState>>(buildInitialThreadState);
  const [quotePreview, setQuotePreview] = useState<QuotePreviewState | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<ThreadSortMode>("oldest");
  const [mediaMode, setMediaMode] = useState<ThreadMediaMode>("all");
  const [highlightOnly, setHighlightOnly] = useState(false);
  const [persistedYouState, setPersistedYouState] = useState<PersistedYouState>(buildInitialPersistedYouState);
  const [hasLoadedPersistedYouState, setHasLoadedPersistedYouState] = useState(false);
  const [unreadReplyCountByTab, setUnreadReplyCountByTab] = useState<Record<ThreadTabKey, number>>(() =>
    THREAD_TABS.reduce<Record<ThreadTabKey, number>>((acc, tab) => {
      acc[tab.key] = 0;
      return acc;
    }, {} as Record<ThreadTabKey, number>)
  );
  const activeTabDefinition = THREAD_TABS.find((tab) => tab.key === activeTab) || THREAD_TABS[0];
  const activeState = threadStateByKey[activeTab];

  const activateTab = useCallback((tabKey: ThreadTabKey) => {
    setQuotePreview(null);
    setThreadStateByKey((current) => {
      const nextState = current[tabKey];
      if (nextState.data || nextState.error || nextState.isLoading) {
        return current;
      }

      return {
        ...current,
        [tabKey]: {
          ...nextState,
          isLoading: true,
          error: null,
        },
      };
    });
    setActiveTab(tabKey);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPersistedYouState(parsePersistedYouState(window.localStorage.getItem(YOU_TRACKING_STORAGE_KEY)));
    setHasLoadedPersistedYouState(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedYouState || typeof window === "undefined") return;
    window.localStorage.setItem(YOU_TRACKING_STORAGE_KEY, JSON.stringify(persistedYouState));
  }, [hasLoadedPersistedYouState, persistedYouState]);

  useEffect(() => {
    if (!activeState.isLoading || activeState.data) return undefined;

    const controller = new AbortController();

    void apiFetch<NasfaqThreadResponse>(activeTabDefinition.endpoint, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((result) => {
        setThreadStateByKey((current) => ({
          ...current,
          [activeTab]: {
            data: result,
            error: null,
            isLoading: false,
          },
        }));
      })
      .catch((nextError) => {
        if ((nextError as Error).name === "AbortError") return;
        setThreadStateByKey((current) => ({
          ...current,
          [activeTab]: {
            data: null,
            error: String((nextError as Error).message || nextError),
            isLoading: false,
          },
        }));
      });

    return () => controller.abort();
  }, [activeState.data, activeState.isLoading, activeTab, activeTabDefinition.endpoint]);

  const thread = activeState.data;
  const posts = useMemo(() => thread?.posts || [], [thread]);
  const availablePostIds = useMemo(() => new Set(posts.map((post) => post.post_id)), [posts]);
  const replyIndex = useMemo(() => buildReplyIndex(posts), [posts]);
  const postById = useMemo(() => new Map(posts.map((post) => [post.post_id, post])), [posts]);
  const previewPost = quotePreview ? postById.get(quotePreview.postId) || null : null;
  const isNotFound = activeState.error === activeTabDefinition.notFoundError;
  const activePersistedState = persistedYouState[activeTab];
  const activeYouPostIds = useMemo(
    () =>
      thread && activePersistedState.threadId === thread.thread_id
        ? activePersistedState.youPostIds.filter((postId) => availablePostIds.has(postId))
        : [],
    [activePersistedState.threadId, activePersistedState.youPostIds, availablePostIds, thread]
  );
  const activeReplyIdsToYou = useMemo(() => {
    const replyIds = new Set<number>();
    for (const youPostId of activeYouPostIds) {
      for (const replyId of replyIndex.get(youPostId) || []) {
        replyIds.add(replyId);
      }
    }

    return Array.from(replyIds).sort((a, b) => a - b);
  }, [activeYouPostIds, replyIndex]);
  const activeYouPostIdSet = useMemo(() => new Set(activeYouPostIds), [activeYouPostIds]);
  const activeReplyIdsToYouSet = useMemo(() => new Set(activeReplyIdsToYou), [activeReplyIdsToYou]);
  const opPost = posts[0] || null;
  const threadTerms = useMemo(() => extractThreadTerms(posts), [posts]);
  const threadStats = useMemo(() => {
    const mediaPosts = posts.filter((post) => post.image_url || post.thumbnail_url || post.op_cdn_image_url).length;
    const linkCount = posts.reduce((sum, post) => sum + countLinks(post.text_content), 0);
    const replyCount = posts.reduce((sum, post) => sum + getPostReplyCount(post.post_id, replyIndex), 0);
    const latestTimestamp = posts.reduce<number | null>((latest, post) => {
      if (!post.timestamp) return latest;
      return latest === null || post.timestamp > latest ? post.timestamp : latest;
    }, null);
    const relevanceScore = posts.length ? Math.min(99, Math.round(42 + mediaPosts * 3 + linkCount * 2 + Math.min(replyCount, 24))) : 0;

    return {
      mediaPosts,
      linkCount,
      replyCount,
      latestTimestamp,
      velocity: calculateThreadVelocity(posts),
      relevanceScore,
    };
  }, [posts, replyIndex]);
  const filteredPosts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const nextPosts = posts.filter((post, index) => {
      const hasMedia = Boolean(post.image_url || post.thumbnail_url || post.op_cdn_image_url);
      const replyCount = getPostReplyCount(post.post_id, replyIndex);
      const hasLinks = countLinks(post.text_content) > 0;

      if (mediaMode === "with-media" && !hasMedia) return false;
      if (mediaMode === "text-only" && hasMedia) return false;
      if (highlightOnly && !hasMedia && !hasLinks && replyCount === 0 && index !== 0) return false;
      if (!normalizedSearch) return true;

      return `${post.post_id} ${post.author || ""} ${post.text_content || ""}`.toLowerCase().includes(normalizedSearch);
    });

    return [...nextPosts].sort((a, b) => {
      if (sortMode === "oldest") return (a.timestamp || 0) - (b.timestamp || 0) || a.post_id - b.post_id;
      if (sortMode === "replies") return getPostReplyCount(b.post_id, replyIndex) - getPostReplyCount(a.post_id, replyIndex) || (b.timestamp || 0) - (a.timestamp || 0);
      return (b.timestamp || 0) - (a.timestamp || 0) || b.post_id - a.post_id;
    });
  }, [highlightOnly, mediaMode, posts, replyIndex, searchQuery, sortMode]);
  const feedPosts = useMemo(() => filteredPosts.filter((post) => post.post_id !== opPost?.post_id), [filteredPosts, opPost?.post_id]);
  const hideQuotePreview = useCallback(() => {
    setQuotePreview(null);
  }, []);
  const showQuotePreview = useCallback((postId: number, clientX: number, clientY: number) => {
    const position = getQuotePreviewPosition(clientX, clientY);
    setQuotePreview({ postId, x: position.x, y: position.y });
  }, []);

  useEffect(() => {
    if (!quotePreview) return undefined;

    let frame = 0;
    const handleMouseMove = (event: MouseEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const position = getQuotePreviewPosition(event.clientX, event.clientY);
        setQuotePreview((current) => (current ? { ...current, x: position.x, y: position.y } : current));
      });
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [quotePreview]);

  useEffect(() => {
    if (!hasLoadedPersistedYouState) return;

    setPersistedYouState((current) => {
      let didChange = false;
      const nextState = { ...current };

      for (const tab of THREAD_TABS) {
        const threadData = threadStateByKey[tab.key].data;
        if (!threadData) continue;

        const persisted = current[tab.key];
        if (persisted.threadId !== threadData.thread_id) {
          nextState[tab.key] = {
            threadId: threadData.thread_id,
            youPostIds: [],
            seenReplyIds: [],
          };
          didChange = true;
        } else if (persisted.youPostIds.length) {
          const postIds = new Set(threadData.posts.map((post) => post.post_id));
          const nextYouPostIds = persisted.youPostIds.filter((postId) => postIds.has(postId));
          if (nextYouPostIds.length !== persisted.youPostIds.length) {
            nextState[tab.key] = {
              ...persisted,
              youPostIds: nextYouPostIds,
              seenReplyIds: [],
            };
            didChange = true;
          }
        }
      }

      return didChange ? nextState : current;
    });
  }, [hasLoadedPersistedYouState, threadStateByKey]);

  useEffect(() => {
    if (!hasLoadedPersistedYouState) return;
    let nextUnreadCounts: Record<ThreadTabKey, number> | null = null;
    let nextPersistedState: PersistedYouState | null = null;

    for (const tab of THREAD_TABS) {
      const threadData = threadStateByKey[tab.key].data;
      const persisted = persistedYouState[tab.key];

      if (!threadData || persisted.threadId !== threadData.thread_id || !persisted.youPostIds.length) {
        if (unreadReplyCountByTab[tab.key] !== 0) {
          nextUnreadCounts ||= { ...unreadReplyCountByTab };
          nextUnreadCounts[tab.key] = 0;
        }
        continue;
      }

      const threadSignature = `${threadData.thread_id}:${threadData.updated_at || "none"}:${threadData.posts.length}:${threadData.posts[threadData.posts.length - 1]?.post_id || 0}`;
      if (processedThreadSignatureByTabRef.current[tab.key] === threadSignature) {
        continue;
      }
      processedThreadSignatureByTabRef.current[tab.key] = threadSignature;

      const replyIds = new Set<number>();
      const tabReplyIndex = buildReplyIndex(threadData.posts);
      for (const youPostId of persisted.youPostIds) {
        for (const replyId of tabReplyIndex.get(youPostId) || []) {
          replyIds.add(replyId);
        }
      }

      const seenSet = new Set(persisted.seenReplyIds);
      const newReplyIds = Array.from(replyIds).filter((replyId) => !seenSet.has(replyId)).sort((a, b) => a - b);

      nextUnreadCounts ||= { ...unreadReplyCountByTab };
      nextUnreadCounts[tab.key] = newReplyIds.length;

      if (newReplyIds.length) {
        nextPersistedState ||= { ...persistedYouState };
        nextPersistedState[tab.key] = {
          ...persisted,
          seenReplyIds: Array.from(new Set([...persisted.seenReplyIds, ...newReplyIds])).sort((a, b) => a - b),
        };
      }
    }

    if (nextUnreadCounts) {
      setUnreadReplyCountByTab((current) => {
        for (const tab of THREAD_TABS) {
          if (current[tab.key] !== nextUnreadCounts![tab.key]) {
            return nextUnreadCounts!;
          }
        }
        return current;
      });
    }

    if (nextPersistedState) {
      setPersistedYouState((current) => {
        for (const tab of THREAD_TABS) {
          const currentEntry = current[tab.key];
          const nextEntry = nextPersistedState![tab.key];
          if (
            currentEntry.threadId !== nextEntry.threadId ||
            currentEntry.youPostIds.length !== nextEntry.youPostIds.length ||
            currentEntry.youPostIds.some((postId, index) => postId !== nextEntry.youPostIds[index]) ||
            currentEntry.seenReplyIds.length !== nextEntry.seenReplyIds.length ||
            currentEntry.seenReplyIds.some((replyId, index) => replyId !== nextEntry.seenReplyIds[index])
          ) {
            return nextPersistedState!;
          }
        }

        return current;
      });
    }
  }, [hasLoadedPersistedYouState, persistedYouState, threadStateByKey, unreadReplyCountByTab]);

  const toggleYouPost = useCallback(
    (postId: number) => {
      if (!thread) return;

      setPersistedYouState((current) => {
        const persisted = current[activeTab];
        const currentYouPostIds = persisted.threadId === thread.thread_id ? persisted.youPostIds : [];
        const nextYouPostIds = currentYouPostIds.includes(postId)
          ? currentYouPostIds.filter((currentPostId) => currentPostId !== postId)
          : [...currentYouPostIds, postId].sort((a, b) => a - b);
        const nextSeenReplyIds =
          nextYouPostIds.length === 0
            ? []
            : Array.from(
                new Set(
                  nextYouPostIds.flatMap((youPostId) => replyIndex.get(youPostId) || [])
                )
              ).sort((a, b) => a - b);

        return {
          ...current,
          [activeTab]: {
            threadId: thread.thread_id,
            youPostIds: nextYouPostIds,
            seenReplyIds: nextSeenReplyIds,
          },
        };
      });
      setUnreadReplyCountByTab((current) => ({
        ...current,
        [activeTab]: 0,
      }));
    },
    [activeTab, replyIndex, thread]
  );

  const renderReplyLinks = useCallback(
    (post: NasfaqThreadPost) => {
      const replyIds = replyIndex.get(post.post_id) || [];
      if (!replyIds.length) return null;

      return (
        <span className={styles.replyCluster}>
          {replyIds.slice(0, 5).map((replyPostId) => (
            <a
              key={`${post.post_id}:${replyPostId}`}
              href={`#post-${replyPostId}`}
              className={styles.replyLink}
              onMouseEnter={(event) => {
                showQuotePreview(replyPostId, event.clientX, event.clientY);
              }}
              onMouseMove={(event) => {
                showQuotePreview(replyPostId, event.clientX, event.clientY);
              }}
              onMouseLeave={hideQuotePreview}
            >
              {`>>${replyPostId}`}
            </a>
          ))}
          {replyIds.length > 5 ? <span className={styles.replyOverflow}>+{replyIds.length - 5}</span> : null}
        </span>
      );
    },
    [hideQuotePreview, replyIndex, showQuotePreview]
  );

  const renderPostActions = useCallback(
    (post: NasfaqThreadPost) => {
      const isYouPost = activeYouPostIdSet.has(post.post_id);
      return (
        <button
          type="button"
          className={`${styles.youToggle} ${isYouPost ? styles.youToggleActive : ""}`.trim()}
          onClick={() => toggleYouPost(post.post_id)}
        >
          <FiUser aria-hidden="true" />
          <span>{isYouPost ? "Marked as (You)" : "Mark as (You)"}</span>
        </button>
      );
    },
    [activeYouPostIdSet, toggleYouPost]
  );

  const renderedPosts = useMemo(
    () =>
      feedPosts.map((post) => {
        const isYouPost = activeYouPostIdSet.has(post.post_id);
        const repliesToYou = activeReplyIdsToYouSet.has(post.post_id);
        const replyCount = getPostReplyCount(post.post_id, replyIndex);
        const hasMedia = Boolean(post.image_url || post.thumbnail_url || post.op_cdn_image_url);

        return (
          <article
            key={post.post_id}
            id={`post-${post.post_id}`}
            className={`${styles.feedPost} ${hasMedia ? "" : styles.feedPostNoMedia} ${isYouPost ? styles.feedPostYou : ""} ${repliesToYou ? styles.feedPostRepliesToYou : ""}`.trim()}
          >
            <PostMedia post={post} />
            <div className={styles.feedPostBody}>
              <div className={styles.feedMeta}>
                <span className={styles.postAuthor}>{post.author || "Anonymous"}</span>
                <span>No. {post.post_id}</span>
                <time>{formatThreadTimestamp(post.timestamp)}</time>
                {isYouPost ? <span className={styles.youBadge}>You</span> : null}
              </div>
              <div className={styles.postBody}>
                {renderPostText(
                  post.text_content || "",
                  availablePostIds,
                  false,
                  showQuotePreview,
                  hideQuotePreview
                )}
              </div>
              <div className={styles.feedFooter}>
                <span><FiMessageSquare aria-hidden="true" /> {replyCount} replies</span>
                <span><FiExternalLink aria-hidden="true" /> {countLinks(post.text_content)} links</span>
                {renderReplyLinks(post)}
                {renderPostActions(post)}
              </div>
            </div>
          </article>
        );
      }),
    [
      activeReplyIdsToYouSet,
      activeYouPostIdSet,
      availablePostIds,
      feedPosts,
      hideQuotePreview,
      renderPostActions,
      renderReplyLinks,
      replyIndex,
      showQuotePreview,
    ]
  );

  return (
    <SiteShell>
      <div className={`${shellStyles.stack} ${styles.threadPage}`.trim()}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <FiActivity aria-hidden="true" />
              <span>Board Activity</span>
            </div>
            <h1 className={styles.title}>/vt/ Threads</h1>
            <p className={styles.copy}>Market relevant /vt/ activity.</p>
            <div className={styles.heroMeta}>
              <span>{activeTabDefinition.label} live board</span>
              <span>Last refresh {formatUpdatedAt(thread?.updated_at || null)}</span>
              <span>{thread ? `Thread No. ${thread.thread_id}` : activeState.isLoading ? "Loading thread..." : "Thread unavailable"}</span>
            </div>
          </div>
          <div className={styles.heroMetrics}>
            <StatTile icon={FiMessageSquare} label="Posts" value={thread ? String(thread.posts.length) : "—"} meta="loaded now" />
            <StatTile icon={FiZap} label="Velocity" value={thread ? threadStats.velocity : "—"} meta="estimated pace" />
            <StatTile icon={FiTrendingUp} label="Relevance" value={thread ? `${threadStats.relevanceScore}%` : "—"} meta="market signal" />
          </div>
        </section>

        {activeState.error && !isNotFound ? <div className="statusMessage statusMessageError">Thread request error: {activeState.error}</div> : null}

        <section className={styles.controlsPanel}>
          <div className={styles.controlsTopRow}>
            <div className={styles.tabGroup} aria-label="Thread board tabs">
              {THREAD_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ""}`.trim()}
                  onClick={() => activateTab(tab.key)}
                >
                  <span>{tab.label}</span>
                  {unreadReplyCountByTab[tab.key] ? <strong>{unreadReplyCountByTab[tab.key]}</strong> : null}
                </button>
              ))}
            </div>
            <a
              href={thread ? `https://boards.4channel.org/${encodeURIComponent(thread.board)}/thread/${thread.thread_id}` : "https://boards.4channel.org/vt/"}
              target="_blank"
              rel="noreferrer"
              className={styles.openThreadLink}
            >
              <FiExternalLink aria-hidden="true" />
              <span>Open source thread</span>
            </a>
          </div>

          <div className={styles.filterGrid}>
            <label className={`${styles.field} ${styles.searchField}`}>
              <ControlLabel icon={FiSearch}>Headline and post search</ControlLabel>
              <span className={styles.searchInputShell}>
                <FiSearch aria-hidden="true" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search post text, numbers, authors"
                  className={styles.input}
                />
              </span>
            </label>
            <label className={styles.field}>
              <ControlLabel icon={FiBarChart2}>Sort</ControlLabel>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as ThreadSortMode)} className={styles.select}>
                <option value="latest">Latest activity</option>
                <option value="oldest">Oldest first</option>
                <option value="replies">Most replied</option>
              </select>
            </label>
            <label className={styles.field}>
              <ControlLabel icon={FiImage}>Media</ControlLabel>
              <select value={mediaMode} onChange={(event) => setMediaMode(event.target.value as ThreadMediaMode)} className={styles.select}>
                <option value="all">All posts</option>
                <option value="with-media">With media</option>
                <option value="text-only">Text only</option>
              </select>
            </label>
            <div className={styles.field}>
              <ControlLabel icon={FiFilter}>Signals</ControlLabel>
              <button
                type="button"
                className={`${styles.toggleButton} ${highlightOnly ? styles.toggleButtonActive : ""}`.trim()}
                onClick={() => setHighlightOnly((value) => !value)}
              >
                <FiZap aria-hidden="true" />
                <span>{highlightOnly ? "Highlights on" : "All activity"}</span>
              </button>
            </div>
          </div>
        </section>

        {activeState.isLoading ? (
          <section className={styles.threadStatusPanel}>
            <LoadingSpinner label={`Loading ${activeTabDefinition.label} thread`} />
          </section>
        ) : null}

        {isNotFound ? <section className={styles.threadEmptyState}>{activeTabDefinition.emptyCopy}</section> : null}

        {thread ? (
          <div className={styles.contentGrid}>
            <main className={styles.threadFeed}>
              {opPost ? (
                <article
                  id={`post-${opPost.post_id}`}
                  className={`${styles.featuredThread} ${activeYouPostIdSet.has(opPost.post_id) ? styles.featuredThreadYou : ""}`.trim()}
                >
                  <PostMedia post={opPost} featured />
                  <div className={styles.featuredBody}>
                    <div className={styles.featuredKicker}>
                      <span>{activeTabDefinition.label}</span>
                      <span>No. {thread.thread_id}</span>
                      <span>{formatThreadTimestamp(opPost.timestamp)}</span>
                    </div>
                    <h2 className={styles.featuredTitle}>
                      {thread.subject || clampPreview(opPost.text_content, 92) || `${activeTabDefinition.label} active thread`}
                    </h2>
                    <div className={styles.featuredExcerpt}>
                      {renderPostText(
                        opPost.text_content || "",
                        availablePostIds,
                        true,
                        showQuotePreview,
                        hideQuotePreview
                      )}
                    </div>
                    <div className={styles.featuredFooter}>
                      <span><FiMessageSquare aria-hidden="true" /> {getPostReplyCount(opPost.post_id, replyIndex)} direct replies</span>
                      <span><FiExternalLink aria-hidden="true" /> {countLinks(opPost.text_content)} links</span>
                      <span><FiClock aria-hidden="true" /> {formatCompactTime(threadStats.latestTimestamp)}</span>
                      {renderReplyLinks(opPost)}
                      {renderPostActions(opPost)}
                    </div>
                  </div>
                </article>
              ) : null}

              <section className={styles.feedPanel}>
                <div className={styles.feedHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Thread feed</h2>
                    <p className={styles.sectionCopy}>
                      {filteredPosts.length} matching posts from {posts.length} loaded posts.
                    </p>
                  </div>
                  <span className={styles.feedStatus}>
                    <FiRefreshCcw aria-hidden="true" />
                    {formatUpdatedAt(thread.updated_at)}
                  </span>
                </div>
                {renderedPosts.length ? <div className={styles.postList}>{renderedPosts}</div> : <div className={styles.emptyState}>No posts match the active filters.</div>}
              </section>
            </main>

            <aside className={styles.signalRail}>
              <section className={styles.railPanel}>
                <h2 className={styles.railTitle}><FiTrendingUp aria-hidden="true" /> Market relevance</h2>
                <div className={styles.relevanceGauge}>
                  <strong>{threadStats.relevanceScore}%</strong>
                  <span>derived from media, links, replies, and thread size</span>
                </div>
                <div className={styles.railMetricGrid}>
                  <div><span>Posts</span><strong>{posts.length}</strong></div>
                  <div><span>Media</span><strong>{threadStats.mediaPosts}</strong></div>
                  <div><span>Links</span><strong>{threadStats.linkCount}</strong></div>
                  <div><span>Replies</span><strong>{threadStats.replyCount}</strong></div>
                </div>
              </section>

              <section className={styles.railPanel}>
                <h2 className={styles.railTitle}><FiHash aria-hidden="true" /> Watch terms</h2>
                {threadTerms.length ? (
                  <div className={styles.termList}>
                    {threadTerms.map((item) => (
                      <div key={item.term} className={styles.termRow}>
                        <span>{item.term}</span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.railCopy}>No strong ticker-like terms detected yet.</p>
                )}
              </section>

              <section className={styles.railPanel}>
                <h2 className={styles.railTitle}><FiActivity aria-hidden="true" /> Thread velocity</h2>
                <div className={styles.velocityBlock}>
                  <strong>{threadStats.velocity}</strong>
                  <span>Latest post around {formatCompactTime(threadStats.latestTimestamp)}</span>
                </div>
              </section>
            </aside>
          </div>
        ) : null}

        {previewPost && quotePreview ? (
          <div
            className={styles.quotePreview}
            style={{
              left: quotePreview.x,
              top: quotePreview.y,
            }}
          >
            <div className={styles.quotePreviewHeader}>
              <span className={styles.quotePreviewAuthor}>{previewPost.author || "Anonymous"}</span>
              <span className={styles.quotePreviewId}>No. {previewPost.post_id}</span>
            </div>
            {previewPost.thumbnail_url ? <img src={previewPost.thumbnail_url} alt="" className={styles.quotePreviewThumb} loading="lazy" /> : null}
            <div className={styles.quotePreviewBody}>
              {String(previewPost.text_content || "").trim() || "(no text)"}
            </div>
          </div>
        ) : null}
      </div>
    </SiteShell>
  );
}
