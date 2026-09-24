"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { GamesFrame } from "@/app/components/games/shell/games-frame";
import { MIN_REAL_MS } from "@/app/components/games/ticker-tap/engine";
import { Lobby } from "@/app/components/games/ticker-tap/lobby";
import { RunResults, type PostedRun } from "@/app/components/games/ticker-tap/results";
import { RunStage, type RunEnd } from "@/app/components/games/ticker-tap/run-stage";
import { fetchTickerTapBoard, startTickerTap, submitTickerTap } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import type { Talent, TickerTapBoard, TickerTapSession } from "@/app/lib/games/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useGamesStore } from "@/app/stores/games-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/games/ticker-tap/ticker-tap.module.scss";

const SUBMIT_MARGIN_MS = 600;

export function TickerTapPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [board, setBoard] = useState<TickerTapBoard | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [active, setActive] = useState<{ session: TickerTapSession; createdAt: number; best: number | null } | null>(null);
  const [posted, setPosted] = useState<PostedRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const collection = useGamesStore((state) => state.collection);
  const loadCollection = useGamesStore((state) => state.loadCollection);
  const resultsRef = useRef<HTMLDivElement>(null);

  const talents = useMemo(() => new Map<string, Talent>((collection?.talents ?? []).map((talent) => [talent.symbol, talent])), [collection]);
  const fee = board?.game?.entry_fee_cash ?? 100;

  const loadBoard = useCallback(async () => {
    try {
      const next = await fetchTickerTapBoard();
      setBoard(next);
      setBoardError(null);
      return next;
    } catch (error) {
      setBoardError(gameErrorText(error));
      return null;
    }
  }, []);

  // The board, refreshed every 30 s while you're in the lobby (the pool moves as others play).
  useEffect(() => {
    if (active) return;
    const first = window.setTimeout(() => void loadBoard(), 0);
    const timer = window.setInterval(() => void loadBoard(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active, loadBoard, userId]);

  useEffect(() => {
    if (user && !collection) void loadCollection({ quiet: true });
  }, [user, collection, loadCollection]);

  const play = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const { session } = await startTickerTap();
      setActive({ session, createdAt: performance.now(), best: board?.me?.score ?? null });
      setPosted(null);
      void useProfileStore.getState().fetchPortfolio();
      void loadBoard();
    } catch (error) {
      setStartError(gameErrorText(error));
    } finally {
      setStarting(false);
    }
  }, [board, loadBoard, starting]);

  const submit = useCallback(
    async (run: PostedRun) => {
      setPosted({ ...run, status: "posting", error: undefined });
      try {
        const response = await submitTickerTap(run.sessionId, run.end.taps);
        setPosted({ ...run, status: "done", response });
        await loadBoard();
      } catch (error) {
        const code = String((error as Error)?.message ?? "");
        // Too early by a hair (clock skew): wait a beat and go again.
        if (code === "run_too_fast") {
          setPosted({ ...run, status: "waiting", submitAt: performance.now() + 1500 });
          return;
        }
        setPosted({ ...run, status: "error", error: gameErrorText(error) });
      }
    },
    [loadBoard],
  );

  // A run can't post until 42 s after its session was created. Normal runs are well past it;
  // quit runs wait here (off the stage) and post whatever they scored.
  useEffect(() => {
    if (!posted || posted.status !== "waiting") return;
    const timer = window.setTimeout(() => void submit(posted), Math.max(0, posted.submitAt - performance.now()));
    return () => window.clearTimeout(timer);
  }, [posted, submit]);

  const onEnd = useCallback(
    (end: RunEnd) => {
      if (!active) return;
      const submitAt = active.createdAt + MIN_REAL_MS + SUBMIT_MARGIN_MS;
      setPosted({ sessionId: active.session.id, createdAt: active.createdAt, end, status: "waiting", submitAt });
      setActive(null);
      window.requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ block: "start" }));
    },
    [active],
  );

  return (
    <GamesFrame
      kicker="Arcade · weekly pool"
      title="Ticker Tap"
      live={Boolean(board && board.week.runs > 0)}
      blurb={
        <>
          Tap the greens, dodge the reds, grab the gold. <b>45</b>s a run; the top <b>10</b> split the pot every Monday.
        </>
      }
    >
      <div className={styles.page} ref={resultsRef}>
        {posted ? (
          <RunResults
            run={posted}
            board={board}
            userId={userId}
            fee={fee}
            starting={starting}
            startError={startError}
            onPlay={play}
            onRetry={() => void submit(posted)}
            onDismiss={() => setPosted(null)}
          />
        ) : null}
        <Lobby
          board={board}
          boardError={boardError}
          signedIn={Boolean(user)}
          userId={userId}
          needsVerification={userNeedsEmailVerification(user)}
          fee={fee}
          starting={starting}
          startError={posted ? null : startError}
          onPlay={play}
          compactHero={Boolean(posted)}
        />
      </div>
      {active ? <RunStage session={active.session} talents={talents} board={board} userId={userId} personalBest={active.best} onEnd={onEnd} /> : null}
    </GamesFrame>
  );
}
