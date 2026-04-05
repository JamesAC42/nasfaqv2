"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/nasfaq-thread-page.module.scss";

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
  const [activeTab, setActiveTab] = useState<ThreadTabKey>(DEFAULT_THREAD_TAB);
  const [threadStateByKey, setThreadStateByKey] = useState<Record<ThreadTabKey, ThreadLoadState>>(buildInitialThreadState);
  const [quotePreview, setQuotePreview] = useState<QuotePreviewState | null>(null);
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

  const renderedPosts = useMemo(
    () =>
      posts.map((post, index) => {
        const isOp = index === 0;
        const mediaUrl = post.image_url || "";

        return (
          <article
            key={post.post_id}
            id={`post-${post.post_id}`}
            className={`${styles.postCard} ${isOp ? styles.postCardOp : ""}`.trim()}
          >
            <div className={styles.postHeader}>
              <div className={styles.postIdentity}>
                <span className={styles.postAuthor}>{post.author || "Anonymous"}</span>
                <span className={styles.postId}>No. {post.post_id}</span>
                {(replyIndex.get(post.post_id) || []).length ? (
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
    [availablePostIds, hideQuotePreview, posts, replyIndex, showQuotePreview]
  );

  return (
    <SiteShell>
      <div className={shellStyles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>Community Watch</div>
          <h1 className={styles.title}>/vt/ Threads</h1>
          <p className={styles.copy}>Market relevant threads active on /vt/.</p>
          <div className={styles.heroMeta}>
            <span>{thread ? `${thread.posts.length} posts` : "Thread unavailable"}</span>
            <span>Last refresh {formatUpdatedAt(thread?.updated_at || null)}</span>
          </div>
        </section>

        {activeState.error && !isNotFound ? <div className="statusMessage statusMessageError">Thread request error: {activeState.error}</div> : null}
        {activeState.isLoading ? <div className={shellStyles.panel}>Loading {activeTabDefinition.label} thread…</div> : null}

        {isNotFound ? (
          <section className={styles.threadPanel}>
            <div className={styles.tabBarConnected}>
              {THREAD_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`${styles.tabButtonConnected} ${activeTab === tab.key ? styles.tabButtonConnectedActive : ""}`.trim()}
                  onClick={() => activateTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className={styles.threadEmptyState}>{activeTabDefinition.emptyCopy}</div>
          </section>
        ) : null}

        {thread ? (
          <section className={styles.threadPanel}>
            <div className={styles.tabBarConnected}>
              {THREAD_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`${styles.tabButtonConnected} ${activeTab === tab.key ? styles.tabButtonConnectedActive : ""}`.trim()}
                  onClick={() => activateTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

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
          </section>
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
