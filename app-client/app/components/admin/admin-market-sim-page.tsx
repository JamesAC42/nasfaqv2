"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdminFrame, AdminGate, AdminLoading, useAdminAccess } from "@/app/components/admin/admin-frame";
import { Notice, Section, Switch, Tabs, adminErrorText, adminUi as ui, fmtCash, fmtCount, useHashTab } from "@/app/components/admin/admin-ui";
import { RedShareChart, ReturnsChart } from "@/app/components/admin/market-sim-charts";
import { apiFetch } from "@/app/lib/api";
import { PRESETS, RUN_LIMITS, todayParams } from "@/app/lib/market-sim/params";
import type { SimMode } from "@/app/lib/market-sim/runner";
import { marketSnapshot } from "@/app/lib/market-sim/snapshot";
import type { SimComparison, SimInputs, SimMetrics, SimParams } from "@/app/lib/market-sim/types";
import styles from "@/app/components/admin/admin-market-sim-page.module.scss";

// /admin/market-sim: a sandbox for choosing market settings. It loads real stocks, holdings and
// recent fills (GET /api/admin/market-sim/inputs, anonymous and read-only), then runs the engine in
// app/lib/market-sim in a Web Worker: a replay of recent fills under other costs, or the market run
// forward from today, always next to today's settings on the same seeds. Nothing here writes
// anything or changes a live setting.

const MODES = ["replay", "forward"] as const;

type Metric = { key: keyof SimMetrics; label: string; line: string; kind: "share" | "return"; better: "up" | "down" | null; forwardOnly?: boolean };

const METRICS: Metric[] = [
  { key: "positionsRed", label: "Positions in the red", line: "Open positions worth less than they cost, the fee included.", kind: "share", better: "down" },
  { key: "playersRed", label: "Players with a red bag", line: "Players whose shares, all together, are worth less than they paid.", kind: "share", better: "down" },
  { key: "medianBagReturn", label: "Typical bag", line: "The middle player's shares now against what they paid for them.", kind: "return", better: "up" },
  {
    key: "medianAllInReturn",
    label: "Typical all-in result",
    line: "The middle player's shares now, plus what they sold, plus dividends, against everything they paid.",
    kind: "return",
    better: "up",
  },
  { key: "playersLosing", label: "Players losing money", line: "Players whose all-in result is below zero.", kind: "share", better: "down" },
  { key: "greenDays", label: "Green days", line: "Days a player's shares closed up on the day, out of all the days they held some.", kind: "share", better: "up" },
  { key: "buysGreen1d", label: "Buys green the next day", line: "Buys worth more than they cost, the fee included, at the next day's close.", kind: "share", better: "up" },
  { key: "buysGreen7d", label: "Buys green a week later", line: "The same, seven days after the buy.", kind: "share", better: "up" },
  { key: "brokerTake", label: "Broker's take", line: "What the spread, slippage and fees take, as a share of everything traded.", kind: "share", better: "down" },
  {
    key: "tiltPrinted",
    label: "Printed by the dividend tilt",
    line: "The flat weekly payout, as a share of what players' shares were worth at the start.",
    kind: "share",
    better: null,
  },
  { key: "dividendsNet", label: "Dividends less share fees", line: "Every dividend paid less every share fee charged, same base.", kind: "return", better: null },
  {
    key: "growthLift",
    label: "Growth's lift to fair values",
    line: "How much the daily growth adds to every channel's value over the run.",
    kind: "return",
    better: null,
    forwardOnly: true,
  },
  { key: "buyShare", label: "Buys, share of shares traded", line: "Shares bought over all shares bought and sold.", kind: "share", better: null },
];

