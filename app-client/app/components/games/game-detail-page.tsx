"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FaArrowLeft, FaClock, FaMoneyBillTrendUp, FaPlay, FaUsers } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtNumber } from "@/app/lib/format";
import {
  normalizeGameCatalogEntry,
  normalizeGameInventoryResponse,
  normalizeGamesSummary,
  normalizeGachaPullResult,
  normalizeTickerTapLeaderboardResponse,
  normalizeTickerTapSessionCreateResponse,
  normalizeTickerTapSubmitResponse,
} from "@/app/lib/normalizers";
import type {
  GameCatalogEntry,
  GameInventoryResponse,
  GamesSummary,
  GachaPullResult,
  TickerTapLeaderboardResponse,
  TickerTapSessionConfig,
  TickerTapSubmitResponse,
} from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/game-detail-page.module.scss";

type TickerTapRunPhase = "idle" | "starting" | "running" | "submitting" | "completed";

type TickerTapRunState = {
  phase: TickerTapRunPhase;
  sessionId: number | null;
  config: TickerTapSessionConfig | null;
  elapsedMs: number;
  startedAtMs: number | null;
  hits: number;
  misses: number;
  taps: number;
  streak: number;
  maxStreak: number;
  hitTargetIndexes: number[];
  walletBalanceAfter: number | null;
  result: TickerTapSubmitResponse | null;
};

const INITIAL_TICKER_TAP_RUN_STATE: TickerTapRunState = {
  phase: "idle",
  sessionId: null,
  config: null,
  elapsedMs: 0,
  startedAtMs: null,
  hits: 0,
  misses: 0,
  taps: 0,
  streak: 0,
  maxStreak: 0,
  hitTargetIndexes: [],
  walletBalanceAfter: null,
  result: null,
};

function gameAccent(game: GameCatalogEntry | null) {
  if (game?.key === "capsule-gacha") return "#f97316";
  if (game?.key === "ticker-tap") return "#0ea5e9";
  if (game?.game_type === "pvp") return "#ef4444";
  return "#14b8a6";
}

function typeLabel(gameType: GameCatalogEntry["game_type"]) {
  if (gameType === "gacha") return "Cosmetic Sink";
  if (gameType === "single_player") return "Solo Run";
  if (gameType === "pvp") return "PvP";
  return "Idle";
}

function statusClass(status: GameCatalogEntry["status"]) {
  if (status === "active") return styles.statusActive;
  if (status === "disabled") return styles.statusDisabled;
  return styles.statusDraft;
}

function statusCopy(status: GameCatalogEntry["status"]) {
  if (status === "active") return "Live";
  if (status === "disabled") return "Disabled";
  return "Draft";
}

function rarityAccent(rarity: string) {
  const normalized = rarity.toLowerCase();
  if (normalized === "legendary") return "#eab308";
  if (normalized === "epic") return "#c084fc";
  if (normalized === "rare") return "#38bdf8";
  return "#34d399";
}

function priceLine(game: GameCatalogEntry) {
  if (game.game_type === "pvp") {
    if (game.min_stake_cash !== null && game.max_stake_cash !== null) {
      return `${fmtNumber(game.min_stake_cash, "$")} to ${fmtNumber(game.max_stake_cash, "$")}`;
    }
    return "Stake based";
  }
  return fmtNumber(game.entry_fee_cash, "$");
}

function placeholderCopy(game: GameCatalogEntry | null) {
  if (!game) return "Game unavailable.";
  if (game.key === "prediction-duel") {
    return "Prediction Duel stays in draft while the asynchronous stake-match flow is built out on the backend and then surfaced here.";
  }
  return "This game does not have a dedicated frontend surface yet.";
}

function tickerAccuracy(hits: number, misses: number) {
  const attempts = hits + misses;
  if (attempts <= 0) return 0;
  return hits / attempts;
}

