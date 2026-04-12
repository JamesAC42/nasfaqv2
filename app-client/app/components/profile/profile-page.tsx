"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { createChannelChartTheme } from "@/app/lib/chart-theme";
import { fmtNumber } from "@/app/lib/format";
import { normalizeArticleListResponse, normalizeProfileBundle } from "@/app/lib/normalizers";
import type { ArticleSummary, ProfileBundle, ProfileRelationUser } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
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
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
  return (
    <section
      className={styles.identityPanel}
      style={profile.profile_color ? ({ "--profile-accent": profile.profile_color } as CSSProperties) : undefined}
    >
      <div className={styles.identityTop}>
        {isSelf ? (
          <button type="button" className={styles.avatarPickerButton} onClick={onOpenProfilePicturePicker}>
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
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{profile.username}</h1>
            {profile.oshi_coin ? (
              <AssetCoin
                symbol={profile.oshi_coin.symbol}
                icon={profile.oshi_coin.icon}
                color={profile.oshi_coin.color}
                className={styles.titleOshiCoin}
                shape="circle"
              />
            ) : null}
          </div>
          <div className={styles.metaRow}>
            <span>Joined {formatDate(profile.created_at)}</span>
            {profile.oshi_coin ? <span>Oshi coin: {profile.oshi_coin.symbol}</span> : null}
          </div>
          {profile.bio ? <p className={styles.bio}>{profile.bio}</p> : null}
          {isSelf ? (
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={onOpenProfileSettings}>
                Edit profile
              </button>
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
  onSave: (payload: { bio: string; profile_color: string | null; oshi_coin_asset_id: number | null }) => Promise<void>;
}) {
  const [bioDraft, setBioDraft] = useState("");
  const [profileColorDraft, setProfileColorDraft] = useState("#1aacbc");
  const [oshiSymbolDraft, setOshiSymbolDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !profile) return;
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
        <span>{article.comment_count} comments</span>
      </div>
    </Link>
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
  const [tradesPage, setTradesPage] = useState(1);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [profilePictures, setProfilePictures] = useState<SelectableProfilePicture[]>([]);
  const [profilePictureBusy, setProfilePictureBusy] = useState<number | "none" | null>(null);
  const [isProfilePictureModalOpen, setIsProfilePictureModalOpen] = useState(false);
  const [isProfileSettingsModalOpen, setIsProfileSettingsModalOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  function baseProfilePath() {
    return username
      ? `/api/profiles/${encodeURIComponent(username)}`
      : "/api/profiles/me";
  }

  useEffect(() => {
    setArticlesPage(1);
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
  const selectedProfilePictureId = detectSelectedProfilePictureId(profile?.profile_picture_url || null, profilePictures);

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
              <div className={styles.topGrid}>
                <ProfileIdentity
                  profile={profile}
                  isSelf={isSelf}
                  onOpenProfilePicturePicker={() => setIsProfilePictureModalOpen(true)}
                  onOpenProfileSettings={() => setIsProfileSettingsModalOpen(true)}
                  onLogout={() => void handleLogout()}
                  logoutBusy={logoutBusy}
                />

                <section className={styles.sectionPanel}>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>Overview</h2>
                    {viewer.is_self ? <span className={styles.sectionCount}>Private extras enabled</span> : null}
                  </div>
                  <div className={styles.statsGrid}>
                    <div className={styles.statCard}><span>Net worth</span><strong>{fmtNumber(profile.stats.total_equity, "$")}</strong></div>
                    <div className={styles.statCard}><span>Cash</span><strong>{fmtNumber(profile.stats.cash_balance, "$")}</strong></div>
                    <div className={styles.statCard}><span>Market value</span><strong>{fmtNumber(profile.stats.total_market_value, "$")}</strong></div>
                    <div className={styles.statCard}><span>Unrealized PnL</span><strong>{formatSignedCurrency(profile.stats.total_unrealized_pnl)}</strong></div>
                    <div className={styles.statCard}><span>Articles</span><strong>{fmtNumber(profile.stats.article_count)}</strong></div>
                    <div className={styles.statCard}><span>Trades</span><strong>{fmtNumber(profile.stats.trade_count)}</strong></div>
                    <div className={styles.statCard}><span>Friends</span><strong>{fmtNumber(profile.stats.friend_count)}</strong></div>
                    <div className={styles.statCard}><span>Rivals</span><strong>{fmtNumber(profile.stats.rival_count)}</strong></div>
                  </div>
                  {!viewer.is_self ? (
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
                  ) : null}
                </section>
              </div>

              <div className={styles.contentGrid}>
                <div className={styles.mainColumn}>
                  <TrendChartCard
                    title="Net Worth"
                    subtitle="Tracked snapshots of equity and cash over time"
                    series={networthSeries}
                    theme={chartTheme}
                  />

                  <section className={styles.sectionPanel}>
                    <div className={styles.sectionHead}>
                      <h2 className={styles.sectionTitle}>Articles</h2>
                      <span className={styles.sectionCount}>Page {bundle.articles.pagination.page} of {bundle.articles.pagination.page_count}</span>
                    </div>
                    {bundle.articles.items.length ? (
                      <div className={styles.articleGrid}>
                        {bundle.articles.items.map((article) => <ArticleCard key={article.id} article={article} />)}
                      </div>
                    ) : (
                      <div className={styles.empty}>No published articles yet.</div>
                    )}
                    <div className={styles.paginationRow}>
                      <button type="button" className={styles.secondaryButton} disabled={!bundle.articles.pagination.has_previous_page || isLoading} onClick={() => setArticlesPage((current) => Math.max(1, current - 1))}>Previous</button>
                      <span className={styles.muted}>{bundle.articles.pagination.total} total</span>
                      <button type="button" className={styles.secondaryButton} disabled={!bundle.articles.pagination.has_next_page || isLoading} onClick={() => setArticlesPage((current) => current + 1)}>Next</button>
                    </div>
                  </section>

                  <section className={styles.sectionPanel}>
                    <div className={styles.sectionHead}>
                      <h2 className={styles.sectionTitle}>Recent Trades</h2>
                      <span className={styles.sectionCount}>Page {bundle.trades.pagination.page} of {bundle.trades.pagination.page_count}</span>
                    </div>
                    {bundle.trades.items.length ? (
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>Asset</th>
                              <th>Side</th>
                              <th>Qty</th>
                              <th>Price</th>
                              <th>Gross</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bundle.trades.items.map((trade) => (
                              <tr key={trade.id}>
                                <td>{formatDateTime(trade.ts)}</td>
                                <td>
                                  <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`}>{trade.symbol}</Link>
                                </td>
                                <td>{trade.side.toUpperCase()}</td>
                                <td>{fmtNumber(trade.quantity)}</td>
                                <td>{fmtNumber(trade.price, "$")}</td>
                                <td>{fmtNumber(trade.gross_cash, "$")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className={styles.empty}>No trades have been recorded yet.</div>
                    )}
                    <div className={styles.paginationRow}>
                      <button type="button" className={styles.secondaryButton} disabled={!bundle.trades.pagination.has_previous_page || isLoading} onClick={() => setTradesPage((current) => Math.max(1, current - 1))}>Previous</button>
                      <span className={styles.muted}>{bundle.trades.pagination.total} total</span>
                      <button type="button" className={styles.secondaryButton} disabled={!bundle.trades.pagination.has_next_page || isLoading} onClick={() => setTradesPage((current) => current + 1)}>Next</button>
                    </div>
                  </section>

                  {isSelf ? (
                    <section className={styles.sectionPanel}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>Holdings</h2>
                        <span className={styles.sectionCount}>{profile.holdings.length}</span>
                      </div>
                      {profile.holdings.length ? (
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>Symbol</th>
                                <th>Qty</th>
                                <th>Avg Cost</th>
                                <th>Mid</th>
                                <th>Value</th>
                                <th>PnL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {profile.holdings.map((holding) => (
                                <tr key={holding.asset_id}>
                                  <td>{holding.symbol}</td>
                                  <td>{fmtNumber(holding.quantity)}</td>
                                  <td>{fmtNumber(holding.avg_cost_basis, "$")}</td>
                                  <td>{fmtNumber(holding.current_mid_price, "$")}</td>
                                  <td>{fmtNumber(holding.market_value, "$")}</td>
                                  <td>{formatSignedCurrency(holding.unrealized_pnl)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className={styles.empty}>You do not hold any positions yet.</div>
                      )}
                    </section>
                  ) : null}
                </div>

                <div className={styles.sideColumn}>
                  <RelationList title="Friends" emptyLabel={isSelf ? "You have no confirmed friends yet." : "No friends are visible yet."} people={profile.friends} />
                  <RelationList title="Rivals" emptyLabel={isSelf ? "You have not marked any rivals yet." : "No rivals are visible yet."} people={profile.rivals} />

                  {isSelf && profile.pending_friend_requests ? (
                    <>
                      <RelationList title="Incoming Requests" emptyLabel="No incoming friend requests." people={profile.pending_friend_requests.incoming} />
                      <RelationList title="Outgoing Requests" emptyLabel="No outgoing friend requests." people={profile.pending_friend_requests.outgoing} />
                    </>
                  ) : null}

                  {isSelf && user?.is_admin ? (
                    <section className={styles.sectionPanel}>
                      <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>Market Admin</h2>
                      </div>
                      <p className={styles.muted}>Reset clears derived market and portfolio state. Rebuild recalculates assets, fundamentals, and settlement history.</p>
                      <div className={styles.actions}>
                        <Link href="/admin/assets" className={styles.secondaryButton}>Manage assets</Link>
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
          }}
        />
        </>
      )}
    </SiteShell>
  );
}