const pct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`);
/** A signed number that never reads "−0.0" (the sign follows what's shown). */
function signed(value: number, digits: number, suffix: string) {
  const shown = Number((value * 100).toFixed(digits));
  return `${shown > 0 ? "+" : shown < 0 ? "−" : ""}${Math.abs(shown).toFixed(digits)}${suffix}`;
}
const signedPct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : signed(value, digits, "%"));
const points = (value: number) => (Number.isFinite(value) ? signed(value, 1, " pts") : "—");

export function AdminMarketSimPage() {
  const access = useAdminAccess();
  if (!access.initialized) return <AdminLoading title="Market simulator" />;
  if (!access.isAdmin) return <AdminGate title="Market simulator" signedIn={access.signedIn} need="admins" headline="Admins only." />;
  return <MarketSim />;
}

function MarketSim() {
  const [replayDays, setReplayDays] = useState(14);
  const [inputs, setInputs] = useState<SimInputs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<SimMode>("replay");
  const pickMode = useHashTab(MODES, "replay", setMode);
  const [params, setParams] = useState<SimParams | null>(null);
  const [result, setResult] = useState<{ comparison: SimComparison; params: SimParams } | null>(null);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  const fetchInputs = useCallback(async (days: number) => {
    try {
      const data = await apiFetch<SimInputs>(`/api/admin/market-sim/inputs?replay_days=${days}`, { cache: "no-store" });
      setInputs(data);
      setLoadError(null);
      setParams((current) => current ?? todayParams(data.settings, { days: 60, seeds: 12, seed: 1 }));
    } catch (error) {
      setLoadError(adminErrorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void fetchInputs(14), 0);
    return () => {
      clearTimeout(first);
      worker.current?.terminate();
    };
  }, [fetchInputs]);

  const load = (days: number) => {
    setLoading(true);
    void fetchInputs(days);
  };

  const today = useMemo(() => (inputs && params ? todayParams(inputs.settings, params) : null), [inputs, params]);
  const snapshot = useMemo(() => (inputs ? marketSnapshot(inputs) : null), [inputs]);

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(null);
  };

  const run = () => {
    if (!inputs || !params) return;
    stop();
    setRunError(null);
    const job = new Worker(new URL("../../lib/market-sim/sim.worker.ts", import.meta.url));
    worker.current = job;
    const used = { ...params };
    setRunning({ done: 0, total: mode === "replay" ? 2 : params.seeds });
    job.onmessage = (event: MessageEvent<{ type: string; done?: number; total?: number; result?: SimComparison; message?: string }>) => {
      const message = event.data;
      if (message.type === "progress") setRunning({ done: message.done ?? 0, total: message.total ?? 1 });
      else {
        if (message.type === "result" && message.result) setResult({ comparison: message.result, params: used });
        if (message.type === "error") setRunError(message.message || "The simulation failed.");
        job.terminate();
        if (worker.current === job) worker.current = null;
        setRunning(null);
      }
    };
    job.onerror = (event) => {
      setRunError(event.message || "The simulation failed.");
      stop();
    };
    job.postMessage({ id: Date.now(), mode, inputs, params });
  };

  const set = <K extends keyof SimParams>(key: K, value: SimParams[K]) => setParams((current) => (current ? { ...current, [key]: value } : current));

  return (
    <AdminFrame
      title="Market simulator"
      blurb="Try market settings on real data before anyone plays with them. A sandbox: nothing here changes the live market or writes to the database."
      aside={
        <button type="button" className={ui.btn} onClick={() => load(replayDays)} disabled={loading}>
          {loading ? "Loading…" : "Reload data"}
        </button>
      }
    >
      {loadError ? <Notice>{loadError}</Notice> : null}
      {inputs && snapshot ? <TodayStrip inputs={inputs} snapshot={snapshot} /> : loading ? <p className={ui.empty}>Loading the market…</p> : null}

      {inputs && params && today && snapshot ? (
        <div className={styles.layout}>
          <div className={styles.controls}>
            <Tabs
              label="Mode"
              value={mode}
              onChange={pickMode}
              tabs={[
                { key: "replay", label: "Replay" },
                { key: "forward", label: "Forecast" },
              ]}
            />
            <p className={styles.modeLine}>
              {mode === "replay"
                ? `Re-prices the real fills of the last ${inputs.window.replay_days} days under these costs, against the real prices. The same people make the same trades; only what they cost changes. The most trustworthy view.`
                : "Runs the market forward from today: real holdings and Cash, players trading the way their last weeks of fills say they trade and getting their usual outside income, fair values moving the way they have been. Every seed runs at today's settings too, so the gap is the settings, not luck."}
            </p>

            <div className={styles.presets}>
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  title={preset.line}
                  onClick={() => setParams({ ...preset.apply(today), days: params.days, seeds: params.seeds, seed: params.seed })}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <Group title="What trading costs">
              <Knob
                label="Spread"
                hint={
                  params.spreadBps === null
                    ? `Each stock's own (most are ${pct(snapshot.medianSpreadBps / 10000)}). A buy pays half above the price, a sale gets half below.`
                    : "The gap between the buy and the sell price. A buy pays half of it above the price, a sale gets half below."
                }
                value={(params.spreadBps ?? snapshot.medianSpreadBps) / 100}
                onChange={(value) => set("spreadBps", Math.round(value * 100))}
                min={0}
                max={8}
                step={0.05}
                unit="%"
              />
              <Knob
                label="Trading fee"
                hint="Charged on each trade's value, on top of the price."
                value={params.feeRate * 100}
                onChange={(value) => set("feeRate", value / 100)}
                min={0}
                max={3}
                step={0.05}
                unit="%"
              />
              <div className={styles.knob}>
                <div className={styles.knobHead}>
                  <span>Fee only on quick sells</span>
                  <Switch checked={params.feeOnlyOnQuickSells} onChange={(next) => set("feeOnlyOnQuickSells", next)} label="Fee only on quick sells" />
                </div>
                <small>Buys are free; only a sale within this many hours of the last buy of that stock pays the fee.</small>
                {params.feeOnlyOnQuickSells ? (
                  <Knob label="Quick means within" value={params.quickSellHours} onChange={(value) => set("quickSellHours", value)} min={1} max={168} step={1} unit="h" bare />
                ) : null}
              </div>
            </Group>

            <Group title="How orders move the price" note={mode === "replay" ? "Replay keeps the real prices, so these only matter in the forecast." : undefined}>
              <Knob
                label="Slippage"
                hint="Extra a big order pays: this times the order's share of the stock's depth."
                value={params.slippageWeight}
                onChange={(value) => set("slippageWeight", value)}
                min={0}
                max={3}
                step={0.05}
                disabled={mode === "replay"}
              />
              <Knob
                label="Short-lived push"
                hint="How far an order moves the price for the next hour or so."
                value={params.transientWeight}
                onChange={(value) => set("transientWeight", value)}
                min={0}
                max={3}
                step={0.05}
                disabled={mode === "replay"}
              />
              <Knob
                label="Lasting push"
                hint="How far an order moves the price for days."
                value={params.persistentWeight}
                onChange={(value) => set("persistentWeight", value)}
                min={0}
                max={1.5}
                step={0.01}
                disabled={mode === "replay"}
              />
              <Knob
                label="Lasting push kept each day"
                hint="What's left of the lasting push after each daily settlement."
                value={params.persistentDecay * 100}
                onChange={(value) => set("persistentDecay", value / 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                disabled={mode === "replay"}
              />
              <Knob
                label="Short-lived push half-life"
                hint="Minutes for the short-lived push to fade by half."
                value={params.transientHalfLifeMinutes}
                onChange={(value) => set("transientHalfLifeMinutes", value)}
                min={5}
                max={720}
                step={5}
                unit="min"
                disabled={mode === "replay"}
              />
            </Group>

            <Group title="Ticks" note={mode === "replay" ? "Only in the forecast." : undefined}>
              <Knob
                label="Total tick strength"
                hint="The day's four ticks together pull the price this far toward fair value. Over 100% overshoots."
                value={params.strengthTotalPct}
                onChange={(value) => set("strengthTotalPct", value)}
                min={20}
                max={400}
                step={4}
                unit="%"
                disabled={mode === "replay"}
              />
            </Group>

            <Group title="Growth and dividends">
              <Knob
                label="Market growth a day"
                hint="Every channel's value grows this much a day, so prices drift up. Forecast only."
                value={params.driftPerDay * 100}
                onChange={(value) => set("driftPerDay", value / 100)}
                min={-0.3}
                max={0.3}
                step={0.01}
                unit="%"
                disabled={mode === "replay"}
              />
              <Knob
                label="Flat dividend a week"
                hint="Paid every Saturday on every share held, as a share of its value, on top of the ranking. New money."
                value={params.dividendTiltPerWeek * 100}
                onChange={(value) => set("dividendTiltPerWeek", value / 100)}
                min={-1}
                max={1}
                step={0.05}
                unit="%"
              />
              <Knob
                label="Dividend per σ"
                hint="What the weekly ranking pays (or charges) for each standard deviation past the dead zone."
                value={params.dividendPerSigma * 100}
                onChange={(value) => set("dividendPerSigma", value / 100)}
                min={0}
                max={10}
                step={0.25}
                unit="%"
              />
              <Knob
                label="Dead zone"
                hint="Stocks this close to the middle of the ranking pay and charge nothing."
                value={params.deadzoneSigma}
                onChange={(value) => set("deadzoneSigma", value)}
                min={0}
                max={2}
                step={0.05}
                unit="σ"
              />
              <Knob
                label="Dividend cap"
                hint="No stock pays or charges more than this a week."
                value={params.dividendCap * 100}
                onChange={(value) => set("dividendCap", value / 100)}
                min={0}
                max={30}
                step={0.5}
                unit="%"
              />
            </Group>

            <Group title="Limit orders">
              <Knob
                label="Players using them"
                hint="Share of players who post a bid under the price instead of buying at the ask. It fills if the price comes down to it within a day."
                value={params.limitShare * 100}
                onChange={(value) => set("limitShare", value / 100)}
                min={0}
                max={100}
                step={5}
                unit="%"
              />
              <Knob
                label="How far under the price"
                hint="Where they post the bid."
                value={params.limitOffsetPct * 100}
                onChange={(value) => set("limitOffsetPct", value / 100)}
                min={0}
                max={10}
                step={0.25}
                unit="%"
              />
            </Group>

            <Group title="Run">
              {mode === "forward" ? (
                <>
                  <Knob
                    label="Days"
                    hint="How far ahead to run."
                    value={params.days}
                    onChange={(value) => set("days", value)}
                    min={RUN_LIMITS.days.min}
                    max={RUN_LIMITS.days.max}
                    step={1}
                  />
                  <Knob
                    label="Seeds"
                    hint="How many different futures to average. More is steadier and slower."
                    value={params.seeds}
                    onChange={(value) => set("seeds", value)}
                    min={RUN_LIMITS.seeds.min}
                    max={RUN_LIMITS.seeds.max}
                    step={1}
                  />
                </>
              ) : (
                <Knob
                  label="Days to replay"
                  hint="Changing this reloads the data."
                  value={replayDays}
                  onChange={(value) => setReplayDays(value)}
                  onCommit={(value) => load(value)}
                  min={1}
                  max={30}
                  step={1}
                />
              )}
              <label className={ui.field}>
                <span>Seed</span>
                <input
                  className={ui.inputNum}
                  type="number"
                  min={1}
                  value={params.seed}
                  onChange={(event) => set("seed", Math.max(1, Math.round(Number(event.target.value) || 1)))}
                />
              </label>
            </Group>

            <div className={styles.runBar}>
              {running ? (
                <>
                  <progress max={running.total} value={running.done} aria-label="Simulation progress" />
                  <button type="button" className={ui.btn} onClick={stop}>
                    Stop
                  </button>
                </>
              ) : (
                <button type="button" className={ui.btnPrimary} onClick={run} disabled={!inputs.players.length}>
                  {mode === "replay" ? "Run the replay" : `Run ${params.seeds} × ${params.days} days`}
                </button>
              )}
            </div>
            {runError ? <Notice>{runError}</Notice> : null}
          </div>

          <div className={styles.results}>{result ? <Results result={result.comparison} params={result.params} /> : <EmptyResults mode={mode} />}</div>
        </div>
      ) : null}
    </AdminFrame>
  );
}

