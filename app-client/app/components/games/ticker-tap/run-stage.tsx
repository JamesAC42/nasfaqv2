"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FiX } from "react-icons/fi";
import { Oshimark } from "@/app/components/common/oshimark";
import { fmtPayout, placementFor } from "@/app/components/games/ticker-tap/board-math";
import { LANES, LiveScorer, MAX_TAPS, RUN_MS, runEndMs, scoreRun, splitPool, type Tap, type TapOutcome } from "@/app/components/games/ticker-tap/engine";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import type { Talent, TapReplay, TapTarget, TickerTapBoard, TickerTapSession } from "@/app/lib/games/types";
import { getIconUrl } from "@/app/lib/normalizers";
import { talentAccent } from "@/app/lib/talent-color";
import { isCalm } from "@/app/providers/motion-provider";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/games/ticker-tap/run-stage.module.scss";

const COUNTDOWN_MS = 3000;
const TIME_BANNER_MS = 1100;
const KEY_LANES: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, d: 0, f: 1, j: 2, k: 3, l: 4 };
const LANE_KEYS = ["1 · D", "2 · F", "3 · J", "4 · K", "5 · L"];
const GLYPH: Record<TapTarget["kind"], string> = { up: "▲", down: "▼", gold: "★" };

export type RunEnd = { taps: Tap[]; local: TapReplay; quit: boolean; wasHidden: boolean };

type Effect =
  | { id: number; born: number; type: "pop"; lane: number; y: number; kind: TapTarget["kind"]; symbol: string | null; points: number; multiplier: number }
  | { id: number; born: number; type: "red"; lane: number; y: number; symbol: string | null; points: number; broke: number }
  | { id: number; born: number; type: "miss"; lane: number; points: number; broke: number }
  | { id: number; born: number; type: "escape"; lane: number; y: number; kind: TapTarget["kind"]; symbol: string | null; broke: number }
  | { id: number; born: number; type: "mult"; multiplier: number; combo: number };

type EffectInput = Effect extends infer E ? (E extends Effect ? Omit<E, "id" | "born"> : never) : never;

/** What one animation frame shows. The loop snapshots the scorer into this so render stays pure. */
type Frame = { t: number; effects: Effect[]; visible: TapTarget[]; score: number; combo: number; multiplier: number };

const EFFECT_MS: Record<Effect["type"], number> = { pop: 650, red: 650, miss: 450, escape: 600, mult: 1000 };

/** Where a target sits in its lane (0-100, % of lane height). Deterministic per target. */
const targetY = (target: TapTarget) => 12 + ((target.index * 53 + target.lane * 17) % 50);

type RunStageProps = {
  session: TickerTapSession;
  talents: Map<string, Talent>;
  board: TickerTapBoard | null;
  userId: string | number | null;
  personalBest: number | null;
  onEnd: (end: RunEnd) => void;
};

