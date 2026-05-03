"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FaArrowLeft, FaBoxOpen, FaClock, FaMoneyBillTrendUp, FaPlay, FaTicket, FaUsers } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtDate, fmtNumber } from "@/app/lib/format";
import {
  createTickerTapSession,
  fetchCapsuleGachaCatalog,
  fetchCapsuleGachaSpendingLeaderboard,
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
  GachaCatalogReward,
  GachaSpendingLeaderboardResponse,
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
type GachaRevealPhase = "idle" | "rolling" | "revealed";

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

const GACHA_REVEAL_DURATION_MS = 4_200;

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function GachaRevealCanvas({
  phase,
  rewards,
  result,
  nonce,
}: {
  phase: GachaRevealPhase;
  rewards: GachaCatalogReward[];
  result: GachaPullResult | null;
  nonce: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wonReward = result?.pull.reward || null;
  const isRevealed = phase === "revealed" && Boolean(wonReward);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let frame = 0;
    let cancelled = false;
    const startedAt = performance.now();
    const displayRewards = rewards.length
      ? rewards
      : wonReward
        ? [{
          key: wonReward.key,
          type: wonReward.type,
          rarity: wonReward.rarity,
          display_name: wonReward.display_name,
          description: wonReward.description,
          slot_key: wonReward.slot_key,
          weight: 1,
          pull_weight: 1,
          pull_chance: wonReward.pull_chance,
          image_key: wonReward.image_key,
          filename: "",
          image_url: wonReward.image_url,
          metadata: wonReward.metadata,
        }]
        : [];
    const cycle = displayRewards.length ? displayRewards : [{
      key: "pending",
      type: "cosmetic",
      rarity: "common",
      display_name: "Prize",
      description: "",
      slot_key: null,
      weight: 1,
      pull_weight: 1,
      pull_chance: 0,
      image_key: "",
      filename: "",
      image_url: "",
      metadata: {},
    }];
    const imageCache = new Map<string, HTMLImageElement>();
    Array.from(new Set(displayRewards.map((reward) => reward.image_url).filter(Boolean))).forEach((imageUrl) => {
      const image = new Image();
      image.decoding = "async";
      image.src = imageUrl;
      imageCache.set(imageUrl, image);
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const rarityColor = (rarity: string) => {
      const normalized = rarity.toLowerCase();
      if (normalized === "legendary") return "#d6a53a";
      if (normalized === "epic") return "#a78bfa";
      if (normalized === "rare") return "#67b7dc";
      return "#d9c7a3";
    };
    const easeInOut = (value: number) => value < 0.5
      ? 4 * value * value * value
      : 1 - Math.pow(-2 * value + 2, 3) / 2;
    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
    const drawCoverImage = (image: HTMLImageElement, radius: number) => {
      const imageRatio = image.naturalWidth / image.naturalHeight;
      const size = radius * 1.78;
      const targetRatio = 1;
      let drawWidth = size;
      let drawHeight = size;
      if (imageRatio > targetRatio) {
        drawWidth = size * imageRatio;
      } else {
        drawHeight = size / imageRatio;
      }
      ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    };
    const drawBubble = (
      reward: GachaCatalogReward,
      x: number,
      y: number,
      radius: number,
      alpha: number,
      scale = 1,
    ) => {
      const color = rarityColor(reward.rarity);
      const image = reward.image_url ? imageCache.get(reward.image_url) : null;
      const hasLoadedImage = Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.shadowColor = color;
      ctx.shadowBlur = radius * 0.32;
      ctx.fillStyle = "rgba(8, 13, 24, 0.38)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (hasLoadedImage && image) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.92, 0, Math.PI * 2);
        ctx.clip();
        drawCoverImage(image, radius);
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha * 0.22;
        ctx.beginPath();
        ctx.arc(0, -radius * 0.08, radius * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
      }

      const glass = ctx.createRadialGradient(-radius * 0.34, -radius * 0.42, 0, 0, 0, radius);
      glass.addColorStop(0, "rgba(255, 255, 255, 0.38)");
      glass.addColorStop(0.22, "rgba(255, 255, 255, 0.14)");
      glass.addColorStop(0.5, "rgba(255, 255, 255, 0.06)");
      glass.addColorStop(1, "rgba(10, 15, 27, 0.38)");
      ctx.fillStyle = glass;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.36)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(-radius * 0.24, -radius * 0.22, radius * 0.48, Math.PI * 1.05, Math.PI * 1.55);
      ctx.stroke();
      ctx.fillStyle = "rgba(8, 13, 24, 0.62)";
      ctx.beginPath();
      ctx.roundRect(-radius * 0.76, radius * 0.34, radius * 1.52, radius * 0.32, radius * 0.16);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = `800 ${Math.max(8, radius * 0.11)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(reward.rarity.toUpperCase(), 0, radius * 0.5, radius * 1.28);
      ctx.restore();
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      if (cancelled) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const centerX = width / 2;
      const centerY = height / 2;
      const elapsed = now - startedAt;
      const progress = phase === "rolling"
        ? Math.min(1, elapsed / GACHA_REVEAL_DURATION_MS)
        : 1;
      const speedCurve = Math.sin(Math.min(1, progress) * Math.PI);
      const spacing = Math.max(86, height * 0.22);
      const baseOffset = ((elapsed * (0.72 + speedCurve * 3.8)) % spacing);
      const wonAsCatalog = wonReward
        ? (displayRewards.find((reward) => reward.key === wonReward.key) || {
          key: wonReward.key,
          type: wonReward.type,
          rarity: wonReward.rarity,
          display_name: wonReward.display_name,
          description: wonReward.description,
          slot_key: wonReward.slot_key,
          weight: 1,
          pull_weight: 1,
          pull_chance: wonReward.pull_chance,
          image_key: wonReward.image_key,
          filename: "",
          image_url: wonReward.image_url,
          metadata: wonReward.metadata,
        })
        : null;
      const winnerLandStart = 0.62;
      const winnerJumpStart = 0.72;
      const jumpProgress = wonAsCatalog && phase === "rolling"
        ? easeInOut(clamp01((progress - winnerJumpStart) / (1 - winnerJumpStart)))
        : phase === "revealed" && wonAsCatalog
          ? 1
          : 0;
      const winnerLineProgress = wonAsCatalog
        ? clamp01((progress - winnerLandStart) / (winnerJumpStart - winnerLandStart))
        : 0;
      const lineAlpha = phase === "rolling"
        ? wonAsCatalog
          ? Math.max(0, 1 - jumpProgress * 3.4)
          : 1
        : 0;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(10, 15, 27, 0.94)";
      ctx.fillRect(0, 0, width, height);

      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.72);
      gradient.addColorStop(0, "rgba(249, 115, 22, 0.22)");
      gradient.addColorStop(1, "rgba(10, 15, 27, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      if (phase === "idle") {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, Math.min(width, height) * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        frame = window.requestAnimationFrame(draw);
        return;
      }

      if (lineAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = lineAlpha;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, height);
        ctx.stroke();
        ctx.restore();

        const visibleCount = Math.ceil(height / spacing) + 5;
        for (let index = -2; index < visibleCount; index += 1) {
          const reward = cycle[Math.abs(index + Math.floor(elapsed / spacing)) % cycle.length];
          const rawY = index * spacing + baseOffset - spacing;
          const distance = Math.abs(rawY - centerY);
          if (wonAsCatalog && progress >= winnerLandStart && distance < spacing * 0.48) {
            continue;
          }
          const alpha = Math.max(0.14, 1 - distance / (height * 0.72)) * lineAlpha;
          drawBubble(reward, centerX, rawY, Math.min(52, spacing * 0.34), alpha, 1);
        }
      }

      if (wonAsCatalog) {
        const finalScale = 1 + jumpProgress * 1.08;
        const finalAlpha = phase === "revealed" ? 1 : Math.max(winnerLineProgress, jumpProgress);
        const liftY = centerY - Math.sin(jumpProgress * Math.PI) * 18;
        const color = rarityColor(wonAsCatalog.rarity);
        ctx.save();
        ctx.globalAlpha = finalAlpha * jumpProgress;
        ctx.strokeStyle = color;
        for (let ring = 0; ring < 4; ring += 1) {
          ctx.globalAlpha = finalAlpha * jumpProgress * (0.3 - ring * 0.05);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(centerX, liftY, 76 + ring * 28 + Math.sin(elapsed / 420 + ring) * 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        drawBubble(wonAsCatalog, centerX, liftY, 58, finalAlpha, finalScale);
      }

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [phase, rewards, wonReward, nonce]);

  return (
    <div className={`${styles.gachaRevealStage} ${isRevealed ? styles.gachaRevealStageComplete : ""}`.trim()}>
      <canvas ref={canvasRef} className={styles.gachaRevealCanvas} aria-hidden="true" />
      <div className={styles.gachaRevealOverlay} aria-live="polite">
        {wonReward && isRevealed ? (
          <>
            <span>You received: {wonReward.display_name}</span>
            <strong>{wonReward.rarity} · {formatPullChance(wonReward.pull_chance)} probability</strong>
          </>
        ) : phase === "rolling" ? (
          <span>Opening capsule...</span>
        ) : (
          <span>Ready for a pull</span>
        )}
      </div>
    </div>
  );
}

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
  const [pendingPull, setPendingPull] = useState<GachaPullResult | null>(null);
  const [gachaRevealPhase, setGachaRevealPhase] = useState<GachaRevealPhase>("idle");
  const [gachaRevealNonce, setGachaRevealNonce] = useState(0);
  const [tickerTapRun, setTickerTapRun] = useState<TickerTapRunState>(INITIAL_TICKER_TAP_RUN_STATE);
  const [tickerTapBoard, setTickerTapBoard] = useState<TickerTapLeaderboardResponse | null>(null);
  const [isLoadingGame, setIsLoadingGame] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isLoadingGachaCatalog, setIsLoadingGachaCatalog] = useState(false);
  const [gachaSpendingBoard, setGachaSpendingBoard] = useState<GachaSpendingLeaderboardResponse | null>(null);
  const [isLoadingGachaSpendingBoard, setIsLoadingGachaSpendingBoard] = useState(false);
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
    setPendingPull(null);
    setGachaRevealPhase("rolling");
    try {
      const pullResult = await pullCapsuleGacha(1);
      setPendingPull(pullResult);
      setGachaRevealNonce((current) => current + 1);
      await wait(GACHA_REVEAL_DURATION_MS);
      setLatestPull(pullResult);
      setPendingPull(null);
      setGachaRevealPhase("revealed");
      await loadAccount();
    } catch (error) {
      setPullError(String((error as Error).message || error));
      setGachaRevealPhase(latestPull ? "revealed" : "idle");
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
      setLatestPull(null);
      setPendingPull(null);
      setGachaRevealPhase("idle");
      return;
    }

    let cancelled = false;
    void (async () => {
      setIsLoadingGachaCatalog(true);
      setGachaCatalogError(null);
      setIsLoadingGachaSpendingBoard(true);
      try {
        const [catalogResult, boardResult] = await Promise.all([
          fetchCapsuleGachaCatalog(),
          fetchCapsuleGachaSpendingLeaderboard(),
        ]);
        if (!cancelled) {
          setGachaCatalog(catalogResult);
          setGachaSpendingBoard(boardResult);
        }
      } catch (error) {
        if (!cancelled) {
          setGachaCatalogError(String((error as Error).message || error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGachaCatalog(false);
          setIsLoadingGachaSpendingBoard(false);
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
  const gachaRevealPull = pendingPull || latestPull;
  const gachaRewards = gachaCatalog?.rewards || [];
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
              </div>
              <div className={styles.metaCard}>
                <span className={styles.metaLabel}>Wallet</span>
                <strong className={styles.metaValue}>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading…" : "Sign in"}</strong>
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
                </div>
                <HiSparkles />
              </div>

              <div className={styles.gachaHeroGrid}>
                <div className={styles.gachaMachine}>
                  <GachaRevealCanvas
                    phase={gachaRevealPhase}
                    rewards={gachaRewards}
                    result={gachaRevealPull}
                    nonce={gachaRevealNonce}
                  />
                </div>

                <div className={styles.pullConsolePanel}>
                  <span className={styles.rewardKicker}>Single pull</span>
                  <h3 className={styles.pullPrice}>{fmtNumber(game.entry_fee_cash, "$")}</h3>

                  <div className={styles.pullBalanceCard}>
                    <span className={styles.metaLabel}>Wallet available</span>
                    <strong>{summary ? fmtNumber(summary.cash_balance, "$") : user ? "Loading..." : "Sign in"}</strong>
                    <span>{isLoadingAccount ? "Refreshing." : `${gachaRewards.length} prizes in the pool.`}</span>
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
                    <span>Prize catalogue</span>
                  </button>
                </div>
              </div>

              <div className={`${styles.resultCard} ${styles.gachaResult}`.trim()}>
                <div>
                  <span className={styles.rewardKicker}>Latest result</span>
                  <h3 className={styles.resultTitle}>
                    {latestPull ? latestPull.pull.reward.display_name : "No pull yet"}
                  </h3>
                </div>

                {latestPull ? (
                  <div className={styles.rewardHero} style={{ "--reward-accent": rarityAccent(latestPull.pull.reward.rarity) } as CSSProperties}>
                    <span className={styles.rewardKicker}>{latestPull.pull.reward.rarity}</span>
                    <h4 className={styles.rewardTitle}>{latestPull.pull.reward.display_name}</h4>
                    <span className={styles.rewardMeta}>
                      {formatPullChance(latestPull.pull.reward.pull_chance)} chance · {fmtDate(latestPull.pull.created_at)}
                    </span>
                  </div>
                ) : (
                  <div className={styles.rewardPlaceholder}>
                    <span>Ready</span>
                  </div>
                )}

                <div className={styles.resultGrid}>
                  <div className={styles.resultLine}>
                    <span className={styles.resultLabel}>Prize type</span>
                    <strong className={styles.resultValue}>{latestPull ? latestPull.pull.reward.type.replaceAll("_", " ") : "-"}</strong>
                  </div>
                  <div className={styles.resultLine}>
                    <span className={styles.resultLabel}>Balance after pull</span>
                    <strong className={styles.resultValue}>{latestPull ? fmtNumber(latestPull.wallet.cash_balance_after, "$") : "-"}</strong>
                  </div>
                  <div className={styles.resultLine}>
                    <span className={styles.resultLabel}>Locker item</span>
                    <strong className={styles.resultValue}>{latestPull ? `#${latestPull.pull.granted_cosmetic?.id || latestPull.pull.id}` : "-"}</strong>
                  </div>
                </div>
              </div>
            </section>

            <aside className={`${styles.panel} ${styles.gachaSidebar}`.trim()}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Your Locker</h2>
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

              <div className={styles.sectionHead}>
                <div>
                  <h3 className={styles.sectionTitle}>Spending Leaderboard</h3>
                  <p className={styles.sectionCopy}>Top spenders on Capsule Gacha.</p>
                </div>
                <FaMoneyBillTrendUp />
              </div>

              <div className={styles.boardList}>
                {isLoadingGachaSpendingBoard ? (
                  <div className={styles.empty}>Loading leaderboard…</div>
                ) : gachaSpendingBoard?.leaderboard.length ? gachaSpendingBoard.leaderboard.slice(0, 8).map((entry) => (
                  <Link
                    key={entry.user_id}
                    href={`/profile/${encodeURIComponent(entry.username)}`}
                    className={styles.boardItem}
                  >
                    <div className={styles.boardHeading}>
                      <span className={styles.boardRank}>#{entry.rank}</span>
                      <strong className={styles.boardName} style={entry.profile_color ? { color: entry.profile_color } : undefined}>
                        {entry.username}
                      </strong>
                      <span className={styles.boardScore}>{fmtNumber(entry.total_spent_cash, "$")}</span>
                    </div>
                    <span className={styles.itemMeta}>
                      {entry.pull_count} pulls
                    </span>
                  </Link>
                )) : (
                  <div className={styles.empty}>No spending data yet.</div>
                )}
              </div>
            </aside>

            {isCatalogOpen ? (
              <div className={styles.catalogModalBackdrop}>
                <section className={styles.catalogModal} role="dialog" aria-modal="true" aria-labelledby="gacha-catalog-title">
                  <div className={styles.catalogModalHead}>
                    <div>
                      <span className={styles.rewardKicker}>Capsule pool</span>
                      <h2 id="gacha-catalog-title" className={styles.catalogModalTitle}>Prize Catalogue</h2>
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
                      <span className={styles.metaLabel}>Duplicates</span>
                      <strong>Allowed</strong>
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