function TodayStrip({ inputs, snapshot }: { inputs: SimInputs; snapshot: ReturnType<typeof marketSnapshot> }) {
  return (
    <Section title="The market now" hint={`Real data, ${inputs.window.replay_days}-day window. Players are anonymous.`}>
      <div className={ui.stripWrap}>
        <div className={ui.strip} style={{ ["--cols" as string]: 6, ["--cols-tablet" as string]: 3 }}>
          <Stat label="Positions red" value={pct(snapshot.positionsRed, 0)} note={`of ${fmtCount(snapshot.positions)} open`} />
          <Stat label="Players red" value={pct(snapshot.playersRed, 0)} note={`of ${fmtCount(snapshot.holders)} holding shares`} />
          <Stat label="Typical bag" value={signedPct(snapshot.medianBagReturn)} note="at the price now" />
          <Stat label="Fills" value={fmtCount(snapshot.fills)} note={`last ${inputs.window.replay_days} days${inputs.window.fills_truncated ? " (capped)" : ""}`} />
          <Stat label="Buys" value={pct(snapshot.buyShare, 0)} note="of shares traded" />
          <Stat label="Broker's take" value={pct(snapshot.brokerTake, 2)} note="of what was traded" />
        </div>
      </div>
    </Section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={ui.stat}>
      <small>{label}</small>
      <b>{value}</b>
      <em>{note}</em>
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend>{title}</legend>
      {note ? <p className={styles.groupNote}>{note}</p> : null}
      {children}
    </fieldset>
  );
}