function tickerConfigFromGame(game: GameCatalogEntry | null): TickerTapSessionConfig | null {
  if (!game || game.key !== "ticker-tap") return null;
  const config = game.config || {};
  const laneCount = Math.max(3, Math.min(6, Number(config.lane_count || 4)));
  return {
    run_duration_seconds: Math.max(10, Math.min(120, Number(config.run_duration_seconds || 45))),
    lane_count: laneCount,
    target_lifetime_ms: Math.max(350, Math.min(1600, Number(config.target_lifetime_ms || 900))),
    spawn_interval_ms: Math.max(250, Math.min(1500, Number(config.spawn_interval_ms || 650))),
    max_targets: Math.max(12, Math.min(200, Number(config.max_targets || 72))),
    leaderboard_window_days: Number(config.leaderboard_window_days || 7),
    leaderboard_limit: Number(config.leaderboard_limit || 20),
    seed_hint: "",
    timeline: [],
  };
}

export function GameDetailPage({ gameKey }: { gameKey: string }) {
  const { user, initialized } = useAuth();
  const [game, setGame] = useState<GameCatalogEntry | null>(null);
  const [summary, setSummary] = useState<GamesSummary | null>(null);
  const [inventory, setInventory] = useState<GameInventoryResponse | null>(null);
  const [latestPull, setLatestPull] = useState<GachaPullResult | null>(null);
  const [tickerTapRun, setTickerTapRun] = useState<TickerTapRunState>(INITIAL_TICKER_TAP_RUN_STATE);
  const [tickerTapBoard, setTickerTapBoard] = useState<TickerTapLeaderboardResponse | null>(null);
  const [isLoadingGame, setIsLoadingGame] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isLoadingTickerTapBoard, setIsLoadingTickerTapBoard] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [tickerTapError, setTickerTapError] = useState<string | null>(null);
  const [tickerTapBoardError, setTickerTapBoardError] = useState<string | null>(null);
  const tickerTapRunRef = useRef<TickerTapRunState>(INITIAL_TICKER_TAP_RUN_STATE);
  const tickerTapSubmitRequestedRef = useRef(false);

  const loadAccount = useCallback(async () => {
    if (!user) return;
    setIsLoadingAccount(true);
    setAccountError(null);
    try {
      const [summaryResult, inventoryResult] = await Promise.all([
        apiFetch<Record<string, unknown>>("/api/games/me/summary", { cache: "no-store" }),
        apiFetch<Record<string, unknown>>("/api/games/me/inventory", { cache: "no-store" }),
      ]);
      setSummary(normalizeGamesSummary(summaryResult));
      setInventory(normalizeGameInventoryResponse(inventoryResult));
    } catch (error) {
      setAccountError(String((error as Error).message || error));
    } finally {
      setIsLoadingAccount(false);
    }
  }, [user]);

  const loadTickerTapBoard = useCallback(async () => {
    if (gameKey !== "ticker-tap") return;
    setIsLoadingTickerTapBoard(true);
    setTickerTapBoardError(null);
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/games/ticker-tap/leaderboard", { cache: "no-store" });
      setTickerTapBoard(normalizeTickerTapLeaderboardResponse(result));
    } catch (error) {
      setTickerTapBoardError(String((error as Error).message || error));
    } finally {
      setIsLoadingTickerTapBoard(false);
    }
  }, [gameKey]);

  async function handlePull() {
    setIsPulling(true);
    setPullError(null);
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/games/capsule-gacha/pull", {
        method: "POST",
        body: JSON.stringify({ count: 1 }),
      });
      setLatestPull(normalizeGachaPullResult(result));
      await loadAccount();
    } catch (error) {
      setPullError(String((error as Error).message || error));
    } finally {
      setIsPulling(false);
    }
  }

  async function handleStartTickerTapRun() {
    setTickerTapError(null);
    setTickerTapRun((current) => ({
      ...current,
      phase: "starting",
      result: null,
    }));

    try {
      const result = await apiFetch<Record<string, unknown>>("/api/games/ticker-tap/sessions", {
        method: "POST",
      });
      const normalized = normalizeTickerTapSessionCreateResponse(result);
      tickerTapSubmitRequestedRef.current = false;
      setTickerTapRun({
        phase: "running",
        sessionId: normalized.session.id,
        config: normalized.session.config,
        elapsedMs: 0,
        startedAtMs: Date.now(),
        hits: 0,
        misses: 0,
        taps: 0,
        streak: 0,
        maxStreak: 0,
        hitTargetIndexes: [],
        walletBalanceAfter: normalized.wallet.cash_balance_after,
        result: null,
      });
      await Promise.all([loadAccount(), loadTickerTapBoard()]);
    } catch (error) {
      setTickerTapRun(INITIAL_TICKER_TAP_RUN_STATE);
      setTickerTapError(String((error as Error).message || error));
    }
  }

  const submitTickerTapRun = useCallback(async () => {
    const currentRun = tickerTapRunRef.current;
    if (currentRun.phase !== "running" || !currentRun.sessionId || !currentRun.config) {
      return;
    }

    setTickerTapError(null);
    setTickerTapRun((current) => ({
      ...current,
      phase: "submitting",
    }));

    try {
      const result = await apiFetch<Record<string, unknown>>(`/api/games/ticker-tap/sessions/${currentRun.sessionId}/submit`, {
        method: "POST",
        body: JSON.stringify({
          hits: currentRun.hits,
          misses: currentRun.misses,
          max_streak: currentRun.maxStreak,
          duration_ms: Math.max(currentRun.elapsedMs, currentRun.config.run_duration_seconds * 1000),
          taps: currentRun.taps,
        }),
      });
      const normalized = normalizeTickerTapSubmitResponse(result);
      setTickerTapRun((current) => ({
        ...current,
        phase: "completed",
        elapsedMs: current.config ? current.config.run_duration_seconds * 1000 : current.elapsedMs,
        result: normalized,
      }));
      await Promise.all([loadAccount(), loadTickerTapBoard()]);
    } catch (error) {
      tickerTapSubmitRequestedRef.current = false;
      setTickerTapRun((current) => ({
        ...current,
        phase: "running",
      }));
      setTickerTapError(String((error as Error).message || error));
    }
  }, [loadAccount, loadTickerTapBoard]);

  function handleTickerTapLane(laneIndex: number) {
    setTickerTapRun((current) => {
      if (current.phase !== "running" || !current.config) return current;
      const config = current.config;

      const matchingTarget = config.timeline.find((target) => (
        target.lane === laneIndex
        && !current.hitTargetIndexes.includes(target.index)
        && current.elapsedMs >= target.start_ms
        && current.elapsedMs <= (target.start_ms + config.target_lifetime_ms)
      ));

      if (!matchingTarget) {
        return {
          ...current,
          taps: current.taps + 1,
          misses: current.misses + 1,
          streak: 0,
        };
      }

      const nextStreak = current.streak + 1;
      return {
        ...current,
        taps: current.taps + 1,
        hits: current.hits + 1,
        streak: nextStreak,
        maxStreak: Math.max(current.maxStreak, nextStreak),
        hitTargetIndexes: [...current.hitTargetIndexes, matchingTarget.index],
      };
    });
  }

  useEffect(() => {
    tickerTapRunRef.current = tickerTapRun;
  }, [tickerTapRun]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoadingGame(true);
      setGameError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/games/catalog/${encodeURIComponent(gameKey)}`, { cache: "no-store" });
        if (cancelled) return;
        setGame(normalizeGameCatalogEntry(((result.game || {}) as Record<string, unknown>)));
      } catch (error) {
        if (cancelled) return;
        setGameError(String((error as Error).message || error));
        setGame(null);
      } finally {
        if (!cancelled) {
          setIsLoadingGame(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameKey]);

  useEffect(() => {
    if (!initialized) return;
    if (!user) {
      setSummary(null);
      setInventory(null);
      setAccountError(null);
      return;
    }
    void loadAccount();
  }, [initialized, user, loadAccount]);

  useEffect(() => {
    if (gameKey !== "ticker-tap") {
      setTickerTapBoard(null);
      setTickerTapBoardError(null);
      setTickerTapRun(INITIAL_TICKER_TAP_RUN_STATE);
      tickerTapSubmitRequestedRef.current = false;
      return;
    }
    void loadTickerTapBoard();
  }, [gameKey, loadTickerTapBoard]);

  useEffect(() => {
    if (tickerTapRun.phase !== "running" || !tickerTapRun.startedAtMs || !tickerTapRun.config) {
      return undefined;
    }

    let frame = 0;
    const durationMs = tickerTapRun.config.run_duration_seconds * 1000;
    const tick = () => {
      setTickerTapRun((current) => {
        if (current.phase !== "running" || !current.startedAtMs || !current.config) return current;
        const nextElapsedMs = Math.min(Date.now() - current.startedAtMs, durationMs);
        if (nextElapsedMs === current.elapsedMs) return current;
        return {
          ...current,
          elapsedMs: nextElapsedMs,
        };
      });
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [tickerTapRun.phase, tickerTapRun.startedAtMs, tickerTapRun.config]);

  useEffect(() => {
    if (tickerTapRun.phase !== "running" || !tickerTapRun.config) return;
    if (tickerTapRun.elapsedMs < (tickerTapRun.config.run_duration_seconds * 1000)) return;
    if (tickerTapSubmitRequestedRef.current) return;
    tickerTapSubmitRequestedRef.current = true;
    void submitTickerTapRun();
  }, [tickerTapRun.phase, tickerTapRun.elapsedMs, tickerTapRun.config, submitTickerTapRun]);

  useEffect(() => {
    if (tickerTapRun.phase !== "running" || !tickerTapRun.config) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const laneIndex = Number.parseInt(event.key, 10) - 1;
      if (!Number.isInteger(laneIndex)) return;
      if (laneIndex < 0 || laneIndex >= tickerTapRun.config!.lane_count) return;
      event.preventDefault();
      handleTickerTapLane(laneIndex);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tickerTapRun.phase, tickerTapRun.config, tickerTapRun.elapsedMs, tickerTapRun.hitTargetIndexes]);

  const accent = gameAccent(game);
  const recentCosmetics = inventory?.cosmetics.slice(0, 4) || [];
  const recentSessions = summary?.recent_sessions.filter((session) => session.game_key === gameKey).slice(0, 5) || [];
  const isCapsuleGacha = game?.key === "capsule-gacha";
  const isTickerTap = game?.key === "ticker-tap";
  const tickerTapConfig = tickerTapRun.config || tickerConfigFromGame(game);
  const tickerTapLaneCount = tickerTapConfig?.lane_count || 4;
  const tickerTapDurationMs = tickerTapConfig ? tickerTapConfig.run_duration_seconds * 1000 : 45_000;
  const tickerTapRemainingMs = Math.max(0, tickerTapDurationMs - tickerTapRun.elapsedMs);
  const tickerTapAccuracyValue = tickerTapRun.result
    ? tickerTapRun.result.result.submission.accuracy
    : tickerAccuracy(tickerTapRun.hits, tickerTapRun.misses);
  const tickerTapVisibleTargets = tickerTapRun.config
    ? tickerTapRun.config.timeline
      .filter((target) => (
        !tickerTapRun.hitTargetIndexes.includes(target.index)
        && tickerTapRun.elapsedMs >= target.start_ms
        && tickerTapRun.elapsedMs <= (target.start_ms + tickerTapRun.config!.target_lifetime_ms)
      ))
      .map((target) => ({
        ...target,
        progress: Math.max(
          0,
          Math.min(
            1,
            (tickerTapRun.elapsedMs - target.start_ms) / tickerTapRun.config!.target_lifetime_ms
          )
        ),
      }))
    : [];

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero} style={{ "--hero-accent": accent } as CSSProperties}>
          <div className={styles.heroTop}>
            <Link href="/games" className={styles.backLink}>
              <FaArrowLeft />
              <span>Back to games hub</span>
            </Link>
            {game ? (
              <div className={styles.badgeRow}>
                <span className={styles.typePill}>{typeLabel(game.game_type)}</span>
                <span className={`${styles.statusPill} ${statusClass(game.status)}`.trim()}>{statusCopy(game.status)}</span>
              </div>
            ) : null}
          </div>

          {gameError ? <div className={`${styles.statusMessage} ${styles.statusError}`}>Game error: {gameError}</div> : null}

          <div>
            <h1 className={styles.heroTitle}>{game?.name || (isLoadingGame ? "Loading game…" : "Game not found")}</h1>
            <p className={styles.heroCopy}>
              {game?.description || "This page is the dedicated surface for a specific NASFAQ game. It consumes the same `/api/games/*` contract the hub uses."}
            </p>
          </div>

          {game ? (
            <div className={styles.heroMetaGrid}>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>Entry</span>
                <strong className={styles.metaValue}>{priceLine(game)}</strong>
                <span className={styles.metaHint}>Shared wallet, no second currency.</span>
              </div>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>Game Key</span>
                <strong className={styles.metaValue}>{game.key}</strong>
                <span className={styles.metaHint}>Portable route and backend contract.</span>
              </div>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>Wallet</span>
                <strong className={styles.metaValue}>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Sign in"}</strong>
                <span className={styles.metaHint}>Same balance used across NASFAQ.</span>
              </div>
            </div>
          ) : null}
        </section>

        {isCapsuleGacha && game ? (
          <div className={styles.layout}>
            <section className={styles.panel}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Live Pull Console</h2>
                  <p className={styles.sectionCopy}>
                    Pulls are resolved server-side. Cash is debited from the shared NASFAQ wallet, cosmetics are granted or duplicate compensation is paid back, and the result is stored in the games backend.
                  </p>
                </div>
                <HiSparkles />
              </div>

              <div className={styles.console}>
                <div className={styles.priceRow}>
                  <HiSparkles />
                  <span>{fmtNumber(game.entry_fee_cash, "$")} per pull</span>
                </div>
                <p className={styles.consoleCopy}>
                  Cosmetic-only sink. Duplicate pulls convert into cash compensation instead of burning the outcome.
                </p>

                {pullError ? <div className={`${styles.statusMessage} ${styles.statusError}`}>Pull failed: {pullError}</div> : null}

                {user ? (
                  <button type="button" className={styles.actionButton} disabled={isPulling || isLoadingAccount} onClick={() => void handlePull()}>
                    <HiSparkles />
                    <span>{isPulling ? "Rolling capsule…" : `Pull for ${fmtNumber(game.entry_fee_cash, "$")}`}</span>
                  </button>
                ) : (
                  <Link href="/login" className={styles.actionLink}>
                    <FaPlay />
                    <span>Sign In To Pull</span>
                  </Link>
                )}
              </div>

              <div className={styles.resultCard}>
                <div className={styles.sectionHead}>
                  <div>
                    <h3 className={styles.sectionTitle}>Latest Result</h3>
                    <p className={styles.sectionCopy}>
                      {latestPull
                        ? latestPull.pull.duplicate
                          ? `Duplicate converted into ${fmtNumber(latestPull.wallet.duplicate_compensation_cash, "$")} cash back.`
                          : "New cosmetic added to your locker."
                        : "Your next pull result will show up here."}
                    </p>
                  </div>
                  <FaMoneyBillTrendUp />
                </div>

                {latestPull ? (
                  <div className={styles.rewardHero} style={{ "--reward-accent": rarityAccent(latestPull.pull.reward.rarity) } as CSSProperties}>
                    <span className={styles.rewardKicker}>{latestPull.pull.reward.rarity}</span>
                    <h4 className={styles.rewardTitle}>{latestPull.pull.reward.display_name}</h4>
                    <span className={styles.rewardMeta}>
                      {latestPull.pull.reward.type} · {latestPull.pull.reward.slot_key || "no slot"} · {fmtDate(latestPull.pull.created_at)}
                    </span>
                  </div>
                ) : (
                  <div className={`${styles.statusMessage} ${styles.statusNeutral}`}>No pull yet for this session.</div>
                )}

                <div className={styles.resultLine}>
                  <span className={styles.resultLabel}>Duplicate compensation</span>
                  <strong className={styles.resultValue}>{latestPull ? fmtNumber(latestPull.wallet.duplicate_compensation_cash, "$") : "—"}</strong>
                </div>
                <div className={styles.resultLine}>
                  <span className={styles.resultLabel}>Balance after pull</span>
                  <strong className={styles.resultValue}>{latestPull ? fmtNumber(latestPull.wallet.cash_balance_after, "$") : "—"}</strong>
                </div>
                <div className={styles.resultLine}>
                  <span className={styles.resultLabel}>Grant result</span>
                  <strong className={styles.resultValue}>{latestPull ? (latestPull.pull.granted_cosmetic ? "New cosmetic" : "Duplicate") : "—"}</strong>
                </div>
              </div>
            </section>

            <aside className={styles.panel}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Locker Slice</h2>
                  <p className={styles.sectionCopy}>Recent cosmetics and sessions tied to the same shared game account.</p>
                </div>
                <FaClock />
              </div>

              {accountError ? <div className={`${styles.statusMessage} ${styles.statusWarn}`}>Account warning: {accountError}</div> : null}

              <div className={styles.miniRow}>
                <span className={styles.miniLabel}>Wallet balance</span>
                <strong className={styles.miniValue}>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Sign in"}</strong>
              </div>
              <div className={styles.miniRow}>
                <span className={styles.miniLabel}>Owned cosmetics</span>
                <strong className={styles.miniValue}>{summary?.inventory.total_cosmetics ?? 0}</strong>
              </div>

              <div className={styles.lockerList}>
                {recentCosmetics.length ? recentCosmetics.map((cosmetic) => (
                  <article key={cosmetic.id} className={styles.lockerItem}>
                    <strong className={styles.itemTitle}>{String(cosmetic.metadata.display_name || cosmetic.cosmetic_key)}</strong>
                    <span className={styles.itemMeta}>{cosmetic.rarity} · {cosmetic.cosmetic_type} · {fmtDate(cosmetic.granted_at)}</span>
                  </article>
                )) : <div className={styles.empty}>Your recent cosmetics will show up here.</div>}
              </div>

              <div className={styles.sectionHead}>
                <div>
                  <h3 className={styles.sectionTitle}>Recent Sessions</h3>
                  <p className={styles.sectionCopy}>Only this game’s session history.</p>
                </div>
                <FaClock />
              </div>

              <div className={styles.sessionList}>
                {recentSessions.length ? recentSessions.map((session) => (
                  <article key={session.id} className={styles.sessionItem}>
                    <strong className={styles.itemTitle}>{session.status}</strong>
                    <span className={styles.itemMeta}>
                      Fee {fmtNumber(session.entry_fee_cash, "$")} · Payout {fmtNumber(session.payout_cash, "$")} · {fmtDate(session.created_at)}
                    </span>
                  </article>
                )) : <div className={styles.empty}>No sessions recorded for this game yet.</div>}
              </div>
            </aside>
          </div>
        ) : isTickerTap && game ? (
          <div className={styles.layout}>
            <section className={styles.panel}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Run Console</h2>
                  <p className={styles.sectionCopy}>
                    Each run is a paid backend session. The server creates the seed and target timeline, debits your wallet up front, and scores the submitted run when time expires.
                  </p>
                </div>
                <FaPlay />
              </div>

              <div className={styles.console}>
                <div className={styles.priceRow}>
                  <FaPlay />
                  <span>{fmtNumber(game.entry_fee_cash, "$")} per run</span>
                </div>
                <p className={styles.consoleCopy}>
                  Press the numbered lanes or use keys `1-{tickerTapLaneCount}`. This stays client-portable because the only dependency is the `/api/games/ticker-tap/*` contract.
                </p>

                {tickerTapError ? <div className={`${styles.statusMessage} ${styles.statusError}`}>Run error: {tickerTapError}</div> : null}

                {user ? (
                  <button
                    type="button"
                    className={styles.actionButton}
                    disabled={tickerTapRun.phase === "starting" || tickerTapRun.phase === "running" || tickerTapRun.phase === "submitting"}
                    onClick={() => void handleStartTickerTapRun()}
                  >
                    <FaPlay />
                    <span>
                      {tickerTapRun.phase === "starting"
                        ? "Buying run…"
                        : tickerTapRun.phase === "running"
                          ? "Run active"
                          : tickerTapRun.phase === "submitting"
                            ? "Submitting run…"
                            : `Start run for ${fmtNumber(game.entry_fee_cash, "$")}`}
                    </span>
                  </button>
                ) : (
                  <Link href="/login" className={styles.actionLink}>
                    <FaPlay />
                    <span>Sign In To Play</span>
                  </Link>
                )}

                <div className={styles.tickerStatGrid}>
                  <article className={styles.tickerStatCard}>
                    <span className={styles.tickerStatLabel}>Time left</span>
                    <strong className={styles.tickerStatValue}>{(tickerTapRemainingMs / 1000).toFixed(1)}s</strong>
                  </article>
                  <article className={styles.tickerStatCard}>
                    <span className={styles.tickerStatLabel}>Hits</span>
                    <strong className={styles.tickerStatValue}>{tickerTapRun.hits}</strong>
                  </article>
                  <article className={styles.tickerStatCard}>
                    <span className={styles.tickerStatLabel}>Accuracy</span>
                    <strong className={styles.tickerStatValue}>{(tickerTapAccuracyValue * 100).toFixed(0)}%</strong>
                  </article>
                  <article className={styles.tickerStatCard}>
                    <span className={styles.tickerStatLabel}>Best streak</span>
                    <strong className={styles.tickerStatValue}>{tickerTapRun.maxStreak}</strong>
                  </article>
                </div>
              </div>

              <div className={styles.tickerArena}>
                <div className={styles.sectionHead}>
                  <div>
                    <h3 className={styles.sectionTitle}>Ticker Grid</h3>
                    <p className={styles.sectionCopy}>
                      Live targets fall through each lane for {tickerTapConfig?.run_duration_seconds || 45}s. Missed taps reduce accuracy; only server-submitted runs hit the leaderboard.
                    </p>
                  </div>
                  <FaClock />
                </div>

                <div
                  className={styles.tickerLaneGrid}
                  style={{ "--lane-count": String(tickerTapLaneCount) } as CSSProperties}
                >
                  {Array.from({ length: tickerTapLaneCount }, (_, laneIndex) => {
                    const laneTargets = tickerTapVisibleTargets.filter((target) => target.lane === laneIndex);
                    return (
                      <button
                        key={laneIndex}
                        type="button"
                        className={`${styles.tickerLane} ${tickerTapRun.phase === "running" ? styles.tickerLaneActive : ""}`.trim()}
                        disabled={tickerTapRun.phase !== "running"}
                        onClick={() => handleTickerTapLane(laneIndex)}
                      >
                        <span className={styles.tickerLaneTop}>
                          <span className={styles.tickerLaneLabel}>Lane {laneIndex + 1}</span>
                          <span className={styles.tickerLaneHotkey}>{laneIndex + 1}</span>
                        </span>

                        {laneTargets.map((target) => (
                          <span
                            key={target.index}
                            className={styles.tickerTarget}
                            style={{ "--target-progress": String(target.progress) } as CSSProperties}
                          >
                            TAP
                          </span>
                        ))}

                        <span className={styles.tickerLaneFooter}>
                          {tickerTapRun.phase === "running" ? "Tap live target" : "Start a paid run"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.resultCard}>
                <div className={styles.sectionHead}>
                  <div>
                    <h3 className={styles.sectionTitle}>Run Result</h3>
                    <p className={styles.sectionCopy}>
                      {tickerTapRun.result
                        ? "The score below is the server-accepted result for the most recent completed run."
                        : "Start a run to generate a score and push a completed session into history."}
                    </p>
                  </div>
                  <FaMoneyBillTrendUp />
                </div>

                {tickerTapRun.result ? (
                  <div className={styles.scoreHero}>
                    <span className={styles.scoreKicker}>Server Score</span>
                    <h4 className={styles.scoreValue}>{fmtNumber(tickerTapRun.result.session.score)}</h4>
                    <span className={styles.scoreMeta}>
                      Completed {fmtDate(tickerTapRun.result.session.completed_at)} · Accuracy {(tickerTapRun.result.result.submission.accuracy * 100).toFixed(0)}%
                    </span>
                  </div>
                ) : (
                  <div className={`${styles.statusMessage} ${styles.statusNeutral}`}>No completed run yet for this session.</div>
                )}

                <div className={styles.resultLine}>
                  <span className={styles.resultLabel}>Wallet after entry debit</span>
                  <strong className={styles.resultValue}>{tickerTapRun.walletBalanceAfter !== null ? fmtNumber(tickerTapRun.walletBalanceAfter, "$") : "—"}</strong>
                </div>
                <div className={styles.resultLine}>
                  <span className={styles.resultLabel}>Misses</span>
                  <strong className={styles.resultValue}>{tickerTapRun.result ? tickerTapRun.result.result.submission.misses : tickerTapRun.misses}</strong>
                </div>
                <div className={styles.resultLine}>
                  <span className={styles.resultLabel}>Tap count</span>
                  <strong className={styles.resultValue}>{tickerTapRun.result ? tickerTapRun.result.result.submission.taps : tickerTapRun.taps}</strong>
                </div>
              </div>
            </section>

            <aside className={styles.panel}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Run Board</h2>
                  <p className={styles.sectionCopy}>Recent best runs from the shared NASFAQ population.</p>
                </div>
                <FaUsers />
              </div>

              {accountError ? <div className={`${styles.statusMessage} ${styles.statusWarn}`}>Account warning: {accountError}</div> : null}
              {tickerTapBoardError ? <div className={`${styles.statusMessage} ${styles.statusWarn}`}>Leaderboard warning: {tickerTapBoardError}</div> : null}

              <div className={styles.miniRow}>
                <span className={styles.miniLabel}>Wallet balance</span>
                <strong className={styles.miniValue}>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Sign in"}</strong>
              </div>
              <div className={styles.miniRow}>
                <span className={styles.miniLabel}>Recent runs</span>
                <strong className={styles.miniValue}>{recentSessions.length}</strong>
              </div>

              <div className={styles.boardList}>
                {isLoadingTickerTapBoard ? (
                  <div className={styles.empty}>Loading leaderboard…</div>
                ) : tickerTapBoard?.leaderboard.length ? tickerTapBoard.leaderboard.map((entry) => (
                  <article key={entry.session_id} className={styles.boardItem}>
                    <div className={styles.boardHeading}>
                      <span className={styles.boardRank}>#{entry.rank}</span>
                      <strong className={styles.boardName} style={entry.profile_color ? { color: entry.profile_color } : undefined}>
                        {entry.username}
                      </strong>
                      <span className={styles.boardScore}>{fmtNumber(entry.score)}</span>
                    </div>
                    <span className={styles.itemMeta}>
                      {entry.stats.hits} hits · {entry.stats.max_streak} streak · {fmtDate(entry.completed_at)}
                    </span>
                  </article>
                )) : (
                  <div className={styles.empty}>No leaderboard entries yet.</div>
                )}
              </div>

              <div className={styles.sectionHead}>
                <div>
                  <h3 className={styles.sectionTitle}>Recent Sessions</h3>
                  <p className={styles.sectionCopy}>Completed and active sessions for this game.</p>
                </div>
                <FaClock />
              </div>

              <div className={styles.sessionList}>
                {recentSessions.length ? recentSessions.map((session) => (
                  <article key={session.id} className={styles.sessionItem}>
                    <strong className={styles.itemTitle}>{session.score !== null ? `${fmtNumber(session.score)} pts` : session.status}</strong>
                    <span className={styles.itemMeta}>
                      Fee {fmtNumber(session.entry_fee_cash, "$")} · {fmtDate(session.created_at)}
                    </span>
                  </article>
                )) : <div className={styles.empty}>No sessions recorded for this game yet.</div>}
              </div>
            </aside>
          </div>
        ) : (
          <section className={styles.placeholder}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Surface Status</h2>
                <p className={styles.sectionCopy}>{placeholderCopy(game)}</p>
              </div>
              {game?.game_type === "pvp" ? <FaUsers /> : <FaPlay />}
            </div>

            <div className={`${styles.statusMessage} ${styles.statusNeutral}`}>
              {game?.status === "draft"
                ? "This page is intentionally ahead of the fully playable UI so the route structure is stable before the next game surfaces land."
                : "The route is live, but the interactive client surface is still queued."}
            </div>

            <Link href="/games" className={styles.actionLink}>Back to games hub</Link>
          </section>
        )}
      </div>
    </SiteShell>
  );
}
