"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { IconType } from "react-icons";
import {
  FaArrowLeft,
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaBinoculars,
  FaBookmark,
  FaBoxesStacked,
  FaChartSimple,
  FaCircleDown,
  FaCircleQuestion,
  FaCircleUp,
  FaGem,
  FaHeart,
  FaRegBookmark,
  FaRegHeart,
  FaScaleBalanced,
  FaThumbsDown,
  FaThumbsUp,
} from "react-icons/fa6";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger } from "@/app/lib/format";
import { normalizeArticleDetail } from "@/app/lib/normalizers";
import { ARTICLE_COMMENT_MOODS, type ArticleComment, type ArticleCommentMood, type ArticleDetail, type ArticleProposal } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/articles/article-pages.module.scss";

const viewedArticleSlugs = new Set<string>();
const inflightArticleLoads = new Map<string, Promise<Record<string, unknown>>>();

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

function hasText(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

function getProposalTitle(proposal: ArticleProposal, article: ArticleDetail) {
  return proposal.title?.trim() || `${article.title} draft`;
}

function loadArticleRecord(slug: string) {
  const existing = inflightArticleLoads.get(slug);
  if (existing) return existing;

  const shouldRecordView = !viewedArticleSlugs.has(slug);
  if (shouldRecordView) {
    viewedArticleSlugs.add(slug);
  }

  const endpoint = shouldRecordView
    ? `/api/articles/${encodeURIComponent(slug)}/view`
    : `/api/articles/${encodeURIComponent(slug)}`;
  const method = shouldRecordView ? "POST" : "GET";

  const request = apiFetch<{ article: Record<string, unknown> }>(endpoint, {
    method,
    body: shouldRecordView ? "{}" : undefined,
  })
    .then((result) => result.article)
    .catch((error) => {
      if (shouldRecordView) {
        viewedArticleSlugs.delete(slug);
      }
      throw error;
    })
    .finally(() => {
      inflightArticleLoads.delete(slug);
    });

  inflightArticleLoads.set(slug, request);
  return request;
}

function estimateReadingTimeMinutes(content: string | null | undefined) {
  const normalized = String(content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#>*_~[\]()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const wordCount = normalized.split(" ").filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 220));
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${fmtInteger(count)} ${count === 1 ? singular : plural}`;
}

const COMMENT_MOOD_META: Record<ArticleCommentMood, { icon: IconType; badgeClassName: string; optionClassName: string }> = {
  Bullish: { icon: FaArrowTrendUp, badgeClassName: styles.commentMoodBadgeBullish, optionClassName: styles.commentMoodOptionBullish },
  Bearish: { icon: FaArrowTrendDown, badgeClassName: styles.commentMoodBadgeBearish, optionClassName: styles.commentMoodOptionBearish },
  Neutral: { icon: FaScaleBalanced, badgeClassName: styles.commentMoodBadgeNeutral, optionClassName: styles.commentMoodOptionNeutral },
  Hodling: { icon: FaChartSimple, badgeClassName: styles.commentMoodBadgeHodling, optionClassName: styles.commentMoodOptionHodling },
  "Dump Eet": { icon: FaArrowTrendDown, badgeClassName: styles.commentMoodBadgeDumpEet, optionClassName: styles.commentMoodOptionDumpEet },
  "He Bought?": { icon: FaCircleUp, badgeClassName: styles.commentMoodBadgeHeBought, optionClassName: styles.commentMoodOptionHeBought },
  "He Sold?": { icon: FaCircleDown, badgeClassName: styles.commentMoodBadgeHeSold, optionClassName: styles.commentMoodOptionHeSold },
  "Diamond Hands": { icon: FaGem, badgeClassName: styles.commentMoodBadgeDiamondHands, optionClassName: styles.commentMoodOptionDiamondHands },
  Watching: { icon: FaBinoculars, badgeClassName: styles.commentMoodBadgeWatching, optionClassName: styles.commentMoodOptionWatching },
  Accumulating: { icon: FaBoxesStacked, badgeClassName: styles.commentMoodBadgeAccumulating, optionClassName: styles.commentMoodOptionAccumulating },
};

function getCommentMoodMeta(mood: ArticleCommentMood | null) {
  return mood ? COMMENT_MOOD_META[mood] : null;
}

function CommentMoodBadge({ comment }: { comment: ArticleComment }) {
  const meta = getCommentMoodMeta(comment.mood);
  if (!meta || !comment.mood) return null;
  const Icon = meta.icon;
  return (
    <span className={`${styles.commentMoodBadge} ${meta.badgeClassName}`}>
      <Icon aria-hidden="true" />
      <span>{comment.mood}</span>
    </span>
  );
}

export function ArticleDetailPage({ slug }: { slug: string }) {
  const { user } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [activeEffect, setActiveEffect] = useState<"like" | "save" | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentMood, setCommentMood] = useState<ArticleCommentMood | null>(null);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalSubtitle, setProposalSubtitle] = useState("");
  const [proposalTags, setProposalTags] = useState("");
  const [proposalThumbnailUrl, setProposalThumbnailUrl] = useState("");
  const [proposalContent, setProposalContent] = useState("");
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [proposalVoteBusyId, setProposalVoteBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effectTimeoutRef = useRef<number | null>(null);

  const canEdit = useMemo(
    () => Boolean(user && article && !article.is_news && (user.is_admin || user.id === article.author?.id)),
    [article, user]
  );
  const hasPublishedBody = useMemo(() => hasText(article?.content), [article?.content]);
  const estimatedReadMinutes = useMemo(() => estimateReadingTimeMinutes(article?.content), [article?.content]);
  const selectedProposal = useMemo(() => {
    if (!article?.proposals.length) return null;
    return article.proposals.find((proposal) => proposal.id === selectedProposalId)
      || article.proposals.find((proposal) => proposal.status === "approved")
      || article.proposals[0];
  }, [article, selectedProposalId]);

  const loadArticle = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const articleRecord = await loadArticleRecord(slug);
      setArticle(normalizeArticleDetail(articleRecord));
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

  useEffect(() => {
    if (!article?.proposals.length) {
      setSelectedProposalId(null);
      return;
    }
    setSelectedProposalId((current) => (
      article.proposals.some((proposal) => proposal.id === current)
        ? current
        : (article.proposals.find((proposal) => proposal.status === "approved")?.id ?? article.proposals[0].id)
    ));
  }, [article]);

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

  async function handleProposalVote(proposal: ArticleProposal, value: 1 | -1) {
    if (!user) return;
    setProposalVoteBusyId(proposal.id);
    try {
      const result = await apiFetch<{ article: Record<string, unknown> }>(
        `/api/articles/${encodeURIComponent(slug)}/proposals/${proposal.id}/vote`,
        {
          method: "POST",
          body: JSON.stringify({ value: proposal.viewer_vote === value ? 0 : value }),
        }
      );
      setArticle(normalizeArticleDetail(result.article));
    } finally {
      setProposalVoteBusyId((current) => (current === proposal.id ? null : current));
    }
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setIsSubmittingComment(true);
    try {
      const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentBody, mood: commentMood }),
      });
      setArticle(normalizeArticleDetail(result.article));
      setCommentBody("");
      setCommentMood(null);
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
            <section className={styles.storyHero}>
              <div className={styles.storyTopRow}>
                <Link href={article.is_news ? "/news" : "/articles"} className={styles.backLink}>
                  <FaArrowLeft aria-hidden="true" />
                  <span>{article.is_news ? "Back to all news" : "Back to all articles"}</span>
                </Link>
                <div className={styles.metaRow}>
                  <span className={styles.eyebrow}>{article.is_news ? "News Feature" : "Community Article"}</span>
                  <span className={`${styles.statusPill} ${article.status === "draft" ? styles.statusDraft : styles.statusPublished}`}>
                    {article.status}
                  </span>
                </div>
              </div>

              <div className={styles.storyHeader}>
                <div className={styles.metaRow}>
                  {article.is_news && !hasPublishedBody ? <span className={styles.pill}>Open for coverage</span> : null}
                  {article.news_item ? <span className={styles.pill}>Source headline archived</span> : null}
                </div>
                <h1 className={styles.storyTitle}>{article.title}</h1>
                {article.subtitle ? <p className={styles.storyDek}>{article.subtitle}</p> : null}
              </div>

              <div className={styles.storyByline}>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.eyebrow}>Byline</span>
                  {article.author ? (
                    <div className={styles.metaRow}>
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
                    </div>
                  ) : (
                    <span className={styles.muted}>Imported from the news feed</span>
                  )}
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.eyebrow}>Published</span>
                  <span className={styles.muted}>{formatDateTime(article.published_at || article.news_item?.published_at || article.created_at)}</span>
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.eyebrow}>Reading time</span>
                  <span className={styles.muted}>{estimatedReadMinutes ? `${estimatedReadMinutes} min read` : "Awaiting body"}</span>
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.eyebrow}>Views</span>
                  <span className={styles.muted}>{formatCountLabel(article.views, "view")}</span>
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.eyebrow}>Discussion</span>
                  <span className={styles.muted}>{formatCountLabel(article.comment_count, "comment")}</span>
                </div>
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
                      enablePopover
                    />
                  ))}
                </div>
              ) : null}

              <div className={styles.storyFooter}>
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
                {!user ? <p className={styles.helperText}>Sign in to like, save, comment, or react to coverage proposals.</p> : null}
              </div>
            </section>

            <div className={styles.detailMain}>
              {hasPublishedBody ? (
                <section className={styles.storyFrame}>
                  {article.thumbnail_url ? (
                    <div className={styles.flatMedia}>
                      <img src={article.thumbnail_url} alt="" className={styles.featureThumb} />
                    </div>
                  ) : null}
                  <article className={styles.storyArticle}>
                    <div className={styles.storyArticleMeta}>
                      <span className={styles.eyebrow}>Published body</span>
                      {article.is_news ? <span className={styles.pill}>Official article version</span> : null}
                    </div>
                    <div className={styles.markdownBody}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {article.content}
                      </ReactMarkdown>
                    </div>
                  </article>
                </section>
              ) : article.is_news ? (
                <section className={styles.emptyStoryCard}>
                  <div className={styles.emptyStoryHeader}>
                    <span className={styles.eyebrow}>Waiting for coverage</span>
                    <h2 className={styles.emptyStoryTitle}>This news item does not have an approved article yet.</h2>
                  </div>
                  <p className={styles.copy}>
                    The headline is live in the archive, but nobody has written the long-form article body yet. You can submit the first draft below, or vote on existing proposals to help surface the strongest one for approval.
                  </p>
                  <div className={styles.actionRow}>
                    <a href="#write-proposal" className={styles.primaryButton}>Write a proposal</a>
                    {article.proposals.length ? <a href="#proposal-preview" className={styles.secondaryButton}>Review proposals</a> : null}
                  </div>
                </section>
              ) : (
                <section className={styles.storyFrame}>
                  <article className={styles.storyArticle}>
                    <div className={styles.storyArticleMeta}>
                      <span className={styles.eyebrow}>Article body</span>
                    </div>
                    <div className={styles.articleBody}>This article does not have any published body text yet.</div>
                  </article>
                </section>
              )}

              {article.is_news ? (
                <section className={styles.coverageWorkspace}>
                  <div className={styles.coverageIntro}>
                    <div>
                      <h2 className={styles.sectionTitle}>Coverage desk</h2>
                      <p className={styles.sectionCopy}>
                        Proposals live in a dedicated review area so it is always clear when you are reading a draft rather than the published article. Community votes help signal which version looks strongest before approval.
                      </p>
                    </div>
                    <div className={styles.metaRow}>
                      <span className={styles.pill}>{fmtInteger(article.proposals.length)} proposals</span>
                      {!hasPublishedBody ? <span className={styles.statusPill}>No approved body yet</span> : null}
                    </div>
                  </div>

                  <div className={styles.proposalWorkspaceGrid}>
                    <div className={styles.proposalRail}>
                      <div className={styles.proposalRailHeader}>
                        <h3 className={styles.sectionTitle}>Draft queue</h3>
                        <p className={styles.sectionCopy}>Select a proposal to preview the full draft.</p>
                      </div>
                      {article.proposals.length ? (
                        <div className={styles.proposalList}>
                          {article.proposals.map((proposal) => {
                            const isSelected = selectedProposal?.id === proposal.id;
                            const voteIsBusy = proposalVoteBusyId === proposal.id;
                            return (
                              <article
                                key={proposal.id}
                                className={`${styles.proposalSummaryCard} ${isSelected ? styles.proposalSummaryCardActive : ""}`.trim()}
                              >
                                <button
                                  type="button"
                                  className={styles.proposalSelectButton}
                                  onClick={() => setSelectedProposalId(proposal.id)}
                                >
                                  <div className={styles.proposalHeader}>
                                    <div className={styles.proposalMeta}>
                                      <strong>{getProposalTitle(proposal, article)}</strong>
                                      <span className={styles.muted}>
                                        {proposal.author.username} · {formatDateTime(proposal.created_at)}
                                      </span>
                                    </div>
                                    <span className={`${styles.statusPill} ${proposal.status === "approved" ? styles.statusPublished : styles.statusDraft}`}>
                                      {proposal.status}
                                    </span>
                                  </div>
                                  {proposal.subtitle ? <p className={styles.sectionCopy}>{proposal.subtitle}</p> : null}
                                  {proposal.tags.length ? (
                                    <div className={styles.tagRow}>
                                      {proposal.tags.map((tag) => <span key={`${proposal.id}:${tag}`} className={styles.pill}>{tag}</span>)}
                                    </div>
                                  ) : null}
                                  <div className={styles.proposalSummaryFooter}>
                                    <span className={styles.muted}>{fmtInteger(proposal.upvotes)} upvotes</span>
                                    <span className={styles.muted}>{fmtInteger(proposal.downvotes)} downvotes</span>
                                  </div>
                                </button>
                                <div className={styles.proposalActions}>
                                  <button
                                    type="button"
                                    className={`${styles.secondaryButton} ${proposal.viewer_vote === 1 ? styles.secondaryButtonOn : ""}`.trim()}
                                    onClick={() => void handleProposalVote(proposal, 1)}
                                    disabled={!user || voteIsBusy}
                                  >
                                    <FaThumbsUp aria-hidden="true" />
                                    <span>{fmtInteger(proposal.upvotes)}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.secondaryButton} ${proposal.viewer_vote === -1 ? styles.secondaryButtonOn : ""}`.trim()}
                                    onClick={() => void handleProposalVote(proposal, -1)}
                                    disabled={!user || voteIsBusy}
                                  >
                                    <FaThumbsDown aria-hidden="true" />
                                    <span>{fmtInteger(proposal.downvotes)}</span>
                                  </button>
                                  {user?.is_admin && proposal.status !== "approved" ? (
                                    <button type="button" className={styles.primaryButton} onClick={() => void handleApproveProposal(proposal.id)}>
                                      Approve
                                    </button>
                                  ) : null}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={styles.empty}>No proposals yet. Be the first to draft coverage for this item.</div>
                      )}
                    </div>

                    <div className={styles.proposalViewerPane} id="proposal-preview">
                      {selectedProposal ? (
                        <article className={styles.proposalViewer}>
                          <div className={styles.proposalViewerHeader}>
                            <div>
                              <div className={styles.metaRow}>
                                <span className={styles.eyebrow}>Proposal preview</span>
                                <span className={`${styles.statusPill} ${selectedProposal.status === "approved" ? styles.statusPublished : styles.statusDraft}`}>
                                  {selectedProposal.status}
                                </span>
                              </div>
                              <h3 className={styles.proposalViewerTitle}>{getProposalTitle(selectedProposal, article)}</h3>
                              {selectedProposal.subtitle ? <p className={styles.storyDek}>{selectedProposal.subtitle}</p> : null}
                            </div>
                            <div className={styles.proposalViewerMeta}>
                              <span>By {selectedProposal.author.username}</span>
                              <span>{formatDateTime(selectedProposal.created_at)}</span>
                              <span>{fmtInteger(selectedProposal.upvotes - selectedProposal.downvotes)} net score</span>
                            </div>
                          </div>
                          {selectedProposal.tags.length ? (
                            <div className={styles.tagRow}>
                              {selectedProposal.tags.map((tag) => <span key={`${selectedProposal.id}:preview:${tag}`} className={styles.pill}>{tag}</span>)}
                            </div>
                          ) : null}
                          {selectedProposal.thumbnail_url ? (
                            <div className={styles.flatMedia}>
                              <img src={selectedProposal.thumbnail_url} alt="" className={styles.featureThumb} />
                            </div>
                          ) : null}
                          <div className={styles.proposalViewerBody}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {selectedProposal.content}
                            </ReactMarkdown>
                          </div>
                        </article>
                      ) : (
                        <div className={styles.empty}>Select a proposal from the queue to preview it here.</div>
                      )}
                    </div>
                  </div>

                  {user ? (
                    <section className={styles.detailCard} id="write-proposal">
                      <div>
                        <h3 className={styles.sectionTitle}>{hasPublishedBody ? "Submit an alternate draft" : "Write the first draft"}</h3>
                        <p className={styles.sectionCopy}>
                          Your submission is stored as a proposal until an admin approves it as the official article body.
                        </p>
                      </div>
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
                    </section>
                  ) : (
                    <p className={styles.sectionCopy}>Sign in to submit a proposed article for this news item.</p>
                  )}
                </section>
              ) : null}

              <section className={`${styles.detailCard} ${styles.commentsSection}`.trim()}>
                <div>
                  <h2 className={styles.sectionTitle}>Comments</h2>
                  <p className={styles.sectionCopy}>{formatCountLabel(article.comment_count, "comment")} total</p>
                </div>
                {user ? (
                  <form className={styles.fieldGrid} onSubmit={handleCommentSubmit}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Mood</span>
                      <div className={styles.commentMoodPicker}>
                        {ARTICLE_COMMENT_MOODS.map((mood) => {
                          const meta = COMMENT_MOOD_META[mood];
                          const Icon = meta.icon;
                          const isSelected = commentMood === mood;
                          return (
                            <button
                              key={mood}
                              type="button"
                              className={`${styles.commentMoodOption} ${meta.optionClassName} ${isSelected ? styles.commentMoodOptionSelected : ""}`}
                              onClick={() => setCommentMood((current) => (current === mood ? null : mood))}
                              aria-pressed={isSelected}
                            >
                              <Icon aria-hidden="true" />
                              <span>{mood}</span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className={`${styles.commentMoodOption} ${commentMood === null ? styles.commentMoodOptionSelected : ""}`}
                          onClick={() => setCommentMood(null)}
                          aria-pressed={commentMood === null}
                        >
                          <FaCircleQuestion aria-hidden="true" />
                          <span>No mood</span>
                        </button>
                      </div>
                    </div>
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
                          <CommentMoodBadge comment={comment} />
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
