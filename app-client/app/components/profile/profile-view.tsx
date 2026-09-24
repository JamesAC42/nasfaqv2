"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { PlayerAvatar } from "@/app/components/common/player-avatar";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { PictureModal, SettingsModal } from "@/app/components/profile/profile-modals";
import {
  Achievements,
  Articles,
  Bags,
  FriendsRivals,
  GachaBadges,
  HeadToHead,
  NetworthChart,
  Oshiboards,
  PendingOrders,
  PredictionExposure,
  RecentFills,
} from "@/app/components/profile/profile-sections";
import { apiFetch } from "@/app/lib/api";
import { normalizePredictionPortfolioResponse, normalizeProfileBundle } from "@/app/lib/normalizers";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct, toneOf } from "@/app/lib/time";
import type { PredictionPortfolioResponse, ProfileBundle } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/profile/profile.module.scss";

export const START_CASH = 10_000;
const enc = encodeURIComponent;

/** A player's profile. Without a username it is the signed-in player's own. */
export function ProfileView({ username }: { username?: string | null }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const assets = useMarketStore((state) => state.assets);
  const tradingRevision = useProfileStore((state) => state.tradingRevision);
  const [bundle, setBundle] = useState<ProfileBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<PredictionPortfolioResponse | null>(null);
  const [modal, setModal] = useState<"settings" | "picture" | null>(null);

  const base = username ? `/api/profiles/${enc(username)}` : "/api/profiles/me";
  const revision = username ? 0 : tradingRevision;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ articles_page: "1", articles_limit: "6", saved_articles_page: "1", saved_articles_limit: "6", trades_page: "1", trades_limit: "10" });
    const raw = await apiFetch<Record<string, unknown>>(`${base}?${params}`);
    return normalizeProfileBundle(raw);
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((next) => !cancelled && setBundle(next))
      .catch((reason) => {
        if (cancelled) return;
        setBundle(null);
        setError(String((reason as Error).message || reason));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [load, revision]);

  const isSelf = Boolean(bundle?.viewer_context.is_self);

  useEffect(() => {
    if (!isSelf) {
      setPredictions(null);
      return;
    }
    let cancelled = false;
    apiFetch<Record<string, unknown>>("/api/portfolio/me/predictions")
      .then((raw) => !cancelled && setPredictions(normalizePredictionPortfolioResponse(raw)))
      .catch(() => !cancelled && setPredictions(null));
    return () => {
      cancelled = true;
    };
  }, [isSelf, revision]);

  const act = async (action: string, run: () => Promise<Record<string, unknown> | unknown>, reloadSelf = false) => {
    setBusy(action);
    setError(null);
    try {
      const result = await run();
      if (reloadSelf || !result || typeof result !== "object") setBundle(await load());
      else setBundle(normalizeProfileBundle(result as Record<string, unknown>));
    } catch (reason) {
      setError(String((reason as Error).message || reason));
    } finally {
      setBusy(null);
    }
  };

  const relation = {
    friend: (name: string) => act(`friend:${name}`, () => apiFetch(`/api/profiles/${enc(name)}/friend-request`, { method: "POST", body: "{}" }), name !== bundle?.profile.username),
    accept: (name: string) => act(`accept:${name}`, () => apiFetch(`/api/profiles/${enc(name)}/friend-request/accept`, { method: "POST", body: "{}" }), name !== bundle?.profile.username),
    remove: (name: string) => act(`remove:${name}`, () => apiFetch(`/api/profiles/${enc(name)}/friendship`, { method: "DELETE" }), name !== bundle?.profile.username),
    rival: (name: string, active: boolean) => act(`rival:${name}`, () => apiFetch(`/api/profiles/${enc(name)}/rival`, { method: "PUT", body: JSON.stringify({ active }) }), name !== bundle?.profile.username),
  };

  if (!bundle) {
    return (
      <SiteShell>
        <div className={styles.page}>
          {!username && !user && !loading ? (
            <div className={styles.signin}>
              <h1>Your profile</h1>
              <p>Sign in to see your bags, your rank and your friends.</p>
              <Link href="/login" className={styles.primary}>
                SIGN IN
              </Link>{" "}
              <Link href="/register" className={styles.ghost}>
                MAKE AN ACCOUNT
              </Link>
            </div>
          ) : (
            <p className={styles.empty}>{loading ? "Loading profile…" : error === "profile_not_found" || error === "404" ? `No player called ${username}.` : `Couldn't load this profile (${error}).`}</p>
          )}
        </div>
      </SiteShell>
    );
  }

  const { profile, viewer_context: viewer } = bundle;
  const color = profile.profile_color || "#3FB8F5";
  const oshi = profile.oshi_coin;
  const oshiAsset = oshi ? assets.find((asset) => asset.symbol.toUpperCase() === oshi.symbol.toUpperCase()) : undefined;
  const allTime = profile.stats.total_equity - START_CASH;
  const history = profile.networth_history;
  const dayAgo = [...history].reverse().find((point) => Date.parse(point.recorded_at) <= Date.now() - 86_400_000);
  const today = dayAgo && dayAgo.total_equity ? profile.stats.total_equity / dayAgo.total_equity - 1 : null;
  const verify = isSelf && userNeedsEmailVerification(user);

  return (
    <SiteShell>
      <div className={styles.page} style={{ "--pc": color, "--tal": oshiAsset ? talentAccent(oshiAsset.color, theme) : color } as React.CSSProperties}>
        <Link href="/leaderboard" className={styles.back}>
          ← LEADERBOARD
        </Link>

        <header className={styles.banner}>
          {oshi ? <ArtSlot kind="keyart" symbol={oshi.symbol} icon={oshi.icon} accent={oshiAsset ? talentAccent(oshiAsset.color, theme) : undefined} width={480} className={styles.bannerArt} /> : null}
          <div className={styles.idRow}>
            <button type="button" className={styles.avatarBtn} onClick={() => isSelf && setModal("picture")} disabled={!isSelf} aria-label={isSelf ? "Change your icon" : undefined} title={isSelf ? "Change your icon" : undefined}>
              <PlayerAvatar username={profile.username} pictureUrl={profile.profile_picture_url} color={color} size={120} className={styles.avatar} />
              {isSelf ? <span className={styles.avatarEdit}>CHANGE</span> : null}
            </button>
            <div className={styles.id}>
              <h1>{profile.username}</h1>
              <div className={styles.meta}>
                <span>Rank #{profile.rank.toLocaleString("en-US")}</span>
                {oshi ? (
                  <Link href={`/stocks/${enc(oshi.symbol)}`} className={styles.oshi} data-peek-stock={oshi.symbol}>
                    <Oshimark icon={oshi.icon} symbol={oshi.symbol} size={16} /> Oshi {oshi.display_name}
                  </Link>
                ) : null}
                <span>Joined {new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                {profile.is_admin ? <span className={styles.tag}>ADMIN</span> : null}
                {viewer.is_rivaled_by_profile ? <span className={styles.tagWarn}>RIVALS YOU</span> : null}
              </div>
              {profile.bio ? <p className={styles.bio}>{profile.bio}</p> : null}
            </div>
            <div className={styles.actions}>
              {isSelf ? (
                <>
                  <button type="button" className={styles.ghost} onClick={() => setModal("settings")}>
                    EDIT PROFILE
                  </button>
                  <Link href="/games/item-locker" className={styles.ghost}>
                    LOCKER
                  </Link>
                  <button
                    type="button"
                    className={styles.ghost}
                    disabled={busy === "logout"}
                    onClick={async () => {
                      setBusy("logout");
                      try {
                        await logout();
                        router.replace("/");
                        router.refresh();
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    LOG OUT
                  </button>
                </>
              ) : viewer.is_authenticated ? (
                <>
                  {viewer.friendship_status === "none" ? (
                    <button type="button" className={styles.primary} disabled={busy !== null || !viewer.can_send_friend_request} onClick={() => void relation.friend(profile.username)}>
                      ADD FRIEND
                    </button>
                  ) : viewer.friendship_status === "pending_incoming" ? (
                    <>
                      <button type="button" className={styles.primary} disabled={busy !== null} onClick={() => void relation.accept(profile.username)}>
                        ACCEPT FRIEND
                      </button>
                      <button type="button" className={styles.ghost} disabled={busy !== null} onClick={() => void relation.remove(profile.username)}>
                        IGNORE
                      </button>
                    </>
                  ) : viewer.friendship_status === "pending_outgoing" ? (
                    <button type="button" className={styles.ghost} disabled={busy !== null} onClick={() => void relation.remove(profile.username)} title="Cancel your request">
                      REQUESTED · CANCEL
                    </button>
                  ) : viewer.friendship_status === "accepted" ? (
                    <button type="button" className={styles.on} disabled={busy !== null} onClick={() => void relation.remove(profile.username)} title="Remove friend">
                      FRIENDS ✓
                    </button>
                  ) : null}
                  <button type="button" className={viewer.is_rival ? styles.rivalOn : styles.rival} disabled={busy !== null} onClick={() => void relation.rival(profile.username, !viewer.is_rival)}>
                    {viewer.is_rival ? "RIVAL ✓" : "DECLARE RIVAL"}
                  </button>
                </>
              ) : (
                <Link href="/login" className={styles.ghost}>
                  SIGN IN TO ADD FRIEND
                </Link>
              )}
            </div>
          </div>
        </header>

        {error ? (
          <p className={styles.err} role="alert">
            {error}
          </p>
        ) : null}
        {verify ? <VerificationRequiredNotice action="trade, post, comment, vote, or write articles" /> : null}

        <div className={styles.kstrip}>
          <div>
            <span className={styles.label}>Net worth</span>
            <b>{money(profile.stats.total_equity)}</b>
            <small>{money(profile.stats.cash_balance)} cash</small>
          </div>
          <div>
            <span className={styles.label}>All-time</span>
            <b className={styles[toneOf(allTime)]}>
              {allTime >= 0 ? "+" : "−"}
              {money(Math.abs(allTime))}
            </b>
            <small>vs the $10,000 start</small>
          </div>
          <div>
            <span className={styles.label}>Today</span>
            <b className={styles[toneOf(today)]}>{signedPct(today)}</b>
            <small>net worth, 24h</small>
          </div>
          <div>
            <span className={styles.label}>Unrealized</span>
            <b className={styles[toneOf(profile.stats.total_unrealized_pnl)]}>
              {profile.stats.total_unrealized_pnl >= 0 ? "+" : "−"}
              {money(Math.abs(profile.stats.total_unrealized_pnl))}
            </b>
            <small>on open bags</small>
          </div>
          <div>
            <span className={styles.label}>Streak</span>
            <b>{profile.streaks.current_streak_days} days</b>
            <small>best {profile.streaks.longest_streak_days}</small>
          </div>
          <div>
            <span className={styles.label}>Trades</span>
            <b>{profile.stats.trade_count.toLocaleString("en-US")}</b>
            <small>
              {profile.stats.friend_count} friends · {profile.stats.rival_count} rivals
            </small>
          </div>
        </div>

        <div className={styles.grid2}>
          <NetworthChart profile={profile} />
          <Bags profile={profile} isSelf={isSelf} />
        </div>

        <div className={styles.grid3}>
          <div className={styles.col}>
            {isSelf ? <PendingOrders /> : null}
            {isSelf ? <PredictionExposure portfolio={predictions} /> : null}
            <RecentFills bundle={bundle} base={base} onPage={(trades) => setBundle((current) => (current ? { ...current, trades } : current))} />
          </div>
          <div className={styles.col}>
            <GachaBadges profile={profile} isSelf={isSelf} />
            <Oshiboards profile={profile} />
            {!isSelf && viewer.is_authenticated ? <HeadToHead profile={profile} /> : null}
          </div>
          <div className={styles.col}>
            <FriendsRivals profile={profile} isSelf={isSelf} busy={busy} relation={relation} />
            <Articles bundle={bundle} base={base} isSelf={isSelf} onChange={(next) => setBundle((current) => (current ? { ...current, ...next } : current))} />
          </div>
        </div>

        <Achievements profile={profile} />

        {isSelf && (user?.is_admin || user?.can_manage_assets) ? (
          <div className={styles.admin}>
            <span className={styles.label}>{user?.is_admin ? "Market admin" : "Asset manager"}</span>
            <Link href="/admin/assets">Manage assets →</Link>
            {user?.is_admin ? <Link href="/admin/market-tuning">Tune market →</Link> : null}
          </div>
        ) : null}
      </div>

      {isSelf ? (
        <>
          <SettingsModal
            open={modal === "settings"}
            profile={profile}
            onClose={() => setModal(null)}
            onSaved={(next) => setBundle(next)}
          />
          <PictureModal open={modal === "picture"} profile={profile} onClose={() => setModal(null)} onSaved={(next) => setBundle(next)} />
        </>
      ) : null}
    </SiteShell>
  );
}
