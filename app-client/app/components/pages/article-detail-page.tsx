"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
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
  FaCalendarDays,
  FaChartSimple,
  FaCircleDown,
  FaCircleQuestion,
  FaCircleUp,
  FaClock,
  FaComments,
  FaEye,
  FaGem,
  FaHeart,
  FaRegBookmark,
  FaRegHeart,
  FaScaleBalanced,
  FaTrashCan,
  FaUserPen,
  FaXmark,
  FaThumbsDown,
  FaThumbsUp,
} from "react-icons/fa6";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
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

function splitHeadline(headline: string) {
  const trimmed = headline.trim();
  if (!trimmed) return { title: "", subhead: null as string | null };

  const sentenceBreak = trimmed.match(/^(.{1,200}?[.!?])(?:\s+)(.+)$/);
  if (sentenceBreak) {
    return {
      title: sentenceBreak[1].trim(),
      subhead: sentenceBreak[2].trim() || null,
    };
  }

  if (trimmed.length <= 200) {
    return { title: trimmed, subhead: null as string | null };
  }

  const slice = trimmed.slice(0, 200);
  const naturalBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(": "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(", "),
    slice.lastIndexOf(" - "),
    slice.lastIndexOf(" ")
  );
  const cutoff = naturalBreak > 80 ? naturalBreak + 1 : 200;

  return {
    title: trimmed.slice(0, cutoff).trim(),
    subhead: trimmed.slice(cutoff).trim() || null,
  };
}

function getArticleStoryHeading(article: ArticleDetail | null) {
  if (!article) {
    return { title: "", subtitle: null as string | null };
  }

  if (!article.is_news) {
    return {
      title: article.title,
      subtitle: article.subtitle?.trim() || null,
    };
  }

  const { title, subhead } = splitHeadline(article.title);
  const subtitle = article.subtitle?.trim() || null;

  if (subhead && subtitle && subhead.localeCompare(subtitle, undefined, { sensitivity: "accent" }) === 0) {
    return { title, subtitle };
  }

  return {
    title,
    subtitle: subhead || subtitle,
  };
}

function getProposalTitle(proposal: ArticleProposal, article: ArticleDetail) {
  return proposal.title?.trim() || `${article.title} draft`;
}

function getProposalPreviewHeading(proposal: ArticleProposal, article: ArticleDetail) {
  const customTitle = proposal.title?.trim() || null;
  const customSubtitle = proposal.subtitle?.trim() || null;

  if (customTitle || customSubtitle) {
    return {
      title: customTitle || article.title,
      subtitle: customSubtitle || article.subtitle?.trim() || null,
    };
  }

  return getArticleStoryHeading(article);
}

