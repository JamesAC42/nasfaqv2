"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const DEFAULT_THREAD_TAB: ThreadTabKey = "nasfaq";

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

  const renderedPosts = useMemo(
    () =>
      posts.map((post, index) => {
        const isOp = index === 0;
        const mediaUrl = post.image_url || "";
        const isYouPost = activeYouPostIdSet.has(post.post_id);
        const repliesToYou = activeReplyIdsToYouSet.has(post.post_id);
        const replyCount = (replyIndex.get(post.post_id) || []).length;

        return (
          <article
            key={post.post_id}
            id={`post-${post.post_id}`}
            className={`${styles.postCard} ${isOp ? styles.postCardOp : ""} ${isYouPost ? styles.postCardYou : ""} ${repliesToYou ? styles.postCardRepliesToYou : ""}`.trim()}
          >
            <div className={styles.postHeader}>
              <div className={styles.postIdentity}>
                <span className={styles.postAuthor}>{post.author || "Anonymous"}</span>
                <span className={styles.postId}>No. {post.post_id}</span>
                {isYouPost ? <span className={styles.youBadge}>You</span> : null}
                <button
                  type="button"
                  className={`${styles.youToggle} ${isYouPost ? styles.youToggleActive : ""}`.trim()}
                  onClick={() => toggleYouPost(post.post_id)}
                >
                  {isYouPost ? "Marked as (You)" : "Mark as (You)"}
                </button>
                {replyCount ? (
                  <span className={styles.postReplies}>
                    {(replyIndex.get(post.post_id) || []).map((replyPostId) => (
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
                  </span>
                ) : null}
              </div>
              <time className={styles.postTimestamp}>{formatThreadTimestamp(post.timestamp)}</time>
            </div>

            {isOp ? (
              post.op_cdn_image_url ? (
                <div className={styles.imageSlot}>
                  <a href={mediaUrl} target="_blank" rel="noreferrer" className={styles.imageLink}>
                    <img src={post.op_cdn_image_url} alt="" className={`${styles.imageThumb} ${styles.imageThumbExpanded}`.trim()} />
                  </a>
                </div>
              ) : null
            ) : post.thumbnail_url && post.image_url ? (
              <div className={styles.imageSlot}>
                <a href={mediaUrl} target="_blank" rel="noreferrer" className={styles.imageLink}>
                  <img src={post.thumbnail_url} alt="" className={styles.imageThumb} />
                </a>
              </div>
            ) : null}

            <div className={styles.postBody}>
              {renderPostText(
                post.text_content || "",
                availablePostIds,
                isOp,
                showQuotePreview,
                hideQuotePreview
              )}
            </div>
          </article>
        );
      }),
    [activeReplyIdsToYouSet, activeYouPostIdSet, availablePostIds, hideQuotePreview, posts, replyIndex, showQuotePreview, toggleYouPost]
  );

  return (
    <SiteShell>
      <div className={`${shellStyles.stack} ${styles.pageStack}`.trim()}>
        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>Community Watch</div>
          <h1 className={styles.title}>/vt/ Threads</h1>
          <p className={styles.copy}>Market relevant threads active on /vt/.</p>
          <div className={styles.heroMeta}>
            <span>{thread ? `${thread.posts.length} posts` : activeState.isLoading ? "Loading posts..." : "Thread unavailable"}</span>
            <span>Last refresh {formatUpdatedAt(thread?.updated_at || null)}</span>
          </div>
        </section>

        {activeState.error && !isNotFound ? <div className="statusMessage statusMessageError">Thread request error: {activeState.error}</div> : null}
        <section className={styles.threadPanel}>
          <div className={styles.tabBarConnected}>
            {THREAD_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`${styles.tabButtonConnected} ${activeTab === tab.key ? styles.tabButtonConnectedActive : ""}`.trim()}
                onClick={() => activateTab(tab.key)}
              >
                <span className={styles.tabButtonLabel}>{tab.label}</span>
                {unreadReplyCountByTab[tab.key] ? <span className={styles.tabBadge}>{unreadReplyCountByTab[tab.key]}</span> : null}
              </button>
            ))}
          </div>

          {activeState.isLoading ? (
            <div className={styles.threadStatusPanel}>
              <LoadingSpinner label={`Loading ${activeTabDefinition.label} thread`} />
            </div>
          ) : null}

          {isNotFound ? <div className={styles.threadEmptyState}>{activeTabDefinition.emptyCopy}</div> : null}

          {thread ? (
            <>
              <div className={styles.sectionHeader}>
                <div className={styles.threadMeta}>
                  <h2 className={styles.sectionTitle}>{activeTabDefinition.label}</h2>
                  <a
                    href={`https://boards.4channel.org/${encodeURIComponent(thread.board)}/thread/${thread.thread_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.metaLink}
                  >
                    No. {thread.thread_id}
                  </a>
                  {thread.subject ? <span className={styles.threadSubject}>{thread.subject}</span> : null}
                </div>
              </div>

              <div className={styles.postList}>{renderedPosts}</div>
            </>
          ) : null}
        </section>

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
            {previewPost.thumbnail_url ? <img src={previewPost.thumbnail_url} alt="" className={styles.quotePreviewThumb} /> : null}
            <div className={styles.quotePreviewBody}>
              {String(previewPost.text_content || "").trim() || "(no text)"}
            </div>
          </div>
        ) : null}
      </div>
    </SiteShell>
  );
}
