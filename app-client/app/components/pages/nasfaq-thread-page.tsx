"use client";

import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from "react";
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
  setQuotePreview: Dispatch<SetStateAction<QuotePreviewState | null>>
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
            const position = getQuotePreviewPosition(event.clientX, event.clientY);
            setQuotePreview({ postId: targetPostId, x: position.x, y: position.y });
          }}
          onMouseMove={(event) => {
            const position = getQuotePreviewPosition(event.clientX, event.clientY);
            setQuotePreview((current) => (current ? { ...current, x: position.x, y: position.y } : null));
          }}
          onMouseLeave={() => setQuotePreview(null)}
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

function getPostCardClassName(baseClass: string, opClass: string, isOp: boolean) {
  return [baseClass, isOp ? opClass : ""].filter(Boolean).join(" ");
}

function renderPostText(
  text: string,
  availablePostIds: Set<number>,
  isOp: boolean,
  setQuotePreview: Dispatch<SetStateAction<QuotePreviewState | null>>
) {
  const lines = text ? text.split("\n") : [];

  if (!lines.length) {
    return <div className={styles.postLine}>(no text)</div>;
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
        {line ? renderInlinePostText(line, availablePostIds, setQuotePreview) : "\u00A0"}
      </div>
    );
  });
}

export function NasfaqThreadPage() {
  const [thread, setThread] = useState<NasfaqThreadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quotePreview, setQuotePreview] = useState<QuotePreviewState | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadThread() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await apiFetch<NasfaqThreadResponse>("/api/getNasfaqThread", {
          signal: controller.signal,
          cache: "no-store",
        });
        setThread(result);
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setThread(null);
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadThread();
    return () => controller.abort();
  }, []);

  const posts = thread?.posts || [];
  const availablePostIds = new Set(posts.map((post) => post.post_id));
  const replyIndex = buildReplyIndex(posts);
  const postById = new Map(posts.map((post) => [post.post_id, post]));
  const previewPost = quotePreview ? postById.get(quotePreview.postId) || null : null;

  return (
    <SiteShell>
      <div className={shellStyles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroEyebrow}>Community Watch</div>
          <h1 className={styles.title}>NASFAQ Thread</h1>
          <p className={styles.copy}>Live snapshot of the current `/vt/` NASFAQ thread, refreshed from the API with a one-minute Redis cache.</p>
          <div className={styles.heroMeta}>
            <span>{thread ? `${thread.posts.length} posts` : "Thread unavailable"}</span>
            <span>Last refresh {formatUpdatedAt(thread?.updated_at || null)}</span>
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">Thread request error: {error}</div> : null}
        {isLoading ? <div className={shellStyles.panel}>Loading NASFAQ thread…</div> : null}

        {thread ? (
          <>
            <section className={styles.metaPanel}>
              <div>
                <div className={styles.metaLabel}>Board</div>
                <div className={styles.metaValue}>/{thread.board}/</div>
              </div>
              <div>
                <div className={styles.metaLabel}>Thread</div>
                <a
                  href={`https://boards.4channel.org/${encodeURIComponent(thread.board)}/thread/${thread.thread_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.metaLink}
                >
                  No. {thread.thread_id}
                </a>
              </div>
              <div>
                <div className={styles.metaLabel}>Subject</div>
                <div className={styles.metaValue}>{thread.subject || "Untitled thread"}</div>
              </div>
            </section>

            <section className={styles.threadPanel}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Posts</h2>
              </div>

              <div className={styles.postList}>
                {thread.posts.map((post, index) => {
                  const isOp = index === 0;
                  const mediaUrl = post.image_url || "";

                  return (
                    <article
                      key={post.post_id}
                      id={`post-${post.post_id}`}
                      className={getPostCardClassName(styles.postCard, styles.postCardOp, isOp)}
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
                                    const position = getQuotePreviewPosition(event.clientX, event.clientY);
                                    setQuotePreview({ postId: replyPostId, x: position.x, y: position.y });
                                  }}
                                  onMouseMove={(event) => {
                                    const position = getQuotePreviewPosition(event.clientX, event.clientY);
                                    setQuotePreview((current) => (current ? { ...current, x: position.x, y: position.y } : null));
                                  }}
                                  onMouseLeave={() => setQuotePreview(null)}
                                >
                                  {`>>${replyPostId}`}
                                </a>
                              ))}
                            </span>
                          ) : null}
                        </div>
                        <time className={styles.postTimestamp}>{formatThreadTimestamp(post.timestamp)}</time>
                      </div>

                      {isOp && post.op_cdn_image_url ? (
                        <div className={styles.imageSlot}>
                          <a href={mediaUrl} target="_blank" rel="noreferrer" className={styles.imageLink}>
                            <img src={post.op_cdn_image_url} alt="" className={`${styles.imageThumb} ${styles.imageThumbExpanded}`.trim()} />
                          </a>
                        </div>
                      ) : post.thumbnail_url && post.image_url ? (
                        <div className={styles.imageSlot}>
                          <a href={mediaUrl} target="_blank" rel="noreferrer" className={styles.imageLink}>
                            <img src={post.thumbnail_url} alt="" className={styles.imageThumb} />
                          </a>
                        </div>
                      ) : null}

                      <div className={styles.postBody}>{renderPostText(post.text_content || "", availablePostIds, isOp, setQuotePreview)}</div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
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
