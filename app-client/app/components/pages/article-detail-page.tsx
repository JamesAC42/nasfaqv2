"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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

  const canEdit = useMemo(
    () => Boolean(user && article && !article.is_news && (user.is_admin || user.id === article.author?.id)),
    [article, user]
  );

  async function loadArticle() {
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
  }

  useEffect(() => {
    void loadArticle();
  }, [slug]);

  async function handlePreference(kind: "like" | "save") {
    const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}/${kind}`, {
      method: "POST",
      body: "{}",
    });
    setArticle(normalizeArticleDetail(result.article));
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
              <div className={styles.eyebrow}>{article.is_news ? "News Article" : "Community Article"}</div>
              <h1 className={styles.title}>{article.title}</h1>
              {article.subtitle ? <p className={styles.copy}>{article.subtitle}</p> : null}
              <div className={styles.metaRow}>
                <span className={styles.muted}>{article.author ? `By ${article.author.username}` : "Imported from the news feed"}</span>
                <span className={styles.muted}>{formatDateTime(article.published_at)}</span>
                <span className={`${styles.statusPill} ${article.status === "draft" ? styles.statusDraft : styles.statusPublished}`}>
                  {article.status}
                </span>
              </div>
              {article.tags.length ? (
                <div className={styles.tagRow}>
                  {article.tags.map((tag) => <span key={tag} className={styles.pill}>{tag}</span>)}
                </div>
              ) : null}
              {article.related_assets.length ? (
                <div className={styles.assetRow}>
                  {article.related_assets.map((asset) => (
                    <Link key={asset.id} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.assetPill}>
                      {asset.symbol}
                    </Link>
                  ))}
                </div>
              ) : null}
              <div className={styles.actionRow}>
                <button type="button" className={styles.actionButton} onClick={() => void handlePreference("like")} disabled={!user}>
                  {article.viewer_has_liked ? "Unlike" : "Like"} · {article.likes}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => void handlePreference("save")} disabled={!user}>
                  {article.viewer_has_saved ? "Unsave" : "Save"} · {article.saves}
                </button>
                {canEdit ? <Link href={`/articles/${encodeURIComponent(article.slug)}/edit`} className={styles.toolbarLink}>Edit article</Link> : null}
              </div>
            </section>

            <div className={styles.detailLayout}>
              <div className={styles.detailMain}>
                {article.thumbnail_url ? (
                  <section className={styles.detailCard}>
                    <img src={article.thumbnail_url} alt="" className={styles.thumb} />
                  </section>
                ) : null}

                <section className={styles.detailCard}>
                  <div className={styles.articleBody}>{article.content || "No article body has been approved yet for this entry."}</div>
                </section>

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

              <aside className={styles.detailAside}>
                <section className={styles.detailCard}>
                  <h2 className={styles.sectionTitle}>Quick Facts</h2>
                  <div className={styles.fieldGrid}>
                    <div>
                      <strong>{article.likes}</strong>
                      <div className={styles.sectionCopy}>likes</div>
                    </div>
                    <div>
                      <strong>{article.saves}</strong>
                      <div className={styles.sectionCopy}>saves</div>
                    </div>
                    <div>
                      <strong>{article.comment_count}</strong>
                      <div className={styles.sectionCopy}>comments</div>
                    </div>
                    {article.news_item ? (
                      <div>
                        <strong>{article.news_item.headline}</strong>
                        <div className={styles.sectionCopy}>linked headline</div>
                      </div>
                    ) : null}
                  </div>
                </section>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