function Knob({
  label,
  hint,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  unit,
  disabled,
  bare,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  bare?: boolean;
}) {
  const digits = step < 1 ? Math.min(4, String(step).split(".")[1]?.length ?? 2) : 0;
  const shown = Number(value.toFixed(digits));
  const change = (raw: string) => {
    const next = Number(raw);
    if (Number.isFinite(next)) onChange(next);
  };
  return (
    <div className={styles.knob} data-bare={bare || undefined} data-disabled={disabled || undefined}>
      <label className={styles.knobHead}>
        <span>{label}</span>
        <span className={styles.knobValue}>
          <input
            className={ui.inputNum}
            type="number"
            value={shown}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onChange={(event) => change(event.target.value)}
            onBlur={(event) => onCommit?.(Number(event.target.value))}
          />
          {unit ? <i>{unit}</i> : null}
        </span>
      </label>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
        onPointerUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
        onKeyUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
      />
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function EmptyResults({ mode }: { mode: SimMode }) {
  return (
    <div className={styles.empty}>
      <b>Pick settings and run.</b>
      <p>
        {mode === "replay"
          ? "The replay takes a moment. It shows what the last days of trading would have looked like under these settings, next to what really happened."
          : "A forecast takes a few seconds. Results always sit next to the same futures at today's settings."}
      </p>
    </div>
  );
}

function Results({ result, params }: { result: SimComparison; params: SimParams }) {
  const { scenario, baseline } = result;
  const shown = METRICS.filter((metric) => !(metric.forwardOnly && result.mode === "replay"));
  return (
    <>
      <Section
        title={result.mode === "replay" ? "Replay: scenario against what happened" : "Forecast: scenario against today's settings"}
        hint={
          result.mode === "replay"
            ? `${fmtCount(baseline.metrics.fillsPerDay * (baseline.dayLabels.length - 1))} real fills, ${fmtCash(baseline.metrics.volume)} traded`
            : `${params.seeds} seeds × ${params.days} days, ${(result.elapsedMs / 1000).toFixed(1)}s`
        }
      >
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Scenario</th>
                <th scope="col">{result.mode === "replay" ? "Real" : "Today's settings"}</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((metric) => {
                const a = scenario.metrics[metric.key];
                const b = baseline.metrics[metric.key];
                const delta = a - b;
                const verdict = !metric.better || !Number.isFinite(delta) || Math.abs(delta) < 0.0005 ? null : delta > 0 === (metric.better === "up") ? "better" : "worse";
                const range = result.scenarioRange?.[metric.key];
                const format =
                  metric.kind === "share"
                    ? (value: number) => pct(value, metric.key === "brokerTake" || metric.key === "tiltPrinted" ? 2 : 1)
                    : (value: number) => signedPct(value, 1);
                return (
                  <tr key={metric.key}>
                    <th scope="row">
                      <b>{metric.label}</b>
                      <small>{metric.line}</small>
                    </th>
                    <td>
                      {format(a)}
                      {range ? (
                        <small title="80% of seeds landed in this range">
                          {format(range[0])} to {format(range[1])}
                        </small>
                      ) : null}
                    </td>
                    <td>{format(b)}</td>
                    <td>
                      {points(delta)}
                      {verdict ? <small data-verdict={verdict}>{verdict} for players</small> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Charts">
        <div className={styles.charts}>
          <ReturnsChart scenario={scenario.returns} baseline={baseline.returns} />
          <RedShareChart scenario={scenario.redByDay} baseline={baseline.redByDay} labels={scenario.dayLabels} />
        </div>
      </Section>

      {result.replayCheck ? (
        <Section title="Can the replay be trusted?">
          <p className={styles.check}>
            At today&rsquo;s settings the replay reprices {fmtCount(result.replayCheck.fills)} real fills to within {fmtCash(result.replayCheck.maxPriceError, 4)} a share and{" "}
            {fmtCash(result.replayCheck.maxFeeError, 4)} in fees.
            {result.replayCheck.startUnknown
              ? ` ${fmtCount(result.replayCheck.startUnknown)} starting positions couldn't be traced back exactly (sold off completely in the window, or changed outside trading), so their starting cost is estimated from the sale price.`
              : " Every starting position traced back exactly."}
          </p>
        </Section>
      ) : null}

      {result.modelCheck ? (
        <Section title="Does the forecast look like the real market?" hint="Real numbers come from the last 90 days of revealed fair values and players' recent fills.">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Real</th>
                  <th scope="col">Forecast at today&rsquo;s settings</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    <b>Fair value, typical daily move</b>
                  </th>
                  <td>{pct(result.modelCheck.realFairDailyVol, 2)}</td>
                  <td>{pct(result.modelCheck.simFairDailyVol, 2)}</td>
                </tr>
                <tr>
                  <th scope="row">
                    <b>Fair value, how much a move carries into the next day</b>
                  </th>
                  <td>{result.modelCheck.realFairAutocorr?.toFixed(2) ?? "—"}</td>
                  <td>{result.modelCheck.simFairAutocorr?.toFixed(2) ?? "—"}</td>
                </tr>
                <tr>
                  <th scope="row">
                    <b>Fills a day</b>
                  </th>
                  <td>{result.modelCheck.realFillsPerDay?.toFixed(0) ?? "—"}</td>
                  <td>{Number.isFinite(baseline.metrics.fillsPerDay) ? baseline.metrics.fillsPerDay.toFixed(0) : "—"}</td>
                </tr>
                <tr>
                  <th scope="row">
                    <b>Buys, share of fills</b>
                  </th>
                  <td>{pct(result.modelCheck.realBuyShare, 0)}</td>
                  <td>{pct(baseline.metrics.buyFillShare, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={styles.check}>
            {result.modelCheck.fittedAssets} stocks fitted to their own history; the rest borrow the market&rsquo;s typical momentum (day-to-day carry{" "}
            {result.modelCheck.pooledRho.toFixed(2)}, daily shock {result.modelCheck.pooledSigma.toFixed(2)}). Players get their recent outside income (games, check-ins) every day;
            fewer fills than real means some still ran short of Cash.
          </p>
        </Section>
      ) : null}

      <Section title="What this leaves out">
        <ul className={styles.caveats}>
          <li>New players and the auto-bailout. {result.mode === "replay" ? "" : "Outside income (games, check-ins) comes at each player's recent daily rate."}</li>
          <li>Sell-outs and buybacks: a frozen stock just doesn&rsquo;t trade. Rookie and oshi exemptions from dividends and share fees.</li>
          <li>Players reacting to the new settings: they trade the way they have been, only at the new costs.</li>
          {result.mode === "replay" ? <li>In the replay, the price path is the real one: cheaper or bigger trades don&rsquo;t move it differently.</li> : null}
        </ul>
      </Section>
    </>
  );
}