export function RunStage({ session, talents, board, userId, personalBest, onEnd }: RunStageProps) {
  const timeline = session.config.timeline;
  const { theme } = useTheme();
  const endMs = useMemo(() => runEndMs(timeline), [timeline]);
  const [scorer] = useState(() => new LiveScorer(timeline));
  const tapsRef = useRef<Tap[]>([]);
  const t0Ref = useRef(0);
  const effectsRef = useRef<Effect[]>([]);
  const effectId = useRef(0);
  const endedRef = useRef(false);
  const hiddenRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastMultRef = useRef(1);
  const [frame, setFrame] = useState<Frame>({ t: -COUNTDOWN_MS, effects: [], visible: [], score: 0, combo: 0, multiplier: 1 });
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [pressed, setPressed] = useState<{ lane: number; tone: string; id: number }[]>([]);
  const [ended, setEnded] = useState<null | "time" | "quit">(null);
  const [wasHidden, setWasHidden] = useState(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const pushEffect = useCallback((effect: EffectInput, born: number) => {
    effectId.current += 1;
    effectsRef.current = [...effectsRef.current, { ...effect, id: effectId.current, born } as Effect];
  }, []);

  const noteEscapes = useCallback(
    (escaped: ReturnType<LiveScorer["advance"]>, at: number) => {
      for (const { target, brokeCombo } of escaped) {
        pushEffect({ type: "escape", lane: target.lane, y: targetY(target), kind: target.kind, symbol: target.symbol, broke: brokeCombo }, at);
      }
      if (escaped.length) lastMultRef.current = scorer.multiplier;
    },
    [pushEffect, scorer],
  );

  const finish = useCallback(
    (quit: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const taps = tapsRef.current.slice();
      // The live tally and a from-scratch replay must agree; the replay is what the server runs.
      const live = scorer.finish();
      const local = scoreRun(timeline, taps);
      if (live.score !== local.score && process.env.NODE_ENV !== "production") console.warn("ticker-tap: live score drifted from replay", live, local);
      setEnded(quit ? "quit" : "time");
      window.setTimeout(() => onEndRef.current({ taps, local, quit, wasHidden: hiddenRef.current }), quit ? 0 : TIME_BANNER_MS);
    },
    [scorer, timeline],
  );

  // Preload every oshimark on the tape so nothing pops in mid-run.
  useEffect(() => {
    const seen = new Set<string>();
    for (const target of timeline) {
      const icon = target.symbol ? talents.get(target.symbol)?.icon : null;
      const url = getIconUrl(icon);
      if (url && !seen.has(url)) {
        seen.add(url);
        const img = new Image();
        img.src = url;
      }
    }
  }, [timeline, talents]);

  // Lock the page under the stage: no scroll, no rubber-banding, no accidental navigation.
  useEffect(() => {
    const html = document.documentElement;
    const previous = { htmlOverflow: html.style.overflow, bodyOverflow: document.body.style.overflow, overscroll: html.style.overscrollBehavior };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (endedRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    stageRef.current?.focus({ preventScroll: true });
    return () => {
      html.style.overflow = previous.htmlOverflow;
      document.body.style.overflow = previous.bodyOverflow;
      html.style.overscrollBehavior = previous.overscroll;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  // The clock. rAF drives the picture; a slow interval ends the run even if the tab is hidden.
  useEffect(() => {
    t0Ref.current = performance.now() + COUNTDOWN_MS;
    let frame = 0;
    const loop = () => {
      const t = performance.now() - t0Ref.current;
      if (t >= 0 && !endedRef.current) noteEscapes(scorer.advance(t), t);
      effectsRef.current = effectsRef.current.filter((effect) => t - effect.born < EFFECT_MS[effect.type]);
      setFrame({
        t,
        effects: effectsRef.current,
        visible: timeline.filter((target) => target.start_ms <= t && t < target.start_ms + target.life_ms && !scorer.hit.has(target.index)),
        score: scorer.score,
        combo: scorer.combo,
        multiplier: scorer.multiplier,
      });
      if (t >= endMs) finish(false);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const timer = window.setInterval(() => {
      if (performance.now() - t0Ref.current >= endMs) finish(false);
    }, 500);
    const onVisibility = () => {
      if (document.hidden && !endedRef.current && performance.now() - t0Ref.current > -COUNTDOWN_MS) {
        hiddenRef.current = true;
        setWasHidden(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [endMs, finish, noteEscapes, scorer, timeline]);

  const feedback = useCallback(
    (outcome: TapOutcome, lane: number, t: number) => {
    const calm = isCalm();
    let tone = "miss";
    if (outcome.type === "hit") {
      tone = outcome.target.kind;
      pushEffect({ type: "pop", lane, y: targetY(outcome.target), kind: outcome.target.kind, symbol: outcome.target.symbol, points: outcome.points, multiplier: outcome.multiplier }, t);
      const mult = scorer.multiplier;
      if (mult > lastMultRef.current) pushEffect({ type: "mult", multiplier: mult, combo: scorer.combo }, t);
      lastMultRef.current = mult;
    } else if (outcome.type === "red") {
      tone = "down";
      pushEffect({ type: "red", lane, y: targetY(outcome.target), symbol: outcome.target.symbol, points: outcome.points, broke: outcome.brokeCombo }, t);
      lastMultRef.current = 1;
      if (!calm) {
        stageRef.current?.animate(
          [{ transform: "translate(0,0)" }, { transform: "translate(-7px,2px)" }, { transform: "translate(6px,-2px)" }, { transform: "translate(-4px,1px)" }, { transform: "translate(0,0)" }],
          { duration: 260, easing: "ease-out" },
        );
        navigator.vibrate?.(40);
      }
    } else {
      pushEffect({ type: "miss", lane, points: outcome.points, broke: outcome.brokeCombo }, t);
      lastMultRef.current = 1;
    }
    effectId.current += 1;
    const id = effectId.current;
    setPressed((current) => [...current.filter((press) => press.lane !== lane), { lane, tone, id }]);
    },
    [pushEffect, scorer],
  );

  const tap = useCallback(
    (lane: number) => {
      if (endedRef.current) return;
      const raw = performance.now() - t0Ref.current;
      if (raw < 0 || raw > endMs || tapsRef.current.length >= MAX_TAPS) return;
      // Strictly increasing t: the server sorts by t, and ties between lanes would be ambiguous.
      const last = tapsRef.current[tapsRef.current.length - 1];
      const t = last && raw <= last.t ? last.t + 0.01 : raw;
      tapsRef.current.push({ lane, t });
      const { outcome, escaped } = scorer.tap(lane, t);
      noteEscapes(escaped, t);
      feedback(outcome, lane, t);
    },
    [endMs, feedback, noteEscapes, scorer],
  );

  // Keyboard: 1-5 or D F J K L. Escape asks to quit.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        setConfirmQuit((open) => !open);
        return;
      }
      const lane = KEY_LANES[event.key.toLowerCase()];
      if (lane === undefined) return;
      event.preventDefault();
      if (event.repeat) return;
      tap(lane);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tap]);

  const { t, effects, visible } = frame;
  const running = t >= 0 && !ended;
  const countdown = t < 0 ? Math.ceil(-t / 1000) : null;
  const timeLeft = Math.max(0, RUN_MS - Math.max(0, t));
  const calm = typeof document !== "undefined" && isCalm();
  const pace = placementFor(board, Math.max(0, frame.score), userId, 0);
  const beatingBest = personalBest !== null && frame.score > personalBest;
  const progress = Math.min(1, Math.max(0, t) / RUN_MS);
  // The tape under the lanes scrolls faster as the run speeds up (integral of a linear ramp).
  const tapeScroll = calm || t <= 0 ? 0 : 0.06 * (Math.min(t, endMs) + (0.7 * Math.min(t, endMs) ** 2) / RUN_MS);
  const accent = (symbol: string | null) => talentAccent(symbol ? talents.get(symbol)?.color : null, theme);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Ticker Tap run">
      <LiveLadder board={board} userId={userId} score={Math.max(0, frame.score)} />
      <div className={styles.stage} ref={stageRef} tabIndex={-1} data-ended={ended || undefined} style={{ "--progress": progress } as CSSProperties}>
        <header className={styles.hud}>
          <button type="button" className={styles.quit} aria-label="Quit run" onClick={() => setConfirmQuit(true)} disabled={Boolean(ended)}>
            <FiX aria-hidden="true" />
          </button>
          <div className={styles.scoreBox}>
            <span className={styles.hudLabel}>Score</span>
            <b className={styles.score} data-neg={frame.score < 0 || undefined}>
              {fmtInteger(frame.score)}
            </b>
          </div>
          <div className={styles.comboBox} data-mult={frame.multiplier} data-live={frame.combo > 0 || undefined}>
            <b className={styles.mult}>×{frame.multiplier}</b>
            <span className={styles.combo}>
              <span className={styles.hudLabel}>Combo</span> {frame.combo}
            </span>
            <span className={styles.comboPips} aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => (
                <i key={index} data-on={(frame.multiplier >= 3 ? 5 : frame.combo % 5) > index || undefined} />
              ))}
            </span>
          </div>
          <div className={styles.timeBox}>
            <span className={styles.hudLabel}>Time</span>
            <b className={styles.time} data-low={timeLeft < 10_000 || undefined}>
              {(timeLeft / 1000).toFixed(1)}
            </b>
          </div>
          <div className={styles.timeBar} aria-hidden="true">
            <i style={{ transform: `scaleX(${1 - progress})` }} />
          </div>
          <div className={styles.paceRow}>
            <span>
              Pace <b>#{pace.rank}</b>
              {pace.inMoney ? (
                <>
                  {" "}
                  · <b className={styles.pacePay}>{fmtPayout(pace.payout)}</b>
                </>
              ) : (
                " · outside top 10"
              )}
            </span>
            {personalBest !== null ? (
              <span data-beat={beatingBest || undefined}>
                {beatingBest ? "Beating week best" : "Week best"} <b>{fmtInteger(personalBest)}</b>
              </span>
            ) : null}
          </div>
        </header>

        <div className={styles.lanes} data-calm={calm || undefined} style={{ "--scroll": `${(tapeScroll % 40).toFixed(1)}px` } as CSSProperties}>
          {Array.from({ length: LANES }, (_, lane) => {
            const press = pressed.find((item) => item.lane === lane);
            return (
              <button
                key={lane}
                type="button"
                className={styles.lane}
                aria-label={`Lane ${lane + 1}`}
                tabIndex={-1}
                onPointerDown={(event) => {
                  event.preventDefault();
                  tap(lane);
                }}
                onClick={(event) => {
                  // Keyboard activation of a focused lane (detail 0); pointer taps land on pointerdown.
                  if (event.detail === 0) tap(lane);
                }}
                onContextMenu={(event) => event.preventDefault()}
              >
                {press ? <span key={press.id} className={styles.press} data-tone={press.tone} aria-hidden="true" /> : null}
                {visible
                  .filter((target) => target.lane === lane)
                  .map((target) => {
                    const age = (t - target.start_ms) / target.life_ms;
                    const talent = target.symbol ? talents.get(target.symbol) : undefined;
                    return (
                      <span
                        key={target.index}
                        className={styles.tile}
                        data-kind={target.kind}
                        data-index={target.index}
                        data-urgent={age > 0.68 || undefined}
                        style={{ top: `${targetY(target)}%`, "--age": age, "--tal": accent(target.symbol) } as CSSProperties}
                        aria-hidden="true"
                      >
                        <span className={styles.glyph}>{GLYPH[target.kind]}</span>
                        <Oshimark icon={talent?.icon} symbol={target.symbol ?? undefined} size={24} className={styles.mark} />
                        <span className={styles.sym}>{target.symbol ?? "???"}</span>
                        <i className={styles.life} />
                      </span>
                    );
                  })}
                {effects.map((effect) => {
                  if (effect.type === "mult" || effect.lane !== lane) return null;
                  if (effect.type === "pop") {
                    return (
                      <span key={effect.id} className={styles.pop} data-kind={effect.kind} style={{ top: `${effect.y}%` }} aria-hidden="true">
                        <span className={styles.burst} />
                        {effect.kind === "gold" && !calm ? (
                          <span className={styles.sparks}>
                            {Array.from({ length: 8 }, (_, index) => (
                              <i key={index} style={{ "--a": `${index * 45 + 20}deg` } as CSSProperties}>
                                ★
                              </i>
                            ))}
                          </span>
                        ) : null}
                        <b className={styles.points}>+{effect.points}</b>
                        {effect.multiplier > 1 ? <small className={styles.pointsMult}>×{effect.multiplier}</small> : null}
                      </span>
                    );
                  }
                  if (effect.type === "red") {
                    return (
                      <span key={effect.id} className={styles.pop} data-kind="down" style={{ top: `${effect.y}%` }} aria-hidden="true">
                        <span className={styles.burst} />
                        <b className={styles.points}>{effect.points}</b>
                        {effect.broke >= 2 ? <small className={styles.broke}>Combo {effect.broke} gone</small> : null}
                      </span>
                    );
                  }
                  if (effect.type === "miss") {
                    return (
                      <span key={effect.id} className={styles.whiff} aria-hidden="true">
                        <b>{effect.points}</b>
                        {effect.broke >= 2 ? <small>Combo {effect.broke} gone</small> : null}
                      </span>
                    );
                  }
                  return [
                    <span key={`${effect.id}f`} className={styles.escFlash} aria-hidden="true" />,
                    <span key={effect.id} className={styles.escape} data-kind={effect.kind} style={{ top: `${effect.y}%` }} aria-hidden="true">
                      <span className={styles.escTile}>{GLYPH[effect.kind]}</span>
                      <small>{effect.broke >= 2 ? `Got away · combo ${effect.broke} gone` : "Got away"}</small>
                    </span>,
                  ];
                })}
                <span className={styles.laneKey} aria-hidden="true">
                  {LANE_KEYS[lane]}
                </span>
              </button>
            );
          })}

          {effects.map((effect) =>
            effect.type === "mult" ? (
              <div key={effect.id} className={styles.multBanner} data-max={effect.multiplier >= 3 || undefined} aria-hidden="true">
                <b>×{effect.multiplier}</b>
                <span>{effect.multiplier >= 3 ? "Max combo" : `${effect.combo} in a row`}</span>
              </div>
            ) : null,
          )}

          {countdown !== null ? (
            <div className={styles.countdown} aria-live="assertive">
              <b key={countdown}>{countdown}</b>
              <p>
                Tap <span data-kind="up">▲</span> and <span data-kind="gold">★</span>. Leave <span data-kind="down">▼</span> alone.
              </p>
              <p className={styles.countKeys}>Tap a lane · keys 1–5 or D F J K L</p>
            </div>
          ) : running && t < 700 ? (
            <div className={styles.countdown} aria-hidden="true">
              <b className={styles.go}>Go</b>
            </div>
          ) : null}

          {ended === "time" ? (
            <div className={styles.timeUp} role="status">
              <b>Closing bell</b>
              <span>{fmtInteger(Math.max(0, frame.score))}</span>
            </div>
          ) : null}
        </div>

        {wasHidden && running ? <p className={styles.hiddenNote}>The tape kept rolling while you were away.</p> : null}

        {confirmQuit && !ended ? (
          <div className={styles.quitSheet} role="alertdialog" aria-labelledby="tt-quit-title" aria-describedby="tt-quit-copy">
            <b id="tt-quit-title">Bail on this run?</b>
            <p id="tt-quit-copy">
              The {fmtNumber(session.entry_fee_cash, "$")} is already in the pool. We&apos;ll post what you have ({fmtInteger(Math.max(0, frame.score))}) once the run clock
              allows.
            </p>
            <div>
              <button type="button" className={styles.keepPlaying} onClick={() => setConfirmQuit(false)} autoFocus>
                Keep playing
              </button>
              <button type="button" className={styles.bail} onClick={() => finish(true)}>
                Quit run
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <aside className={styles.rail} data-side="right" aria-hidden="true">
        <p className={styles.railHead}>Scoring</p>
        <ul className={styles.railLegend}>
          <li data-kind="up">
            <span>▲</span> Green <b>+100</b>
          </li>
          <li data-kind="gold">
            <span>★</span> Gold <b>+500</b>
          </li>
          <li data-kind="down">
            <span>▼</span> Red <b>−150</b>
          </li>
          <li>
            <span>·</span> Whiff <b>−25</b>
          </li>
        </ul>
        <p className={styles.railNote}>
          5 in a row: <b>×1.5</b>, up to <b>×3</b>. Let a green get away and the combo resets.
        </p>
        <p className={styles.railNote}>
          Keys <kbd>1</kbd>–<kbd>5</kbd> or <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> · <kbd>Esc</kbd> to quit
        </p>
      </aside>
    </div>
  );
}

/** Desktop rail: this week's top ten with your live score slotted in, climbing as you play. */
function LiveLadder({ board, userId, score }: { board: TickerTapBoard | null; userId: string | number | null; score: number }) {
  if (!board) return <aside className={styles.rail} data-side="left" aria-hidden="true" />;
  const others = board.leaderboard.filter((row) => String(row.user_id) !== String(userId));
  const place = placementFor(board, score, userId);
  const rows: { key: string; rank: number; name: string; score: number; you?: boolean }[] = others.slice(0, 10).map((row, index) => ({ key: String(row.user_id), rank: index + 1, name: row.username, score: row.score }));
  rows.splice(place.rank - 1, 0, { key: "you", rank: place.rank, name: "You", score, you: true });
  const shown = rows.slice(0, 10).map((row, index) => ({ ...row, rank: index + 1 }));
  if (place.rank > 10) shown.push({ key: "you", rank: place.rank, name: "You", score, you: true });
  const payouts = splitPool(board.week.pool, Math.min(10, others.length + 1));
  return (
    <aside className={styles.rail} data-side="left" aria-hidden="true">
      <p className={styles.railHead}>This week&apos;s pool</p>
      <p className={styles.railPool}>{fmtPayout(board.week.pool)}</p>
      <ol className={styles.railLadder}>
        {shown.map((row) => (
          <li key={row.key} data-you={row.you || undefined}>
            <span>{row.rank}</span>
            <span>{row.name}</span>
            <b>{fmtInteger(row.score)}</b>
            <em>{row.rank <= 10 ? fmtPayout(payouts[row.rank - 1]) : ""}</em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
