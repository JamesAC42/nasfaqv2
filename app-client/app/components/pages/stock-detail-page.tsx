"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { IconType } from "react-icons";
import {
  CandleChartCard,
  RankedBarChartCard,
  SuperchatHeatmapCard,
  SuperchatHistogramCard,
  TrendChartCard,
  VolumeChartCard,
} from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { MarketSidebar } from "@/app/components/common/market-sidebar";
import { OshiboardPanel } from "@/app/components/oshiboard/oshiboard-panel";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { LivestreamModal, type LivestreamModalItem } from "@/app/components/livestreams/livestream-modal";
import { apiFetch } from "@/app/lib/api";
import { adjustSaturation, createChannelChartTheme, rotateHue } from "@/app/lib/chart-theme";
import { getUsableChannelColor, normalizeHexColor } from "@/app/lib/color";
import { fmtDate, fmtDurationSeconds, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { pickTradeConfirmationImage } from "@/app/lib/trade-confirmation-images";
import {
  normalizeArticleListResponse,
  normalizeAssetCommentListResponse,
  normalizeAssetSuperchatSummary,
  normalizeAssetSuperchatTimeseries,
  normalizeCandles,
  normalizeLivestreams,
  normalizeMarketAssetAdjustmentHistory,
  normalizeOshiboardResponse,
} from "@/app/lib/normalizers";
import { getBucketWsUrl } from "@/app/lib/ws";
import { ARTICLE_COMMENT_MOODS } from "@/app/lib/types";
import type {
  ArticleSummary,
  AuthUser,
  AssetComment,
  AssetCommentListResponse,
  AssetSuperchatSummaryBundle,
  AssetSuperchatTimeseriesBundle,
  ArticleCommentMood,
  ChannelOverviewRow,
  LivestreamItem,
  MarketAssetAdjustmentHistory,
  MarketAdjustmentOutcome,
  MarketAsset,
  OshiboardResponse,
  PortfolioHolding,
  CandlePoint,
} from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useChannelStore } from "@/app/stores/channel-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/stock-detail-page.module.scss";
import { BsArrowDown, BsArrowUp, BsYoutube } from "react-icons/bs";
import { GoLinkExternal } from "react-icons/go";
import {
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaBinoculars,
  FaBoxesStacked,
  FaChartColumn,
  FaChartSimple,
  FaCircleDown,
  FaCircleQuestion,
  FaCircleUp,
  FaDollarSign,
  FaEye,
  FaGem,
  FaScaleBalanced,
  FaThumbsDown,
  FaThumbsUp,
  FaUsers,
  FaVideo,
  FaYenSign,
} from "react-icons/fa6";

const DETAIL_CHART_START_DATE = "2025-10-09";
const TRADE_CONFIRMATION_ANIMATION_MS = 280;
const INTRADAY_CANDLE_INTERVALS = [
  { value: "1h", label: "1H" },
  { value: "5m", label: "5M" },
  { value: "1m", label: "1M" },
] as const;

type IntradayCandleInterval = (typeof INTRADAY_CANDLE_INTERVALS)[number]["value"];
const SUPERCHAT_TIMESERIES_OPTIONS = [
  { value: "7d", label: "Past 7 days" },
  { value: "14d", label: "Past 14 days" },
  { value: "1m", label: "Weekly for month" },
  { value: "1y", label: "Past year" },
] as const;
const CURRENCY_FLAG_MAP: Record<string, string> = {
  AED: "AE",
  ARS: "AR",
  AUD: "AU",
  BRL: "BR",
  CAD: "CA",
  CHF: "CH",
  CLP: "CL",
  CNY: "CN",
  COP: "CO",
  CZK: "CZ",
  DKK: "DK",
  EUR: "EU",
  GBP: "GB",
  HKD: "HK",
  HUF: "HU",
  IDR: "ID",
  INR: "IN",
  JPY: "JP",
  YEN: "JP",
  KRW: "KR",
  KWD: "KW",
  MXN: "MX",
  MYR: "MY",
  NOK: "NO",
  NZD: "NZ",
  PEN: "PE",
  PHP: "PH",
  PLN: "PL",
  PYG: "PY",
  QAR: "QA",
  RON: "RO",
  SAR: "SA",
  SEK: "SE",
  SGD: "SG",
  THB: "TH",
  TRY: "TR",
  TWD: "TW",
  USD: "US",
  VND: "VN",
  ZAR: "ZA",
};
const DESCRIPTION_URL_PATTERN = /((https?:\/\/|www\.)[^\s<]+)/gi;

type LiveSessionResponse = {
  session: {
    video_id: string;
    youtube_channel_id: string;
    status: "upcoming" | "live" | "ended";
    video_title: string | null;
    thumbnail_url: string | null;
    scheduled_start_at: string | null;
    actual_start_at: string | null;
    ended_at: string | null;
    total_views: number | null;
    avg_concurrent_viewers: number | null;
    max_concurrent_viewers: number | null;
    duration_seconds: number | null;
    channel_name: string;
    channel_icon: string | null;
    channel_color: string | null;
  } | null;
};

type ViewerBucket = {
  bucket_start: string;
  bucket_end: string;
  duration_seconds: number;
  avg_viewers: number | null;
  max_viewers: number | null;
};

type BucketUpdate = {
  video_id: string;
  bucket_start: string;
  bucket_end: string;
  avg_viewers?: number | string | null;
  max_viewers?: number | string | null;
};

type TradeExecutionResult = {
  order_id?: number | string;
  status?: "pending" | "filled" | "cancelled" | "rejected";
  order_type?: "market" | "live_market";
  requested_quantity?: number;
  execute_after?: string | null;
  interval_limit?: number;
  remaining_interval_shares?: number | null;
  remaining_tick_shares?: number | null;
  indicative_price?: number;
  filled_quantity?: number;
  executed_price?: number;
  fee?: number;
  total_cost?: number | null;
  total_proceeds?: number | null;
  cost_basis_sold?: number | null;
  realized_pnl?: number | null;
  side: "buy" | "sell";
  symbol: string;
  updated_holdings?: {
    quantity: number;
    avg_cost_basis: number;
  } | null;
  updated_cash_balance?: number | null;
  filled_at?: string | null;
};

type TradeConfirmation = {
  mode: "filled" | "queued";
  orderId: number | string | null;
  side: "buy" | "sell";
  symbol: string;
  requestedQuantity: number;
  executeAfter: string | null;
  intervalLimit: number | null;
  remainingIntervalShares: number | null;
  filledQuantity: number;
  executedPrice: number;
  fee: number;
  grossValue: number;
  netCashImpact: number;
  totalCost: number | null;
  totalProceeds: number | null;
  costBasisSold: number | null;
  previousQuantity: number;
  previousAvgCost: number;
  nextQuantity: number;
  nextAvgCost: number;
  nextCashBalance: number | null;
  currentMidPrice: number | null;
  filledAt: string | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  themePnl: number | null;
  imageSrc: string;
};

type HeroStat = {
  label: string;
  value: string;
  accent: boolean;
  tone?: "up" | "down";
  meta?: string;
};

type AssetSuperchatRank = {
  symbol: string;
  youtube_channel_id: string;
  range: string;
  total_in_yen: number | null;
  rank: number | null;
};

type PastLivestreamResponse = {
  video_id: string;
  status: "ended";
  video_title: string | null;
  thumbnail_url: string | null;
  channel_name: string;
  channel_icon: string | null;
  channel_color: string | null;
  scheduled_start_at: string | null;
  actual_start_at: string | null;
  ended_at: string | null;
  total_views: number | null;
  avg_concurrent_viewers: number | null;
  max_concurrent_viewers: number | null;
  duration_seconds: number | null;
};

type PastLivestreamPayload = {
  page: number;
  week_start: string;
  week_end: string;
  has_older: boolean;
  streams: PastLivestreamResponse[];
};

type PastLivestreamItem = LivestreamModalItem & {
  total_views: number | null;
  avg_concurrent_viewers: number | null;
  max_concurrent_viewers: number | null;
  duration_seconds: number | null;
  ended_at: string | null;
};

type RankSpotlight = {
  label: string;
  rank: number | null;
  value: string;
  icon: ReactNode;
};

type TradeFailureNotice = {
  title: string;
  message: string;
};

const TRADE_QUANTITY_PRESETS = ["1", "10", "25", "50", "100"] as const;

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

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveDurationSeconds(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 1000);
}

function normalizePastLivestream(stream: PastLivestreamResponse): PastLivestreamItem {
  return {
    id: stream.video_id,
    title: stream.video_title || "Livestream",
    creator: stream.channel_name,
    creator_icon: stream.channel_icon,
    channel_color: stream.channel_color,
    thumbnail_url: stream.thumbnail_url,
    started_at: stream.actual_start_at || stream.scheduled_start_at,
    ended_at: stream.ended_at,
    total_views: toNumber(stream.total_views),
    avg_concurrent_viewers: toNumber(stream.avg_concurrent_viewers),
    max_concurrent_viewers: toNumber(stream.max_concurrent_viewers),
    duration_seconds: toNumber(stream.duration_seconds) ?? deriveDurationSeconds(stream.actual_start_at, stream.ended_at),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(stream.video_id)}`,
    status: stream.status,
  };
}

function formatAdjustmentLabel(value: string | null | undefined) {
  switch (value) {
    case "open":
      return "Open";
    case "lunch":
      return "Lunch";
    case "late":
      return "Late";
    case "overnight":
      return "Overnight";
    default:
      return value || "N/A";
  }
}

function formatAdjustmentTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildAdjustmentKey(item: MarketAdjustmentOutcome | null | undefined) {
  if (!item) return "";
  return `${item.id ?? "item"}-${item.market_date || "date"}-${item.interval_key}-${item.scheduled_at || item.applied_at || ""}`;
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return { relative: "Unknown time", absolute: "Unknown time" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { relative: value, absolute: value };
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs <= 0) {
    return { relative: "just now", absolute: date.toLocaleString() };
  }
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return { relative: `${seconds} second${seconds === 1 ? "" : "s"} ago`, absolute: date.toLocaleString() };
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return { relative: `${minutes} minute${minutes === 1 ? "" : "s"} ago`, absolute: date.toLocaleString() };
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { relative: `${hours} hour${hours === 1 ? "" : "s"} ago`, absolute: date.toLocaleString() };
  }
  const days = Math.floor(hours / 24);
  return { relative: `${days} day${days === 1 ? "" : "s"} ago`, absolute: date.toLocaleString() };
}

function getCommentMoodMeta(mood: ArticleCommentMood | null) {
  return mood ? COMMENT_MOOD_META[mood] : null;
}

function profileInitial(username: string) {
  return username.trim().charAt(0).toUpperCase() || "?";
}

function commentFailureMessage(error: unknown) {
  const code = String((error as Error).message || error);
  switch (code) {
    case "asset_comment_requires_holding":
      return "You need to own shares of this coin before you can post on the channel board.";
    case "invalid_asset_comment":
      return "Comments must include text and use a valid mood selection.";
    case "unauthenticated":
      return "Sign in to join the channel board.";
    default:
      return code;
  }
}

function voteFailureMessage(error: unknown) {
  const code = String((error as Error).message || error);
  switch (code) {
    case "asset_comment_self_vote":
      return "You cannot vote on your own comment.";
    case "invalid_asset_comment_vote":
      return "That vote could not be saved.";
    case "unauthenticated":
      return "Sign in to vote on comments.";
    default:
      return code;
  }
}

function CommentMoodBadge({ comment }: { comment: AssetComment }) {
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

type ChannelBoardProps = {
  assetSymbol: string;
  assetCommentBoard: AssetCommentListResponse | null;
  assetCommentBoardError: string | null;
  canPostAssetComment: boolean;
  commentVoteBusyId: number | null;
  isLoadingAssetComments: boolean;
  isLoadingPortfolio: boolean;
  isSubmittingComment: boolean;
  needsEmailVerification: boolean;
  onCommentSubmit: (body: string, mood: ArticleCommentMood | null) => Promise<boolean>;
  onCommentVote: (comment: AssetComment, value: 1 | -1) => void | Promise<void>;
  onNextPage: () => void;
  onPreviousPage: () => void;
  totalAssetComments: number;
  user: AuthUser | null;
  viewerOwnedShares: number;
};

const ChannelBoard = memo(function ChannelBoard({
  assetSymbol,
  assetCommentBoard,
  assetCommentBoardError,
  canPostAssetComment,
  commentVoteBusyId,
  isLoadingAssetComments,
  isLoadingPortfolio,
  isSubmittingComment,
  needsEmailVerification,
  onCommentSubmit,
  onCommentVote,
  onNextPage,
  onPreviousPage,
  totalAssetComments,
  user,
  viewerOwnedShares,
}: ChannelBoardProps) {
  const [commentBody, setCommentBody] = useState("");
  const [commentMood, setCommentMood] = useState<ArticleCommentMood | null>(null);
  const assetCommentPagination = assetCommentBoard?.pagination || null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBody = commentBody.trim();
    if (!trimmedBody) return;
    const didSubmit = await onCommentSubmit(trimmedBody, commentMood);
    if (didSubmit) {
      setCommentBody("");
      setCommentMood(null);
    }
  }

  return (
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Channel Board</h2>
          <p className={styles.sectionCopy}>
            {fmtInteger(totalAssetComments)} total comments. Only shareholders can post; votes are open to other signed-in users.
          </p>
        </div>
        {user ? (
          <span className={styles.commentBoardStatus}>
            {isLoadingPortfolio && !assetCommentBoard ? "Checking holdings…" : `${fmtNumber(viewerOwnedShares)} shares owned`}
          </span>
        ) : null}
      </div>
      {assetCommentBoardError ? <div className="statusMessage statusMessageError">Board error: {assetCommentBoardError}</div> : null}
      {user ? (
        <form className={styles.commentComposer} onSubmit={handleSubmit}>
          {needsEmailVerification ? <VerificationRequiredNotice action="post on the channel board" /> : null}
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
          <textarea
            className={styles.commentInput}
            placeholder={
              canPostAssetComment
                ? `What is your current read on ${assetSymbol}?`
                : `Buy shares of ${assetSymbol} to unlock posting.`
            }
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            disabled={!canPostAssetComment}
          />
          <div className={styles.commentComposerFooter}>
            <span>
              {needsEmailVerification
                ? "Verify your email before posting on the channel board."
                : !user
                  ? "Sign in to join the channel board."
                  : canPostAssetComment
                    ? `You can post because you currently own ${fmtNumber(viewerOwnedShares)} shares of ${assetSymbol}.`
                    : `Posting is limited to shareholders. You currently own ${fmtNumber(viewerOwnedShares)} shares of ${assetSymbol}.`}
            </span>
            <button
              type="submit"
              className={styles.commentButton}
              disabled={!canPostAssetComment || isSubmittingComment || !commentBody.trim()}
            >
              {isSubmittingComment ? "Posting…" : "Post Comment"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.authCta}>
          <p className={styles.sectionCopy}>Sign in to vote, and own shares of this coin to post on the board.</p>
          <div className={styles.authLinks}>
            <Link href="/login">Sign in</Link>
            <Link href="/register">Create account</Link>
          </div>
        </div>
      )}
      {isLoadingAssetComments ? <div className={styles.empty}>Loading channel board…</div> : null}
      {!isLoadingAssetComments && assetCommentBoard?.comments.length ? (
        <>
          <div className={styles.commentList}>
            {assetCommentBoard.comments.map((comment) => {
              const timeLabel = formatRelativeTime(comment.created_at);
              const isOwnComment = user?.id === comment.author.id;
              return (
                <article key={comment.id} className={styles.commentCard}>
                  <div className={styles.commentHeader}>
                    <div className={styles.commentAuthor}>
                      <Link href={`/profile/${encodeURIComponent(comment.author.username)}`} className={styles.commentAuthorAvatar}>
                        {comment.author.profile_picture_url ? (
                          <img src={comment.author.profile_picture_url} alt="" className={styles.commentAuthorAvatarImage} />
                        ) : (
                          <span className={styles.commentAuthorAvatarFallback} aria-hidden="true">
                            {profileInitial(comment.author.username)}
                          </span>
                        )}
                      </Link>
                      <div className={styles.commentAuthorMeta}>
                        <div className={styles.commentAuthorRow}>
                          <Link href={`/profile/${encodeURIComponent(comment.author.username)}`} className={styles.commentAuthorName}>
                            {comment.author.username}
                          </Link>
                          <span className={styles.commentSharePill}>{fmtNumber(comment.author_share_quantity)} shares</span>
                        </div>
                        <span title={timeLabel.absolute}>{timeLabel.relative}</span>
                      </div>
                    </div>
                    <CommentMoodBadge comment={comment} />
                  </div>
                  <p className={styles.commentBody}>{comment.body}</p>
                  <div className={styles.commentVoteRow}>
                    <button
                      type="button"
                      className={`${styles.commentVoteButton} ${comment.viewer_vote === 1 ? styles.commentVoteButtonActive : ""}`.trim()}
                      onClick={() => void onCommentVote(comment, 1)}
                      disabled={!user || needsEmailVerification || isOwnComment || commentVoteBusyId === comment.id}
                      aria-pressed={comment.viewer_vote === 1}
                    >
                      <FaThumbsUp aria-hidden="true" />
                      <span>{fmtInteger(comment.upvotes)}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.commentVoteButton} ${comment.viewer_vote === -1 ? styles.commentVoteButtonActive : ""}`.trim()}
                      onClick={() => void onCommentVote(comment, -1)}
                      disabled={!user || needsEmailVerification || isOwnComment || commentVoteBusyId === comment.id}
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
          {assetCommentPagination && assetCommentPagination.page_count > 1 ? (
            <div className={styles.commentPagination}>
              <button
                type="button"
                className={styles.commentButton}
                onClick={onPreviousPage}
                disabled={!assetCommentPagination.has_previous_page}
              >
                Newer
              </button>
              <span>
                Page {assetCommentPagination.page} of {assetCommentPagination.page_count}
              </span>
              <button
                type="button"
                className={styles.commentButton}
                onClick={onNextPage}
                disabled={!assetCommentPagination.has_next_page}
              >
                Older
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {!isLoadingAssetComments && !assetCommentBoard?.comments.length ? (
        <div className={styles.emptyComments}>No comments yet. Shareholders can start the first thread for this coin.</div>
      ) : null}
    </section>
  );
});

function formatSignedPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${fmtPct(value)}`;
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value), "$")}`;
}

function formatSignedNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value))}`;
}

function findAssetForChannel(channel: ChannelOverviewRow, assets: MarketAsset[]) {
  const channelId = channel.channel.youtube_channel_id?.trim();
  if (channelId) {
    const byChannelId = assets.find((asset) => asset.youtube_channel_id?.trim() === channelId) || null;
    if (byChannelId) return byChannelId;
  }

  const symbol = channel.channel.symbol?.trim().toUpperCase();
  if (symbol) {
    return assets.find((asset) => asset.symbol?.trim().toUpperCase() === symbol) || null;
  }

  return null;
}

function buildRankMap<T extends { key: string; value: number }>(items: T[]) {
  return new Map(
    [...items]
      .sort((a, b) => (b.value - a.value) || a.key.localeCompare(b.key))
      .map((item, index) => [item.key, index + 1] as const)
  );
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

  if (naturalBreak > 40) {
    return {
      title: slice.slice(0, naturalBreak + 1).trim(),
      subhead: trimmed.slice(naturalBreak + 1).trim() || null,
    };
  }

  return {
    title: slice.trim(),
    subhead: trimmed.slice(200).trim() || null,
  };
}

function computePriceDelta(value: number | null | undefined, movePct: number | null | undefined) {
  if (
    value === null ||
    value === undefined ||
    movePct === null ||
    movePct === undefined ||
    Number.isNaN(value) ||
    Number.isNaN(movePct) ||
    movePct <= -1
  ) {
    return null;
  }

  const previous = value / (1 + movePct);
  if (!Number.isFinite(previous)) return null;
  return value - previous;
}

function getTradeFailureNotice(errorCode: string, side: "buy" | "sell", symbol: string) {
  switch (errorCode) {
    case "insufficient_cash":
      return {
        title: "Not enough cash",
        message: `You do not have enough cash available to buy ${symbol}. Reduce the share count or add funds to your account balance.`,
      };
    case "insufficient_holdings":
      return {
        title: "Not enough shares",
        message: `You tried to sell more ${symbol} shares than you currently own. Lower the order size and try again.`,
      };
    case "market_closed":
      return {
        title: "Market is closed",
        message: "Trading is unavailable right now. Wait for the market to reopen, then submit the order again.",
      };
    case "invalid_quantity":
      return {
        title: "Invalid order size",
        message: `Enter a valid number of ${symbol} shares before submitting this ${side} order.`,
      };
    case "live_order_limit_exceeded":
      return {
        title: "Live limit reached",
        message: "This order would exceed your live share limit for the next execution tick.",
      };
    default:
      return {
        title: "Trade failed",
        message: `This ${side} order for ${symbol} could not be completed. Please try again.`,
      };
  }
}

function buildTradeConfirmation(args: {
  result: TradeExecutionResult;
  currentMidPrice: number | null | undefined;
  previousHolding: PortfolioHolding | null;
}): TradeConfirmation {
  const { result, currentMidPrice, previousHolding } = args;
  const previousQuantity = previousHolding?.quantity ?? 0;
  const previousAvgCost = previousHolding?.avg_cost_basis ?? 0;
  const isQueued = result.order_type === "live_market" && result.status === "pending";
  const filledQuantity = result.filled_quantity ?? 0;
  const executedPrice = result.executed_price ?? (result.indicative_price ?? 0);
  const fee = result.fee ?? 0;
  const grossValue = filledQuantity * executedPrice;
  const requestedQuantity = result.requested_quantity ?? filledQuantity;
  const nextQuantity = result.updated_holdings?.quantity ?? (result.side === "buy" ? previousQuantity + filledQuantity : previousQuantity - filledQuantity);
  const nextAvgCost = result.updated_holdings?.avg_cost_basis ?? (nextQuantity > 0 ? previousAvgCost : 0);
  const totalCost = result.total_cost ?? (result.side === "buy" ? grossValue + fee : null);
  const totalProceeds = result.total_proceeds ?? (result.side === "sell" ? grossValue - fee : null);
  const costBasisSold = result.cost_basis_sold ?? (result.side === "sell" ? previousAvgCost * filledQuantity : null);
  const netCashImpact = result.side === "buy" ? -(totalCost ?? (grossValue + fee)) : (totalProceeds ?? (grossValue - fee));
  const realizedPnl =
    result.side === "sell"
      ? (result.realized_pnl ?? ((totalProceeds ?? (grossValue - fee)) - (costBasisSold ?? 0)))
      : null;
  const unrealizedPnl =
    currentMidPrice !== null && currentMidPrice !== undefined && nextQuantity > 0
      ? nextQuantity * (currentMidPrice - nextAvgCost)
      : null;
  const expectedSellPnl =
    result.side === "sell" && isQueued
      ? (requestedQuantity * executedPrice) - fee - (previousAvgCost * requestedQuantity)
      : null;
  const themePnl = result.side === "sell" ? (expectedSellPnl ?? realizedPnl) : null;
  const imageSrc = pickTradeConfirmationImage(result.side, themePnl);

  return {
    mode: isQueued ? "queued" : "filled",
    orderId: result.order_id ?? null,
    side: result.side,
    symbol: result.symbol,
    requestedQuantity,
    executeAfter: result.execute_after ?? null,
    intervalLimit: result.interval_limit ?? null,
    remainingIntervalShares: result.remaining_interval_shares ?? result.remaining_tick_shares ?? null,
    filledQuantity,
    executedPrice,
    fee,
    grossValue,
    netCashImpact,
    totalCost,
    totalProceeds,
    costBasisSold,
    previousQuantity,
    previousAvgCost,
    nextQuantity,
    nextAvgCost,
    nextCashBalance: result.updated_cash_balance ?? null,
    currentMidPrice: currentMidPrice ?? null,
    filledAt: result.filled_at ?? null,
    realizedPnl,
    unrealizedPnl,
    themePnl,
    imageSrc,
  };
}

function formatCurrencyLabel(currencyCode: string) {
  return currencyCode.trim().toUpperCase();
}

function getFlagEmoji(countryCode: string) {
  const upper = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return String.fromCodePoint(...upper.split("").map((char) => 127397 + char.charCodeAt(0)));
}

function getCurrencyFlagEmoji(currencyCode: string) {
  const upper = currencyCode.trim().toUpperCase();
  const countryCode = CURRENCY_FLAG_MAP[upper];
  if (!countryCode) return "";
  return getFlagEmoji(countryCode);
}

function formatCurrencyLabelWithFlag(currencyCode: string) {
  const upper = formatCurrencyLabel(currencyCode);
  const flag = getCurrencyFlagEmoji(currencyCode);
  return flag ? `${flag} ${upper}` : upper;
}

function getCurrencyFlagUrl(currencyCode: string) {
  const upper = currencyCode.trim().toUpperCase();
  const countryCode = CURRENCY_FLAG_MAP[upper];
  if (!countryCode) return null;
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

function toChartTime(value: string): Time | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000) as Time;
}

type ChartPoint = { time: Time; value: number };

function smoothSeriesData(points: ChartPoint[]) {
  if (points.length < 3) return points;

  const smoothed: ChartPoint[] = [];
  const segments = 6;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];

    if (index === 0) {
      smoothed.push(p1);
    }

    for (let step = 1; step < segments; step += 1) {
      const t = step / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      const value =
        0.5 *
        ((2 * p1.value) +
          (-p0.value + p2.value) * t +
          (2 * p0.value - 5 * p1.value + 4 * p2.value - p3.value) * t2 +
          (-p0.value + 3 * p1.value - 3 * p2.value + p3.value) * t3);
      const rawTime = Number(p1.time) + (Number(p2.time) - Number(p1.time)) * t;
      const roundedTime = Math.round(rawTime);
      const previousTime = Number(smoothed[smoothed.length - 1]?.time ?? 0);
      const nextTime = (roundedTime > previousTime ? roundedTime : previousTime + 1) as Time;

      smoothed.push({
        time: nextTime,
        value: Math.max(0, value),
      });
    }

    smoothed.push(p2);
  }

  return smoothed;
}

function mergeBucketsByStart(prev: ViewerBucket[], incoming: ViewerBucket[]) {
  if (!prev.length) return incoming;
  if (!incoming.length) return prev;
  const byStart = new Map(prev.map((item) => [item.bucket_start, item]));
  for (const bucket of incoming) {
    const existing = byStart.get(bucket.bucket_start);
    byStart.set(bucket.bucket_start, existing ? { ...existing, ...bucket } : bucket);
  }
  return [...byStart.values()].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

function resolveChartFontFamily() {
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    if (computed) return computed;
  }
  return "'Nasfaq Mono', 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace";
}

function resolveCssVar(name: string, fallback: string) {
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (computed) return computed;
  }
  return fallback;
}

function LiveViewerChart({ buckets, accentColor }: { buckets: ViewerBucket[]; accentColor: string }) {
  const chartRef = useRef<IChartApi | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const avgSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const maxSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const { theme: colorMode } = useTheme();
  const channelChartTheme = useMemo(() => createChannelChartTheme(accentColor), [accentColor]);
  const maxLineColor = useMemo(
    () => getUsableChannelColor(accentColor, colorMode) || accentColor,
    [accentColor, colorMode]
  );
  const avgLineColor = useMemo(
    () =>
      getUsableChannelColor(
        channelChartTheme.baseMuted,
        colorMode,
        colorMode === "light" ? { maxLightLuminance: 0.34 } : undefined
      ) || channelChartTheme.baseMuted,
    [channelChartTheme.baseMuted, colorMode]
  );

  const avgData = useMemo(() => {
    const points = buckets
      .map((bucket) => {
        const time = toChartTime(bucket.bucket_end);
        if (!time || bucket.avg_viewers === null) return null;
        return { time, value: bucket.avg_viewers };
      })
      .filter(Boolean) as ChartPoint[];
    return smoothSeriesData(points);
  }, [buckets]);

  const maxData = useMemo(() => {
    const points = buckets
      .map((bucket) => {
        const time = toChartTime(bucket.bucket_end);
        if (!time || bucket.max_viewers === null) return null;
        return { time, value: bucket.max_viewers };
      })
      .filter(Boolean) as ChartPoint[];
    return smoothSeriesData(points);
  }, [buckets]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 250,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: resolveCssVar("--text", channelChartTheme.text),
        fontFamily: resolveChartFontFamily(),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: channelChartTheme.grid },
        horzLines: { color: channelChartTheme.grid },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      crosshair: {
        vertLine: { color: channelChartTheme.crosshairSoft, width: 1 },
        horzLine: { color: channelChartTheme.crosshairSoft, width: 1 },
      },
    });

    const avgSeries = chart.addSeries(LineSeries, {
      color: avgLineColor,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    const maxSeries = chart.addSeries(LineSeries, {
      color: maxLineColor,
      lineWidth: 3,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    avgSeriesRef.current = avgSeries;
    maxSeriesRef.current = maxSeries;

    return () => {
      chartRef.current = null;
      avgSeriesRef.current = null;
      maxSeriesRef.current = null;
      chart.remove();
    };
  }, [avgLineColor, channelChartTheme.crosshairSoft, channelChartTheme.grid, channelChartTheme.text, maxLineColor]);

  useEffect(() => {
    if (!avgSeriesRef.current || !maxSeriesRef.current) return;
    avgSeriesRef.current.applyOptions({ color: avgLineColor });
    maxSeriesRef.current.applyOptions({ color: maxLineColor });
  }, [avgLineColor, maxLineColor]);

  useEffect(() => {
    if (!avgSeriesRef.current || !maxSeriesRef.current || !chartRef.current) return;
    avgSeriesRef.current.setData(avgData);
    maxSeriesRef.current.setData(maxData);
    chartRef.current.timeScale().fitContent();
  }, [avgData, avgLineColor, maxData, maxLineColor]);

  return buckets.length
    ? <div ref={containerRef} className={styles.liveChartCanvas} />
    : <div className={styles.liveChartEmpty}>No viewer buckets yet.</div>;
}

function renderSkeletonLines(count: number, className?: string) {
  return Array.from({ length: count }, (_, index) => (
    <span
      key={`skeleton:${index}`}
      className={[styles.skeletonBlock, styles.skeletonLine, className || ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  ));
}

function normalizeDescriptionHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function renderDescriptionContent(text: string) {
  return text.split(/\r?\n/).map((line, lineIndex, lines) => {
    const matches = Array.from(line.matchAll(DESCRIPTION_URL_PATTERN));
    let cursor = 0;

    return (
      <Fragment key={`description-line:${lineIndex}`}>
        {matches.map((match, matchIndex) => {
          const url = match[0];
          const start = match.index ?? 0;
          const prefix = line.slice(cursor, start);
          cursor = start + url.length;

          return (
            <Fragment key={`description-link:${lineIndex}:${matchIndex}`}>
              {prefix}
              <a href={normalizeDescriptionHref(url)} target="_blank" rel="noreferrer" className={styles.heroDescriptionLink}>
                {url}
              </a>
            </Fragment>
          );
        })}
        {line.slice(cursor)}
        {lineIndex < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}

function LiveDurationValue({
  actualStartAt,
  durationSeconds,
}: {
  actualStartAt: string | null | undefined;
  durationSeconds: number | null | undefined;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!actualStartAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [actualStartAt]);

  const liveDurationSeconds = actualStartAt
    ? Math.max(0, Math.floor((nowMs - new Date(actualStartAt).getTime()) / 1000))
    : durationSeconds ?? null;

  return <strong>{fmtDurationSeconds(liveDurationSeconds)}</strong>;
}

export function StockDetailPage({ symbol }: { symbol: string }) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const { theme: colorMode } = useTheme();
  const { user, refreshSession } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const detail = useMarketStore((state) => state.detail);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const error = useMarketStore((state) => state.error);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const isLoadingDetail = useMarketStore((state) => state.isLoadingDetail);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const fetchAssetDetail = useMarketStore((state) => state.fetchAssetDetail);
  const channels = useChannelStore((state) => state.channels);
  const fetchChannels = useChannelStore((state) => state.fetchChannels);
  const channelError = useChannelStore((state) => state.error);
  const portfolio = useProfileStore((state) => state.portfolio);
  const isLoadingPortfolio = useProfileStore((state) => state.isLoadingPortfolio);
  const portfolioError = useProfileStore((state) => state.portfolioError);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const fetchPortfolioOrders = useProfileStore((state) => state.fetchPortfolioOrders);
  const clearPortfolio = useProfileStore((state) => state.clearPortfolio);
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeQuantity, setTradeQuantity] = useState("10");
  const [lastTradeQuantityPreset, setLastTradeQuantityPreset] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeFailureNotice, setTradeFailureNotice] = useState<TradeFailureNotice | null>(null);
  const [tradeConfirmation, setTradeConfirmation] = useState<TradeConfirmation | null>(null);
  const [isTradeConfirmationClosing, setIsTradeConfirmationClosing] = useState(false);
  const [assetCommentBoard, setAssetCommentBoard] = useState<AssetCommentListResponse | null>(null);
  const [assetCommentBoardError, setAssetCommentBoardError] = useState<string | null>(null);
  const [assetCommentPage, setAssetCommentPage] = useState(1);
  const [isLoadingAssetComments, setIsLoadingAssetComments] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentVoteBusyId, setCommentVoteBusyId] = useState<number | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [channelStreams, setChannelStreams] = useState<{ live: LivestreamItem[]; upcoming: LivestreamItem[] }>({
    live: [],
    upcoming: [],
  });
  const [livestreamView, setLivestreamView] = useState<"current" | "past">("current");
  const [livestreamError, setLivestreamError] = useState<string | null>(null);
  const [isLoadingLivestreams, setIsLoadingLivestreams] = useState(false);
  const [pastLivestreamPage, setPastLivestreamPage] = useState(0);
  const [pastLivestreamData, setPastLivestreamData] = useState<PastLivestreamPayload | null>(null);
  const [pastLivestreamError, setPastLivestreamError] = useState<string | null>(null);
  const [isLoadingPastLivestreams, setIsLoadingPastLivestreams] = useState(false);
  const [selectedLivestreamItem, setSelectedLivestreamItem] = useState<LivestreamModalItem | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSessionResponse["session"]>(null);
  const [liveBuckets, setLiveBuckets] = useState<ViewerBucket[]>([]);
  const [liveSessionError, setLiveSessionError] = useState<string | null>(null);
  const [isLoadingLiveSession, setIsLoadingLiveSession] = useState(false);
  const [superchatSummary, setSuperchatSummary] = useState<AssetSuperchatSummaryBundle | null>(null);
  const [superchatRank, setSuperchatRank] = useState<AssetSuperchatRank | null>(null);
  const [superchatError, setSuperchatError] = useState<string | null>(null);
  const [isLoadingSuperchats, setIsLoadingSuperchats] = useState(false);
  const [superchatTimeseriesRange, setSuperchatTimeseriesRange] = useState<(typeof SUPERCHAT_TIMESERIES_OPTIONS)[number]["value"]>("7d");
  const [superchatTimeseries, setSuperchatTimeseries] = useState<AssetSuperchatTimeseriesBundle | null>(null);
  const [superchatCalendarTimeseries, setSuperchatCalendarTimeseries] = useState<AssetSuperchatTimeseriesBundle | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<ArticleSummary[]>([]);
  const [superchatTimeseriesError, setSuperchatTimeseriesError] = useState<string | null>(null);
  const [superchatCalendarError, setSuperchatCalendarError] = useState<string | null>(null);
  const [isLoadingSuperchatTimeseries, setIsLoadingSuperchatTimeseries] = useState(false);
  const [isLoadingSuperchatCalendar, setIsLoadingSuperchatCalendar] = useState(false);
  const [intradayCandleInterval, setIntradayCandleInterval] = useState<IntradayCandleInterval>("1h");
  const [intradayCandles, setIntradayCandles] = useState<CandlePoint[]>([]);
  const [intradayCandlesError, setIntradayCandlesError] = useState<string | null>(null);
  const [isLoadingIntradayCandles, setIsLoadingIntradayCandles] = useState(false);
  const [deferredReadySymbol, setDeferredReadySymbol] = useState<string | null>(null);
  const [adjustmentHistory, setAdjustmentHistory] = useState<MarketAssetAdjustmentHistory | null>(null);
  const [adjustmentHistoryError, setAdjustmentHistoryError] = useState<string | null>(null);
  const [selectedAdjustmentKey, setSelectedAdjustmentKey] = useState<string | null>(null);
  const [oshiboard, setOshiboard] = useState<OshiboardResponse | null>(null);
  const [oshiboardError, setOshiboardError] = useState<string | null>(null);
  const [isLoadingOshiboard, setIsLoadingOshiboard] = useState(false);
  const tradeConfirmationCloseTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const showDeferredSections = deferredReadySymbol === normalizedSymbol;

  useEffect(() => {
    if (!tradeConfirmation && !isTradeConfirmationClosing) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTradeConfirmation();
      }
    };

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTradeConfirmationClosing, tradeConfirmation]);

  useEffect(() => () => {
    if (tradeConfirmationCloseTimerRef.current !== null) {
      globalThis.clearTimeout(tradeConfirmationCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    void refreshOverview();
    void fetchChannels();
  }, [fetchChannels, refreshOverview, refreshSession]);

  useEffect(() => {
    if (user) {
      void fetchPortfolio();
      return;
    }
    clearPortfolio();
  }, [clearPortfolio, fetchPortfolio, user]);

  useEffect(() => {
    setSelectedSymbol(normalizedSymbol);
    void fetchAssetDetail(normalizedSymbol);
  }, [fetchAssetDetail, normalizedSymbol, setSelectedSymbol]);

  useEffect(() => {
    let cancelled = false;
    async function loadAdjustmentHistory() {
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/market/assets/${encodeURIComponent(normalizedSymbol)}/adjustments?recent_limit=5&upcoming_limit=2`, {
          cache: "no-store",
        });
        if (!cancelled) {
          const history = normalizeMarketAssetAdjustmentHistory(result);
          setAdjustmentHistory(history);
          setSelectedAdjustmentKey((current) => {
            if (current && history.items.some((item) => buildAdjustmentKey(item) === current)) return current;
            return buildAdjustmentKey(history.items[0]);
          });
          setAdjustmentHistoryError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setAdjustmentHistory(null);
          setSelectedAdjustmentKey(null);
          setAdjustmentHistoryError(String((nextError as Error).message || nextError));
        }
      }
    }
    void loadAdjustmentHistory();
    return () => {
      cancelled = true;
    };
  }, [normalizedSymbol]);

  useEffect(() => {
    setAssetCommentPage(1);
  }, [normalizedSymbol]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAssetComments() {
      setIsLoadingAssetComments(true);
      setAssetCommentBoardError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(
          `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/comments?page=${assetCommentPage}&limit=6`
        );
        if (cancelled) return;
        setAssetCommentBoard(normalizeAssetCommentListResponse(result));
      } catch (nextError) {
        if (cancelled) return;
        setAssetCommentBoard(null);
        setAssetCommentBoardError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) {
          setIsLoadingAssetComments(false);
        }
      }
    }

    void fetchAssetComments();
    return () => {
      cancelled = true;
    };
  }, [assetCommentPage, normalizedSymbol]);

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [normalizedSymbol]);

  useEffect(() => {
    setIntradayCandleInterval("1h");
    setIntradayCandles([]);
    setIntradayCandlesError(null);
    setIsLoadingIntradayCandles(false);
  }, [normalizedSymbol]);

  useEffect(() => {
    setDeferredReadySymbol(null);

    if (typeof window === "undefined") {
      setDeferredReadySymbol(normalizedSymbol);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let idleId: number | null = null;
    const complete = () => {
      if (!cancelled) {
        setDeferredReadySymbol(normalizedSymbol);
      }
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(complete, { timeout: 250 }) as unknown as number;
    } else {
      timeoutId = globalThis.setTimeout(complete, 80);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, [normalizedSymbol]);

  useEffect(() => {
    if (!showDeferredSections || !normalizedSymbol) {
      setIntradayCandles([]);
      return;
    }

    let cancelled = false;
    setIsLoadingIntradayCandles(true);
    setIntradayCandlesError(null);

    void apiFetch<{ candles: Array<Record<string, unknown>> }>(
      `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/candles?interval=${encodeURIComponent(intradayCandleInterval)}&range=24h`,
      { cache: "no-store" }
    )
      .then((result) => {
        if (cancelled) return;
        setIntradayCandles(normalizeCandles(result.candles || []));
      })
      .catch((nextError) => {
        if (cancelled) return;
        setIntradayCandles([]);
        setIntradayCandlesError(String((nextError as Error).message || nextError));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingIntradayCandles(false);
      });

    return () => {
      cancelled = true;
    };
  }, [intradayCandleInterval, normalizedSymbol, showDeferredSections]);

  useEffect(() => {
    if (!normalizedSymbol) return;
    let cancelled = false;

    async function fetchOshiboard() {
      setIsLoadingOshiboard(true);
      setOshiboardError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/leaderboard/oshiboard/${encodeURIComponent(normalizedSymbol)}?limit=12`);
        if (!cancelled) setOshiboard(normalizeOshiboardResponse(result));
      } catch (nextError) {
        if (!cancelled) {
          setOshiboard(null);
          setOshiboardError(String((nextError as Error).message || nextError));
        }
      } finally {
        if (!cancelled) setIsLoadingOshiboard(false);
      }
    }

    void fetchOshiboard();
    return () => {
      cancelled = true;
    };
  }, [normalizedSymbol]);

  const selectedAsset = useMemo(
    () => assets.find((item) => item.symbol.toUpperCase() === normalizedSymbol) || null,
    [assets, normalizedSymbol]
  );
  const selectedChannel = useMemo(() => {
    if (selectedAsset?.youtube_channel_id) {
      const byId = channels.find((item) => item.channel.youtube_channel_id === selectedAsset.youtube_channel_id) || null;
      if (byId) return byId;
    }

    return channels.find((item) => item.channel.symbol?.trim().toUpperCase() === normalizedSymbol) || null;
  }, [channels, normalizedSymbol, selectedAsset?.youtube_channel_id]);
  const selectedHolding = useMemo(
    () => portfolio?.holdings.find((holding) => holding.symbol.toUpperCase() === normalizedSymbol) || null,
    [normalizedSymbol, portfolio?.holdings]
  );
  const ownedShares = selectedHolding?.quantity ?? 0;
  const viewerOwnedShares = assetCommentBoard?.viewer_context.owned_shares ?? ownedShares;
  const needsEmailVerification = userNeedsEmailVerification(user);
  const canPostAssetComment = user && !needsEmailVerification ? (assetCommentBoard?.viewer_context.can_post ?? ownedShares > 0) : false;
  const assetCommentPagination = assetCommentBoard?.pagination || null;
  const totalAssetComments = assetCommentPagination?.total ?? 0;
  const estimatedPositionValue = selectedHolding?.market_value ?? ((selectedAsset?.current_mid_price ?? 0) * ownedShares);
  const themeSafeAssetColor = useMemo(
    () => getUsableChannelColor(selectedAsset?.color, colorMode) || selectedAsset?.color || null,
    [colorMode, selectedAsset?.color]
  );
  const chartTheme = useMemo(() => createChannelChartTheme(themeSafeAssetColor), [themeSafeAssetColor]);
  const chartPalette = chartTheme.categorical;
  const channelProfileImage = selectedChannel?.channel.channel_asset_icon_url?.trim() || null;
  const channelBannerImage = selectedChannel?.channel.channel_asset_banner_url?.trim() || null;

  useEffect(() => {
    setPastLivestreamPage(0);
    setPastLivestreamData(null);
    setPastLivestreamError(null);
    setIsLoadingPastLivestreams(false);
    setSelectedLivestreamItem(null);
    setLivestreamView("current");
  }, [selectedAsset?.youtube_channel_id]);

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim() || "";
    if (!channelId) {
      setChannelStreams({ live: [], upcoming: [] });
      setLivestreamError(null);
      setIsLoadingLivestreams(false);
      setPastLivestreamData(null);
      setPastLivestreamError(null);
      setIsLoadingPastLivestreams(false);
      setSuperchatSummary(null);
      setSuperchatRank(null);
      setSuperchatError(null);
      setIsLoadingSuperchats(false);
      setSuperchatCalendarTimeseries(null);
      setSuperchatCalendarError(null);
      setIsLoadingSuperchatCalendar(false);
      return;
    }

    let cancelled = false;

    async function fetchLivestreams() {
      setIsLoadingLivestreams(true);
      setLivestreamError(null);
      try {
        const result = await apiFetch<{
          channel_id: string;
          live: Array<Record<string, unknown>>;
          upcoming: Array<Record<string, unknown>>;
        }>(`/api/livestreams/channel/${encodeURIComponent(channelId)}`);
        if (cancelled) return;
        setChannelStreams({
          live: normalizeLivestreams(result.live || []),
          upcoming: normalizeLivestreams(result.upcoming || []),
        });
      } catch (nextError) {
        if (cancelled) return;
        setChannelStreams({ live: [], upcoming: [] });
        setLivestreamError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) {
          setIsLoadingLivestreams(false);
        }
      }
    }

    async function fetchSuperchatSummary() {
      setIsLoadingSuperchats(true);
      setSuperchatError(null);
      try {
        const [summaryResult, rankResult] = await Promise.all([
          apiFetch<Record<string, unknown>>(
            `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchats?range=7d`
          ),
          apiFetch<AssetSuperchatRank>(
            `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchat-rank?range=7d`
          ),
        ]);
        if (cancelled) return;
        setSuperchatSummary(normalizeAssetSuperchatSummary(summaryResult));
        setSuperchatRank({
          symbol: String(rankResult.symbol || normalizedSymbol),
          youtube_channel_id: String(rankResult.youtube_channel_id || channelId),
          range: String(rankResult.range || "7d"),
          total_in_yen: toNumber(rankResult.total_in_yen),
          rank: toNumber(rankResult.rank),
        });
      } catch (nextError) {
        if (cancelled) return;
        setSuperchatSummary(null);
        setSuperchatRank(null);
        setSuperchatError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) {
          setIsLoadingSuperchats(false);
        }
      }
    }

    async function fetchSuperchatCalendar() {
      setIsLoadingSuperchatCalendar(true);
      setSuperchatCalendarError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(
          `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchats/timeseries?range=1y`
        );
        if (cancelled) return;
        setSuperchatCalendarTimeseries(normalizeAssetSuperchatTimeseries(result));
      } catch (nextError) {
        if (cancelled) return;
        setSuperchatCalendarTimeseries(null);
        setSuperchatCalendarError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) {
          setIsLoadingSuperchatCalendar(false);
        }
      }
    }

    void fetchLivestreams();
    void fetchSuperchatSummary();
    void fetchSuperchatCalendar();
    return () => {
      cancelled = true;
    };
  }, [normalizedSymbol, selectedAsset?.youtube_channel_id]);

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim() || "";
    if (!channelId || livestreamView !== "past") return;

    let cancelled = false;
    setIsLoadingPastLivestreams(true);
    setPastLivestreamError(null);

    void apiFetch<PastLivestreamPayload>(
      `/api/livestreams/history?page=${encodeURIComponent(String(pastLivestreamPage))}&channel=${encodeURIComponent(channelId)}`
    )
      .then((result) => {
        if (cancelled) return;
        setPastLivestreamData(result);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setPastLivestreamData(null);
        setPastLivestreamError(String((nextError as Error).message || nextError));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPastLivestreams(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [livestreamView, pastLivestreamPage, selectedAsset?.youtube_channel_id]);

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim() || "";
    if (!channelId) {
      setSuperchatTimeseries(null);
      setSuperchatTimeseriesError(null);
      setIsLoadingSuperchatTimeseries(false);
      return;
    }

    let cancelled = false;

    async function fetchSuperchatTimeseries() {
      setIsLoadingSuperchatTimeseries(true);
      setSuperchatTimeseriesError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(
          `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchats/timeseries?range=${encodeURIComponent(superchatTimeseriesRange)}`
        );
        if (cancelled) return;
        setSuperchatTimeseries(normalizeAssetSuperchatTimeseries(result));
      } catch (nextError) {
        if (cancelled) return;
        setSuperchatTimeseries(null);
        setSuperchatTimeseriesError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) {
          setIsLoadingSuperchatTimeseries(false);
        }
      }
    }

    void fetchSuperchatTimeseries();
    return () => {
      cancelled = true;
    };
  }, [normalizedSymbol, selectedAsset?.youtube_channel_id, superchatTimeseriesRange]);

  useEffect(() => {
    const activeLiveId = channelStreams.live[0]?.id;
    if (!activeLiveId) {
      setLiveSession(null);
      setLiveBuckets([]);
      setLiveSessionError(null);
      setIsLoadingLiveSession(false);
      return;
    }

    let cancelled = false;

    async function fetchLiveSession() {
      setIsLoadingLiveSession(true);
      setLiveSessionError(null);

      try {
        const [sessionResult, bucketsResult] = await Promise.all([
          apiFetch<LiveSessionResponse>(`/api/livestreams/${encodeURIComponent(activeLiveId)}`),
          apiFetch<{ buckets: ViewerBucket[] }>(`/api/livestreams/${encodeURIComponent(activeLiveId)}/buckets`),
        ]);
        if (cancelled) return;

        setLiveSession(sessionResult.session);
        setLiveBuckets(
          (bucketsResult.buckets || []).map((bucket) => ({
            ...bucket,
            avg_viewers: toNumber(bucket.avg_viewers),
            max_viewers: toNumber(bucket.max_viewers),
          }))
        );
      } catch (nextError) {
        if (cancelled) return;
        setLiveSession(null);
        setLiveBuckets([]);
        setLiveSessionError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) {
          setIsLoadingLiveSession(false);
        }
      }
    }

    void fetchLiveSession();
    return () => {
      cancelled = true;
    };
  }, [channelStreams.live]);

  useEffect(() => {
    if (!selectedLivestreamItem || selectedLivestreamItem.status === "ended") return;
    const next = [...channelStreams.live, ...channelStreams.upcoming].find((entry) => entry.id === selectedLivestreamItem.id);
    if (!next) return;
    const timerId = window.setTimeout(() => setSelectedLivestreamItem(next), 0);
    return () => window.clearTimeout(timerId);
  }, [channelStreams.live, channelStreams.upcoming, selectedLivestreamItem]);

  useEffect(() => {
    const activeLiveId = channelStreams.live[0]?.id;
    if (!activeLiveId) return;

    const wsUrl = getBucketWsUrl();
    if (!wsUrl) return;

    let closed = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      attempt += 1;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, Math.min(15_000, 1_000 * Math.max(1, attempt)));
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as BucketUpdate;
          if (message.video_id !== activeLiveId || !message.bucket_start) return;

          setLiveBuckets((current) =>
            mergeBucketsByStart(current, [
              {
                bucket_start: message.bucket_start,
                bucket_end: message.bucket_end,
                duration_seconds: Math.max(
                  1,
                  Math.floor((new Date(message.bucket_end).getTime() - new Date(message.bucket_start).getTime()) / 1000)
                ),
                avg_viewers: toNumber(message.avg_viewers),
                max_viewers: toNumber(message.max_viewers),
              },
            ])
          );
        } catch {}
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {}
    };
  }, [channelStreams.live]);

  useEffect(() => {
    let cancelled = false;
    async function loadRelatedArticles() {
      if (!selectedAsset?.symbol) {
        setRelatedArticles([]);
        return;
      }
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/articles?asset=${encodeURIComponent(selectedAsset.symbol)}&limit=3`);
        if (!cancelled) {
          setRelatedArticles(normalizeArticleListResponse(result).items);
        }
      } catch {
        if (!cancelled) {
          setRelatedArticles([]);
        }
      }
    }

    void loadRelatedArticles();
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.symbol]);

  async function refreshAll() {
    await refreshOverview();
    await fetchChannels();
    if (selectedAsset?.symbol) {
      await fetchAssetDetail(selectedAsset.symbol);
      const commentResult = await apiFetch<Record<string, unknown>>(
        `/api/market/assets/${encodeURIComponent(selectedAsset.symbol)}/comments?page=${assetCommentPage}&limit=6`
      );
      setAssetCommentBoard(normalizeAssetCommentListResponse(commentResult));
      setAssetCommentBoardError(null);
    }
    if (user) {
      await Promise.all([fetchPortfolio(), fetchPortfolioOrders()]);
    }
  }

  function closeTradeConfirmation() {
    if (!tradeConfirmation || isTradeConfirmationClosing) return;
    setIsTradeConfirmationClosing(true);
    if (tradeConfirmationCloseTimerRef.current !== null) {
      globalThis.clearTimeout(tradeConfirmationCloseTimerRef.current);
    }
    tradeConfirmationCloseTimerRef.current = globalThis.setTimeout(() => {
      setTradeConfirmation(null);
      setIsTradeConfirmationClosing(false);
      tradeConfirmationCloseTimerRef.current = null;
    }, TRADE_CONFIRMATION_ANIMATION_MS);
  }

  async function handleTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAsset) return;
    if (userNeedsEmailVerification(user)) {
      setTradeError("email_verification_required");
      setTradeFailureNotice({
        title: "Email verification required",
        message: "Verify your email before you can trade.",
      });
      setTradeConfirmation(null);
      setIsTradeConfirmationClosing(false);
      return;
    }
    if (marketStatus && !marketStatus.is_trading_open) {
      setTradeError("market_closed");
      setTradeFailureNotice({
        title: "Market is closed",
        message: marketStatus.trading_message || "Trading is unavailable right now. Wait for the market to reopen, then submit the order again.",
      });
      setTradeConfirmation(null);
      setIsTradeConfirmationClosing(false);
      return;
    }

    setTradeError(null);
    setTradeFailureNotice(null);
    if (tradeConfirmationCloseTimerRef.current !== null) {
      globalThis.clearTimeout(tradeConfirmationCloseTimerRef.current);
      tradeConfirmationCloseTimerRef.current = null;
    }
    setTradeConfirmation(null);
    setIsTradeConfirmationClosing(false);

    try {
      const previousHolding = selectedHolding;
      const result = await apiFetch<TradeExecutionResult>(`/api/market/orders/${tradeSide}`, {
        method: "POST",
        body: JSON.stringify({ symbol: selectedAsset.symbol, quantity: Number(tradeQuantity) }),
      });

      setTradeConfirmation(
        buildTradeConfirmation({
          result,
          currentMidPrice: selectedAsset.current_mid_price,
          previousHolding,
        })
      );
      setIsTradeConfirmationClosing(false);
      await refreshAll();
    } catch (nextError) {
      const errorCode = String((nextError as Error).message || nextError);
      setTradeError(errorCode);
      setTradeFailureNotice(getTradeFailureNotice(errorCode, tradeSide, selectedAsset.symbol));
    }
  }

  function applyTradeQuantityPreset(preset: string) {
    if (lastTradeQuantityPreset === preset) {
      setTradeQuantity((current) => String((Number(current) || 0) + Number(preset)));
    } else {
      setTradeQuantity(preset);
    }
    setLastTradeQuantityPreset(preset);
  }

  const handleCommentSubmit = useCallback(async (body: string, mood: ArticleCommentMood | null) => {
    if (!selectedAsset || !body.trim()) return false;
    if (needsEmailVerification) {
      setAssetCommentBoardError("Verify your email before posting on the channel board.");
      return false;
    }

    setIsSubmittingComment(true);
    setAssetCommentBoardError(null);
    try {
      const result = await apiFetch<Record<string, unknown>>(`/api/market/assets/${encodeURIComponent(selectedAsset.symbol)}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body,
          mood,
        }),
      });
      const nextBoard = normalizeAssetCommentListResponse(result);
      setAssetCommentBoard(nextBoard);
      setAssetCommentPage(1);
      return true;
    } catch (nextError) {
      setAssetCommentBoardError(commentFailureMessage(nextError));
      return false;
    } finally {
      setIsSubmittingComment(false);
    }
  }, [needsEmailVerification, selectedAsset]);

  const handleCommentVote = useCallback(async (comment: AssetComment, value: 1 | -1) => {
    if (!selectedAsset || !user) return;
    if (needsEmailVerification) {
      setAssetCommentBoardError("Verify your email before voting on channel board comments.");
      return;
    }

    setCommentVoteBusyId(comment.id);
    setAssetCommentBoardError(null);
    try {
      const result = await apiFetch<Record<string, unknown>>(
        `/api/market/assets/${encodeURIComponent(selectedAsset.symbol)}/comments/${comment.id}/vote?page=${assetCommentPage}`,
        {
          method: "POST",
          body: JSON.stringify({ value: comment.viewer_vote === value ? 0 : value }),
        }
      );
      setAssetCommentBoard(normalizeAssetCommentListResponse(result));
    } catch (nextError) {
      setAssetCommentBoardError(voteFailureMessage(nextError));
    } finally {
      setCommentVoteBusyId((current) => (current === comment.id ? null : current));
    }
  }, [assetCommentPage, needsEmailVerification, selectedAsset, user]);

  const handlePreviousAssetCommentPage = useCallback(() => {
    setAssetCommentPage((current) => Math.max(1, current - 1));
  }, []);

  const handleNextAssetCommentPage = useCallback(() => {
    setAssetCommentPage((current) => current + 1);
  }, []);

  const openLivestreamModal = useCallback((item: LivestreamModalItem) => {
    setSelectedLivestreamItem(item);
  }, []);

  const pastLivestreams = useMemo(
    () => (pastLivestreamData?.streams || []).map(normalizePastLivestream),
    [pastLivestreamData?.streams]
  );

  const pastLivestreamWeekLabel = pastLivestreamData
    ? `${fmtDate(pastLivestreamData.week_start)} to ${fmtDate(pastLivestreamData.week_end)}`
    : "Loading archive";

  function renderStreamItem(stream: LivestreamItem, label: "Live" | "Upcoming") {
    const content = (
      <>
        {stream.thumbnail_url ? (
          <img src={stream.thumbnail_url} alt="" className={styles.livestreamThumb} />
        ) : (
          <div className={styles.livestreamThumbFallback} />
        )}
        <div className={styles.livestreamBody}>
          <div className={styles.livestreamTitle}>{stream.title}</div>
          <div className={styles.livestreamMeta}>{stream.creator}</div>
          <div className={styles.livestreamMeta}>
            {label === "Live" ? (
              <>
                <span className={shellStyles.livePill}>LIVE</span>
                <span>{fmtNumber(stream.viewer_count)} viewers</span>
                {stream.started_at ? <span>Started {fmtDate(stream.started_at)}</span> : null}
              </>
            ) : (
              <>
                <span className={shellStyles.upcomingPill}>UPCOMING</span>
                <span>{stream.started_at ? fmtDate(stream.started_at) : "Scheduled time unavailable"}</span>
              </>
            )}
          </div>
        </div>
      </>
    );

    if (label === "Live") {
      return (
        <button
          key={stream.id}
          type="button"
          className={styles.livestreamItem}
          onClick={() => openLivestreamModal(stream)}
        >
          {content}
        </button>
      );
    }

    return (
      <Link
        key={stream.id}
        href={stream.url || "/livestreams"}
        className={styles.livestreamItem}
        target={stream.url ? "_blank" : undefined}
        rel={stream.url ? "noreferrer" : undefined}
      >
        {content}
      </Link>
    );
  }

  function renderPastStreamItem(stream: PastLivestreamItem) {
    return (
      <button
        key={stream.id}
        type="button"
        className={styles.livestreamItem}
        onClick={() => openLivestreamModal(stream)}
      >
        {stream.thumbnail_url ? (
          <img src={stream.thumbnail_url} alt="" className={styles.livestreamThumb} />
        ) : (
          <div className={styles.livestreamThumbFallback} />
        )}
        <div className={styles.livestreamBody}>
          <div className={styles.livestreamTitle}>{stream.title}</div>
          <div className={styles.livestreamMeta}>
            <span className={styles.pastStreamPill}>ENDED</span>
            <span>{stream.started_at ? fmtDate(stream.started_at) : "Start time unavailable"}</span>
          </div>
          <div className={styles.pastStreamStats}>
            <span><strong>{fmtInteger(stream.max_concurrent_viewers)}</strong> max</span>
            <span><strong>{fmtInteger(stream.avg_concurrent_viewers)}</strong> avg</span>
            <span><strong>{fmtDurationSeconds(stream.duration_seconds)}</strong> runtime</span>
            <span><strong>{fmtInteger(stream.total_views)}</strong> views</span>
          </div>
        </div>
      </button>
    );
  }

  const heroStyle = useMemo(() => {
    const accent = selectedAsset?.color || "#f59e0b";
    const surfaceImage = channelBannerImage || channelProfileImage;
    const escapedSurfaceImage = surfaceImage ? surfaceImage.replace(/["\\]/g, "\\$&") : null;
    return ({
      "--hero-accent": accent,
      "--hero-surface-image": escapedSurfaceImage ? `url("${escapedSurfaceImage}")` : "none",
    } as CSSProperties);
  }, [channelBannerImage, channelProfileImage, selectedAsset?.color]);

  const channelDescription = selectedChannel?.channel.youtube_channel_description?.trim() || "Channel profile metadata will appear here once the market overview cache resolves.";
  const canExpandDescription = channelDescription.split(/\r?\n/).length > 4 || channelDescription.length > 280;
  const marketClosedMessage = marketStatus?.trading_message || "Trading is temporarily unavailable while the market settles.";
  const tradingOpen = marketStatus?.is_trading_open ?? true;
  const liveAccentColor = normalizeHexColor(liveSession?.channel_color || selectedAsset?.color) || "#ff5c7a";
  const liveViewerChartTheme = useMemo(() => createChannelChartTheme(liveAccentColor), [liveAccentColor]);
  const liveAvgLegendColor = useMemo(
    () =>
      getUsableChannelColor(
        liveViewerChartTheme.baseMuted,
        colorMode,
        colorMode === "light" ? { maxLightLuminance: 0.34 } : undefined
      ) || liveViewerChartTheme.baseMuted,
    [colorMode, liveViewerChartTheme.baseMuted]
  );
  const liveMaxLegendColor = useMemo(
    () => getUsableChannelColor(liveAccentColor, colorMode) || liveAccentColor,
    [colorMode, liveAccentColor]
  );
  const activeLiveStream = channelStreams.live[0] || null;
  const latestLiveBucket = liveBuckets.at(-1) || null;
  const liveCurrentViewers = latestLiveBucket?.max_viewers ?? activeLiveStream?.viewer_count ?? liveSession?.max_concurrent_viewers ?? null;
  const numericTradeQuantity = Number(tradeQuantity) || 0;
  const estimatedTradeNotional = (selectedAsset?.current_mid_price ?? 0) * Math.max(numericTradeQuantity, 0);
  const chartStartTs = toTimestamp(DETAIL_CHART_START_DATE);
  const filteredDailyCandles = useMemo(() => (
    !showDeferredSections ? [] : detail?.daily_candles.filter((item) => {
      const ts = toTimestamp(item.bucket);
      return chartStartTs !== null && ts !== null && ts >= chartStartTs;
    }) || []
  ), [chartStartTs, detail?.daily_candles, showDeferredSections]);
  const displayedIntradayCandles = intradayCandles.length > 0
    ? intradayCandles
    : intradayCandleInterval === "1h"
      ? detail?.intraday_candles || []
      : [];
  const intradayCandleSubtitle = `${INTRADAY_CANDLE_INTERVALS.find((item) => item.value === intradayCandleInterval)?.label || "1H"} candles from trades and adjustment ticks`;
  const filteredStats = useMemo(() => (
    !showDeferredSections ? [] : detail?.stats.filter((item) => {
      const ts = toTimestamp(item.snapshot_date);
      return chartStartTs !== null && ts !== null && ts >= chartStartTs;
    }) || []
  ), [chartStartTs, detail?.stats, showDeferredSections]);
  const sameUnitAssets = useMemo(() => {
    if (!selectedAsset?.unit) return [];
    return assets
      .filter((asset) => asset.unit === selectedAsset.unit && asset.symbol !== selectedAsset.symbol)
      .sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0))
      .slice(0, 6);
  }, [assets, selectedAsset?.symbol, selectedAsset?.unit]);
  const relatedCommunityArticles = useMemo(
    () => relatedArticles.filter((article) => !article.is_news),
    [relatedArticles]
  );
  const relatedNewsItems = useMemo(
    () => relatedArticles.filter((article) => article.is_news),
    [relatedArticles]
  );
  const currentMidPrice = fmtNumber(selectedAsset?.current_mid_price, "$");
  const current24hMove = formatSignedPct(selectedAsset?.move_24h_pct);
  const isPositive = selectedAsset?.move_24h_pct !== null && selectedAsset?.move_24h_pct !== undefined && selectedAsset?.move_24h_pct >= 0;
  const marketPrice = selectedAsset?.market_price ?? selectedAsset?.current_mid_price ?? null;
  const nextAdjustment = selectedAsset?.next_adjustment || null;
  const latestAdjustment = selectedAsset?.latest_adjustment || null;
  const adjustmentEnabled = selectedAsset?.adjustment_enabled !== false;
  const latestAdjustmentMovePct =
    latestAdjustment?.price_before && latestAdjustment.price_after !== null && latestAdjustment.price_after !== undefined
      ? (latestAdjustment.price_after - latestAdjustment.price_before) / latestAdjustment.price_before
      : null;
  const driftSinceLastTickPct =
    latestAdjustment?.price_after && marketPrice !== null && marketPrice !== undefined
      ? (marketPrice - latestAdjustment.price_after) / latestAdjustment.price_after
      : null;
  const driftMarkerPct = driftSinceLastTickPct === null ? 50 : Math.max(5, Math.min(95, 50 + driftSinceLastTickPct * 220));
  const driftLabel =
    driftSinceLastTickPct === null
      ? "No tick yet"
      : driftSinceLastTickPct > 0
        ? "Drifted up"
        : driftSinceLastTickPct < 0
          ? "Drifted down"
          : "Flat since tick";
  const selectedAdjustment = useMemo(() => {
    const items = adjustmentHistory?.items || [];
    return items.find((item) => buildAdjustmentKey(item) === selectedAdjustmentKey) || items[0] || null;
  }, [adjustmentHistory?.items, selectedAdjustmentKey]);
  const selectedAdjustmentMovePct =
    selectedAdjustment?.price_before && selectedAdjustment.price_after !== null && selectedAdjustment.price_after !== undefined
      ? (selectedAdjustment.price_after - selectedAdjustment.price_before) / selectedAdjustment.price_before
      : selectedAdjustment?.move_pct ?? null;
  
  const heroPrimaryStats: HeroStat[] = [
    { label: "Mid Price", value: currentMidPrice, accent: false },
    { label: "24H Move", value: current24hMove, accent: isPositive, tone: isPositive ? "up" : "down" },
    { label: "Bid / Ask", value: `${fmtNumber(selectedAsset?.current_bid_price, "$")} / ${fmtNumber(selectedAsset?.current_ask_price, "$")}`, accent: false },
    { label: "24H Volume", value: fmtNumber(selectedAsset?.volume_24h), meta: "shares", accent: false },
  ];
  const heroMetaStats: HeroStat[] = [
    { label: "Subscribers", value: fmtInteger(selectedChannel?.latest?.subscriber_count ?? null), accent: false },
    { label: "Views", value: fmtInteger(selectedChannel?.latest?.view_count ?? null), accent: false },
    { label: "Videos", value: fmtInteger(selectedChannel?.latest?.video_count ?? null), accent: false },
    { label: "Unit", value: selectedAsset?.unit || selectedChannel?.channel.unit || "—", accent: false },
  ];
  const subscriberRankMap = useMemo(
    () =>
      buildRankMap(
        channels
          .map((channel) => {
            const asset = findAssetForChannel(channel, assets);
            const value = channel.latest?.subscriber_count ?? null;
            if (!asset || value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets, channels]
  );
  const viewRankMap = useMemo(
    () =>
      buildRankMap(
        channels
          .map((channel) => {
            const asset = findAssetForChannel(channel, assets);
            const value = channel.latest?.view_count ?? null;
            if (!asset || value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets, channels]
  );
  const videoRankMap = useMemo(
    () =>
      buildRankMap(
        channels
          .map((channel) => {
            const asset = findAssetForChannel(channel, assets);
            const value = channel.latest?.video_count ?? null;
            if (!asset || value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets, channels]
  );
  const priceRankMap = useMemo(
    () =>
      buildRankMap(
        assets
          .map((asset) => {
            const value = asset.current_mid_price ?? null;
            if (value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets]
  );
  const volumeRankMap = useMemo(
    () =>
      buildRankMap(
        assets
          .map((asset) => {
            const value = asset.volume_24h ?? null;
            if (value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets]
  );
  const isAssetLoading = isLoadingOverview || isLoadingDetail;
  const showHeroSkeleton = isAssetLoading && !selectedAsset;

  const superchatLineSeries = useMemo(() => {
    if (!showDeferredSections || !superchatTimeseries) return [];

    const bucketOrder = Array.from(new Set(superchatTimeseries.points.map((point) => point.bucket))).sort((a, b) => a.localeCompare(b));
    const grouped = new Map<string, Map<string, number>>();
    const totalsByBucket = new Map<string, number>();
    const totalsByCurrency = new Map<string, number>();

    for (const point of superchatTimeseries.points) {
      const value = point.total_in_yen || 0;
      if (!grouped.has(point.currency_name)) {
        grouped.set(point.currency_name, new Map<string, number>());
      }
      grouped.get(point.currency_name)?.set(point.bucket, value);
      totalsByBucket.set(point.bucket, (totalsByBucket.get(point.bucket) || 0) + value);
      totalsByCurrency.set(point.currency_name, (totalsByCurrency.get(point.currency_name) || 0) + value);
    }

    const topCurrencies = Array.from(totalsByCurrency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([currencyName]) => currencyName);

    return [
      {
        name: "All currencies",
        color: chartTheme.complement,
        kind: "area" as const,
        values: bucketOrder.map((bucket) => ({
          time: bucket,
          value: totalsByBucket.get(bucket) || 0,
        })),
      },
      ...topCurrencies.map((currencyName, index) => ({
        name: formatCurrencyLabelWithFlag(currencyName),
        color: chartPalette[index % chartPalette.length],
        kind: "line" as const,
        values: bucketOrder.map((bucket) => ({
          time: bucket,
          value: grouped.get(currencyName)?.get(bucket) || 0,
        })),
      })),
    ];
  }, [chartPalette, chartTheme.complement, showDeferredSections, superchatTimeseries]);

  const sortedSuperchatCurrencies = useMemo(
    () => (superchatSummary ? [...superchatSummary.currencies].sort((a, b) => (b.total_in_yen || 0) - (a.total_in_yen || 0)) : []),
    [superchatSummary]
  );
  const sortedSuperchatCurrenciesByDonationCount = useMemo(
    () => [...sortedSuperchatCurrencies].sort((a, b) => (b.donation_count || 0) - (a.donation_count || 0)),
    [sortedSuperchatCurrencies]
  );
  const sortedSuperchatCurrenciesByAverageTicket = useMemo(
    () =>
      [...sortedSuperchatCurrencies]
        .filter((item) => (item.donation_count || 0) > 0)
        .sort((a, b) => {
          const left = (a.total_in_yen || 0) / Math.max(a.donation_count || 1, 1);
          const right = (b.total_in_yen || 0) / Math.max(b.donation_count || 1, 1);
          return right - left;
        }),
    [sortedSuperchatCurrencies]
  );
  const totalSuperchatYen = useMemo(
    () => sortedSuperchatCurrencies.reduce((sum, item) => sum + (item.total_in_yen || 0), 0),
    [sortedSuperchatCurrencies]
  );
  const totalSuperchatCount = useMemo(
    () => sortedSuperchatCurrencies.reduce((sum, item) => sum + (item.donation_count || 0), 0),
    [sortedSuperchatCurrencies]
  );
  const superchatValuePalette = chartPalette;
  const superchatDonationPalette = useMemo(
    () => chartPalette.map((color, index) => adjustSaturation(rotateHue(color, 46 + index * 4), 10)),
    [chartPalette]
  );
  const superchatAveragePalette = useMemo(
    () => chartPalette.map((color, index) => adjustSaturation(rotateHue(color, -58 - index * 4), 12)),
    [chartPalette]
  );
  const topCurrency = sortedSuperchatCurrencies[0] || null;
  const averageDonationYen = totalSuperchatCount > 0 ? totalSuperchatYen / totalSuperchatCount : 0;
  const activeCurrencyCount = useMemo(
    () => sortedSuperchatCurrencies.filter((item) => (item.total_in_yen || 0) > 0).length,
    [sortedSuperchatCurrencies]
  );
  const rankSpotlights: RankSpotlight[] = useMemo(() => {
    const symbolKey = normalizedSymbol.toUpperCase();
    return [
      {
        label: "Subscribers",
        rank: subscriberRankMap.get(symbolKey) ?? null,
        value: fmtInteger(selectedChannel?.latest?.subscriber_count ?? null),
        icon: <FaUsers aria-hidden="true" />,
      },
      {
        label: "Views",
        rank: viewRankMap.get(symbolKey) ?? null,
        value: fmtInteger(selectedChannel?.latest?.view_count ?? null),
        icon: <FaEye aria-hidden="true" />,
      },
      {
        label: "Weekly Yen Superchat",
        rank: superchatRank?.rank ?? null,
        value: `¥${fmtInteger(superchatRank?.total_in_yen ?? totalSuperchatYen)}`,
        icon: <FaYenSign aria-hidden="true" />,
      },
      {
        label: "Price",
        rank: priceRankMap.get(symbolKey) ?? null,
        value: fmtNumber(selectedAsset?.current_mid_price, "$"),
        icon: <FaDollarSign aria-hidden="true" />,
      },
      {
        label: "Volume",
        rank: volumeRankMap.get(symbolKey) ?? null,
        value: fmtNumber(selectedAsset?.volume_24h),
        icon: <FaChartColumn aria-hidden="true" />,
      },
      {
        label: "Videos",
        rank: videoRankMap.get(symbolKey) ?? null,
        value: fmtInteger(selectedChannel?.latest?.video_count ?? null),
        icon: <FaVideo aria-hidden="true" />,
      },
    ];
  }, [
    normalizedSymbol,
    priceRankMap,
    selectedAsset?.current_mid_price,
    selectedAsset?.volume_24h,
    selectedChannel?.latest?.subscriber_count,
    selectedChannel?.latest?.video_count,
    subscriberRankMap,
    superchatRank?.rank,
    superchatRank?.total_in_yen,
    totalSuperchatYen,
    videoRankMap,
    viewRankMap,
    volumeRankMap,
  ]);

  const superchatHeatmap = useMemo(() => {
    if (!showDeferredSections || !superchatCalendarTimeseries) {
      return { columns: [] as string[], rows: [] as Array<{ label: string; cells: Array<{ bucket: string; value: number; valueLabel: string }> }> };
    }

    const totalsByBucket = new Map<string, number>();
    for (const point of superchatCalendarTimeseries.points) {
      const value = point.total_in_yen || 0;
      totalsByBucket.set(point.bucket, (totalsByBucket.get(point.bucket) || 0) + value);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cells = Array.from({ length: 365 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (364 - index));
      const bucket = date.toISOString().slice(0, 10);
      const value = totalsByBucket.get(bucket) || 0;
      return {
        bucket,
        value,
        valueLabel: value > 0 ? `¥${fmtInteger(value)}` : "No superchats",
      };
    });

    return {
      columns: [],
      rows: [{ label: "Daily total", cells }],
    };
  }, [showDeferredSections, superchatCalendarTimeseries]);

  const tradeTicket = (
    <section className={styles.tradePanel}>
      <div className={styles.tradePanelContent}>
        <div className={styles.tradeTicketHeader}>
          <div>
            <span className={styles.tradeTicketEyebrow}>Execution</span>
            <h2 className={styles.sectionTitle}>Trade {selectedAsset?.symbol || normalizedSymbol}</h2>
          </div>
          <span className={tradingOpen ? styles.marketOpenPill : styles.marketClosedPill}>
            {tradingOpen ? "Market open" : "Market closed"}
          </span>
        </div>

        {!user ? (
          <div className={styles.authCta}>
            <span>Sign in to trade and load your portfolio context.</span>
            <div className={styles.authLinks}>
              <Link href="/login">Login</Link>
              <Link href="/register">Register</Link>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.portfolioGrid}>
              <div className={styles.portfolioStat}>
                <span>Cash</span>
                <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(portfolio?.cash_balance ?? null, "$")}</strong>
              </div>
              <div className={styles.portfolioStat}>
                <span>Shares Owned</span>
                <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(ownedShares)}</strong>
              </div>
              <div className={styles.portfolioStat}>
                <span>Position Value</span>
                <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(estimatedPositionValue, "$")}</strong>
              </div>
              <div className={styles.portfolioStat}>
                <span>Avg Cost</span>
                <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(selectedHolding?.avg_cost_basis ?? null, "$")}</strong>
              </div>
              <div className={styles.portfolioStat}>
                <span>Unrealized PnL</span>
                <strong className={(selectedHolding?.unrealized_pnl ?? 0) >= 0 ? styles.valueUp : styles.valueDown}>
                  {isLoadingPortfolio ? "Loading…" : formatSignedCurrency(selectedHolding?.unrealized_pnl ?? null)}
                </strong>
              </div>
              <div className={styles.portfolioStat}>
                <span>Order Value</span>
                <strong>{fmtNumber(estimatedTradeNotional, "$")}</strong>
              </div>
            </div>

            {needsEmailVerification ? <VerificationRequiredNotice action="trade" /> : null}
            <form className={styles.tradeForm} onSubmit={(event) => void handleTrade(event)}>
              <div className={styles.sideToggle}>
                <button
                  type="button"
                  className={tradeSide === "buy" ? styles.sideToggleActiveBuy : styles.sideToggleButton}
                  onClick={() => setTradeSide("buy")}
                >
                  Buy
                </button>
                <button
                  type="button"
                  className={tradeSide === "sell" ? styles.sideToggleActiveSell : styles.sideToggleButton}
                  onClick={() => setTradeSide("sell")}
                >
                  Sell
                </button>
              </div>

              <label className={styles.tradeField}>
                <span>Quantity</span>
                <input
                  className={styles.tradeInput}
                  value={tradeQuantity}
                  inputMode="decimal"
                  disabled={!tradingOpen}
                  onChange={(event) => {
                    setTradeQuantity(event.target.value);
                    setLastTradeQuantityPreset(null);
                  }}
                />
              </label>

              <div className={styles.tradePresets}>
                {TRADE_QUANTITY_PRESETS.map((preset) => (
                  <button key={preset} type="button" className={styles.presetButton} onClick={() => applyTradeQuantityPreset(preset)}>
                    {preset}
                  </button>
                ))}
              </div>

              <div className={styles.tradeSummary}>
                <div>
                  <span>Mid</span>
                  <strong>{fmtNumber(selectedAsset?.current_mid_price, "$")}</strong>
                </div>
                <div>
                  <span>Bid / Ask</span>
                  <strong>{fmtNumber(selectedAsset?.current_bid_price, "$")} / {fmtNumber(selectedAsset?.current_ask_price, "$")}</strong>
                </div>
                <div>
                  <span>Volume</span>
                  <strong>{fmtNumber(selectedAsset?.volume_24h)}</strong>
                </div>
              </div>

              <div className={styles.liveOrderQueue}>
                <div>
                  <span>Next Tick Queue</span>
                  <strong>{fmtNumber(selectedAsset?.pending_live_order_count ?? 0)}</strong>
                </div>
                <div>
                  <span>Buy Orders</span>
                  <strong className={styles.valueUp}>{fmtNumber(selectedAsset?.pending_live_buy_count ?? 0)}</strong>
                </div>
                <div>
                  <span>Sell Orders</span>
                  <strong className={styles.valueDown}>{fmtNumber(selectedAsset?.pending_live_sell_count ?? 0)}</strong>
                </div>
                <p>
                  {selectedAsset?.next_live_order_execute_after
                    ? `Queued live orders execute around ${fmtDate(selectedAsset.next_live_order_execute_after)}.`
                    : "No live orders are queued for this asset right now."}
                </p>
              </div>

              <button type="submit" className={tradeSide === "buy" ? styles.tradeSubmitBuy : styles.tradeSubmitSell} disabled={!tradingOpen || needsEmailVerification}>
                {tradingOpen ? `${tradeSide === "buy" ? "Submit Buy" : "Submit Sell"} Order` : "Market Closed"}
              </button>
            </form>

            {!tradingOpen ? (
              <div className="statusMessage statusMessageWarn">
                <strong>Trading paused.</strong> {marketClosedMessage}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );

  if (!selectedAsset && !isLoadingOverview) {
    return (
      <SiteShell>
        <div className={styles.pageLayout}>
          <div className={styles.sidebarRail}>
            <MarketSidebar
              assets={assets}
              onSelectSymbol={setSelectedSymbol}
              showSparklines={false}
              compact
              showTopMovers={false}
              showVolumeLeaders={false}
            />
            <div className={styles.takostandSpacer}>
              <div className={styles.takostandSticky} aria-hidden="true">
                <Image
                  src="/takostand.png"
                  alt=""
                  width={320}
                  height={252}
                  className={styles.takostandImage}
                  priority={false}
                />
              </div>
            </div>
          </div>
          <div className={styles.contentRail}>
            <section className={styles.emptyState}>
              <h1 className={styles.emptyTitle}>Unknown asset</h1>
              <p className={styles.emptyCopy}>No stock matched `{normalizedSymbol}` in the current market cache.</p>
            </section>
          </div>
          <div className={styles.sidebarRailRight}>
            <MarketSidebar
              assets={assets}
              onSelectSymbol={setSelectedSymbol}
              showSparklines={false}
              compact
              showSearch={false}
              showRecentViews={false}
              showMostViewed={false}
            />
            <div className={styles.takoSpacer}>
              <div className={styles.takoSticky} aria-hidden="true">
                <Image
                  src="/tako.png"
                  alt=""
                  width={680}
                  height={383}
                  className={styles.takoImage}
                  priority={false}
                />
              </div>
            </div>
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <div className={styles.pageLayout}>
        <div className={styles.sidebarRail}>
          <MarketSidebar
            assets={assets}
            onSelectSymbol={setSelectedSymbol}
            showSparklines={false}
            compact
            showTopMovers={false}
            showVolumeLeaders={false}
          />
          <div className={styles.takostandSpacer}>
            <div className={styles.takostandSticky} aria-hidden="true">
              <Image
                src="/takostand.png"
                alt=""
                width={320}
                height={252}
                className={styles.takostandImage}
                priority={false}
              />
            </div>
          </div>
        </div>

        <div className={styles.contentRail}>
          {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
          {channelError ? <div className="statusMessage statusMessageWarn">Channel metadata warning: {channelError}</div> : null}
          {portfolioError && user ? <div className="statusMessage statusMessageWarn">Portfolio warning: {portfolioError}</div> : null}
          <div className={styles.deskGrid}>
            <div className={styles.workspaceColumn}>
              <section className={styles.hero} style={heroStyle}>
                <div className={styles.heroOverlay}>

              <div className={styles.heroPrice}>
                <strong className={styles.heroPriceValue}>{currentMidPrice}</strong>
                <div className={`${styles.heroPriceChange} ${isPositive ? styles.up : styles.down}`}>
                  <div className={styles.heroPriceChangeIcon}>
                    {isPositive ? <FaArrowTrendUp /> : <FaArrowTrendDown />}
                  </div>
                  <span className={styles.heroPriceChangeValue}>{current24hMove}</span>
                </div>
              </div>
              <div className={styles.heroIdentity}>
                {channelProfileImage ? (
                  <img 
                    src={channelProfileImage}
                    alt=""
                    className={styles.channelAvatar} />
                ) : (
                  <AssetCoin
                    symbol={selectedAsset?.symbol || normalizedSymbol}
                    icon={selectedAsset?.icon ?? null}
                    color={selectedAsset?.color ?? null}
                    className={styles.assetAvatar}
                  />
                )}
                <div className={styles.heroCopy}>
                  <div className={styles.heroEyebrowRow}>
                    {selectedAsset?.unit ? <span className={styles.heroPill}>{selectedAsset.unit}</span> : null}
                    {showHeroSkeleton ? <span className={`${styles.heroPill} ${styles.skeletonBlock} ${styles.heroPillSkeleton}`} aria-hidden="true" /> : null}
                  </div>
                  <h1 className={styles.heroTitle}>
                    {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.heroTitleSkeleton}`} aria-hidden="true" /> : (selectedAsset?.display_name || selectedChannel?.channel.name || normalizedSymbol)}
                    <span className={styles.heroSymbol}>${selectedAsset?.symbol || normalizedSymbol}</span>
                    {selectedChannel?.channel.youtube_channel_id ? (
                      <Link
                        href={`https://www.youtube.com/channel/${encodeURIComponent(selectedChannel.channel.youtube_channel_id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.heroLink}
                      >
                        YouTube Channel
                        <GoLinkExternal />
                      </Link>
                    ) : null}
                  </h1>
                </div>
              </div>

              <div className={styles.heroDescriptionBlock}>
                {showHeroSkeleton ? (
                  <div className={styles.heroDescriptionSkeletonWrap}>
                    {renderSkeletonLines(3, styles.heroDescriptionSkeleton)}
                  </div>
                ) : (
                  <>
                    <pre
                      className={[
                        styles.heroDescription,
                        !isDescriptionExpanded && canExpandDescription ? styles.heroDescriptionCollapsed : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {renderDescriptionContent(channelDescription)}
                    </pre>
                    {canExpandDescription ? (
                      <button
                        type="button"
                        className={styles.heroDescriptionToggle}
                        onClick={() => setIsDescriptionExpanded((current) => !current)}
                      >
                        {isDescriptionExpanded ? "Show less" : "Show more"}
                      </button>
                    ) : null}
                  </>
                )}
              </div>

              <div className={styles.heroMarketGrid}>
                <div className={styles.heroChartFrame}>
                  <div className={styles.heroChartSlot}>
                    <CandleChartCard
                      title="24H Market"
                      subtitle={intradayCandleSubtitle}
                      candles={displayedIntradayCandles}
                      theme={chartTheme}
                      height={320}
                      compact
                      candlePalette="market"
                      fillHeight
                      bare
                      surfaceStyle={{
                        backgroundColor: "#07111d",
                        backgroundImage: "linear-gradient(180deg, rgba(24, 36, 54, 0.98), rgba(8, 12, 20, 0.96))",
                        borderColor: "color-mix(in srgb, var(--hero-accent) 34%, rgba(255, 255, 255, 0.16))",
                      }}
                      className={styles.heroChartCard}
                    />
                  </div>
                </div>
                <div className={styles.quickStatsGrid}>
                  {heroPrimaryStats.map((item) => (
                    <div key={item.label} className={styles.quickStatCard}>
                      <span className={styles.quickStatLabel}>{item.label}</span>
                      <strong
                        className={[
                          styles.quickStatValue,
                          item.accent && item.tone === "up" ? styles.valueUp : "",
                          item.accent && item.tone === "down" ? styles.valueDown : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatValueSkeleton}`} aria-hidden="true" /> : item.value}
                      </strong>
                      {item.meta ? (
                        <span className={styles.quickStatMeta}>
                          {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatMetaSkeleton}`} aria-hidden="true" /> : item.meta}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.heroMetaGrid}>
                {heroMetaStats.map((item) => (
                  <div key={item.label} className={styles.quickStatCard}>
                    <span className={styles.quickStatLabel}>
                      {item.label === "Subscribers" || item.label === "Views" || item.label === "Videos" ? <BsYoutube className={styles.quickStatLabelIcon} aria-hidden="true" /> : null}
                      {item.label}
                    </span>
                    <strong
                      className={[
                        styles.quickStatValue,
                        item.accent && item.tone === "up" ? styles.valueUp : "",
                        item.accent && item.tone === "down" ? styles.valueDown : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatValueSkeleton}`} aria-hidden="true" /> : item.value}
                    </strong>
                    {item.meta ? (
                      <span className={styles.quickStatMeta}>
                        {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatMetaSkeleton}`} aria-hidden="true" /> : item.meta}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
                </div>
              </section>
            </div>
            <aside className={styles.executionColumn}>
              {tradeTicket}
            </aside>
          </div>

          <section className={styles.adjustmentSection}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Adjustment Schedule</h2>
                <p className={styles.sectionCopy}>Track public tick movement without exposing the hidden target.</p>
              </div>
              <span className={styles.adjustmentStatusPill}>
                {!adjustmentEnabled ? "Adjustments disabled" : selectedAsset?.adjustment_ready ? "Adjustment ready" : "Waiting for price data"}
              </span>
            </div>
            <div className={styles.pressureMeter}>
              <div className={styles.pressureMeterHeader}>
                <span>Down since tick</span>
                <strong>{driftLabel}</strong>
                <span>Up since tick</span>
              </div>
              <div className={styles.pressureMeterTrack}>
                <i style={{ left: `${driftMarkerPct}%` }} />
              </div>
              <div className={styles.driftMeterFooter}>
                <span>Last tick close {fmtNumber(latestAdjustment?.price_after ?? null, "$")}</span>
                <strong className={driftSinceLastTickPct === null ? undefined : driftSinceLastTickPct >= 0 ? styles.valueUp : styles.valueDown}>
                  {fmtPct(driftSinceLastTickPct)}
                </strong>
                <span>Now {fmtNumber(marketPrice, "$")}</span>
              </div>
            </div>
            <div className={styles.adjustmentGrid}>
              <div className={styles.adjustmentPrimaryCard}>
                <FaChartSimple aria-hidden="true" className={styles.adjustmentCardIcon} />
                <span>Now</span>
                <strong>{fmtNumber(marketPrice, "$")}</strong>
                <em>Live midpoint</em>
              </div>
              <div className={styles.adjustmentCard}>
                <FaCircleQuestion aria-hidden="true" className={styles.adjustmentCardIcon} />
                <span>Next Tick</span>
                <strong>{nextAdjustment ? formatAdjustmentLabel(nextAdjustment.interval_key) : "N/A"}</strong>
                <em>{formatAdjustmentTime(nextAdjustment?.scheduled_at)}</em>
              </div>
              <div className={styles.adjustmentCard}>
                {adjustmentEnabled ? <FaCircleUp aria-hidden="true" className={styles.adjustmentCardIcon} /> : <FaCircleDown aria-hidden="true" className={styles.adjustmentCardIcon} />}
                <span>Status</span>
                <strong>{adjustmentEnabled ? "Enabled" : "Disabled"}</strong>
                <em>{adjustmentEnabled ? "Ready to play" : "Off the board"}</em>
              </div>
              <div className={styles.adjustmentCard}>
                <FaScaleBalanced aria-hidden="true" className={styles.adjustmentCardIcon} />
                <span>Last Tick</span>
                <strong>{latestAdjustment ? formatAdjustmentLabel(latestAdjustment.interval_key) : "N/A"}</strong>
                <em>
                  {latestAdjustment?.price_before !== null && latestAdjustment?.price_before !== undefined
                    ? `${fmtNumber(latestAdjustment.price_before, "$")} to ${fmtNumber(latestAdjustment.price_after ?? null, "$")} · ${fmtPct(latestAdjustmentMovePct)}`
                    : "No adjustment yet"}
                </em>
              </div>
            </div>
            <div className={styles.adjustmentHistoryPanel}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3 className={styles.sectionTitle}>Tick Log</h3>
                </div>
              </div>
              {adjustmentHistoryError ? <div className="statusMessage">Adjustment history unavailable: {adjustmentHistoryError}</div> : null}
              {adjustmentHistory?.items.length ? (
                <div className={styles.adjustmentHistorySplit}>
                  <div className={styles.adjustmentHistoryList} aria-label="Adjustment ticks">
                    {adjustmentHistory.items.map((item) => {
                      const itemKey = buildAdjustmentKey(item);
                      const isSelected = itemKey === buildAdjustmentKey(selectedAdjustment);
                      const itemMovePct =
                        item.price_before && item.price_after !== null && item.price_after !== undefined
                          ? (item.price_after - item.price_before) / item.price_before
                          : item.move_pct;
                      const StatusIcon = item.status === "skipped" ? FaCircleQuestion : itemMovePct !== null && itemMovePct < 0 ? FaArrowTrendDown : FaArrowTrendUp;
                      return (
                        <button
                          key={itemKey}
                          type="button"
                          className={isSelected ? styles.adjustmentHistoryRowActive : styles.adjustmentHistoryRow}
                          onClick={() => setSelectedAdjustmentKey(itemKey)}
                        >
                          <StatusIcon aria-hidden="true" className={styles.adjustmentHistoryIcon} />
                          <span>
                            <strong>{formatAdjustmentLabel(item.interval_key)}</strong>
                            <em>{formatAdjustmentTime(item.applied_at || item.scheduled_at)}</em>
                          </span>
                          <b className={itemMovePct === null ? undefined : itemMovePct >= 0 ? styles.valueUp : styles.valueDown}>{fmtPct(itemMovePct)}</b>
                        </button>
                      );
                    })}
                  </div>
                  {selectedAdjustment ? (
                    <article key={buildAdjustmentKey(selectedAdjustment)} className={styles.adjustmentDetailPanel}>
                      <div className={styles.adjustmentDetailHeader}>
                        <span className={styles.adjustmentDetailIcon}>
                          {selectedAdjustment.status === "skipped" ? <FaCircleQuestion aria-hidden="true" /> : selectedAdjustmentMovePct !== null && selectedAdjustmentMovePct < 0 ? <FaArrowTrendDown aria-hidden="true" /> : <FaArrowTrendUp aria-hidden="true" />}
                        </span>
                      <div>
                        <strong>{formatAdjustmentLabel(selectedAdjustment.interval_key)} tick</strong>
                          <span>{formatAdjustmentTime(selectedAdjustment.applied_at || selectedAdjustment.scheduled_at)}</span>
                      </div>
                      </div>
                      <div className={styles.adjustmentDetailStats}>
                        <div>
                          <span>Move</span>
                          <strong className={selectedAdjustmentMovePct === null ? undefined : selectedAdjustmentMovePct >= 0 ? styles.valueUp : styles.valueDown}>{fmtPct(selectedAdjustmentMovePct)}</strong>
                        </div>
                        <div>
                          <span>Before</span>
                          <strong>{fmtNumber(selectedAdjustment.price_before, "$")}</strong>
                        </div>
                        <div>
                          <span>After</span>
                          <strong>{fmtNumber(selectedAdjustment.price_after, "$")}</strong>
                        </div>
                        <div>
                          <span>Status</span>
                          <strong>{selectedAdjustment.status || "scheduled"}</strong>
                        </div>
                      </div>
                      <div className={styles.adjustmentDetailTimeline}>
                        <div><span>Scheduled</span><strong>{formatAdjustmentTime(selectedAdjustment.scheduled_at)}</strong></div>
                        <div><span>Landed</span><strong>{formatAdjustmentTime(selectedAdjustment.applied_at)}</strong></div>
                        {selectedAdjustment.status === "skipped" ? <div><span>Call</span><strong>{selectedAdjustment.skip_reason || "Skipped"}</strong></div> : null}
                      </div>
                      <div className={styles.adjustmentDetailMascot} aria-hidden="true">
                        <Image src="/laplus.png" alt="" width={180} height={180} />
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : <div className={styles.emptyState}>No tick history yet.</div>}
            </div>
          </section>

          <section className={styles.rankSection}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Ranking Snapshot</h2>
                <p className={styles.sectionCopy}>Current placement across the market for channel size, weekly superchats, and trading activity.</p>
              </div>
              <Link href="/finance/rankings" className={styles.detailLink}>
                Open rankings
              </Link>
            </div>
            <div className={styles.rankSpotlightGrid}>
              {rankSpotlights.map((item) => (
                <div key={item.label} className={styles.rankSpotlightCard}>
                  <strong className={styles.rankSpotlightValue}>
                    {item.rank !== null && Number.isFinite(item.rank) ? `#${item.rank}` : "—"}
                  </strong>
                  <span className={styles.rankSpotlightLabel}>
                    <span className={styles.rankSpotlightIcon}>{item.icon}</span>
                    {item.label}
                  </span>
                  <span className={styles.rankSpotlightMeta}>{item.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.oshiboardSection}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Oshiboard</h2>
                <p className={styles.sectionCopy}>Top holders who picked this as their oshicoin and hold it as their largest share-quantity position.</p>
              </div>
              <Link href={`/oshiboard?coin=${encodeURIComponent(normalizedSymbol)}`} className={styles.detailLink}>
                Open boards
              </Link>
            </div>
            <OshiboardPanel
              board={oshiboard}
              isLoading={isLoadingOshiboard}
              error={oshiboardError}
              compact
              transitionKey={normalizedSymbol}
            />
          </section>

          {activeLiveStream ? (
            <section className={styles.liveNowCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Live Now</h2>
                  <p className={styles.sectionCopy}>Current stream snapshot with the same viewer curve shown in the livestream popup.</p>
                </div>
                <Link
                  href={activeLiveStream.url || `https://www.youtube.com/watch?v=${encodeURIComponent(activeLiveStream.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.liveWatchLink}
                >
                  Watch stream
                </Link>
              </div>

              {liveSessionError ? <div className="statusMessage statusMessageWarn">Live session warning: {liveSessionError}</div> : null}

              <div className={styles.liveNowGrid}>
                <div className={styles.liveInfoColumn}>
                  {activeLiveStream.thumbnail_url ? (
                    <img src={activeLiveStream.thumbnail_url} alt="" className={styles.liveThumb} />
                  ) : (
                    <div className={styles.liveThumbFallback} />
                  )}
                  <div className={styles.liveMetaStack}>
                    <div className={styles.livePillRow}>
                      <span className={styles.liveNowPill}>LIVE</span>
                      <span className={styles.liveViewers}>{fmtInteger(liveCurrentViewers)} watching</span>
                    </div>
                    <strong className={styles.liveTitle}>{liveSession?.video_title || activeLiveStream.title}</strong>
                    <div className={styles.liveMetaGrid}>
                      <div className={styles.liveMetaCard}>
                        <span>Started</span>
                        <strong>{fmtDate(liveSession?.actual_start_at || activeLiveStream.started_at)}</strong>
                      </div>
                      <div className={styles.liveMetaCard}>
                        <span>Duration</span>
                        <LiveDurationValue
                          actualStartAt={liveSession?.actual_start_at || activeLiveStream.started_at}
                          durationSeconds={liveSession?.duration_seconds}
                        />
                      </div>
                      <div className={styles.liveMetaCard}>
                        <span>Avg Viewers</span>
                        <strong>{fmtInteger(latestLiveBucket?.avg_viewers ?? liveSession?.avg_concurrent_viewers ?? null)}</strong>
                      </div>
                      <div className={styles.liveMetaCard}>
                        <span>Peak Viewers</span>
                        <strong>{fmtInteger(latestLiveBucket?.max_viewers ?? liveSession?.max_concurrent_viewers ?? null)}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.liveChartColumn}>
                  <div className={styles.liveChartHeader}>
                    <strong>Viewers Over Time</strong>
                    <div className={styles.liveLegend}>
                      <span className={styles.liveLegendItem} style={{ "--legend-color": liveAvgLegendColor } as CSSProperties}>
                        Avg viewers
                      </span>
                      <span className={styles.liveLegendItem} style={{ "--legend-color": liveMaxLegendColor } as CSSProperties}>
                        Max viewers
                      </span>
                    </div>
                  </div>

                  {isLoadingLiveSession ? (
                    <div className={styles.liveChartLoading}>Loading live viewer buckets…</div>
                  ) : (
                    <LiveViewerChart buckets={liveBuckets} accentColor={liveAccentColor} />
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <div className={styles.topGrid}>
            <div className={styles.primaryColumn}>
              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Community Articles</h2>
                    <p className={styles.sectionCopy}>Published articles already associated with this asset.</p>
                  </div>
                  <Link href="/articles" className={styles.inlineLink}>Browse articles</Link>
                </div>
                {relatedCommunityArticles.length ? (
                  <div className={styles.articleList}>
                    {relatedCommunityArticles.map((article) => (
                      <Link key={article.id} href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.articleCard}>
                        <div className={styles.articleTopRow}>
                          <span className={styles.articleTag}>{article.tags[0] || "Article"}</span>
                          <span className={styles.articleAuthor}>{article.author?.username || "Imported"}</span>
                        </div>
                        <strong className={styles.articleTitle}>{article.title}</strong>
                        <p className={styles.articleCopy}>{article.preview || article.subtitle || "Open the article to read the full writeup."}</p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className={styles.mockEmpty}>No community articles are associated with this asset yet.</div>
                )}
              </section>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>News Items</h2>
                    <p className={styles.sectionCopy}>Imported news coverage associated with this asset.</p>
                  </div>
                  <Link href="/news" className={styles.inlineLink}>Browse news</Link>
                </div>
                {relatedNewsItems.length ? (
                  <div className={styles.articleList}>
                    {relatedNewsItems.map((article) => (
                      (() => {
                        const heading = splitHeadline(article.title);
                        return (
                          <Link key={article.id} href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.articleCard}>
                            <div className={styles.articleTopRow}>
                              <span className={styles.articleTag}>{article.tags[0] || (article.is_news ? "News" : "Article")}</span>
                              <span className={styles.articleAuthor}>{article.author?.username || "Imported"}</span>
                            </div>
                            <strong className={styles.articleTitle}>{heading.title}</strong>
                            <p className={styles.articleCopy}>{heading.subhead || article.preview || article.subtitle || "Open the article to read the full writeup."}</p>
                          </Link>
                        );
                      })()
                    ))}
                  </div>
                ) : (
                  <div className={styles.mockEmpty}>No news items are associated with this asset yet.</div>
                )}
              </section>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Other members of {selectedAsset?.unit || "this unit"}</h2>
                  </div>
                </div>
                {sameUnitAssets.length ? (
                  <div className={styles.sameUnitGrid}>
                    {sameUnitAssets.map((asset) => (
                      (() => {
                        const deltaValue = computePriceDelta(asset.current_mid_price, asset.move_24h_pct);
                        const isPositiveDelta = (deltaValue ?? 0) >= 0;
                        return (
                          <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.sameUnitCard}>
                            <div className={styles.sameUnitIdentity}>
                              <AssetCoin symbol={asset.symbol} icon={asset.icon ?? null} color={asset.color ?? null} className={styles.sameUnitIcon} />
                              <div>
                                <strong>{asset.symbol}</strong>
                                <span>{asset.display_name}</span>
                              </div>
                            </div>
                            <div className={styles.sameUnitMetrics}>
                              <strong>{fmtNumber(asset.current_mid_price, "$")}</strong>
                              <span className={isPositiveDelta ? styles.valueUp : styles.valueDown}>
                                {formatSignedCurrency(deltaValue)}
                                {isPositiveDelta ? <FaArrowTrendUp aria-hidden="true" /> : <FaArrowTrendDown aria-hidden="true" />}
                              </span>
                            </div>
                          </Link>
                        );
                      })()
                    ))}
                  </div>
                ) : (
                  <div className={styles.mockEmpty}>No other active channels share this unit right now.</div>
                )}
              </section>

            </div>

          </div>

          <ChannelBoard
            key={normalizedSymbol}
            assetSymbol={selectedAsset?.symbol || normalizedSymbol}
            assetCommentBoard={assetCommentBoard}
            assetCommentBoardError={assetCommentBoardError}
            canPostAssetComment={Boolean(canPostAssetComment)}
            commentVoteBusyId={commentVoteBusyId}
            isLoadingAssetComments={isLoadingAssetComments}
            isLoadingPortfolio={isLoadingPortfolio}
            isSubmittingComment={isSubmittingComment}
            needsEmailVerification={needsEmailVerification}
            onCommentSubmit={handleCommentSubmit}
            onCommentVote={handleCommentVote}
            onNextPage={handleNextAssetCommentPage}
            onPreviousPage={handlePreviousAssetCommentPage}
            totalAssetComments={totalAssetComments}
            user={user}
            viewerOwnedShares={viewerOwnedShares}
          />

          {showDeferredSections ? (
            <>
              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Market Graphs</h2>
                    <p className={styles.sectionCopy}>Price and channel growth curves in one deck.</p>
                  </div>
                  <div className={styles.candleIntervalControl} aria-label="24 hour candle interval">
                    {INTRADAY_CANDLE_INTERVALS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={intradayCandleInterval === option.value ? styles.candleIntervalButtonActive : styles.candleIntervalButton}
                        onClick={() => setIntradayCandleInterval(option.value)}
                        aria-pressed={intradayCandleInterval === option.value}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {intradayCandlesError ? <div className="statusMessage statusMessageWarn">24H candle warning: {intradayCandlesError}</div> : null}
                <div className={styles.chartGrid}>
                  <div className={styles.chartGridWide}>
                    <CandleChartCard
                      title="24H Market"
                      subtitle={isLoadingIntradayCandles ? `Loading ${intradayCandleSubtitle.toLowerCase()}` : intradayCandleSubtitle}
                      candles={displayedIntradayCandles}
                      theme={chartTheme}
                      candlePalette="market"
                    />
                  </div>
                  <CandleChartCard title="1Y Daily Price" subtitle="Daily candles with mark-close overlay" candles={filteredDailyCandles} showMarkClose theme={chartTheme} />
                  <VolumeChartCard title="1Y Daily Volume" subtitle="Settled daily coin volume in shares" candles={filteredDailyCandles} theme={chartTheme} />
                  <div className={styles.chartGridWide}>
                    <TrendChartCard
                      title="Subscribers"
                      subtitle="One-year audience trajectory"
                      theme={chartTheme}
                      series={[
                        {
                          name: "Subscribers",
                          color: chartTheme.base,
                          kind: "area",
                          values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.subscriber_count })),
                        },
                      ]}
                    />
                  </div>
                  <TrendChartCard
                    title="Views"
                    subtitle="Cumulative channel views"
                    theme={chartTheme}
                    series={[
                      {
                        name: "Views",
                        color: chartTheme.complement,
                        kind: "area",
                        values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.view_count })),
                      },
                    ]}
                  />
                  <TrendChartCard
                    title="Video Count"
                    subtitle="Published video total over time"
                    theme={chartTheme}
                    series={[
                      {
                        name: "Videos",
                        color: chartTheme.complementSoft,
                        kind: "area",
                        values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.video_count })),
                      },
                    ]}
                  />
                </div>
              </section>

              <div className={styles.utilityGrid}>
                <section className={styles.sectionCard}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>Treasury</h2>
                      <p className={styles.sectionCopy}>Supply structure and emission snapshot for the asset.</p>
                    </div>
                  </div>
                  <div className={styles.infoGrid}>
                    <div className={styles.infoCard}><span>Circulating</span><strong>{fmtNumber(detail?.treasury?.circulating_supply)}</strong></div>
                    <div className={styles.infoCard}><span>Treasury</span><strong>{fmtNumber(detail?.treasury?.treasury_supply)}</strong></div>
                    <div className={styles.infoCard}><span>Max Supply</span><strong>{fmtNumber(detail?.treasury?.max_supply)}</strong></div>
                    <div className={styles.infoCard}><span>Daily Emission</span><strong>{fmtNumber(detail?.treasury?.current_daily_emission)}</strong></div>
                    <div className={styles.infoCard}><span>Snapshot Date</span><strong>{selectedAsset?.latest_snapshot_date || "—"}</strong></div>
                  </div>
                </section>

                <section className={styles.sectionCard}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>Recent Trades</h2>
                      <p className={styles.sectionCopy}>Last fills for this symbol from the market feed.</p>
                    </div>
                  </div>
                  <div className={styles.tradeTape}>
                    {(detail?.trades || []).length ? (
                      (detail?.trades || []).map((trade) => (
                        <article key={trade.id} className={styles.tradeTapeRow}>
                          <div className={styles.tradeAsset}>
                            <AssetCoin
                              symbol={selectedAsset?.symbol || normalizedSymbol}
                              icon={selectedAsset?.icon ?? null}
                              color={selectedAsset?.color ?? null}
                              className={styles.inlineAssetIcon}
                              shape="circle"
                            />
                            <div className={styles.tradeAssetCopy}>
                              <strong className={styles.tradeAssetLink}>{selectedAsset?.symbol || normalizedSymbol}</strong>
                              <span>{fmtDate(trade.ts)}</span>
                            </div>
                          </div>
                          <div>
                            <span className={[styles.sideBadge, trade.side.toLowerCase() === "buy" ? styles.sideBadgeBuy : styles.sideBadgeSell].join(" ")}>
                              {trade.side.toUpperCase()}
                            </span>
                          </div>
                          <div className={styles.tradeMetrics}>
                            <strong className={styles.numericValue}>{fmtNumber(trade.quantity)} @ {fmtNumber(trade.price, "$")}</strong>
                            <span className={styles.numericValue}>Gross {fmtNumber(trade.gross_cash, "$")}</span>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className={styles.mockEmpty}>No recent trades were returned for this symbol.</div>
                    )}
                  </div>
                </section>
              </div>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Livestreams</h2>
                    <p className={styles.sectionCopy}>Current, scheduled, and archived streams for this channel.</p>
                  </div>
                  <Link href="/livestreams" className={styles.detailLink}>
                    Open livestreams
                  </Link>
                </div>

                <div className={styles.livestreamPanel}>
                  <div className={styles.livestreamTabShell}>
                    <div className={styles.revenuePulseTabHeader}>
                      <span>Stream view</span>
                      <strong>{livestreamView === "current" ? "Live and upcoming" : "Past streams"}</strong>
                      <em>
                        {livestreamView === "current"
                          ? `${fmtInteger(channelStreams.live.length)} live / ${fmtInteger(channelStreams.upcoming.length)} upcoming`
                          : pastLivestreamWeekLabel}
                      </em>
                    </div>
                    <div className={styles.livestreamTabList} role="tablist" aria-label="Livestream view">
                      <button
                        type="button"
                        className={livestreamView === "current" ? styles.revenuePulseTabActive : styles.revenuePulseTab}
                        onClick={() => setLivestreamView("current")}
                        aria-pressed={livestreamView === "current"}
                      >
                        Current
                      </button>
                      <button
                        type="button"
                        className={livestreamView === "past" ? styles.revenuePulseTabActive : styles.revenuePulseTab}
                        onClick={() => setLivestreamView("past")}
                        aria-pressed={livestreamView === "past"}
                      >
                        Past Streams
                      </button>
                    </div>
                  </div>

                  {livestreamView === "current" ? (
                    <>
                      {livestreamError ? <div className="statusMessage statusMessageError">Livestream error: {livestreamError}</div> : null}
                      {isLoadingLivestreams ? <div className={shellStyles.empty}>Loading livestreams…</div> : null}
                      {!isLoadingLivestreams && !livestreamError && channelStreams.live.length === 0 && channelStreams.upcoming.length === 0 ? (
                        <div className={shellStyles.empty}>No live or upcoming streams for this channel.</div>
                      ) : null}

                      {channelStreams.live.length > 0 ? (
                        <div className={shellStyles.streamSection}>
                          <h3 className={shellStyles.sectionLabel}>Live Now</h3>
                          <div className={styles.livestreamList}>
                            {channelStreams.live.map((stream) => renderStreamItem(stream, "Live"))}
                          </div>
                        </div>
                      ) : null}

                      {channelStreams.upcoming.length > 0 ? (
                        <div className={shellStyles.streamSection}>
                          <h3 className={shellStyles.sectionLabel}>Upcoming</h3>
                          <div className={styles.livestreamList}>
                            {channelStreams.upcoming.map((stream) => renderStreamItem(stream, "Upcoming"))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className={styles.pastStreamPanel}>
                      <div className={styles.pastStreamPager}>
                        <button
                          type="button"
                          className={styles.pastStreamPageButton}
                          onClick={() => setPastLivestreamPage((value) => value + 1)}
                          disabled={isLoadingPastLivestreams || !pastLivestreamData?.has_older}
                        >
                          Older
                        </button>
                        <span>{pastLivestreamWeekLabel}</span>
                        <button
                          type="button"
                          className={styles.pastStreamPageButton}
                          onClick={() => setPastLivestreamPage((value) => Math.max(0, value - 1))}
                          disabled={isLoadingPastLivestreams || pastLivestreamPage === 0}
                        >
                          Newer
                        </button>
                      </div>

                      {pastLivestreamError ? <div className="statusMessage statusMessageError">Past livestream error: {pastLivestreamError}</div> : null}
                      {isLoadingPastLivestreams ? <div className={shellStyles.empty}>Loading past livestreams…</div> : null}
                      {!isLoadingPastLivestreams && !pastLivestreamError && pastLivestreams.length === 0 ? (
                        <div className={shellStyles.empty}>No completed streams found for this channel in this window.</div>
                      ) : null}

                      {pastLivestreams.length > 0 ? (
                        <>
                          <div className={styles.livestreamList}>
                            {pastLivestreams.map(renderPastStreamItem)}
                          </div>
                          <div className={styles.pastStreamPager}>
                            <button
                              type="button"
                              className={styles.pastStreamPageButton}
                              onClick={() => setPastLivestreamPage((value) => value + 1)}
                              disabled={isLoadingPastLivestreams || !pastLivestreamData?.has_older}
                            >
                              Older
                            </button>
                            <span>{pastLivestreamWeekLabel}</span>
                            <button
                              type="button"
                              className={styles.pastStreamPageButton}
                              onClick={() => setPastLivestreamPage((value) => Math.max(0, value - 1))}
                              disabled={isLoadingPastLivestreams || pastLivestreamPage === 0}
                            >
                              Newer
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </section>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Superchats</h2>
                    <p className={styles.sectionCopy}>Weekly summary and time-series breakdowns by currency.</p>
                    {superchatSummary?.week_start && superchatSummary?.week_end ? (
                      <p className={styles.sectionMeta}>
                        Window: {fmtDate(superchatSummary.week_start)} to {fmtDate(superchatSummary.week_end)}
                      </p>
                    ) : null}
                  </div>
                </div>

                {superchatError ? <div className="statusMessage statusMessageError">Superchat error: {superchatError}</div> : null}
                {isLoadingSuperchats ? <div className={shellStyles.empty}>Loading superchat summary…</div> : null}
                {!isLoadingSuperchats && !superchatError && (!superchatSummary || superchatSummary.currencies.length === 0) ? (
                  <div className={shellStyles.empty}>No superchat currency totals for this channel in the past week.</div>
                ) : null}

                {superchatSummary && superchatSummary.currencies.length > 0 ? (
                  <>
                    <div className={shellStyles.grid}>
                      <div className={shellStyles.card}>
                        <div className={shellStyles.eyebrow}>Weekly Yen</div>
                        <div className={shellStyles.cardTitle}>¥{fmtInteger(totalSuperchatYen)}</div>
                        <div className={shellStyles.meta}>Across all currencies in the current 7-day window.</div>
                      </div>
                      <div className={shellStyles.card}>
                        <div className={shellStyles.eyebrow}>Donation Count</div>
                        <div className={shellStyles.cardTitle}>{fmtInteger(totalSuperchatCount)}</div>
                        <div className={shellStyles.meta}>Average ticket size ¥{fmtInteger(averageDonationYen)}.</div>
                      </div>
                      <div className={shellStyles.card}>
                        <div className={shellStyles.eyebrow}>Leading Currency</div>
                        <div className={shellStyles.cardTitle}>{topCurrency ? formatCurrencyLabelWithFlag(topCurrency.currency_name) : "—"}</div>
                        <div className={shellStyles.meta}>
                          {topCurrency && totalSuperchatYen > 0
                            ? `${fmtNumber(((topCurrency.total_in_yen || 0) / totalSuperchatYen) * 100)}% share across ${activeCurrencyCount} active currencies.`
                            : "No dominant currency yet."}
                        </div>
                      </div>
                    </div>

                    {superchatCalendarError ? (
                      <div className="statusMessage statusMessageError">Superchat calendar error: {superchatCalendarError}</div>
                    ) : null}
                    {isLoadingSuperchatCalendar ? <div className={shellStyles.empty}>Loading yearly superchat calendar…</div> : null}
                    {!isLoadingSuperchatCalendar && !superchatCalendarError ? (
                      <SuperchatHeatmapCard
                        title="Yearly Superchat Heatmap"
                        subtitle="Daily yen flow over the last year; the rightmost square is today"
                        columns={superchatHeatmap.columns}
                        rows={superchatHeatmap.rows}
                        theme={chartTheme}
                      />
                    ) : null}

                    {superchatTimeseriesError ? (
                      <div className="statusMessage statusMessageError">Superchat timeseries error: {superchatTimeseriesError}</div>
                    ) : null}
                    {!isLoadingSuperchatTimeseries && !superchatTimeseriesError && superchatLineSeries.length === 0 ? (
                      <div className={shellStyles.empty}>No superchat timeseries data for this range.</div>
                    ) : null}
                    {superchatLineSeries.length > 0 ? (
                      <div className={styles.revenuePulseRow}>
                        <div className={styles.revenuePulseChart}>
                          <TrendChartCard
                            title="Revenue Pulse"
                            subtitle="Total yen flow over time with the strongest currencies layered on top"
                            series={superchatLineSeries}
                            theme={chartTheme}
                          />
                        </div>
                        <aside className={styles.revenuePulseTabs} aria-label="Revenue Pulse timeframe">
                          <div className={styles.revenuePulseTabHeader}>
                            <span>Timeframe</span>
                            <strong>{SUPERCHAT_TIMESERIES_OPTIONS.find((option) => option.value === superchatTimeseriesRange)?.label}</strong>
                            {superchatTimeseries?.start_date && superchatTimeseries?.end_date ? (
                              <em>{fmtDate(superchatTimeseries.start_date)} to {fmtDate(superchatTimeseries.end_date)}</em>
                            ) : null}
                            {isLoadingSuperchatTimeseries ? <span className={styles.revenuePulseLoading}>Updating chart</span> : null}
                          </div>
                          <div className={styles.revenuePulseTabList}>
                            {SUPERCHAT_TIMESERIES_OPTIONS.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={option.value === superchatTimeseriesRange ? styles.revenuePulseTabActive : styles.revenuePulseTab}
                                onClick={() => setSuperchatTimeseriesRange(option.value)}
                                aria-pressed={option.value === superchatTimeseriesRange}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </aside>
                      </div>
                    ) : null}

                    <SuperchatHistogramCard
                      title="Revenue Power"
                      subtitle="Past 7 days of superchat value in yen by currency"
                      theme={chartTheme}
                      bars={sortedSuperchatCurrencies.map((item, index) => ({
                        label: formatCurrencyLabelWithFlag(item.currency_name),
                        color: superchatValuePalette[index % superchatValuePalette.length],
                        value: item.total_in_yen || 0,
                        subtitle: `${fmtInteger(item.donation_count || 0)} donations • ${fmtNumber(item.total_in_currency)} ${item.currency_name}`,
                        flagUrl: getCurrencyFlagUrl(item.currency_name),
                      }))}
                    />

                    <div className={styles.superchatRankStack}>
                      <RankedBarChartCard
                        title="Share Of Value"
                        subtitle="Currency contribution to weekly yen volume"
                        bars={sortedSuperchatCurrencies.map((item, index) => ({
                          label: formatCurrencyLabelWithFlag(item.currency_name),
                          color: superchatValuePalette[index % superchatValuePalette.length],
                          value: item.total_in_yen || 0,
                          valueLabel: totalSuperchatYen > 0 ? `${fmtNumber(((item.total_in_yen || 0) / totalSuperchatYen) * 100)}%` : "0%",
                          meta: `¥${fmtInteger(item.total_in_yen)} total`,
                        }))}
                      />
                      <RankedBarChartCard
                        title="Donation Count"
                        subtitle="How many superchats each currency contributed"
                        bars={sortedSuperchatCurrenciesByDonationCount.map((item, index) => ({
                          label: formatCurrencyLabelWithFlag(item.currency_name),
                          color: superchatDonationPalette[index % superchatDonationPalette.length],
                          value: item.donation_count || 0,
                          valueLabel: fmtInteger(item.donation_count || 0),
                          meta: totalSuperchatCount > 0 ? `${fmtNumber(((item.donation_count || 0) / totalSuperchatCount) * 100)}% of all donations` : "No donations",
                        }))}
                      />
                      <RankedBarChartCard
                        title="Average Ticket"
                        subtitle="Average yen per donation by currency"
                        bars={sortedSuperchatCurrenciesByAverageTicket
                          .map((item, index) => ({
                            label: formatCurrencyLabelWithFlag(item.currency_name),
                            color: superchatAveragePalette[index % superchatAveragePalette.length],
                            value: (item.total_in_yen || 0) / Math.max(item.donation_count || 1, 1),
                            valueLabel: `¥${fmtInteger((item.total_in_yen || 0) / Math.max(item.donation_count || 1, 1))}`,
                            meta: `${fmtNumber(item.total_in_currency)} ${item.currency_name} across ${fmtInteger(item.donation_count || 0)} donations`,
                          }))}
                      />
                    </div>
                  </>
                ) : null}

              </section>
            </>
          ) : (
            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Market Data</h2>
                  <p className={styles.sectionCopy}>Rendering charts, tape, and superchat analytics after the route settles.</p>
                </div>
              </div>
              <div className={shellStyles.empty}>Loading deferred market panels…</div>
            </section>
          )}
        </div>

        <div className={styles.sidebarRailRight}>
          <MarketSidebar
            assets={assets}
            onSelectSymbol={setSelectedSymbol}
            showSparklines={false}
            compact
            showSearch={false}
            showRecentViews={false}
            showMostViewed={false}
          />
          <div className={styles.takoSpacer}>
            <div className={styles.takoSticky} aria-hidden="true">
              <Image
                src="/tako.png"
                alt=""
                width={680}
                height={383}
                className={styles.takoImage}
                priority={false}
              />
            </div>
          </div>
        </div>
      </div>

      <LivestreamModal
        open={Boolean(selectedLivestreamItem)}
        item={selectedLivestreamItem}
        onClose={() => setSelectedLivestreamItem(null)}
      />

      {tradeConfirmation && typeof document !== "undefined"
        ? createPortal(
            (() => {
          const isQueued = tradeConfirmation.mode === "queued";
          const isPositiveTradeTheme = tradeConfirmation.side === "buy" || (tradeConfirmation.themePnl ?? tradeConfirmation.realizedPnl ?? 0) >= 0;
          return (
        <div
          className={[
            styles.tradeConfirmationOverlay,
            isTradeConfirmationClosing ? styles.tradeConfirmationOverlayClosing : "",
          ].filter(Boolean).join(" ")}
          onClick={closeTradeConfirmation}
        >
            <div
              className={[
                styles.tradeConfirmationFrame,
                isPositiveTradeTheme ? styles.tradeConfirmationFrameBuy : styles.tradeConfirmationFrameSell,
              ].join(" ")}
            >
              <div
                className={[
                  styles.tradeConfirmationModal,
                  isPositiveTradeTheme ? styles.tradeConfirmationModalBuy : styles.tradeConfirmationModalSell,
                  isTradeConfirmationClosing ? styles.tradeConfirmationModalClosing : "",
                ].filter(Boolean).join(" ")}
                role="dialog"
                aria-modal="true"
                aria-labelledby="trade-confirmation-title"
                onClick={(event) => event.stopPropagation()}
              >
            <div
              className={[
                styles.tradeConfirmationHero,
                isPositiveTradeTheme ? styles.tradeConfirmationHeroBuy : styles.tradeConfirmationHeroSell,
              ].join(" ")}
            >
              <div>
                <span className={styles.tradeConfirmationEyebrow}>
                  {isQueued ? "Live Order Queued" : tradeConfirmation.side === "buy" ? "Buy Filled" : "Sell Filled"}
                </span>
                <h2 id="trade-confirmation-title" className={styles.tradeConfirmationTitle}>
                  {isQueued
                    ? "Order queued for next tick"
                    : tradeConfirmation.side === "buy"
                    ? "Position updated"
                    : (tradeConfirmation.realizedPnl ?? 0) >= 0
                      ? `Nice! Capital gains = ${fmtNumber(tradeConfirmation.realizedPnl, "$")}`
                      : `Tough break. Capital loss = ${fmtNumber(Math.abs(tradeConfirmation.realizedPnl ?? 0), "$")}`}
                </h2>
                <div className={styles.tradeConfirmationSubheader}>
                  <AssetCoin
                    symbol={tradeConfirmation.symbol}
                    icon={selectedAsset?.icon ?? null}
                    color={selectedAsset?.color ?? null}
                    className={styles.tradeConfirmationTickerIcon}
                  />
                  <p className={styles.tradeConfirmationCopy}>
                    <strong className={styles.tradeConfirmationTicker}>${tradeConfirmation.symbol}</strong>
                    <span>
                      {isQueued
                        ? `${fmtNumber(tradeConfirmation.requestedQuantity)} shares will execute on the next 10-minute tick.`
                        : `${fmtNumber(tradeConfirmation.filledQuantity)} shares executed at ${fmtNumber(tradeConfirmation.executedPrice, "$")} per share.`}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={styles.tradeConfirmationClose}
                onClick={closeTradeConfirmation}
                aria-label="Close trade confirmation"
              >
                ×
              </button>
            </div>

            <div className={styles.tradeConfirmationBody}>
              <div className={styles.tradeConfirmationLayout}>
                <div className={styles.tradeConfirmationImageSlot}>
                  <Image
                    src={tradeConfirmation.imageSrc}
                    alt="Trade confirmation illustration"
                    width={320}
                    height={320}
                    className={styles.tradeConfirmationImage}
                  />
                </div>

                <div className={styles.tradeConfirmationContent}>
                  <div className={styles.tradeConfirmationGrid}>
                    <div className={styles.tradeConfirmationCard}>
                      <span>{isQueued ? "Requested Shares" : tradeConfirmation.side === "buy" ? "Total Cost" : "Gross Value"}</span>
                      <strong>{isQueued ? fmtNumber(tradeConfirmation.requestedQuantity) : fmtNumber(tradeConfirmation.side === "buy" ? tradeConfirmation.totalCost : tradeConfirmation.grossValue, "$")}</strong>
                    </div>
                    <div className={styles.tradeConfirmationCard}>
                      <span>{isQueued ? "Order ID" : "Fee"}</span>
                      <strong>{isQueued ? `#${tradeConfirmation.orderId || "new"}` : fmtNumber(tradeConfirmation.fee, "$")}</strong>
                    </div>
                    <div className={styles.tradeConfirmationCard}>
                      <span>{isQueued ? "Executes Around" : tradeConfirmation.side === "buy" ? "Cash Change" : "Net Proceeds"}</span>
                      <strong className={isQueued || tradeConfirmation.netCashImpact >= 0 ? styles.valueUp : styles.valueDown}>
                        {isQueued ? fmtDate(tradeConfirmation.executeAfter) : formatSignedCurrency(tradeConfirmation.netCashImpact)}
                      </strong>
                    </div>
                    <div className={styles.tradeConfirmationCard}>
                      <span>{isQueued ? "Shares Left" : "New Cash Balance"}</span>
                      <strong>{isQueued ? `${fmtNumber(tradeConfirmation.remainingIntervalShares ?? tradeConfirmation.intervalLimit)} shares` : fmtNumber(tradeConfirmation.nextCashBalance, "$")}</strong>
                    </div>
                  </div>

                  <div className={styles.tradeConfirmationColumns}>
                    <section className={styles.tradeConfirmationSection}>
                      <h3>Position</h3>
                      <div className={styles.tradeConfirmationMetricList}>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>Shares owned</span>
                          <strong>{fmtNumber(tradeConfirmation.previousQuantity)} → {fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                        </div>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>Average cost</span>
                          <strong>{fmtNumber(tradeConfirmation.previousAvgCost, "$")} → {fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                        </div>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>Marked at</span>
                          <strong>{fmtNumber(tradeConfirmation.currentMidPrice, "$")}</strong>
                        </div>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>{tradeConfirmation.side === "buy" ? "Estimated unrealized P/L" : "Actual realized P/L"}</span>
                          <strong
                            className={((tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl) ?? 0) >= 0 ? styles.valueUp : styles.valueDown}
                          >
                            {formatSignedCurrency(tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl)}
                          </strong>
                        </div>
                      </div>
                    </section>

                    <section className={styles.tradeConfirmationSection}>
                      <h3>{tradeConfirmation.side === "buy" ? "What changed" : "Remaining position"}</h3>
                      <div className={styles.tradeConfirmationMetricList}>
                        {isQueued ? (
                          <>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Side</span>
                              <strong className={tradeConfirmation.side === "buy" ? styles.valueUp : styles.valueDown}>{tradeConfirmation.side.toUpperCase()}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Execution rule</span>
                              <strong>Next 10-minute tick</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Fill check</span>
                              <strong>Cash, holdings, and quote rechecked at execution</strong>
                            </div>
                          </>
                        ) : tradeConfirmation.side === "buy" ? (
                          <>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Shares added</span>
                              <strong className={styles.valueUp}>+{fmtNumber(tradeConfirmation.filledQuantity)}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>New weighted average</span>
                              <strong>{fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Fill time</span>
                              <strong>{fmtDate(tradeConfirmation.filledAt)}</strong>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Cost basis sold</span>
                              <strong>{fmtNumber(tradeConfirmation.costBasisSold, "$")}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Shares remaining</span>
                              <strong>{fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Remaining unrealized P/L</span>
                              <strong className={(tradeConfirmation.unrealizedPnl ?? 0) >= 0 ? styles.valueUp : styles.valueDown}>
                                {formatSignedCurrency(tradeConfirmation.unrealizedPnl)}
                              </strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Fill time</span>
                              <strong>{fmtDate(tradeConfirmation.filledAt)}</strong>
                            </div>
                          </>
                        )}
                      </div>
                    </section>
                  </div>

                  <div className={styles.tradeConfirmationActions}>
                    <button type="button" className={styles.tradeConfirmationPrimary} onClick={closeTradeConfirmation}>
                      Back to chart
                    </button>
                  </div>
                </div>
              </div>
            </div>
              </div>
            </div>
              </div>
            );
            })(),
            document.body,
          )
        : null}
      {tradeFailureNotice ? (
        <div className={styles.tradeFailureOverlay} onClick={() => setTradeFailureNotice(null)}>
          <div className={styles.tradeFailureModal} role="alertdialog" aria-modal="true" aria-labelledby="trade-failure-title" onClick={(event) => event.stopPropagation()}>
            <div className={styles.tradeFailureHeader}>
              <h2 id="trade-failure-title" className={styles.tradeFailureTitle}>{tradeFailureNotice.title}</h2>
              <button
                type="button"
                className={styles.tradeConfirmationClose}
                onClick={() => setTradeFailureNotice(null)}
                aria-label="Close trade failure notice"
              >
                ×
              </button>
            </div>
            <div className={styles.tradeFailureBody}>
              <p className={styles.tradeFailureCopy}>{tradeFailureNotice.message}</p>
              <div className={styles.tradeConfirmationActions}>
                <button type="button" className={styles.tradeFailurePrimary} onClick={() => setTradeFailureNotice(null)}>
                  Back to order ticket
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </SiteShell>
  );
}
