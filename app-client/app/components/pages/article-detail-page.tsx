"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FaBookmark, FaRegBookmark, FaRegHeart, FaHeart, FaArrowLeft } from "react-icons/fa6";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { normalizeArticleDetail } from "@/app/lib/normalizers";
import type { ArticleDetail } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/articles/article-pages.module.scss";

function formatDateTime(value: string | null) {
  if (!value) return "Unknown time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ArticleDetailPage({ slug }: { slug: string }) {
  const { user } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [activeEffect, setActiveEffect] = useState<"like" | "save" | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalSubtitle, setProposalSubtitle] = useState("");
  const [proposalTags, setProposalTags] = useState("");
  const [proposalThumbnailUrl, setProposalThumbnailUrl] = useState("");
  const [proposalContent, setProposalContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectTimeoutRef = useRef<number | null>(null);

  const canEdit = useMemo(
    () => Boolean(user && article && !article.is_news && (user.is_admin || user.id === article.author?.id)),
    [article, user]
  );

  const loadArticle = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}`);
      setArticle(normalizeArticleDetail(result.article));
    } catch (nextError) {
      setArticle(null);
      setError(String((nextError as Error).message || nextError));
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadArticle();
  }, [loadArticle]);

  useEffect(() => (
    () => {
      if (effectTimeoutRef.current !== null) {
        window.clearTimeout(effectTimeoutRef.current);
      }
    }
  ), []);

  function triggerEffect(kind: "like" | "save") {
    setActiveEffect(kind);
    if (effectTimeoutRef.current !== null) {
      window.clearTimeout(effectTimeoutRef.current);
    }
    effectTimeoutRef.current = window.setTimeout(() => {
      setActiveEffect((current) => (current === kind ? null : current));
      effectTimeoutRef.current = null;
    }, 680);
  }

  async function handlePreference(kind: "like" | "save") {
    const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}/${kind}`, {
      method: "POST",
      body: "{}",
    });
    setArticle(normalizeArticleDetail(result.article));
    triggerEffect(kind);
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setIsSubmittingComment(true);
    try {
      const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentBody }),
      });
      setArticle(normalizeArticleDetail(result.article));
      setCommentBody("");
    } finally {
      setIsSubmittingComment(false);
    }
  }

  async function handleProposalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proposalContent.trim()) return;
    setIsSubmittingProposal(true);
    try {
      const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          title: proposalTitle || null,
          subtitle: proposalSubtitle || null,
          tags: proposalTags.split(",").map((tag) => tag.trim()).filter(Boolean),
          thumbnail_url: proposalThumbnailUrl || null,
          content: proposalContent,
        }),
      });
      setArticle(normalizeArticleDetail(result.article));
      setProposalTitle("");
      setProposalSubtitle("");
      setProposalTags("");
      setProposalThumbnailUrl("");
      setProposalContent("");
    } finally {
      setIsSubmittingProposal(false);
    }
  }

  async function handleApproveProposal(proposalId: number) {
    const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}/proposals/${proposalId}/approve`, {
      method: "POST",
      body: "{}",
    });
    setArticle(normalizeArticleDetail(result.article));
  }

  return (
    <SiteShell>
      <div className={styles.stack}>
        {error ? <div className="statusMessage statusMessageError">Article request error: {error}</div> : null}
        {isLoading ? <div className={styles.panel}>Loading article…</div> : null}

        {article ? (
          <>
            <section className={styles.hero}>
              <div className={styles.toolbar}>
                <Link href="/articles" className={styles.backLink}>
                  <FaArrowLeft aria-hidden="true" />
                  <span>Back to all articles</span>
                </Link>
                <div className={styles.metaRow}>
                  <span className={styles.eyebrow}>{article.is_news ? "News Article" : "Community Article"}</span>
                  <span className={`${styles.statusPill} ${article.status === "draft" ? styles.statusDraft : styles.statusPublished}`}>
                    {article.status}
                  </span>
                </div>
              </div>
              <h1 className={styles.title}>{article.title}</h1>
              {article.subtitle ? <p className={styles.copy}>{article.subtitle}</p> : null}
              <div className={styles.metaRow}>
                {article.author ? (
                  <>
                    <Link href={`/profile/${encodeURIComponent(article.author.username)}`} className={styles.inlineLink}>
                      {article.author.username}
                    </Link>
                    <a
                      href="#"
                      className={styles.inlineLinkMuted}
                      onClick={(event) => event.preventDefault()}
                      aria-disabled="true"
                      title="Author article archives coming soon"
                    >
                      More by this author
                    </a>
                  </>
                ) : (
                  <span className={styles.muted}>Imported from the news feed</span>
                )}
                <span className={styles.muted}>{formatDateTime(article.published_at)}</span>
                <span className={styles.muted}>{article.comment_count} comments</span>
              </div>
              {article.tags.length ? (
                <div className={styles.tagRow}>
                  {article.tags.map((tag) => <span key={tag} className={styles.pill}>{tag}</span>)}
                </div>
              ) : null}
              {article.related_assets.length ? (
                <div className={styles.assetRow}>
                  {article.related_assets.map((asset) => (
                    <ChannelTickerPill
                      key={asset.id}
                      channel={{
                        name: asset.display_name,
                        icon: asset.icon,
                        symbol: asset.symbol,
                      }}
                      tone={article.status === "draft" ? "warning" : "default"}
                    />
                  ))}
                </div>
              ) : null}
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={`${styles.actionButton} ${article.viewer_has_liked ? styles.actionButtonOn : ""} ${activeEffect === "like" ? styles.actionButtonBurst : ""}`.trim()}
                  onClick={() => void handlePreference("like")}
                  disabled={!user}
                >
                  <span className={styles.actionIcon}>
                    {article.viewer_has_liked ? <FaHeart aria-hidden="true" /> : <FaRegHeart aria-hidden="true" />}
                  </span>
                  <span>{article.viewer_has_liked ? "Unlike" : "Like"}</span>
                  <span className={styles.actionCount}>{article.likes}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.secondaryButton} ${article.viewer_has_saved ? styles.secondaryButtonOn : ""} ${activeEffect === "save" ? styles.actionButtonBurst : ""}`.trim()}
                  onClick={() => void handlePreference("save")}
                  disabled={!user}
                >
                  <span className={styles.actionIcon}>
                    {article.viewer_has_saved ? <FaBookmark aria-hidden="true" /> : <FaRegBookmark aria-hidden="true" />}
                  </span>
                  <span>{article.viewer_has_saved ? "Unsave" : "Save"}</span>
                  <span className={styles.actionCount}>{article.saves}</span>
                </button>
                {canEdit ? <Link href={`/articles/${encodeURIComponent(article.slug)}/edit`} className={styles.toolbarLink}>Edit article</Link> : null}
              </div>
            </section>

            <div className={styles.detailMain}>
              {article.thumbnail_url ? (
                <section className={styles.flatMedia}>
                  <img src={article.thumbnail_url} alt="" className={styles.featureThumb} />
                </section>
              ) : null}

              <article className={styles.flatArticle}>
                {article.content ? (
                  <div className={styles.markdownBody}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {article.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className={styles.articleBody}>No article body has been approved yet for this entry.</div>
                )}
              </article>

              {article.is_news ? (
                <section className={styles.detailCard}>
                  <div className={styles.metaRow}>
                    <div>
                      <h2 className={styles.sectionTitle}>Coverage Proposals</h2>
                      <p className={styles.sectionCopy}>Users can submit article copy for this news item. Admins can approve one to become the active article body.</p>
                    </div>
                  </div>
                  {article.proposals.length ? (
                    <div className={styles.proposalList}>
                      {article.proposals.map((proposal) => (
                        <article key={proposal.id} className={styles.proposalCard}>
                          <div className={styles.proposalHeader}>
                            <div className={styles.proposalMeta}>
                              <strong>{proposal.title || "Proposal draft"}</strong>
                              <span className={styles.muted}>
                                {proposal.author.username} · {proposal.status} · {formatDateTime(proposal.created_at)}
                              </span>
                            </div>
                            {user?.is_admin && proposal.status !== "approved" ? (
                              <button type="button" className={styles.primaryButton} onClick={() => void handleApproveProposal(proposal.id)}>
                                Approve
                              </button>
                            ) : null}
                          </div>
                          {proposal.subtitle ? <p className={styles.sectionCopy}>{proposal.subtitle}</p> : null}
                          {proposal.tags.length ? (
                            <div className={styles.tagRow}>
                              {proposal.tags.map((tag) => <span key={`${proposal.id}:${tag}`} className={styles.pill}>{tag}</span>)}
                            </div>
                          ) : null}
                          <div className={styles.proposalContent}>{proposal.content}</div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.empty}>No proposals yet.</div>
                  )}

                  {user ? (
                    <form className={styles.fieldGrid} onSubmit={handleProposalSubmit}>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Proposed title</span>
                        <input className={styles.input} value={proposalTitle} onChange={(event) => setProposalTitle(event.target.value)} placeholder="Optional replacement title" />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Proposed subtitle</span>
                        <input className={styles.input} value={proposalSubtitle} onChange={(event) => setProposalSubtitle(event.target.value)} placeholder="Optional subtitle" />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Tags</span>
                        <input className={styles.input} value={proposalTags} onChange={(event) => setProposalTags(event.target.value)} placeholder="Comma-separated tags" />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Thumbnail URL</span>
                        <input className={styles.input} value={proposalThumbnailUrl} onChange={(event) => setProposalThumbnailUrl(event.target.value)} placeholder="Optional thumbnail override" />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Proposal body</span>
                        <textarea className={styles.textarea} value={proposalContent} onChange={(event) => setProposalContent(event.target.value)} placeholder="Write the article body you want the admin to approve." />
                      </label>
                      <div className={styles.actionRow}>
                        <button type="submit" className={styles.primaryButton} disabled={isSubmittingProposal || !proposalContent.trim()}>
                          {isSubmittingProposal ? "Submitting…" : "Submit proposal"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className={styles.sectionCopy}>Sign in to submit a proposed article for this news item.</p>
                  )}
                </section>
              ) : null}

              <section className={styles.detailCard}>
                <div>
                  <h2 className={styles.sectionTitle}>Comments</h2>
                  <p className={styles.sectionCopy}>{article.comment_count} total comments</p>
                </div>
                {user ? (
                  <form className={styles.fieldGrid} onSubmit={handleCommentSubmit}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Add comment</span>
                      <textarea className={styles.textarea} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add your take on this article." />
                    </label>
                    <div className={styles.actionRow}>
                      <button type="submit" className={styles.primaryButton} disabled={isSubmittingComment || !commentBody.trim()}>
                        {isSubmittingComment ? "Posting…" : "Post comment"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className={styles.sectionCopy}>Sign in to comment.</p>
                )}

                {article.comments.length ? (
                  <div className={styles.commentList}>
                    {article.comments.map((comment) => (
                      <article key={comment.id} className={styles.commentCard}>
                        <div className={styles.commentHeader}>
                          <div className={styles.commentMeta}>
                            <strong>{comment.author.username}</strong>
                            <span className={styles.muted}>{formatDateTime(comment.created_at)}</span>
                          </div>
                        </div>
                        <div className={styles.articleBody}>{comment.body}</div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>No comments yet.</div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
