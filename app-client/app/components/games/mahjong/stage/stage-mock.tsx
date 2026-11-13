"use client";

// The 3D table mock's page: the canvas (client-only, loaded lazily), a sparse HTML HUD over it, the
// overlays pinned to seats, and a debug bar that fires each moment. Scripted state only.

import dynamic from "next/dynamic";
import { useEffect, useState, type CSSProperties } from "react";
import { useTheme } from "@/app/providers/theme-provider";
import { SEATS, seatColor, useStage, type LowerThird } from "@/app/components/games/mahjong/stage/mock-state";
import { actionsKey, anchorKey, fpsKey, registerOverlay } from "@/app/components/games/mahjong/stage/overlay";
import styles from "@/app/components/games/mahjong/stage/stage.module.scss";

const StageCanvas = dynamic(() => import("@/app/components/games/mahjong/stage/stage-canvas"), {
  ssr: false,
  loading: () => <div className={styles.loading}>Setting the table…</div>,
});

const fmt = (value: number) => value.toLocaleString("en-US");

function Sparkline({ line, color }: { line: number[]; color: string }) {
  const lo = Math.min(...line) - 500;
  const hi = Math.max(...line) + 500;
  const pts = line.map((v, i) => `${((i / Math.max(1, line.length - 1)) * 56).toFixed(1)},${(18 - ((v - lo) / (hi - lo)) * 16).toFixed(1)}`);
  const last = line[line.length - 1];
  const prev = line[line.length - 2] ?? last;
  const tone = last > prev ? "var(--up)" : last < prev ? "var(--down)" : color;
  return (
    <svg className={styles.spark} viewBox="0 0 56 20" aria-hidden="true">
      <polyline points={pts.slice(0, -1).join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <polyline key={line.length} className={styles.sparkTail} points={pts.slice(-2).join(" ")} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Nameplate({ seat, day }: { seat: number; day: boolean }) {
  const points = useStage((s) => s.points[seat]);
  const line = useStage((s) => s.history[seat]);
  const riichi = useStage((s) => s.riichi[seat]);
  const color = seatColor(seat, day);
  return (
    <div className={styles.pin} ref={(el) => registerOverlay(anchorKey("plate", seat), el)}>
      <div className={styles.plate} data-seat={seat} style={{ "--seat": color } as CSSProperties}>
        <span className={styles.plateWind}>{SEATS[seat].wind}</span>
        <span className={styles.plateName}>{SEATS[seat].short}</span>
        <span className={styles.platePts}>{fmt(points)}</span>
        <Sparkline line={line} color={color} />
        {riichi ? <span className={styles.plateRiichi}>Riichi</span> : null}
      </div>
    </div>
  );
}

function Cheers({ seat, day }: { seat: number; day: boolean }) {
  const reactions = useStage((s) => s.reactions);
  const count = useStage((s) => s.cheers[seat]);
  const reduced = useStage((s) => s.reduced);
  const mine = reactions.filter((r) => r.seat === seat);
  return (
    <div className={styles.pin} ref={(el) => registerOverlay(anchorKey("cheer", seat), el)}>
      <div className={styles.cheers} data-seat={seat} data-reduced={reduced || undefined} style={{ "--seat": seatColor(seat, day) } as CSSProperties}>
        {mine.map((r) => (
          <span key={r.id} className={styles.chip} style={{ "--dx": `${r.dx}px`, animationDelay: `${Math.max(0, r.at - (mine[0]?.at ?? r.at))}ms` } as CSSProperties}>
            {r.glyph}
          </span>
        ))}
        <span className={styles.counter} title="Spectators backing this seat">
          <span aria-hidden="true">▲</span> {count}
        </span>
      </div>
    </div>
  );
}

function TickerStrip({ day }: { day: boolean }) {
  const ticker = useStage((s) => s.ticker);
  if (!ticker) return null;
  return (
    <div key={ticker.id} className={styles.ticker} style={{ "--seat": seatColor(ticker.seat, day) } as CSSProperties} role="status">
      <span className={styles.tickerTag}>Live</span>
      <span className={styles.tickerText}>
        {ticker.text}
        <span className={styles.tickerSep}>◆</span>
        {ticker.text}
        <span className={styles.tickerSep}>◆</span>
        {ticker.text}
      </span>
    </div>
  );
}

function LowerThirdBar({ data, day }: { data: LowerThird; day: boolean }) {
  return (
    <div key={data.id} className={styles.lower} data-kind={data.kind} style={{ "--seat": data.kind === "win" ? seatColor(data.seat, day) : "var(--mid)" } as CSSProperties} role="status">
      <div className={styles.lowerKicker}>{data.kicker}</div>
      <div className={styles.lowerHead}>
        <span className={styles.lowerTitle}>{data.title}</span>
        {data.value ? <span className={styles.lowerValue}>{data.value}</span> : null}
      </div>
      <ul className={styles.lowerLines}>
        {data.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className={styles.lowerDesk}>Market desk · click anywhere to continue</div>
    </div>
  );
}

function Hud({ day }: { day: boolean }) {
  const points = useStage((s) => s.points[0]);
  const line = useStage((s) => s.history[0]);
  const drawn = useStage((s) => s.drawn);
  const riichiFor = useStage((s) => s.riichiFor);
  const myRiichi = useStage((s) => s.riichi[0]);
  // The moves step aside while a moment plays.
  const quiet = useStage((s) => Boolean(s.moment) || s.lowerThird !== null || s.reveal !== null);
  return (
    <>
      <div className={styles.hudTop} style={{ "--seat": seatColor(0, day) } as CSSProperties}>
        <span className={styles.hudWind}>{SEATS[0].wind}</span>
        <span className={styles.hudLabel}>You</span>
        <span className={styles.hudPts}>{fmt(points)}</span>
        <Sparkline line={line} color={seatColor(0, day)} />
        <span className={styles.beta}>Beta</span>
      </div>
      <div className={`${styles.pin} ${styles.actionsPin}`} data-quiet={quiet || undefined} ref={(el) => registerOverlay(actionsKey, el)}>
      <div className={styles.actions} role="group" aria-label="Your moves (placeholders)">
        <button type="button" className={styles.act} disabled>
          Chi
        </button>
        <button type="button" className={styles.act} disabled>
          Pon
        </button>
        <button type="button" className={`${styles.act} ${styles.actHot}`} disabled={!drawn || myRiichi} onClick={() => riichiFor(0)}>
          Riichi
        </button>
        <button type="button" className={styles.act} disabled>
          Pass
        </button>
      </div>
      </div>
    </>
  );
}

function DebugBar({ day, theme }: { day: boolean; theme: "dark" | "light" }) {
  const [seat, setSeat] = useState(1);
  const s = useStage();
  const busy = Boolean(s.moment);
  return (
    <div className={styles.debug}>
      <div className={styles.debugGroup} role="radiogroup" aria-label="Seat">
        <span className={styles.debugLabel}>Seat</span>
        {SEATS.map((info, index) => (
          <button key={index} type="button" role="radio" aria-checked={seat === index} className={styles.seatPick} data-on={seat === index || undefined} style={{ "--seat": seatColor(index, day) } as CSSProperties} onClick={() => setSeat(index)}>
            {info.short}
          </button>
        ))}
      </div>
      <div className={styles.debugGroup}>
        <span className={styles.debugLabel}>Moments</span>
        <button type="button" className={styles.dbtn} disabled={busy || s.riichi[seat]} onClick={() => s.riichiFor(seat)}>
          Riichi
        </button>
        <button type="button" className={styles.dbtn} disabled={busy} onClick={() => s.winFor(seat, "ron")}>
          Ron
        </button>
        <button type="button" className={styles.dbtn} disabled={busy} onClick={() => s.winFor(seat, "tsumo")}>
          Tsumo
        </button>
        <button type="button" className={styles.dbtn} disabled={busy} onClick={() => s.drawGame()}>
          Draw game
        </button>
        <button type="button" className={styles.dbtn} onClick={() => s.burst(seat, 8)}>
          Reactions
        </button>
      </div>
      <div className={styles.debugGroup}>
        <span className={styles.debugLabel}>View</span>
        <button type="button" className={styles.dbtn} onClick={() => s.resetCamera()}>
          Reset camera
        </button>
        <button type="button" className={styles.dbtn} data-on={s.dayOverride !== null || undefined} onClick={() => s.setDay(s.dayOverride === null ? theme !== "light" : null)} title="Overrides the site theme for this page only">
          {day ? "Night" : "Day"}
        </button>
        <button type="button" className={styles.dbtn} data-on={s.phone || undefined} onClick={() => s.setPhone(!s.phone)}>
          Phone frame
        </button>
        <button type="button" className={styles.dbtn} data-on={s.ambient || undefined} onClick={() => s.setAmbient(!s.ambient)}>
          Ambient play
        </button>
        <button type="button" className={styles.dbtn} data-on={s.reduced || undefined} onClick={() => s.setReduced(!s.reduced)}>
          Reduced motion
        </button>
        <button type="button" className={styles.dbtn} onClick={() => s.reset()}>
          Reset hand
        </button>
        <span className={styles.fps} ref={(el) => registerOverlay(fpsKey, el)}>
          – fps
        </span>
      </div>
    </div>
  );
}

export function StageMock() {
  const { theme } = useTheme();
  const dayOverride = useStage((s) => s.dayOverride);
  const phone = useStage((s) => s.phone);
  const ambient = useStage((s) => s.ambient);
  const lowerThird = useStage((s) => s.lowerThird);
  const dismiss = useStage((s) => s.dismiss);
  const setReduced = useStage((s) => s.setReduced);
  const day = dayOverride ?? theme === "light";

  // Follow the OS setting for reduced motion (the debug bar can flip it too).
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [setReduced]);

  // Handy for poking at the mock from the browser console.
  useEffect(() => {
    (window as unknown as { __mjStage?: typeof useStage }).__mjStage = useStage;
  }, []);

  // Opponents take turns now and then.
  useEffect(() => {
    if (!ambient) return;
    const timer = setInterval(() => useStage.getState().ambientTurn(), 3400);
    return () => clearInterval(timer);
  }, [ambient]);

  return (
    <div className={styles.page} data-day={day || undefined}>
      <header className={styles.head}>
        <h1>
          Mahjong stage <span className={styles.beta}>Mock</span>
        </h1>
        <p>A visual mock of a 3D table: scripted state, no game. Click one of your tiles to discard it; fire the moments from the bar below.</p>
      </header>
      <div className={styles.viewport} data-phone={phone || undefined}>
        <div className={styles.stage} data-day={day || undefined} onClick={() => dismiss()}>
          <StageCanvas day={day} />
          <div className={styles.overlays} aria-hidden="true">
            {[1, 2, 3].map((seat) => (
              <Nameplate key={seat} seat={seat} day={day} />
            ))}
            {[0, 1, 2, 3].map((seat) => (
              <Cheers key={seat} seat={seat} day={day} />
            ))}
          </div>
          <TickerStrip day={day} />
          {lowerThird ? <LowerThirdBar data={lowerThird} day={day} /> : null}
          <Hud day={day} />
        </div>
      </div>
      <DebugBar day={day} theme={theme} />
    </div>
  );
}
