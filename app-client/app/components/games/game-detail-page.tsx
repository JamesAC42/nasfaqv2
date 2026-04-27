"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FaArrowLeft, FaBoxOpen, FaClock, FaMoneyBillTrendUp, FaPlay, FaStar, FaTicket, FaUsers } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtDate, fmtNumber } from "@/app/lib/format";
import {
  createTickerTapSession,
  fetchCapsuleGachaCatalog,
  fetchGameCatalogEntry,
  fetchGamesInventory,
  fetchGamesSummary,
  fetchTickerTapLeaderboard,
  pullCapsuleGacha,
  submitTickerTapSession,
} from "@/app/lib/games-api";
import type {
  GameCatalogEntry,
  GachaCatalogResponse,
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

function formatPullChance(value: number) {
  if (value <= 0) return "0%";
  const percent = value * 100;
  return percent >= 1 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
}

function placeholderCopy(game: GameCatalogEntry | null) {
  if (!game) return "Game unavailable.";
  if (game.key === "prediction-duel") {
    return "Prediction Duel is still in development.";
  }
  return "This game is still in development.";
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
  const [gachaCatalog, setGachaCatalog] = useState<GachaCatalogResponse | null>(null);
  const [latestPull, setLatestPull] = useState<GachaPullResult | null>(null);
  const [tickerTapRun, setTickerTapRun] = useState<TickerTapRunState>(INITIAL_TICKER_TAP_RUN_STATE);
  const [tickerTapBoard, setTickerTapBoard] = useState<TickerTapLeaderboardResponse | null>(null);
  const [isLoadingGame, setIsLoadingGame] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isLoadingGachaCatalog, setIsLoadingGachaCatalog] = useState(false);
  const [isLoadingTickerTapBoard, setIsLoadingTickerTapBoard] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [gachaCatalogError, setGachaCatalogError] = useState<string | null>(null);
  const [tickerTapError, setTickerTapError] = useState<string | null>(null);
  const [tickerTapBoardError, setTickerTapBoardError] = useState<string | null>(null);
  const tickerTapRunRef = useRef<TickerTapRunState>(INITIAL_TICKER_TAP_RUN_STATE);
  const tickerTapSubmitRequestedRef = useRef(false);

  const loadAccount = useCallback(async () => {
    if (!user) return;
    setIsLoadingAccount(true);
    setAccountError(null);
    try {
      const [summaryResult, inventoryResult] = await Promise.all([fetchGamesSummary(), fetchGamesInventory()]);
      setSummary(summaryResult);
      setInventory(inventoryResult);
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
      setTickerTapBoard(await fetchTickerTapLeaderboard());
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
      setLatestPull(await pullCapsuleGacha(1));
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
      const normalized = await createTickerTapSession();
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
      const normalized = await submitTickerTapSession(currentRun.sessionId, {
        hits: currentRun.hits,
        misses: currentRun.misses,
        max_streak: currentRun.maxStreak,
        duration_ms: Math.max(currentRun.elapsedMs, currentRun.config.run_duration_seconds * 1000),
        taps: currentRun.taps,
      });
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
        if (cancelled) return;
        setGame(await fetchGameCatalogEntry(gameKey));
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
    if (gameKey !== "capsule-gacha") {
      setGachaCatalog(null);
      setGachaCatalogError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      setIsLoadingGachaCatalog(true);
      setGachaCatalogError(null);
      try {
        const catalogResult = await fetchCapsuleGachaCatalog();
        if (!cancelled) {
          setGachaCatalog(catalogResult);
        }
      } catch (error) {
        if (!cancelled) {
          setGachaCatalogError(String((error as Error).message || error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGachaCatalog(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameKey]);

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

  const heroImage = isCapsuleGacha
    ? 'url("/gacha-game-banner.png")'
    : isTickerTap
      ? 'url("/rhythm-game-banner.png")'
      : "none";

  const heroStyle = {
    "--hero-accent": accent,
    "--hero-image": heroImage,
  } as CSSProperties;

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={`${styles.hero} ${(isCapsuleGacha || isTickerTap) ? styles.heroWithImage : ""}`.trim()} style={heroStyle}>
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
              {game?.description || "Step in, spend some cash, and chase a better run."}
            </p>
          </div>

          {game ? (
            <div className={styles.heroMetaGrid}>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>Entry</span>
                <strong className={styles.metaValue}>{priceLine(game)}</strong>
                <span className={styles.metaHint}>Paid from your NASFAQ balance.</span>
              </div>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>Mode</span>
                <strong className={styles.metaValue}>{typeLabel(game.game_type)}</strong>
                <span className={styles.metaHint}>Jump in and make it count.</span>
              </div>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>Wallet</span>
                <strong className={styles.metaValue}>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Sign in"}</strong>
                <span className={styles.metaHint}>Ready for your next shot.</span>
              </div>
            </div>
          ) : null}
        </section>

        {isCapsuleGacha && game ? (
          <div className={`${styles.layout} ${styles.gachaLayout}`.trim()} style={{ "--hero-accent": accent } as CSSProperties}>
            <section className={`${styles.panel} ${styles.gachaStage}`.trim()}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Capsule Drop</h2>
                  <p className={styles.sectionCopy}>
                    A focused pull experience with the price, prize pool, and result feedback visible before you spend.
                  </p>
                </div>
                <HiSparkles />
              </div>

              <div className={styles.gachaHeroGrid}>
                <div className={styles.gachaMachine}>
                  <div className={styles.assetPrompt}>
                    <span>Featured banner placeholder</span>
                    <p>
                      Image prompt: premium gacha website capsule machine, transparent glass sphere, collectible NASFAQ profile cards inside capsules, teal-black arcade cabinet, amber rim light, anime-inspired but professional, no text.
                    </p>
                  </div>
                  <div className={styles.capsuleRail} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>

                <div className={styles.pullConsolePanel}>
                  <span className={styles.rewardKicker}>Single pull</span>
                  <h3 className={styles.pullPrice}>{fmtNumber(game.entry_fee_cash, "$")}</h3>
                  <p className={styles.consoleCopy}>
                    Pull once for a profile cosmetic. New rewards go straight to your locker, while duplicates return a small cash rebate.
                  </p>

                  <div className={styles.pullBalanceCard}>
                    <span className={styles.metaLabel}>Wallet available</span>
                    <strong>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading..." : "Sign in"}</strong>
                    <span>{isLoadingAccount ? "Refreshing account state." : "Debited only when a pull succeeds."}</span>
                  </div>

                  {pullError ? <div className={`${styles.statusMessage} ${styles.statusError}`}>Pull failed: {pullError}</div> : null}

                  {user ? (
                    <button type="button" className={styles.actionButton} disabled={isPulling || isLoadingAccount} onClick={() => void handlePull()}>
                      <HiSparkles />
                      <span>{isPulling ? "Opening capsule..." : `Pull for ${fmtNumber(game.entry_fee_cash, "$")}`}</span>
                    </button>
                  ) : (
                    <Link href="/login" className={styles.actionLink}>
                      <FaPlay />
                      <span>Sign In To Pull</span>
                    </Link>
                  )}

                  <button type="button" className={styles.secondaryActionButton} onClick={() => setIsCatalogOpen(true)}>
                    <FaTicket />
                    <span>View prize catalogue</span>
                  </button>
                </div>
              </div>

              <div className={styles.gachaInfoGrid}>
                <article className={styles.rateCard}>
                  <FaStar />
                  <span className={styles.metaLabel}>Featured rewards</span>
                  <strong>Frames, themes, chat flair</strong>
                  <p>{gachaCatalog ? `${gachaCatalog.rewards.length} cosmetics in the current pool.` : "Image prompt for reward cards: three premium collectible profile cosmetics on dark glass pedestals, rarity color edges, no text."}</p>
                </article>
                <article className={styles.rateCard}>
                  <FaTicket />
                  <span className={styles.metaLabel}>Pull style</span>
                  <strong>One capsule at a time</strong>
                  <p>Keep the action clear and fast. The result appears immediately below the machine.</p>
                </article>
                <article className={styles.rateCard}>
                  <FaMoneyBillTrendUp />
                  <span className={styles.metaLabel}>Duplicates</span>
                  <strong>Cash rebate applied</strong>
                  <p>Duplicate compensation is shown after every pull so players understand what happened.</p>
                </article>
              </div>

              <div className={`${styles.resultCard} ${styles.gachaResult}`.trim()}>
                <div>
                  <span className={styles.rewardKicker}>Latest result</span>
                  <h3 className={styles.resultTitle}>
                    {latestPull
                      ? latestPull.pull.duplicate
                        ? "Duplicate converted to cash back"
                        : "New cosmetic unlocked"
                      : "Your next reward appears here"}
                  </h3>
                  <p className={styles.sectionCopy}>
                    {latestPull
                      ? "Use this area for the reward card art, rarity treatment, and wallet impact."
                      : "No pull yet this session. The first result will replace this empty state."}
                  </p>
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
                  <div className={styles.rewardPlaceholder}>
                    <span>Reward card placeholder</span>
                    <p>
                      Image prompt: collectible NASFAQ cosmetic card reveal, dark glass card, rarity border, profile frame asset centered, subtle confetti shards, no text.
                    </p>
                  </div>
                )}

                <div className={styles.resultGrid}>
                  <div className={styles.resultLine}>
                    <span className={styles.resultLabel}>Duplicate compensation</span>
                    <strong className={styles.resultValue}>{latestPull ? fmtNumber(latestPull.wallet.duplicate_compensation_cash, "$") : "-"}</strong>
                  </div>
                  <div className={styles.resultLine}>
                    <span className={styles.resultLabel}>Balance after pull</span>
                    <strong className={styles.resultValue}>{latestPull ? fmtNumber(latestPull.wallet.cash_balance_after, "$") : "-"}</strong>
                  </div>
                  <div className={styles.resultLine}>
                    <span className={styles.resultLabel}>Grant result</span>
                    <strong className={styles.resultValue}>{latestPull ? (latestPull.pull.granted_cosmetic ? "New cosmetic" : "Duplicate") : "-"}</strong>
                  </div>
                </div>
              </div>
            </section>

            <aside className={`${styles.panel} ${styles.gachaSidebar}`.trim()}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Your Locker</h2>
                  <p className={styles.sectionCopy}>Newest cosmetics and capsule sessions.</p>
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

              <Link href="/games/item-locker" className={styles.secondaryActionButton}>
                <FaBoxOpen />
                <span>Open item locker</span>
              </Link>

              <div className={styles.lockerList}>
                {recentCosmetics.length ? recentCosmetics.map((cosmetic) => (
                  <article key={cosmetic.id} className={styles.lockerItem}>
                    <strong className={styles.itemTitle}>{String(cosmetic.metadata.display_name || cosmetic.cosmetic_key)}</strong>
                    <span className={styles.itemMeta}>{cosmetic.rarity} · {cosmetic.cosmetic_type} · {fmtDate(cosmetic.granted_at)}</span>
                  </article>
                )) : (
                  <div className={styles.empty}>
                    Your recent cosmetics will show up here. Use profile frame, chat badge, and portfolio theme thumbnail art once assets are ready.
                  </div>
                )}
              </div>

              <div className={styles.sectionHead}>
                <div>
                  <h3 className={styles.sectionTitle}>Capsule History</h3>
                  <p className={styles.sectionCopy}>Your latest capsule runs.</p>
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

            {isCatalogOpen ? (
              <div className={styles.catalogModalBackdrop}>
                <section className={styles.catalogModal} role="dialog" aria-modal="true" aria-labelledby="gacha-catalog-title">
                  <div className={styles.catalogModalHead}>
                    <div>
                      <span className={styles.rewardKicker}>Capsule pool</span>
                      <h2 id="gacha-catalog-title" className={styles.catalogModalTitle}>Prize Catalogue</h2>
                      <p className={styles.sectionCopy}>
                        These rewards and chances come from the backend gacha reward pool, so you can edit the catalogue in one place.
                      </p>
                    </div>
                    <button type="button" className={styles.modalCloseButton} onClick={() => setIsCatalogOpen(false)}>
                      Close
                    </button>
                  </div>

                  {gachaCatalogError ? <div className={`${styles.statusMessage} ${styles.statusError}`}>Catalogue failed to load: {gachaCatalogError}</div> : null}

                  <div className={styles.catalogSummary}>
                    <div>
                      <span className={styles.metaLabel}>Pull price</span>
                      <strong>{fmtNumber(gachaCatalog?.game.entry_fee_cash ?? game.entry_fee_cash, "$")}</strong>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>Reward count</span>
                      <strong>{gachaCatalog?.rewards.length ?? 0}</strong>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>Duplicate rebate</span>
                      <strong>{fmtNumber(Number(game.config.duplicate_compensation_cash || 0), "$")}</strong>
                    </div>
                  </div>

                  <div className={styles.catalogList}>
                    {isLoadingGachaCatalog ? (
                      <div className={styles.empty}>Loading prize catalogue...</div>
                    ) : gachaCatalog?.rewards.length ? gachaCatalog.rewards.map((reward) => (
                      <article key={reward.key} className={styles.catalogRewardCard} style={{ "--reward-accent": rarityAccent(reward.rarity) } as CSSProperties}>
                        <div
                          className={styles.catalogRewardArt}
                          style={reward.image_url ? { backgroundImage: `linear-gradient(180deg, transparent, color-mix(in srgb, var(--bg-darkest) 82%, transparent)), url("${reward.image_url}")` } : undefined}
                        >
                          <span>{reward.rarity}</span>
                          <p>{reward.description || String(reward.metadata.image_prompt || "Cosmetic asset placeholder for this reward.")}</p>
                        </div>
                        <div className={styles.catalogRewardBody}>
                          <div>
                            <h3>{reward.display_name}</h3>
                            <p>{reward.type.replaceAll("_", " ")} · {reward.slot_key || "no slot"}</p>
                          </div>
                          <div className={styles.catalogChance}>
                            <span>Chance</span>
                            <strong>{formatPullChance(reward.pull_chance)}</strong>
                            <em>Weight {reward.weight}</em>
                          </div>
                        </div>
                      </article>
                    )) : (
                      <div className={styles.empty}>No rewards are configured yet.</div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        ) : isTickerTap && game ? (
          <div className={styles.layout} style={{ "--hero-accent": accent } as CSSProperties}>
            <section className={styles.panel}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Run Console</h2>
                  <p className={styles.sectionCopy}>
                    Buy in, stay sharp, and clear as many targets as you can before the clock hits zero.
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
                  Tap the numbered lanes or use keys `1-{tickerTapLaneCount}`. Misses cost rhythm, streaks build score.
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
                      Targets drop fast for {tickerTapConfig?.run_duration_seconds || 45}s. Hit clean, keep the streak alive, and climb the board.
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
                        ? "Your latest completed run."
                        : "Your score card will show up here after a run."}
                    </p>
                  </div>
                  <FaMoneyBillTrendUp />
                </div>

                {tickerTapRun.result ? (
                  <div className={styles.scoreHero}>
                    <span className={styles.scoreKicker}>Server Score</span>
                    <h4 className={styles.scoreValue}>{fmtNumber(tickerTapRun.result.session.score)}</h4>
                    <span className={styles.scoreMeta}>
                      Finished {fmtDate(tickerTapRun.result.session.completed_at)} · Accuracy {(tickerTapRun.result.result.submission.accuracy * 100).toFixed(0)}%
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
                  <p className={styles.sectionCopy}>Recent best scores from across NASFAQ.</p>
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
                  <p className={styles.sectionCopy}>Your latest runs.</p>
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
                <h2 className={styles.sectionTitle}>Coming Soon</h2>
                <p className={styles.sectionCopy}>{placeholderCopy(game)}</p>
              </div>
              {game?.game_type === "pvp" ? <FaUsers /> : <FaPlay />}
            </div>

            <div className={`${styles.statusMessage} ${styles.statusNeutral}`}>
              {game?.status === "draft"
                ? "This game is still in development."
                : "This game is almost ready."}
            </div>

            <Link href="/games" className={styles.actionLink}>Back to games hub</Link>
          </section>
        )}
      </div>
    </SiteShell>
  );
}
