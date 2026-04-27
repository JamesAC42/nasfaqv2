"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaAward,
  FaBookOpen,
  FaBullseye,
  FaCheck,
  FaCoins,
  FaCrown,
  FaFire,
  FaGem,
  FaMoneyBillWave,
  FaPencil,
  FaRocket,
  FaStar,
  FaTrophy,
  FaUsers,
} from "react-icons/fa6";
import type { IconType } from "react-icons";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { createChannelChartTheme } from "@/app/lib/chart-theme";
import { fmtNumber } from "@/app/lib/format";
import { normalizeArticleListResponse, normalizePredictionPortfolioResponse, normalizeProfileBundle } from "@/app/lib/normalizers";
import type { ArticleSummary, PredictionPortfolioResponse, ProfileBundle, ProfileRelationUser } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useAuthStore } from "@/app/stores/auth-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/profile/profile-page.module.scss";

type SelectableProfilePicture = {
  id: number;
  name: string;
  url_large: string;
  url_small: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value), "$")}`;
}

function relationInitial(user: { username: string }) {
  return user.username.trim().charAt(0).toUpperCase() || "N";
}

function detectSelectedProfilePictureId(profilePictureUrl: string | null, options: SelectableProfilePicture[]) {
  if (!profilePictureUrl) return null;
  const match = options.find((item) => item.url_large === profilePictureUrl || item.url_small === profilePictureUrl);
  return match?.id ?? null;
}

function valueToneClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (value > 0) return styles.positive;
  if (value < 0) return styles.negative;
  return styles.neutral;
}

function achievementIconFor(achievement: ProfileBundle["profile"]["achievements"][number]): IconType {
  const signal = `${achievement.key} ${achievement.name} ${achievement.description || ""}`.toLowerCase();
  if (signal.includes("streak") || signal.includes("fire")) return FaFire;
  if (signal.includes("friend") || signal.includes("rival") || signal.includes("social")) return FaUsers;
  if (signal.includes("article") || signal.includes("writer") || signal.includes("publish")) return FaBookOpen;
  if (signal.includes("trade") || signal.includes("volume") || signal.includes("coin")) return FaCoins;
  if (signal.includes("profit") || signal.includes("pnl") || signal.includes("cash")) return FaMoneyBillWave;
  if (signal.includes("diamond") || signal.includes("gem")) return FaGem;
  if (signal.includes("leader") || signal.includes("rank") || signal.includes("top")) return FaCrown;
  if (signal.includes("winner") || signal.includes("trophy")) return FaTrophy;
  if (signal.includes("target") || signal.includes("goal")) return FaBullseye;
  if (signal.includes("launch") || signal.includes("moon") || signal.includes("rocket")) return FaRocket;
  if (signal.includes("star")) return FaStar;
  return FaAward;
}

function TrendValue({
  value,
  toneFrom,
  iconPosition = "left",
  icon,
}: {
  value: string;
  toneFrom?: number | null | undefined;
  iconPosition?: "left" | "right";
  icon?: ReactNode;
}) {
  const toneClass = valueToneClass(toneFrom);
  const TrendIcon = toneFrom === null || toneFrom === undefined || Number.isNaN(toneFrom)
    ? null
    : toneFrom >= 0
      ? FaArrowTrendUp
      : FaArrowTrendDown;

  return (
    <span className={[styles.trendValue, toneClass].filter(Boolean).join(" ")}>
      {iconPosition === "left" ? icon : null}
      {iconPosition === "left" && TrendIcon ? <TrendIcon aria-hidden="true" /> : null}
      <span className={styles.numericValue}>{value}</span>
      {iconPosition === "right" && TrendIcon ? <TrendIcon aria-hidden="true" /> : null}
      {iconPosition === "right" ? icon : null}
    </span>
  );
}

function ProfileIdentity({
  profile,
  isSelf,
  onOpenProfilePicturePicker,
  onOpenProfileSettings,
  onLogout,
  logoutBusy = false,
}: {
  profile: ProfileBundle["profile"];
  isSelf: boolean;
  onOpenProfilePicturePicker?: () => void;
  onOpenProfileSettings?: () => void;
  onLogout?: () => void;
  logoutBusy?: boolean;
}) {
  const currentStreakDays = profile.streaks.current_streak_days;

  return (
    <section
      className={styles.identityPanel}
      style={profile.profile_color ? ({ "--profile-accent": profile.profile_color } as CSSProperties) : undefined}
    >
      <div className={styles.identityTop}>
        {isSelf ? (
          <button
            type="button"
            className={styles.editProfileIconButton}
            onClick={onOpenProfileSettings}
            aria-label="Edit profile"
          >
            <FaPencil aria-hidden="true" />
          </button>
        ) : null}
        {isSelf ? (
          <button type="button" className={styles.avatarPickerButton} onClick={onOpenProfilePicturePicker} aria-label="Change profile picture">
            {profile.profile_picture_url ? (
              <img src={profile.profile_picture_url} alt="" className={styles.avatarImage} />
            ) : (
              <div className={styles.avatarFallback} aria-hidden="true">{relationInitial(profile)}</div>
            )}
          </button>
        ) : (
          <>
            {profile.profile_picture_url ? (
              <img src={profile.profile_picture_url} alt="" className={styles.avatarImage} />
            ) : (
              <div className={styles.avatarFallback} aria-hidden="true">{relationInitial(profile)}</div>
            )}
          </>
        )}
        <div className={styles.identityCopy}>
          <div className={styles.eyebrow}>{isSelf ? "Your Public Profile" : "Public Profile"}</div>
          <h1 className={styles.title}>
            <span className={styles.usernameText}>{profile.username}</span>
            {profile.email_verified ? (
              <span className={styles.verifiedBadge} title="User is verified" aria-label="User is verified">
                <FaCheck aria-hidden="true" />
              </span>
            ) : null}
          </h1>
          <div className={styles.profileBadgeStack}>
            <span className={styles.profileBadge}>Joined {formatDate(profile.created_at)}</span>
            {profile.oshi_coin ? (
              <span className={styles.profileBadge}>
                <AssetCoin
                  symbol={profile.oshi_coin.symbol}
                  icon={profile.oshi_coin.icon}
                  color={profile.oshi_coin.color}
                  className={styles.titleOshiCoin}
                  shape="circle"
                />
                <span>Oshi coin:</span>
                <strong>{profile.oshi_coin.symbol}</strong>
              </span>
            ) : null}
          </div>
          <div className={styles.profileMetaBadgeRow}>
            {profile.rank > 0 ? <span className={styles.profileBadge}>Rank #{profile.rank}</span> : null}
            <span className={styles.profileBadge}>
              <FaFire aria-hidden="true" className={styles.profileBadgeIcon} />
              <span>{currentStreakDays > 0 ? `${currentStreakDays} day streak` : "No active streak"}</span>
            </span>
          </div>
          {profile.bio ? <p className={styles.bio}>{profile.bio}</p> : null}
          {isSelf ? (
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={onLogout} disabled={logoutBusy}>
                {logoutBusy ? "Logging out…" : "Log out"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ProfileSettingsModal({
  open,
  profile,
  assets,
  onClose,
  onSave,
}: {
  open: boolean;
  profile: ProfileBundle["profile"] | null;
  assets: ReturnType<typeof useMarketStore.getState>["assets"];
  onClose: () => void;
  onSave: (payload: { username: string; bio: string; profile_color: string | null; oshi_coin_asset_id: number | null }) => Promise<void>;
}) {
  const [usernameDraft, setUsernameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [profileColorDraft, setProfileColorDraft] = useState("#1aacbc");
  const [oshiSymbolDraft, setOshiSymbolDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !profile) return;
    setUsernameDraft(profile.username || "");
    setBioDraft(profile.bio || "");
    setProfileColorDraft(profile.profile_color || "#1aacbc");
    setOshiSymbolDraft(profile.oshi_coin?.symbol || "");
    setError(null);
    setBusy(false);
  }, [open, profile]);

  if (!open || !profile) return null;

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const selectedAsset = assets.find((asset) => asset.symbol === oshiSymbolDraft) || null;
      await onSave({
        username: usernameDraft,
        bio: bioDraft,
        profile_color: profileColorDraft || null,
        oshi_coin_asset_id: selectedAsset?.id || null,
      });
      onClose();
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.profilePictureOverlay} onClick={onClose}>
      <div
        className={styles.profilePictureModal}
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.profilePictureModalHead}>
          <div>
            <div className={styles.eyebrow}>Profile Settings</div>
            <h2 className={styles.sectionTitle}>Edit Your Profile</h2>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.settingsGrid}>
          <div className={styles.fieldStack}>
            <label className={styles.fieldLabel} htmlFor="profile-username">Username</label>
            <input
              id="profile-username"
              className={styles.input}
              maxLength={32}
              value={usernameDraft}
              onChange={(event) => setUsernameDraft(event.target.value)}
              placeholder="Username"
            />
            <span className={styles.sectionCount}>Letters, numbers, and underscores. 3-32 characters.</span>
          </div>
          <div className={styles.fieldStack}>
            <label className={styles.fieldLabel} htmlFor="profile-bio">Bio</label>
            <textarea
              id="profile-bio"
              className={styles.textarea}
              maxLength={250}
              value={bioDraft}
              onChange={(event) => setBioDraft(event.target.value)}
              placeholder="Tell other traders what matters to you."
            />
            <span className={styles.sectionCount}>{bioDraft.length}/250</span>
          </div>
          <div className={styles.settingsSide}>
            <div className={styles.fieldStack}>
              <label className={styles.fieldLabel} htmlFor="profile-color">Profile color</label>
              <div className={styles.colorRow}>
                <input
                  id="profile-color"
                  className={styles.colorInput}
                  type="color"
                  defaultValue={profile.profile_color || "#1aacbc"}
                  onInput={(event) => setProfileColorDraft((event.target as HTMLInputElement).value)}
                />
                <span className={styles.colorValue}>{profileColorDraft}</span>
              </div>
            </div>
            <div className={styles.fieldStack}>
              <label className={styles.fieldLabel}>Oshi coin</label>
              <AssetPicker
                assets={assets}
                value={oshiSymbolDraft}
                onChange={setOshiSymbolDraft}
                placeholder="Select oshi coin"
                emptyLabel="No oshi coin"
              />
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={handleSave}>
                {busy ? "Saving…" : "Save profile"}
              </button>
            </div>
            {error ? <div className="statusMessage statusMessageError">{error}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileStatCard({
  label,
  value,
  emphasis = "default",
  tone,
  showTrend = false,
  iconPosition = "left",
  icon,
}: {
  label: string;
  value: string;
  emphasis?: "default" | "hero";
  tone?: number | null | undefined;
  showTrend?: boolean;
  iconPosition?: "left" | "right";
  icon?: ReactNode;
}) {
  return (
    <article className={[styles.summaryCard, emphasis === "hero" ? styles.summaryCardHero : ""].filter(Boolean).join(" ")}>
      <span className={styles.summaryLabel}>{label}</span>
      {showTrend ? (
        <TrendValue value={value} toneFrom={tone} iconPosition={iconPosition} icon={icon} />
      ) : (
        <strong className={styles.summaryValue}>
          <span className={styles.numericValue}>{value}</span>
          {icon}
        </strong>
      )}
    </article>
  );
}

function RelationList({
  title,
  emptyLabel,
  people,
}: {
  title: string;
  emptyLabel: string;
  people: ProfileRelationUser[];
}) {
  return (
    <section className={styles.sectionPanel}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <span className={styles.sectionCount}>{people.length}</span>
      </div>
      {people.length ? (
        <div className={styles.peopleGrid}>
          {people.map((person) => (
            <Link key={person.id} href={`/profile/${encodeURIComponent(person.username)}`} className={styles.personCard}>
              {person.profile_picture_url ? (
                <img src={person.profile_picture_url} alt="" className={styles.personAvatarImage} />
              ) : (
                <div className={styles.personAvatar} aria-hidden="true">{relationInitial(person)}</div>
              )}
              <div className={styles.personBody}>
                <strong>{person.username}</strong>
                <span className={styles.muted}>{person.created_at ? `Requested ${formatDate(person.created_at)}` : "View profile"}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.empty}> {emptyLabel} </div>
      )}
    </section>
  );
}

function ArticleCard({ article }: { article: ArticleSummary }) {
  return (
    <Link href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.articleCard}>
      <div className={styles.articleMeta}>
        <span className={styles.pill}>{article.is_news ? "News" : "Article"}</span>
        <span className={styles.muted}>{formatDate(article.published_at)}</span>
      </div>
      <h3>{article.title}</h3>
      <p>{article.subtitle || article.preview || "No summary provided."}</p>
      <div className={styles.articleFooter}>
        <span>{article.likes} likes</span>
        <span>{article.saves} saves</span>
        <span>{article.comment_count} comments</span>
      </div>
    </Link>
  );
}

function ArticleShelf({
  mine,
  saved,
  activeTab,
  isLoading,
  onTabChange,
  onMinePageChange,
  onSavedPageChange,
}: {
  mine: ProfileBundle["articles"];
  saved: ProfileBundle["saved_articles"];
  activeTab: "mine" | "saved";
  isLoading: boolean;
  onTabChange: (tab: "mine" | "saved") => void;
  onMinePageChange: (updater: (current: number) => number) => void;
  onSavedPageChange: (updater: (current: number) => number) => void;
}) {
  const canShowSaved = Boolean(saved);
  const resolvedTab = activeTab === "saved" && canShowSaved ? "saved" : "mine";
  const activeList = resolvedTab === "saved" && saved ? saved : mine;
  const isSaved = resolvedTab === "saved";

  return (
    <section className={[styles.sectionPanel, styles.articleShelf].join(" ")}>
      <div className={styles.articleShelfHead}>
        <div>
          <h2 className={styles.sectionTitle}>Articles</h2>
          <span className={styles.sectionCount}>Page {activeList.pagination.page} of {activeList.pagination.page_count}</span>
        </div>
        <div className={styles.tabList} role="tablist" aria-label="Profile articles">
          <button
            type="button"
            className={[styles.tabButton, resolvedTab === "mine" ? styles.tabButtonActive : ""].filter(Boolean).join(" ")}
            role="tab"
            aria-selected={resolvedTab === "mine"}
            onClick={() => onTabChange("mine")}
          >
            Mine
          </button>
          {canShowSaved ? (
            <button
              type="button"
              className={[styles.tabButton, resolvedTab === "saved" ? styles.tabButtonActive : ""].filter(Boolean).join(" ")}
              role="tab"
              aria-selected={resolvedTab === "saved"}
              onClick={() => onTabChange("saved")}
            >
              Saved
            </button>
          ) : null}
        </div>
      </div>

      {activeList.items.length ? (
        <div className={styles.articleShelfGrid}>
          {activeList.items.map((article) => <ArticleCard key={article.id} article={article} />)}
        </div>
      ) : (
        <div className={styles.empty}>{isSaved ? "No saved articles yet." : "No published articles yet."}</div>
      )}
      <div className={styles.paginationCompact}>
        <button
          type="button"
          className={styles.smallPaginationButton}
          disabled={!activeList.pagination.has_previous_page || isLoading}
          onClick={() => (isSaved ? onSavedPageChange : onMinePageChange)((current) => Math.max(1, current - 1))}
        >
          Previous
        </button>
        <span className={styles.muted}>Page {activeList.pagination.page} of {activeList.pagination.page_count}</span>
        <button
          type="button"
          className={styles.smallPaginationButton}
          disabled={!activeList.pagination.has_next_page || isLoading}
          onClick={() => (isSaved ? onSavedPageChange : onMinePageChange)((current) => current + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}

function TradeList({
  trades,
  assets,
}: {
  trades: ProfileBundle["trades"]["items"];
  assets: ReturnType<typeof useMarketStore.getState>["assets"];
}) {
  return (
    <div className={styles.tradeList}>
      {trades.map((trade) => {
        const asset = assets.find((item) => item.symbol === trade.symbol) || null;
        const isBuy = trade.side.toLowerCase() === "buy";
        return (
          <article key={trade.id} className={styles.tradeRow}>
            <div className={styles.tradeAsset}>
              <AssetCoin
                symbol={trade.symbol}
                icon={asset?.icon ?? null}
                color={asset?.color ?? null}
                className={styles.inlineAssetIcon}
                shape="circle"
              />
              <div className={styles.tradeAssetCopy}>
                <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`} className={styles.tradeAssetLink}>
                  {trade.symbol}
                </Link>
                <span>{trade.display_name || formatDateTime(trade.ts)}</span>
              </div>
            </div>
            <div>
              <span className={[styles.sideBadge, isBuy ? styles.sideBadgeBuy : styles.sideBadgeSell].join(" ")}>
                {trade.side.toUpperCase()}
              </span>
            </div>
            <div className={styles.tradeMetrics}>
              <strong className={styles.numericValue}>{fmtNumber(trade.quantity)} @ {fmtNumber(trade.price, "$")}</strong>
              <span className={styles.numericValue}>Gross {fmtNumber(trade.gross_cash, "$")}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AchievementBadgeList({
  achievements,
  emptyLabel,
  defaultOpen = false,
}: {
  achievements: ProfileBundle["profile"]["achievements"];
  emptyLabel: string;
  defaultOpen?: boolean;
}) {
  return (
    <section className={[styles.sectionPanel, styles.achievementPanel].join(" ")}>
      <details className={styles.achievementDisclosure} open={defaultOpen}>
        <summary className={styles.achievementSummary}>
          <div>
            <h2 className={styles.sectionTitle}>Milestones</h2>
            <span className={styles.sectionCount}>{achievements.length} earned badges</span>
          </div>
          <strong className={styles.disclosureCue}>Toggle</strong>
        </summary>
        {achievements.length ? (
          <div className={styles.achievementGrid}>
            {achievements.map((achievement) => {
              const AchievementIcon = achievementIconFor(achievement);
              return (
                <article
                  key={`${achievement.key}:${achievement.earned_at || "earned"}`}
                  className={styles.achievementCard}
                  style={achievement.badge_color ? ({ "--achievement-accent": achievement.badge_color } as CSSProperties) : undefined}
                >
                  <div className={styles.achievementIconBadge} aria-hidden="true">
                    <AchievementIcon />
                  </div>
                  <div className={styles.achievementTop}>
                    <strong>{achievement.name}</strong>
                    {achievement.reward_cash > 0 ? <span className={styles.achievementReward}>+{fmtNumber(achievement.reward_cash, "$")}</span> : null}
                  </div>
                  {achievement.description ? <p className={styles.achievementDescription}>{achievement.description}</p> : null}
                  <div className={styles.achievementMeta}>
                    <span>{achievement.earned_at ? `Earned ${formatDate(achievement.earned_at)}` : "Earned"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>{emptyLabel}</div>
        )}
      </details>
    </section>
  );
}

function HoldingsTable({
  holdings,
  assets,
  totalEquity,
}: {
  holdings: ProfileBundle["profile"]["holdings"];
  assets: ReturnType<typeof useMarketStore.getState>["assets"];
  totalEquity: number;
}) {
  const router = useRouter();

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Qty</th>
            <th>Avg Cost</th>
            <th>Mid</th>
            <th>Value</th>
            <th>%</th>
            <th>PnL</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const asset = assets.find((item) => item.symbol === holding.symbol) || null;
            const weight = totalEquity > 0 ? (holding.market_value / totalEquity) * 100 : null;
            const href = `/stocks/${encodeURIComponent(holding.symbol)}`;
            return (
              <tr
                key={holding.asset_id}
                className={styles.holdingRow}
                tabIndex={0}
                role="link"
                onClick={() => router.push(href)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(href);
                  }
                }}
              >
                <td>
                  <Link
                    href={href}
                    className={styles.holdingAssetLink}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className={styles.holdingAsset}>
                      <AssetCoin
                        symbol={holding.symbol}
                        icon={asset?.icon ?? null}
                        color={asset?.color ?? null}
                        className={styles.inlineAssetIcon}
                        shape="circle"
                      />
                      <div className={styles.holdingAssetCopy}>
                        <strong>{holding.symbol}</strong>
                        <span>{holding.display_name}</span>
                      </div>
                    </div>
                  </Link>
                </td>
                <td className={styles.numericCell}>{fmtNumber(holding.quantity)}</td>
                <td className={styles.numericCell}>{fmtNumber(holding.avg_cost_basis, "$")}</td>
                <td className={styles.numericCell}>{fmtNumber(holding.current_mid_price, "$")}</td>
                <td className={styles.numericCell}>{fmtNumber(holding.market_value, "$")}</td>
                <td className={styles.numericCell}>{weight === null ? "—" : `${weight.toFixed(1)}%`}</td>
                <td className={[styles.numericCell, valueToneClass(holding.unrealized_pnl)].filter(Boolean).join(" ")}>{formatSignedCurrency(holding.unrealized_pnl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PredictionExposurePanel({ portfolio }: { portfolio: PredictionPortfolioResponse | null }) {
  const positions = portfolio?.positions || [];
  const openOrders = portfolio?.open_orders || [];

  return (
    <section className={styles.sectionPanel}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Prediction Exposure</h2>
        <span className={styles.sectionCount}>{positions.length} positions · {openOrders.length} orders</span>
      </div>
      {positions.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Market</th>
                <th>Outcome</th>
                <th>Shares</th>
                <th>Avg</th>
                <th>PnL</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={`${position.market_id}-${position.outcome_id}`} className={styles.holdingRow}>
                  <td>
                    <Link href={`/predictions/${encodeURIComponent(position.slug)}`} className={styles.holdingAssetLink}>
                      <div className={styles.holdingAssetCopy}>
                        <strong>{position.title}</strong>
                        <span>{position.slug}</span>
                      </div>
                    </Link>
                  </td>
                  <td>{position.outcome_label}</td>
                  <td className={styles.numericCell}>{fmtNumber(position.shares)}</td>
                  <td className={styles.numericCell}>{(position.avg_entry_price * 100).toFixed(1)}c</td>
                  <td className={[styles.numericCell, valueToneClass(position.realized_pnl_cash)].filter(Boolean).join(" ")}>
                    {formatSignedCurrency(position.realized_pnl_cash)}
                  </td>
                  <td>{position.status.replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>No prediction positions yet.</div>
      )}
      {openOrders.length ? (
        <p className={styles.muted}>
          {openOrders.length} open prediction order{openOrders.length === 1 ? "" : "s"} reserve {fmtNumber(openOrders.reduce((sum, order) => sum + order.cash_reserved, 0), "$")} cash.
        </p>
      ) : null}
    </section>
  );
}

export function ProfilePage({ username }: { username?: string | null }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const adminBusy = useProfileStore((state) => state.adminBusy);
  const adminStatus = useProfileStore((state) => state.adminStatus);
  const adminError = useProfileStore((state) => state.adminError);
  const resetMarket = useProfileStore((state) => state.resetMarket);
  const rebuildMarket = useProfileStore((state) => state.rebuildMarket);
  const refreshMarketOverview = useMarketStore((state) => state.refreshOverview);
  const assets = useMarketStore((state) => state.assets);

  const [bundle, setBundle] = useState<ProfileBundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [articlesPage, setArticlesPage] = useState(1);
  const [savedArticlesPage, setSavedArticlesPage] = useState(1);
  const [articleShelfTab, setArticleShelfTab] = useState<"mine" | "saved">("mine");
  const [tradesPage, setTradesPage] = useState(1);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [profilePictures, setProfilePictures] = useState<SelectableProfilePicture[]>([]);
  const [profilePictureBusy, setProfilePictureBusy] = useState<number | "none" | null>(null);
  const [isProfilePictureModalOpen, setIsProfilePictureModalOpen] = useState(false);
  const [isProfileSettingsModalOpen, setIsProfileSettingsModalOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [predictionPortfolio, setPredictionPortfolio] = useState<PredictionPortfolioResponse | null>(null);

  function baseProfilePath() {
    return username
      ? `/api/profiles/${encodeURIComponent(username)}`
      : "/api/profiles/me";
  }

  useEffect(() => {
    setArticlesPage(1);
    setSavedArticlesPage(1);
    setArticleShelfTab("mine");
    setTradesPage(1);
  }, [username]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProfile() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("articles_page", "1");
        params.set("articles_limit", "6");
        params.set("saved_articles_page", "1");
        params.set("saved_articles_limit", "6");
        params.set("trades_page", "1");
        params.set("trades_limit", "10");
        const path = `${baseProfilePath()}?${params.toString()}`;
        const result = await apiFetch<Record<string, unknown>>(path, { signal: controller.signal });
        setBundle(normalizeProfileBundle(result));
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setBundle(null);
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadProfile();
    return () => controller.abort();
  }, [username]);

  useEffect(() => {
    if (username) return;
    const controller = new AbortController();

    async function loadProfilePictures() {
      try {
        const result = await apiFetch<{ profile_pictures: Array<Record<string, unknown>> }>("/api/assets/profile-pictures", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setProfilePictures(
          (result.profile_pictures || []).map((item) => ({
            id: Number(item.id || 0),
            name: String(item.name || ""),
            url_large: String(item.url_large || ""),
            url_small: String(item.url_small || ""),
          })).filter((item) => item.id > 0 && item.url_large && item.url_small)
        );
      } catch {}
    }

    void loadProfilePictures();
    return () => controller.abort();
  }, [username]);

  useEffect(() => {
    if (username || !user) {
      setPredictionPortfolio(null);
      return;
    }
    const controller = new AbortController();

    async function loadPredictionPortfolio() {
      try {
        const result = await apiFetch<Record<string, unknown>>("/api/portfolio/me/predictions", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setPredictionPortfolio(normalizePredictionPortfolioResponse(result));
        }
      } catch {
        if (!controller.signal.aborted) setPredictionPortfolio(null);
      }
    }

    void loadPredictionPortfolio();
    return () => controller.abort();
  }, [username, user]);

  useEffect(() => {
    if (!bundle || bundle.articles.pagination.page === articlesPage) return;
    const controller = new AbortController();

    async function loadArticlesPage() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(articlesPage));
        params.set("limit", "6");
        const result = await apiFetch<Record<string, unknown>>(`${baseProfilePath()}/articles?${params.toString()}`, {
          signal: controller.signal,
        });
        const articles = normalizeArticleListResponse(result);
        if (!controller.signal.aborted) {
          setBundle((current) => current ? { ...current, articles } : current);
        }
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadArticlesPage();
    return () => controller.abort();
  }, [articlesPage, bundle, username]);

  useEffect(() => {
    if (!bundle?.saved_articles || bundle.saved_articles.pagination.page === savedArticlesPage) return;
    const controller = new AbortController();

    async function loadSavedArticlesPage() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(savedArticlesPage));
        params.set("limit", "6");
        const result = await apiFetch<Record<string, unknown>>(`/api/profiles/me/saved-articles?${params.toString()}`, {
          signal: controller.signal,
        });
        const savedArticles = normalizeArticleListResponse(result);
        if (!controller.signal.aborted) {
          setBundle((current) => current ? { ...current, saved_articles: savedArticles } : current);
        }
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadSavedArticlesPage();
    return () => controller.abort();
  }, [savedArticlesPage, bundle]);

  useEffect(() => {
    if (!bundle || bundle.trades.pagination.page === tradesPage) return;
    const controller = new AbortController();

    async function loadTradesPage() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(tradesPage));
        params.set("limit", "10");
        const result = await apiFetch<ProfileBundle["trades"]>(`${baseProfilePath()}/trades?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setBundle((current) => current ? { ...current, trades: result } : current);
        }
      } catch (nextError) {
        if ((nextError as Error).name === "AbortError") return;
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadTradesPage();
    return () => controller.abort();
  }, [bundle, tradesPage, username]);

  async function reloadBundle() {
    const params = new URLSearchParams();
    params.set("articles_page", "1");
    params.set("articles_limit", "6");
    params.set("saved_articles_page", "1");
    params.set("saved_articles_limit", "6");
    params.set("trades_page", "1");
    params.set("trades_limit", "10");
    const path = `${baseProfilePath()}?${params.toString()}`;
    const result = await apiFetch<Record<string, unknown>>(path);
    setBundle(normalizeProfileBundle(result));
  }

  async function handleProfileAction(action: "friend" | "accept" | "removeFriend" | "toggleRival", active?: boolean) {
    if (!username) return;
    setActionBusy(action);
    setError(null);
    try {
      let result: Record<string, unknown>;
      if (action === "friend") {
        result = await apiFetch<Record<string, unknown>>(`/api/profiles/${encodeURIComponent(username)}/friend-request`, {
          method: "POST",
          body: "{}",
        });
      } else if (action === "accept") {
        result = await apiFetch<Record<string, unknown>>(`/api/profiles/${encodeURIComponent(username)}/friend-request/accept`, {
          method: "POST",
          body: "{}",
        });
      } else if (action === "removeFriend") {
        result = await apiFetch<Record<string, unknown>>(`/api/profiles/${encodeURIComponent(username)}/friendship`, {
          method: "DELETE",
        });
      } else {
        result = await apiFetch<Record<string, unknown>>(`/api/profiles/${encodeURIComponent(username)}/rival`, {
          method: "PUT",
          body: JSON.stringify({ active }),
        });
      }
      setBundle(normalizeProfileBundle(result));
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleReset() {
    await resetMarket();
    await Promise.allSettled([reloadBundle(), refreshMarketOverview()]);
  }

  async function handleRebuild() {
    await rebuildMarket();
    await Promise.allSettled([reloadBundle(), refreshMarketOverview()]);
  }

  async function handleSelectProfilePicture(profilePictureId: number | null) {
    setProfilePictureBusy(profilePictureId === null ? "none" : profilePictureId);
    setError(null);
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/profiles/me/profile-picture", {
        method: "PUT",
        body: JSON.stringify({ profile_picture_id: profilePictureId }),
      });
      setBundle(normalizeProfileBundle(result));
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setProfilePictureBusy(null);
    }
  }

  async function handleLogout() {
    setLogoutBusy(true);
    setError(null);
    try {
      await logout();
      setBundle(null);
      router.replace("/");
      router.refresh();
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setLogoutBusy(false);
    }
  }

  const profile = bundle?.profile || null;
  const viewer = bundle?.viewer_context || null;
  const isSelf = Boolean(viewer?.is_self);
  const needsVerification = isSelf && userNeedsEmailVerification(user);
  const selectedProfilePictureId = detectSelectedProfilePictureId(profile?.profile_picture_url || null, profilePictures);
  const accentColor = profile?.profile_color || profile?.oshi_coin?.color || "var(--accent)";
  const networthDelta = useMemo(() => {
    if (!profile?.networth_history?.length) return null;
    const first = profile.networth_history[0]?.total_equity ?? null;
    const last = profile.networth_history[profile.networth_history.length - 1]?.total_equity ?? null;
    if (first === null || last === null) return null;
    return last - first;
  }, [profile?.networth_history]);
  const holdingsSorted = useMemo(
    () => [...(profile?.holdings || [])].sort((a, b) => b.quantity - a.quantity),
    [profile?.holdings]
  );
  const holdingsWeightPct = profile && profile.stats.total_equity > 0
    ? Math.max(0, Math.min(100, (profile.stats.total_market_value / profile.stats.total_equity) * 100))
    : 0;
  const cashWeightPct = Math.max(0, 100 - holdingsWeightPct);
  const topHolding = holdingsSorted[0] || null;
  const topHoldingWeightPct = topHolding && profile && profile.stats.total_equity > 0
    ? (topHolding.market_value / profile.stats.total_equity) * 100
    : null;

  const chartTheme = useMemo(
    () => createChannelChartTheme(profile?.profile_color || profile?.oshi_coin?.color || null),
    [profile?.oshi_coin?.color, profile?.profile_color]
  );
  const networthSeries = useMemo(() => ([
    {
      name: "Net Worth",
      color: chartTheme.baseDeep,
      kind: "area" as const,
      values: (profile?.networth_history || []).map((point) => ({
        time: point.recorded_at,
        value: point.total_equity,
      })),
    },
    {
      name: "Cash",
      color: chartTheme.complement,
      kind: "line" as const,
      values: (profile?.networth_history || []).map((point) => ({
        time: point.recorded_at,
        value: point.cash_balance,
      })),
    },
  ]), [chartTheme.baseDeep, chartTheme.complement, profile?.networth_history]);

  return (
    <SiteShell>
      {!username && error === "unauthenticated" ? (
        <section className={styles.sectionPanel}>
          <h1 className={styles.sectionTitle}>Profile</h1>
          <div className={styles.empty}>
            You need an authenticated session to view your own profile. <Link href="/login">Login</Link> or <Link href="/register">register</Link>.
          </div>
        </section>
      ) : (
        <>
        <div className={styles.page}>
          {error && error !== "unauthenticated" ? <div className="statusMessage statusMessageError">Profile error: {error}</div> : null}
          {isLoading && !bundle ? <div className={styles.sectionPanel}>Loading profile…</div> : null}
          {!isLoading && !bundle && error === "profile_not_found" ? <div className={styles.sectionPanel}>That profile does not exist.</div> : null}

          {bundle && profile && viewer ? (
            <>
              <section
                className={styles.traderHero}
                style={{ "--profile-accent": accentColor, "--holdings-weight": `${holdingsWeightPct}%`, "--cash-weight": `${cashWeightPct}%` } as CSSProperties}
              >
                <div className={styles.heroVisual} aria-hidden="true" />
                <div className={styles.traderIdentitySlot}>
                  <ProfileIdentity
                    profile={profile}
                    isSelf={isSelf}
                    onOpenProfilePicturePicker={() => setIsProfilePictureModalOpen(true)}
                    onOpenProfileSettings={() => setIsProfileSettingsModalOpen(true)}
                    onLogout={() => void handleLogout()}
                    logoutBusy={logoutBusy}
                  />
                </div>

                <div className={styles.traderBriefing}>
                  <div>
                    <div className={styles.heroEyebrow}>User Profile</div>
                    <h2 className={styles.heroTitle}>Trade Desk</h2>
                    <p className={styles.heroText}>
                      {`Live profile, trading posture, and equity curve.`}
                    </p>
                  </div>
                  <div className={styles.deskMetaRow}>
                    {profile.rank > 0 ? <span>Rank #{profile.rank}</span> : null}
                    <span>{profile.stats.trade_count} trades</span>
                    <span>{holdingsSorted.length} holdings</span>
                    <span>{profile.streaks.current_streak_days > 0 ? `${profile.streaks.current_streak_days} day streak` : "No active streak"}</span>
                  </div>
                  <div className={styles.summaryGrid}>
                    <ProfileStatCard
                      label="Net worth"
                      value={fmtNumber(profile.stats.total_equity, "$")}
                      emphasis="hero"
                      tone={networthDelta}
                      showTrend
                      iconPosition="right"
                    />
                    <ProfileStatCard
                      label="Cash"
                      value={fmtNumber(profile.stats.cash_balance, "$")}
                      icon={<FaMoneyBillWave aria-hidden="true" />}
                    />
                    <ProfileStatCard
                      label="Unrealized PnL"
                      value={formatSignedCurrency(profile.stats.total_unrealized_pnl)}
                      tone={profile.stats.total_unrealized_pnl}
                      showTrend
                      iconPosition="right"
                    />
                  </div>
                  <div className={styles.deskReadoutGrid}>
                    <article className={styles.deskReadout}>
                      <span>Portfolio exposure</span>
                      <strong className={styles.numericValue}>{holdingsWeightPct.toFixed(1)}%</strong>
                    </article>
                    <article className={styles.deskReadout}>
                      <span>Largest position</span>
                      <strong className={styles.numericValue}>
                        {topHolding ? `${topHolding.symbol} ${topHoldingWeightPct === null ? "" : `${topHoldingWeightPct.toFixed(1)}%`}` : "—"}
                      </strong>
                    </article>
                    <article className={styles.deskReadout}>
                      <span>Social signal</span>
                      <strong className={styles.numericValue}>{profile.stats.friend_count}F / {profile.stats.rival_count}R</strong>
                    </article>
                  </div>
                </div>

                <div className={styles.heroChartDock}>
                  <div className={styles.allocationPanel}>
                    <div className={styles.allocationRow}>
                      <span>Holdings <strong className={styles.numericValue}>{holdingsWeightPct.toFixed(1)}%</strong></span>
                      <span><strong className={styles.numericValue}>{cashWeightPct.toFixed(1)}%</strong> Cash</span>
                    </div>
                    <div className={styles.allocationBar} aria-hidden="true">
                      <span className={styles.allocationHoldings} />
                      <span className={styles.allocationCash} />
                    </div>
                  </div>
                  <TrendChartCard
                    title="Net Worth"
                    subtitle="Tracked snapshots of equity and cash over time"
                    series={networthSeries}
                    theme={chartTheme}
                    bare
                  />
                </div>
              </section>

              <div className={styles.profileLayout}>
                <div className={styles.leftColumn}>
                  {needsVerification ? (
                    <VerificationRequiredNotice action="trade, post, comment, vote, or write articles" />
                  ) : null}

                  {!viewer.is_self ? (
                    <section className={styles.sectionPanel}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>Connect</h2>
                        <span className={styles.sectionCount}>{viewer.is_authenticated ? "Live" : "Sign in required"}</span>
                      </div>
                      <div className={styles.actions}>
                        {viewer.friendship_status === "none" ? (
                          <button type="button" className={styles.primaryButton} disabled={actionBusy !== null || !viewer.is_authenticated} onClick={() => void handleProfileAction("friend")}>
                            {actionBusy === "friend" ? "Sending…" : "Send friend request"}
                          </button>
                        ) : null}
                        {viewer.friendship_status === "pending_incoming" ? (
                          <button type="button" className={styles.primaryButton} disabled={actionBusy !== null} onClick={() => void handleProfileAction("accept")}>
                            {actionBusy === "accept" ? "Accepting…" : "Accept friend request"}
                          </button>
                        ) : null}
                        {viewer.friendship_status === "accepted" || viewer.friendship_status === "pending_outgoing" || viewer.friendship_status === "pending_incoming" ? (
                          <button type="button" className={styles.secondaryButton} disabled={actionBusy !== null} onClick={() => void handleProfileAction("removeFriend")}>
                            {actionBusy === "removeFriend" ? "Updating…" : viewer.friendship_status === "accepted" ? "Remove friend" : "Clear request"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          disabled={actionBusy !== null || !viewer.is_authenticated}
                          onClick={() => void handleProfileAction("toggleRival", !viewer.is_rival)}
                        >
                          {actionBusy === "toggleRival" ? "Updating…" : viewer.is_rival ? "Remove rival" : "Mark rival"}
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {isSelf && profile.pending_friend_requests ? (
                    <>
                      <RelationList title="Incoming Requests" emptyLabel="No incoming friend requests." people={profile.pending_friend_requests.incoming} />
                      <RelationList title="Outgoing Requests" emptyLabel="No outgoing friend requests." people={profile.pending_friend_requests.outgoing} />
                    </>
                  ) : null}

                  <section className={styles.sectionPanel}>
                    <div className={styles.sectionHead}>
                      <h2 className={styles.sectionTitle}>Recent Trades</h2>
                      <span className={styles.sectionCount}>Page {bundle.trades.pagination.page} of {bundle.trades.pagination.page_count}</span>
                    </div>
                    {bundle.trades.items.length ? (
                      <TradeList trades={bundle.trades.items} assets={assets} />
                    ) : (
                      <div className={styles.empty}>No trades have been recorded yet.</div>
                    )}
                    <div className={styles.paginationCompact}>
                      <button type="button" className={styles.smallPaginationButton} disabled={!bundle.trades.pagination.has_previous_page || isLoading} onClick={() => setTradesPage((current) => Math.max(1, current - 1))}>Previous</button>
                      <span className={styles.muted}>Page {bundle.trades.pagination.page} of {bundle.trades.pagination.page_count}</span>
                      <button type="button" className={styles.smallPaginationButton} disabled={!bundle.trades.pagination.has_next_page || isLoading} onClick={() => setTradesPage((current) => current + 1)}>Next</button>
                    </div>
                  </section>
                </div>

                <div className={styles.centerColumn}>
                  {isSelf ? (
                    <>
                      <section className={styles.sectionPanel}>
                        <div className={styles.sectionHead}>
                          <h2 className={styles.sectionTitle}>Holdings</h2>
                          <span className={styles.sectionCount}>{holdingsSorted.length}</span>
                        </div>
                        {holdingsSorted.length ? (
                          <HoldingsTable holdings={holdingsSorted} assets={assets} totalEquity={profile.stats.total_equity} />
                        ) : (
                          <div className={styles.empty}>You do not hold any positions yet.</div>
                        )}
                      </section>
                      <PredictionExposurePanel portfolio={predictionPortfolio} />
                    </>
                  ) : null}

                  <ArticleShelf
                    mine={bundle.articles}
                    saved={isSelf ? bundle.saved_articles : null}
                    activeTab={articleShelfTab}
                    isLoading={isLoading}
                    onTabChange={setArticleShelfTab}
                    onMinePageChange={setArticlesPage}
                    onSavedPageChange={setSavedArticlesPage}
                  />

                  <AchievementBadgeList
                    achievements={profile.achievements}
                    emptyLabel={isSelf ? "You have not earned any achievements yet." : "No achievements are visible yet."}
                  />
                </div>

                <div className={styles.rightColumn}>
                  <RelationList title="Friends" emptyLabel={isSelf ? "You have no confirmed friends yet." : "No friends are visible yet."} people={profile.friends} />
                  <RelationList title="Rivals" emptyLabel={isSelf ? "You have not marked any rivals yet." : "No rivals are visible yet."} people={profile.rivals} />

                  {isSelf && user?.is_admin ? (
                    <section className={styles.sectionPanel}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>Market Admin</h2>
                      </div>
                      <p className={styles.muted}>Reset clears derived market and portfolio state. Rebuild recalculates assets, fundamentals, and settlement history.</p>
                      <div className={styles.actions}>
                        <Link href="/admin/assets" className={styles.secondaryButton}>Manage assets</Link>
                        <Link href="/admin/market-tuning" className={styles.secondaryButton}>Tune market</Link>
                      </div>
                      <div className={styles.actions}>
                        <button type="button" className={styles.secondaryButton} onClick={() => void handleReset()} disabled={adminBusy !== false}>
                          {adminBusy === "reset" ? "Resetting…" : "Reset market"}
                        </button>
                        <button type="button" className={styles.primaryButton} onClick={() => void handleRebuild()} disabled={adminBusy !== false}>
                          {adminBusy === "rebuild" ? "Rebuilding…" : "Rebuild market"}
                        </button>
                      </div>
                      {adminError ? <div className="statusMessage statusMessageError">Admin error: {adminError}</div> : null}
                      {adminStatus ? <div className="statusMessage statusMessageSuccess">{adminStatus}</div> : null}
                    </section>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
        {bundle && profile && isSelf && isProfilePictureModalOpen ? (
          <div className={styles.profilePictureOverlay} onClick={() => setIsProfilePictureModalOpen(false)}>
            <div
              className={styles.profilePictureModal}
              role="dialog"
              aria-modal="true"
              aria-label="Choose profile picture"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.profilePictureModalHead}>
                <div>
                  <div className={styles.eyebrow}>Profile Picture</div>
                  <h2 className={styles.sectionTitle}>Choose Your Icon</h2>
                </div>
                <button type="button" className={styles.modalCloseButton} onClick={() => setIsProfilePictureModalOpen(false)}>
                  ×
                </button>
              </div>
              <div className={styles.profilePictureModalBody}>
                <button
                  type="button"
                  className={`${styles.profilePictureCircle} ${selectedProfilePictureId === null ? styles.profilePictureCircleActive : ""}`.trim()}
                  onClick={() => void handleSelectProfilePicture(null)}
                  disabled={profilePictureBusy !== null}
                  aria-label="Use letter fallback"
                >
                  <div className={styles.profilePictureFallbackPreview} aria-hidden="true">{relationInitial(profile)}</div>
                </button>
                {profilePictures.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.profilePictureCircle} ${selectedProfilePictureId === item.id ? styles.profilePictureCircleActive : ""}`.trim()}
                    onClick={() => void handleSelectProfilePicture(item.id)}
                    disabled={profilePictureBusy !== null}
                    aria-label={`Choose ${item.name}`}
                  >
                    <img src={item.url_large} alt="" className={styles.profilePicturePreview} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <ProfileSettingsModal
          open={Boolean(bundle && profile && isSelf && isProfileSettingsModalOpen)}
          profile={profile}
          assets={assets}
          onClose={() => setIsProfileSettingsModalOpen(false)}
          onSave={async (payload) => {
            setError(null);
            const result = await apiFetch<Record<string, unknown>>("/api/profiles/me", {
              method: "PUT",
              body: JSON.stringify(payload),
            });
            setBundle(normalizeProfileBundle(result));
            const current = useAuthStore.getState().user;
            if (current) {
              useAuthStore.getState().setUser({ ...current, username: payload.username });
            }
          }}
        />
        </>
      )}
    </SiteShell>
  );
}