function getProposalSummaryHeading(proposal: ArticleProposal, article: ArticleDetail) {
  const customTitle = proposal.title?.trim() || null;
  const customSubtitle = proposal.subtitle?.trim() || null;

  if (customTitle || customSubtitle) {
    return {
      title: customTitle || article.title,
      subtitle: customSubtitle || article.subtitle?.trim() || null,
    };
  }

  return getArticleStoryHeading(article);
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
  const router = useRouter();
  const { user } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [activeEffect, setActiveEffect] = useState<"like" | "save" | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentMood, setCommentMood] = useState<ArticleCommentMood | null>(null);
  const [coverageOverlayTab, setCoverageOverlayTab] = useState<"proposals" | "write">("proposals");
  const [isCoverageOverlayOpen, setIsCoverageOverlayOpen] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalSubtitle, setProposalSubtitle] = useState("");
  const [proposalTags, setProposalTags] = useState("");
  const [proposalThumbnailUrl, setProposalThumbnailUrl] = useState("");
  const [proposalContent, setProposalContent] = useState("");
  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentSort, setCommentSort] = useState<"newest" | "oldest" | "top" | "bottom">("newest");
  const [commentVoteBusyId, setCommentVoteBusyId] = useState<number | null>(null);
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false);
  const [adminActionBusy, setAdminActionBusy] = useState<"delete-article" | "delete-news" | "delete-body" | "regenerate-thumbnail" | null>(null);
  const [proposalVoteBusyId, setProposalVoteBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effectTimeoutRef = useRef<number | null>(null);
  const needsVerification = userNeedsEmailVerification(user);

  const canEdit = useMemo(
    () => Boolean(user && article && !article.is_news && (user.is_admin || user.id === article.author?.id)),
    [article, user]
  );
  const hasPublishedBody = useMemo(() => hasText(article?.content), [article?.content]);
  const shouldUseCoverageOverlay = Boolean(article?.is_news && !hasPublishedBody);
  const canOpenCoverageOverlay = Boolean(article?.is_news && (shouldUseCoverageOverlay || article.proposals.length));
  const estimatedReadMinutes = useMemo(() => estimateReadingTimeMinutes(article?.content), [article?.content]);
  const storyHeading = useMemo(() => getArticleStoryHeading(article), [article]);
  const selectedProposal = useMemo(() => {
    if (!article?.proposals.length) return null;
    return article.proposals.find((proposal) => proposal.id === selectedProposalId)
      || article.proposals.find((proposal) => proposal.status === "approved")
      || article.proposals[0];
  }, [article, selectedProposalId]);
  const selectedProposalHeading = useMemo(
    () => (article && selectedProposal ? getProposalPreviewHeading(selectedProposal, article) : null),
    [article, selectedProposal]
  );

  const sortedComments = useMemo(() => {
    if (!article?.comments.length) return [];
    const copy = [...article.comments];
    switch (commentSort) {
      case "oldest":
        return copy.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case "top":
        return copy.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
      case "bottom":
        return copy.sort((a, b) => (a.upvotes - a.downvotes) - (b.upvotes - b.downvotes));
      case "newest":
      default:
        return copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
  }, [article?.comments, commentSort]);

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

  useEffect(() => {
    if (!canOpenCoverageOverlay && isCoverageOverlayOpen) {
      setIsCoverageOverlayOpen(false);
    }
  }, [canOpenCoverageOverlay, isCoverageOverlayOpen]);

  useEffect(() => {
    if (!isCoverageOverlayOpen) return;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCoverageOverlayOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCoverageOverlayOpen]);

  function openCoverageOverlay(tab: "proposals" | "write") {
    setCoverageOverlayTab(tab);
    setIsCoverageOverlayOpen(true);
  }

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
    if (needsVerification) {
      setError("Verify your email before you can react to articles.");
      return;
    }
    const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(slug)}/${kind}`, {
      method: "POST",
      body: "{}",
    });
    setArticle(normalizeArticleDetail(result.article));
    triggerEffect(kind);
  }

  async function handleProposalVote(proposal: ArticleProposal, value: 1 | -1) {
    if (!user) return;
    if (needsVerification) {
      setError("Verify your email before you can vote on proposals.");
      return;
    }
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

  async function handleCommentVote(comment: ArticleComment, value: 1 | -1) {
    if (!user) return;
    if (needsVerification) {
      setError("Verify your email before you can vote on comments.");
      return;
    }
    setCommentVoteBusyId(comment.id);
    try {
      const result = await apiFetch<{ article: Record<string, unknown> }>(
        `/api/articles/${encodeURIComponent(slug)}/comments/${comment.id}/vote`,
        {
          method: "POST",
          body: JSON.stringify({ value: comment.viewer_vote === value ? 0 : value }),
        }
      );
      setArticle(normalizeArticleDetail(result.article));
    } finally {
      setCommentVoteBusyId((current) => (current === comment.id ? null : current));
    }
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    if (needsVerification) {
      setError("Verify your email before you can comment.");
      return;
    }
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
    if (needsVerification) {
      setError("Verify your email before you can submit article proposals.");
      return;
    }
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
      const nextArticle = normalizeArticleDetail(result.article);
      setArticle(nextArticle);
      const newestProposal = [...nextArticle.proposals].sort((left, right) => (
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      ))[0];
      if (newestProposal) {
        setSelectedProposalId(newestProposal.id);
      }
      setCoverageOverlayTab("proposals");
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

  async function handleDeleteArticle() {
    if (!article || !user?.is_admin || article.is_news) return;
    const confirmed = window.confirm("Delete this community article? This cannot be undone.");
    if (!confirmed) return;
    setAdminActionBusy("delete-article");
    setError(null);
    try {
      await apiFetch<Record<string, unknown>>(`/api/articles/${encodeURIComponent(article.slug)}`, {
        method: "DELETE",
      });
      router.push("/articles");
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setAdminActionBusy((current) => (current === "delete-article" ? null : current));
    }
  }

  async function handleDeleteNewsBody() {
    if (!article || !user?.is_admin || !article.is_news || !hasPublishedBody) return;
    const confirmed = window.confirm("Delete the approved body for this news item? The imported news item and proposal history will remain.");
    if (!confirmed) return;
    setAdminActionBusy("delete-body");
    setError(null);
    try {
      const result = await apiFetch<{ article: Record<string, unknown> }>(`/api/articles/${encodeURIComponent(article.slug)}/body`, {
        method: "DELETE",
      });
      setArticle(normalizeArticleDetail(result.article));
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setAdminActionBusy((current) => (current === "delete-body" ? null : current));
    }
  }

  async function handleDeleteNewsArticle() {
    if (!article || !user?.is_admin || !article.is_news) return;
    const confirmed = window.confirm("Delete this imported news item? This removes it from the news archive and cannot be undone.");
    if (!confirmed) return;
    setAdminActionBusy("delete-news");
    setError(null);
    try {
      await apiFetch<Record<string, unknown>>(`/api/admin/holonews/articles/${encodeURIComponent(article.slug)}`, {
        method: "DELETE",
      });
      router.push("/news");
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setAdminActionBusy((current) => (current === "delete-news" ? null : current));
    }
  }

  async function handleRegenerateNewsThumbnail() {
    if (!article || !user?.is_admin || !article.is_news) return;
    const confirmed = window.confirm("Regenerate this news thumbnail? This will call the image generator, upload a new S3 thumbnail, and update the news item.");
    if (!confirmed) return;
    setAdminActionBusy("regenerate-thumbnail");
    setError(null);
    try {
      const start = await apiFetch<{ job_id?: string; status?: string }>("/api/admin/holonews/thumbnails/regenerate", {
        method: "POST",
        body: JSON.stringify({
          news_id: article.news_item?.id || null,
          article_slug: article.slug,
          impacted_coins: article.related_assets.map((asset) => asset.symbol).filter(Boolean),
          reference_images: article.related_assets.map((asset) => asset.display_name).filter(Boolean),
        }),
      });

      if (start.job_id && start.status === "pending") {
        const jobId = start.job_id;
        const deadline = Date.now() + 12 * 60 * 1000;
        let finished = false;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const state = await apiFetch<{
            status: string;
            result?: unknown;
            code?: string;
            message?: string;
          }>(`/api/admin/holonews/thumbnails/regenerate/${encodeURIComponent(jobId)}`);
          if (state.status === "done") {
            finished = true;
            break;
          }
          if (state.status === "error") {
            throw new Error(state.message || state.code || "thumbnail_regeneration_failed");
          }
        }
        if (!finished) {
          throw new Error(
            "Thumbnail regeneration is still running. Wait a bit and refresh the page, or try again."
          );
        }
      }

      await loadArticle();
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setAdminActionBusy((current) => (current === "regenerate-thumbnail" ? null : current));
    }
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
                <h1 className={styles.storyTitle}>{storyHeading.title}</h1>
                {storyHeading.subtitle ? <p className={styles.storyDek}>{storyHeading.subtitle}</p> : null}
              </div>

              <div className={styles.storyByline}>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.storyBylineIcon}><FaUserPen aria-hidden="true" /></span>
                  <span className={styles.eyebrow}>Byline</span>
                  {article.author ? (
                    <div className={styles.metaRow}>
                      <Link href={`/profile/${encodeURIComponent(article.author.username)}`} className={styles.inlineLink}>
                        {article.author.username}
                      </Link>
                      <Link
                        href={`/profile/${encodeURIComponent(article.author.username)}#articles`}
                        className={styles.inlineLinkMuted}
                      >
                        More by this author
                      </Link>
                    </div>
                  ) : (
                    <span className={styles.muted}>Imported from the news feed</span>
                  )}
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.storyBylineIcon}><FaCalendarDays aria-hidden="true" /></span>
                  <span className={styles.eyebrow}>Published</span>
                  <span className={styles.muted}>{formatDateTime(article.published_at || article.news_item?.published_at || article.created_at)}</span>
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.storyBylineIcon}><FaClock aria-hidden="true" /></span>
                  <span className={styles.eyebrow}>Reading time</span>
                  <span className={styles.muted}>{estimatedReadMinutes ? `${estimatedReadMinutes} min read` : "Awaiting body"}</span>
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.storyBylineIcon}><FaEye aria-hidden="true" /></span>
                  <span className={styles.eyebrow}>Views</span>
                  <span className={styles.muted}>{formatCountLabel(article.views, "view")}</span>
                </div>
                <div className={styles.storyBylineBlock}>
                  <span className={styles.storyBylineIcon}><FaComments aria-hidden="true" /></span>
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
                    disabled={!user || needsVerification}
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
                    disabled={!user || needsVerification}
                  >
                    <span className={styles.actionIcon}>
                      {article.viewer_has_saved ? <FaBookmark aria-hidden="true" /> : <FaRegBookmark aria-hidden="true" />}
                    </span>
                    <span>{article.viewer_has_saved ? "Unsave" : "Save"}</span>
                    <span className={styles.actionCount}>{article.saves}</span>
                  </button>
                  {canEdit ? <Link href={`/articles/${encodeURIComponent(article.slug)}/edit`} className={styles.toolbarLink}>Edit article</Link> : null}
                  {user?.is_admin && !article.is_news ? (
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => void handleDeleteArticle()}
                      disabled={adminActionBusy !== null}
                    >
                      {adminActionBusy === "delete-article" ? "Deleting..." : "Delete article"}
                    </button>
                  ) : null}
                  {user?.is_admin && article.is_news && hasPublishedBody ? (
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => void handleDeleteNewsBody()}
                      disabled={adminActionBusy !== null}
                    >
                      {adminActionBusy === "delete-body" ? "Deleting..." : "Delete body"}
                    </button>
                  ) : null}
                  {user?.is_admin && article.is_news ? (
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => void handleDeleteNewsArticle()}
                      disabled={adminActionBusy !== null}
                    >
                      <span className={styles.actionIcon}><FaTrashCan aria-hidden="true" /></span>
                      <span>{adminActionBusy === "delete-news" ? "Deleting..." : "Delete news item"}</span>
                    </button>
                  ) : null}
                  {user?.is_admin && article.is_news ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => void handleRegenerateNewsThumbnail()}
                      disabled={adminActionBusy !== null}
                    >
                      <span className={styles.actionIcon}><FaGem aria-hidden="true" /></span>
                      <span>{adminActionBusy === "regenerate-thumbnail" ? "Regenerating..." : "Regenerate thumbnail"}</span>
                    </button>
                  ) : null}
                </div>
                {!user ? <p className={styles.helperText}>Sign in to like, save, comment, or react to coverage proposals.</p> : null}
                {needsVerification ? <VerificationRequiredNotice action="like, save, comment, or react to coverage proposals" compact /> : null}
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
                  <Image src="/maidwatame.png" alt="" width={408} height={611} className={styles.bodyMascot} aria-hidden="true" />
                </section>
              ) : article.is_news ? (
                <section className={styles.emptyStoryCard}>
                  {article.thumbnail_url ? (
                    <div className={styles.flatMedia}>
                      <img src={article.thumbnail_url} alt="" className={styles.featureThumb} />
                    </div>
                  ) : null}
                  <div className={styles.emptyStoryHeader}>
                    <span className={styles.eyebrow}>Waiting for coverage</span>
                    <h2 className={styles.emptyStoryTitle}>This news item does not have an approved article yet.</h2>
                  </div>
                  <p className={styles.copy}>
                    The headline is live in the archive, but nobody has written the long-form article body yet. You can submit the first draft below, or vote on existing proposals to help surface the strongest one for approval.
                  </p>
                  <div className={styles.actionRow}>
                    <button type="button" className={styles.primaryButton} onClick={() => openCoverageOverlay("write")}>Open draft room</button>
                    {article.proposals.length ? (
                      <button type="button" className={styles.secondaryButton} onClick={() => openCoverageOverlay("proposals")}>Review proposals</button>
                    ) : null}
                  </div>
                  <Image src="/maidwatame.png" alt="" width={408} height={611} className={styles.bodyMascot} aria-hidden="true" />
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

              {article.is_news && hasPublishedBody && article.proposals.length ? (
                <section className={styles.coverageCompactCard}>
                  <div className={styles.coverageCompactIcon}>
                    <FaBinoculars aria-hidden="true" />
                  </div>
                  <div className={styles.coverageCompactBody}>
                    <h2 className={styles.sectionTitle}>Coverage proposals</h2>
                    <p className={styles.sectionCopy}>
                      This article already has an approved body. You can still review the proposal history in the side panel.
                    </p>
                  </div>
                  <div className={styles.coverageCompactActions}>
                    <span className={styles.pill}>{fmtInteger(article.proposals.length)} proposals</span>
                    <button type="button" className={styles.secondaryButton} onClick={() => openCoverageOverlay("proposals")}>
                      View proposals
                    </button>
                  </div>
                </section>
              ) : null}

              <section className={`${styles.detailCard} ${styles.commentsSection}`.trim()}>
                <div className={styles.commentSectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Comments</h2>
                    <p className={styles.sectionCopy}>{formatCountLabel(article.comment_count, "comment")} total</p>
                  </div>
                  {article.comments.length ? (
                    <div className={styles.commentSortRow}>
                      <span className={styles.fieldLabel}>Sort</span>
                      <select
                        className={styles.commentSortSelect}
                        value={commentSort}
                        onChange={(event) => setCommentSort(event.target.value as typeof commentSort)}
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="top">Highest score</option>
                        <option value="bottom">Lowest score</option>
                      </select>
                    </div>
                  ) : null}
                </div>
                {user && needsVerification ? (
                  <VerificationRequiredNotice action="comment" />
                ) : user ? (
                  <form className={styles.commentComposer} onSubmit={handleCommentSubmit}>
                    <div className={`${styles.field} ${styles.commentComposerMoodField}`}>
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
                    <div className={styles.commentComposerBody}>
                      <label className={`${styles.field} ${styles.commentComposerInputField}`}>
                        <span className={styles.fieldLabel}>Add comment</span>
                        <textarea
                          className={`${styles.textarea} ${styles.commentComposerTextarea}`}
                          value={commentBody}
                          onChange={(event) => setCommentBody(event.target.value)}
                          placeholder="Add your take on this article."
                        />
                      </label>
                      <div className={styles.commentComposerActions}>
                        <button type="submit" className={styles.primaryButton} disabled={needsVerification || isSubmittingComment || !commentBody.trim()}>
                          {isSubmittingComment ? "Posting…" : "Post comment"}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <p className={styles.sectionCopy}>Sign in to comment.</p>
                )}

                {sortedComments.length ? (
                  <div className={styles.commentList}>
                    {sortedComments.map((comment) => {
                      const isOwnComment = user?.id === comment.author.id;
                      return (
                        <article key={comment.id} className={styles.commentCard}>
                          <div className={styles.commentHeader}>
                            <div className={styles.commentMeta}>
                              <strong>{comment.author.username}</strong>
                              <span className={styles.muted}>{formatDateTime(comment.created_at)}</span>
                            </div>
                            <CommentMoodBadge comment={comment} />
                          </div>
                          <div className={styles.articleBody}>{comment.body}</div>
                          <div className={styles.commentVoteRow}>
                            <button
                              type="button"
                              className={`${styles.commentVoteButton} ${comment.viewer_vote === 1 ? styles.commentVoteButtonActive : ""}`.trim()}
                              onClick={() => void handleCommentVote(comment, 1)}
                              disabled={!user || needsVerification || isOwnComment || commentVoteBusyId === comment.id}
                              aria-pressed={comment.viewer_vote === 1}
                            >
                              <FaThumbsUp aria-hidden="true" />
                              <span>{fmtInteger(comment.upvotes)}</span>
                            </button>
                            <button
                              type="button"
                              className={`${styles.commentVoteButton} ${comment.viewer_vote === -1 ? styles.commentVoteButtonActive : ""}`.trim()}
                              onClick={() => void handleCommentVote(comment, -1)}
                              disabled={!user || needsVerification || isOwnComment || commentVoteBusyId === comment.id}
                              aria-pressed={comment.viewer_vote === -1}
                            >
                              <FaThumbsDown aria-hidden="true" />
                              <span>{fmtInteger(comment.downvotes)}</span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.empty}>No comments yet.</div>
                )}
              </section>
            </div>

            {canOpenCoverageOverlay ? (
              <div
                className={`${styles.coverageOverlay} ${isCoverageOverlayOpen ? styles.coverageOverlayOpen : ""}`.trim()}
                aria-hidden={!isCoverageOverlayOpen}
              >
                <button
                  type="button"
                  className={styles.coverageOverlayBackdrop}
                  onClick={() => setIsCoverageOverlayOpen(false)}
                  tabIndex={isCoverageOverlayOpen ? 0 : -1}
                  aria-label="Close draft room"
                />
                <section
                  className={styles.coverageOverlayPanel}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="coverage-overlay-title"
                >
                  <div className={styles.coverageOverlayChrome}>
                    <button
                      type="button"
                      className={styles.coverageOverlayClose}
                      onClick={() => setIsCoverageOverlayOpen(false)}
                      aria-label="Close draft room"
                    >
                      <FaXmark aria-hidden="true" />
                    </button>
                  </div>

                  <div className={styles.coverageOverlayHeader}>
                    <div className={styles.coverageOverlayHeading}>
                      <span className={styles.eyebrow}>{hasPublishedBody ? "Proposal history" : "Writers draft room"}</span>
                      <h2 id="coverage-overlay-title" className={styles.coverageOverlayTitle}>
                        {hasPublishedBody ? "Review existing drafts for this story." : "Build the first approved version of this story."}
                      </h2>
                      <p className={styles.coverageOverlayCopy}>
                        {hasPublishedBody
                          ? "The approved article body remains the canonical version while previous proposals stay available for review."
                          : "Review the room's current drafts or write a new take for editorial approval. The source headline stays live while this coverage board fills up."}
                      </p>
                    </div>
                    <div className={styles.coverageOverlayStats}>
                      <span className={styles.pill}>{fmtInteger(article.proposals.length)} proposals</span>
                      <span className={styles.statusPill}>{hasPublishedBody ? "Approved body live" : "No approved body yet"}</span>
                    </div>
                  </div>

                  <div className={styles.coverageOverlayTabs} role="tablist" aria-label="Coverage workspace">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={coverageOverlayTab === "proposals"}
                      className={`${styles.coverageOverlayTab} ${coverageOverlayTab === "proposals" ? styles.coverageOverlayTabActive : ""}`.trim()}
                      onClick={() => setCoverageOverlayTab("proposals")}
                    >
                      Current proposals
                    </button>
                    {!hasPublishedBody ? (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={coverageOverlayTab === "write"}
                        className={`${styles.coverageOverlayTab} ${coverageOverlayTab === "write" ? styles.coverageOverlayTabActive : ""}`.trim()}
                        onClick={() => setCoverageOverlayTab("write")}
                      >
                        Write a proposal
                      </button>
                    ) : null}
                  </div>

                  <div className={styles.coverageOverlayBody}>
                    {coverageOverlayTab === "proposals" || hasPublishedBody ? (
                      <div className={styles.coverageOverlayWorkspace}>
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
                                const proposalSummaryHeading = getProposalSummaryHeading(proposal, article);
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
                                          <strong>{proposalSummaryHeading.title}</strong>
                                          <span className={styles.muted}>
                                            {proposal.author.username} · {formatDateTime(proposal.created_at)}
                                          </span>
                                        </div>
                                        <span className={`${styles.statusPill} ${proposal.status === "approved" ? styles.statusPublished : styles.statusDraft}`}>
                                          {proposal.status}
                                        </span>
                                      </div>
                                      {proposalSummaryHeading.subtitle ? <p className={styles.sectionCopy}>{proposalSummaryHeading.subtitle}</p> : null}
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
                                        disabled={!user || needsVerification || voteIsBusy}
                                      >
                                        <FaThumbsUp aria-hidden="true" />
                                        <span>{fmtInteger(proposal.upvotes)}</span>
                                      </button>
                                      <button
                                        type="button"
                                        className={`${styles.secondaryButton} ${proposal.viewer_vote === -1 ? styles.secondaryButtonOn : ""}`.trim()}
                                        onClick={() => void handleProposalVote(proposal, -1)}
                                        disabled={!user || needsVerification || voteIsBusy}
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

                        <div className={styles.proposalViewerPane}>
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
                                  <h3 className={styles.proposalViewerTitle}>{selectedProposalHeading?.title || getProposalTitle(selectedProposal, article)}</h3>
                                  {selectedProposalHeading?.subtitle ? <p className={styles.storyDek}>{selectedProposalHeading.subtitle}</p> : null}
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
                              {selectedProposal.thumbnail_url || article.thumbnail_url ? (
                                <div className={styles.flatMedia}>
                                  <img src={selectedProposal.thumbnail_url || article.thumbnail_url || ""} alt="" className={styles.featureThumb} />
                                </div>
                              ) : null}
                              <div className={styles.proposalViewerBody}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {selectedProposal.content}
                                </ReactMarkdown>
                              </div>
                            </article>
                          ) : (
                            <div className={`${styles.empty} ${styles.proposalViewerEmptyState}`.trim()}>
                              <p className={styles.proposalViewerEmptyCopy}>Select a proposal from the queue to preview it here.</p>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src="https://images.nasfaq.biz/site-assets/moona.png"
                                alt="Moona illustration"
                                className={styles.proposalViewerEmptyImage}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ) : user && needsVerification ? (
                      <div className={styles.coverageOverlayDraftPane}>
                        <VerificationRequiredNotice action="submit article proposals" />
                      </div>
                    ) : user ? (
                      <section className={styles.coverageOverlayDraftPane}>
                        <div className={styles.coverageOverlayDraftIntro}>
                          <h3 className={styles.sectionTitle}>Write the first draft</h3>
                          <p className={styles.sectionCopy}>
                            Your submission stays in review until an admin approves it as the official article body.
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
                          <label className={`${styles.field} ${styles.coverageOverlayBodyField}`.trim()}>
                            <span className={styles.fieldLabel}>Proposal body</span>
                            <textarea className={styles.textarea} value={proposalContent} onChange={(event) => setProposalContent(event.target.value)} placeholder="Write the article body you want the admin to approve." />
                          </label>
                          <div className={styles.actionRow}>
                            <button type="submit" className={styles.primaryButton} disabled={needsVerification || isSubmittingProposal || !proposalContent.trim()}>
                              {isSubmittingProposal ? "Submitting…" : "Submit proposal"}
                            </button>
                          </div>
                        </form>
                      </section>
                    ) : (
                      <div className={styles.coverageOverlayDraftPane}>
                        <div className={styles.empty}>Sign in to submit a proposed article for this news item.</div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
