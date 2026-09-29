"use client";

import { schedulerLabel } from "./admin-api";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  closeTrading,
  fetchAdjustmentHealth,
  fetchAdminStats,
  fetchLiveOrderHealth,
  fetchMarketStatus,
  reopenTrading,
  setSiteMaintenance,
  type AdjustmentHealth,
  type AdminOverviewStats,
  type LiveOrderHealth,
} from "@/app/components/admin/admin-api";
import { AdminFrame, AdminGate, AdminLoading, predictionsHref, useAdminAccess, useNow } from "@/app/components/admin/admin-frame";
import { Notice, Section, adminErrorText, adminUi as ui, ago, etTime, fmtCash, fmtCount, until } from "@/app/components/admin/admin-ui";
import { normalizeMarketStatus } from "@/app/lib/normalizers";
import { fetchAdminOverview } from "@/app/lib/predictions/api";
import type { AdminOverview } from "@/app/lib/predictions/types";
import type { MarketStatus } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { connectSite, useSiteStore } from "@/app/stores/site-store";
import styles from "@/app/components/admin/admin-hub.module.scss";

// /admin: the back-office landing page. What needs a human first, then whether the machines are
// running, then how busy the site is, then the way into each tool. Polls every 30s.

type Loaded<T> = { data: T | null; error: string | null };
const empty = <T,>(): Loaded<T> => ({ data: null, error: null });

type Attention = { key: string; tone: "warn" | "info"; title: ReactNode; detail?: ReactNode; href?: string; action?: string };

const POLL_MS = 30_000;

function settle<T>(result: PromiseSettledResult<T>, previous: Loaded<T>): Loaded<T> {
  if (result.status === "fulfilled") return { data: result.value, error: null };
  return { data: previous.data, error: adminErrorText(result.reason) };
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: "warn" | "blue" | "dim" }) {
  return (
    <div className={styles.row} data-tone={tone}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function buildAttention({
  predictions,
  adjust,
  live,
  stats,
  status,
  now,
}: {
  predictions: AdminOverview | null;
  adjust: AdjustmentHealth | null;
  live: LiveOrderHealth | null;
  stats: AdminOverviewStats | null;
  status: Partial<MarketStatus> | null;
  now: number;
}): Attention[] {
  const items: Attention[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  if (predictions) {
    const disputed = predictions.proposals.filter((market) => market.status === "disputed");
    if (disputed.length) {
      items.push({
        key: "disputed",
        tone: "warn",
        title: `${plural(disputed.length, "disputed call")}`,
        detail: disputed
          .slice(0, 2)
          .map((market) => market.title)
          .join(" · "),
        href: "/predictions/manage#proposals",
        action: "Settle it",
      });
    }
    const ready = predictions.proposals.filter(
      (market) => market.status !== "disputed" && market.proposal && new Date(market.proposal.window_ends_at).getTime() <= now,
    );
    if (ready.length) {
      items.push({ key: "ready", tone: "warn", title: `${plural(ready.length, "call")} past the dispute window`, detail: "Ready to confirm.", href: "/predictions/manage#proposals", action: "Confirm" });
    }
    if (predictions.needs_call.length) {
      const oldest = predictions.needs_call[0];
      items.push({
        key: "needs-call",
        tone: "warn",
        title: `${plural(predictions.needs_call.length, "market")} waiting on a call`,
        detail: oldest ? `Oldest: ${oldest.title}` : undefined,
        href: "/predictions/manage#needs-call",
        action: "Make the call",
      });
    }
    if (predictions.queue.length) {
      items.push({ key: "queue", tone: "info", title: `${plural(predictions.queue.length, "market")} waiting for approval`, href: "/predictions/manage#queue", action: "Review" });
    }
    const halted = predictions.live.filter((market) => market.trading_status === "halted");
    if (halted.length) {
      items.push({ key: "halted", tone: "info", title: `${plural(halted.length, "prediction market")} halted`, detail: halted[0]?.title, href: "/predictions/manage#live", action: "Open" });
    }
  }

  if (adjust) {
    if (adjust.scheduler_status !== "running") {
      items.push({ key: "tick-off", tone: "warn", title: `Tick scheduler: ${schedulerLabel(adjust)}`, detail: "Check the worker heartbeat and overdue ticks.", href: "/admin/market-tuning#ticks", action: "Check" });
    }
    if (adjust.stuck_scheduled_count || adjust.overdue_scheduled_count) {
      items.push({
        key: "tick-stuck",
        tone: "warn",
        title: `${plural(adjust.stuck_scheduled_count || adjust.overdue_scheduled_count, "tick")} stuck`,
        detail: `${adjust.overdue_scheduled_count} more than 10 minutes overdue.`,
        href: "/admin/market-tuning#ticks",
        action: "Force next tick",
      });
    }
    if (adjust.scheduler_enabled && !adjust.open_session_count) {
      items.push({ key: "no-session", tone: "warn", title: "No tick session open for today", detail: "Regenerate the day from market tuning.", href: "/admin/market-tuning#ticks", action: "Fix" });
    }
  }

  if (live) {
    if (live.scheduler_status !== "running") {
      items.push({ key: "live-off", tone: "warn", title: `Live orders: ${schedulerLabel(live)}`, detail: "Check the worker heartbeat and pending orders.", href: "/admin/market-tuning#live-orders", action: "Check" });
    }
    if (live.health.overdue_pending_count) {
      items.push({
        key: "live-overdue",
        tone: "warn",
        title: `${plural(live.health.overdue_pending_count, "queued order")} overdue`,
        detail: live.health.oldest_pending_at ? `Oldest queued ${ago(live.health.oldest_pending_at, now)} ago.` : undefined,
        href: "/admin/market-tuning#live-orders",
        action: "Look",
      });
    }
    const failed = live.recent_batches.find((batch) => batch.error_text || batch.status === "failed");
    if (failed) {
      items.push({ key: "batch-failed", tone: "warn", title: `Batch #${failed.id} ${failed.status || "failed"}`, detail: failed.error_text ?? undefined, href: "/admin/market-tuning#live-orders", action: "Look" });
    }
  }

  if (status) {
    if (status.last_cycle_error) {
      items.push({ key: "cycle-error", tone: "warn", title: "Last settlement cycle errored", detail: status.last_cycle_error, href: "/admin/market-tuning#ticks", action: "Check" });
    }
    if (status.trading_status === "manual_closed") {
      items.push({ key: "closed", tone: "info", title: "Market is closed by hand", detail: status.trading_message ?? undefined });
    }
  }

  if (stats) {
    const stuckGames = stats.stuck.game_sessions + stats.stuck.pvp_matches + stats.stuck.blackjack_rounds;
    if (stuckGames) {
      const parts = [
        stats.stuck.game_sessions ? plural(stats.stuck.game_sessions, "solo session") : null,
        stats.stuck.pvp_matches ? plural(stats.stuck.pvp_matches, "table match", "table matches") : null,
        stats.stuck.blackjack_rounds ? plural(stats.stuck.blackjack_rounds, "blackjack round") : null,
      ].filter(Boolean);
      items.push({ key: "games-stale", tone: "info", title: `${plural(stuckGames, "game")} left hanging`, detail: `${parts.join(", ")} open for over an hour. Usually abandoned; worth a look if it grows.` });
    }
  }

  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "warn" ? -1 : 1));
}

/** Pause / reopen trading. Players see the message; queued orders wait and fill after reopening. */
function TradingControl({ status, onChanged }: { status: MarketStatus | null; onChanged: () => void }) {
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status) return null;
  const paused = status.trading_status === "manual_closed";
  const settling = status.trading_status === "settling";

  const run = async (action: () => Promise<{ status: Partial<MarketStatus> }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      // The header and trade tickets update from the socket too; this covers a dropped socket.
      if (result?.status) useMarketStore.setState({ marketStatus: normalizeMarketStatus(result.status as Record<string, unknown>) });
      setComposing(false);
      setMessage("");
      onChanged();
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.tradingControl}>
      {paused ? (
        <>
          <p className={styles.tradingNote}>Paused by hand. Queued orders are waiting; settlement catches up after you reopen.</p>
          <button type="button" className={ui.btnPrimary} disabled={busy} onClick={() => void run(reopenTrading)}>
            {busy ? "Reopening…" : "Reopen trading"}
          </button>
        </>
      ) : composing ? (
        <form
          className={styles.tradingForm}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => closeTrading(message));
          }}
        >
          <label className={ui.field}>
            <span>Message for players</span>
            <input
              className={ui.input}
              value={message}
              maxLength={280}
              placeholder="Trading is paused for maintenance. Back soon."
              onChange={(event) => setMessage(event.target.value)}
              autoFocus
            />
          </label>
          <div className={styles.tradingButtons}>
            <button type="submit" className={ui.btnDangerSolid} disabled={busy}>
              {busy ? "Pausing…" : "Pause trading"}
            </button>
            <button type="button" className={ui.btnGhost} disabled={busy} onClick={() => setComposing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={ui.btnDanger} disabled={settling} onClick={() => setComposing(true)} title={settling ? "Wait for the settlement to finish" : undefined}>
          Pause trading…
        </button>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

/**
 * Maintenance by hand: pauses new games site-wide, with a message players see on every page (games
 * in play finish). Releases do the same on their own while they go out, and reopen when live.
 */
function MaintenanceControl() {
  const site = useSiteStore((state) => state.site);
  const refreshSite = useSiteStore((state) => state.refresh);
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    connectSite();
  }, []);
  const state = site?.maintenance.state ?? "off";

  const run = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setSiteMaintenance(on, message);
      // Every page hears it on the socket; this covers a dropped one here.
      await refreshSite();
      setComposing(false);
      setMessage("");
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.tradingControl}>
      {state !== "off" ? (
        <>
          <p className={styles.tradingNote}>
            {state === "draining"
              ? "A release is going out: new games wait while the ones in play finish. Games reopen by themselves once it's live."
              : `Games paused by hand${site?.maintenance.message ? `: "${site.maintenance.message}"` : ""}. Games in play finish; new ones wait.`}
          </p>
          <button type="button" className={ui.btnPrimary} disabled={busy} onClick={() => void run(false)}>
            {busy ? "Reopening…" : state === "draining" ? "Reopen games now" : "End maintenance"}
          </button>
        </>
      ) : composing ? (
        <form
          className={styles.tradingForm}
          onSubmit={(event) => {
            event.preventDefault();
            void run(true);
          }}
        >
          <label className={ui.field}>
            <span>Message for players</span>
            <input
              className={ui.input}
              value={message}
              maxLength={280}
              placeholder="Games are paused for maintenance. Back soon."
              onChange={(event) => setMessage(event.target.value)}
              autoFocus
            />
          </label>
          <div className={styles.tradingButtons}>
            <button type="submit" className={ui.btnDangerSolid} disabled={busy}>
              {busy ? "Pausing…" : "Pause games"}
            </button>
            <button type="button" className={ui.btnGhost} disabled={busy} onClick={() => setComposing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={ui.btnDanger} onClick={() => setComposing(true)}>
          Games maintenance…
        </button>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

export function AdminHub() {
  const access = useAdminAccess();
  const { user } = useAuth();
  const now = useNow(1000);
  const [stats, setStats] = useState<Loaded<AdminOverviewStats>>(empty);
  const [status, setStatus] = useState<Loaded<Partial<MarketStatus>>>(empty);
  const [adjust, setAdjust] = useState<Loaded<AdjustmentHealth>>(empty);
  const [live, setLive] = useState<Loaded<LiveOrderHealth>>(empty);
  const [predictions, setPredictions] = useState<Loaded<AdminOverview>>(empty);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const { isAdmin, canPredictions, isStaff, initialized } = access;

  const load = useCallback(async () => {
    setBusy(true);
    const [s, st, a, l, p] = await Promise.allSettled([
      isAdmin ? fetchAdminStats() : Promise.reject(new Error("skip")),
      fetchMarketStatus(),
      isAdmin ? fetchAdjustmentHealth() : Promise.reject(new Error("skip")),
      isAdmin ? fetchLiveOrderHealth(5) : Promise.reject(new Error("skip")),
      canPredictions ? fetchAdminOverview() : Promise.reject(new Error("skip")),
    ]);
    if (isAdmin) {
      setStats((prev) => settle(s, prev));
      setAdjust((prev) => settle(a, prev));
      setLive((prev) => settle(l, prev));
    }
    setStatus((prev) => settle(st, prev));
    if (canPredictions) setPredictions((prev) => settle(p, prev));
    setLoadedAt(Date.now());
    setBusy(false);
  }, [isAdmin, canPredictions]);

  useEffect(() => {
    if (!initialized || !isStaff) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [initialized, isStaff, load]);

  if (!initialized) return <AdminLoading title="Back office" />;
  if (!isStaff) return <AdminGate title="Back office" signedIn={access.signedIn} need="the mods and admins" />;

  const p = predictions.data;
  const s = stats.data;
  const a = adjust.data;
  const l = live.data;
  const m = status.data;
  const attention = buildAttention({ predictions: p, adjust: a, live: l, stats: s, status: m, now });
  const warnCount = attention.filter((item) => item.tone === "warn").length;
  const firstLoad = loadedAt === null;
  const disputed = p ? p.proposals.filter((market) => market.status === "disputed").length : 0;
  const open = m ? Boolean(m.is_trading_open) : null;

  const errors = [stats.error, adjust.error, live.error, predictions.error].filter(Boolean) as string[];
  const predsLink = predictionsHref(access, user as Record<string, unknown> | null);

  const tools = [
    { href: "/admin/market-tuning", label: "Market tuning", line: "Tick schedule, force a tick, per-stock guardrails, reset.", show: isAdmin },
    { href: "/admin/assets", label: "Assets & prizes", line: "Emojis, profile pictures and the capsule prize pool.", show: access.canAssets },
    { href: predsLink, label: "Predictions control room", line: "Approvals, calls, disputes and auto templates.", show: canPredictions },
    { href: "/predictions/create", label: "New prediction market", line: "Write one up and send it for approval.", show: isAdmin || Boolean((user as Record<string, unknown> | null)?.can_create_prediction_markets) },
    { href: "/admin/people", label: "People & roles", line: "Find a player, hand out or take back roles.", show: isAdmin },
    { href: "/admin/exchange", label: "Exchange review", line: "Lopsided card sales and trades involving new accounts.", show: isAdmin },
  ].filter((tool) => tool.show);

  return (
    <AdminFrame
      title="Back office"
      live
      blurb={
        firstLoad ? (
          "Checking the machines…"
        ) : (
          <>
            {open === null ? null : open ? <>Market&apos;s <b>open</b>. </> : <>Market&apos;s <em>closed</em>. </>}
            {warnCount ? (
              <>
                <b>{warnCount}</b> thing{warnCount === 1 ? "" : "s"} need{warnCount === 1 ? "s" : ""} you.
              </>
            ) : (
              "Nothing's on fire."
            )}
          </>
        )
      }
      aside={
        <>
          {loadedAt ? <span className={styles.synced}>synced {ago(loadedAt, now)} ago</span> : null}
          <button type="button" className={ui.btn} onClick={() => void load()} disabled={busy}>
            {busy ? "Syncing…" : "Refresh"}
          </button>
        </>
      }
    >
      {errors.length ? <Notice tone="error">Some panels didn&apos;t load: {Array.from(new Set(errors)).join(" · ")}</Notice> : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          <Section id="attention" title="Needs attention" count={firstLoad ? "…" : attention.length} tone={warnCount ? "warn" : undefined}>
            {firstLoad ? (
              <p className={ui.empty}>Checking…</p>
            ) : attention.length ? (
              <ul className={styles.attention}>
                {attention.map((item) => (
                  <li key={item.key} data-tone={item.tone}>
                    <i aria-hidden="true" />
                    <div className={styles.attText}>
                      <b>{item.title}</b>
                      {item.detail ? <span>{item.detail}</span> : null}
                    </div>
                    {item.href ? (
                      <Link href={item.href} className={item.tone === "warn" ? ui.btnPrimary : ui.btn}>
                        {item.action ?? "Open"} →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.allQuiet}>
                <b>All quiet.</b> No disputes, no stuck ticks, nothing waiting on you.
              </p>
            )}
          </Section>

          <Section id="health" title="Health">
            <div className={styles.health}>
              <div className={styles.healthCol}>
                <h3>Market</h3>
                <p className={styles.bigState} data-open={open === null ? undefined : String(open)}>
                  {open === null ? "…" : open ? "Open" : m?.trading_status === "settling" ? "Settling" : m?.trading_status === "manual_closed" ? "Paused" : "Closed"}
                </p>
                <dl className={styles.rows}>
                  {isAdmin ? (
                    <Row label="Next tick" tone="blue">
                      {a?.next_scheduled_at ? (
                        <>
                          {etTime(a.next_scheduled_at, false)} <small>{until(a.next_scheduled_at, now)}</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </Row>
                  ) : null}
                  <Row label="Settlement">
                    {m?.next_scheduled_settlement_at ? (
                      <>
                        {etTime(m.next_scheduled_settlement_at)} <small>{until(m.next_scheduled_settlement_at, now)}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </Row>
                  {isAdmin ? (
                    <Row label="Live batch">
                      {l?.health.next_execute_after ? (
                        <>
                          {etTime(l.health.next_execute_after, false)} <small>{until(l.health.next_execute_after, now)}</small>
                        </>
                      ) : (
                        <span className={styles.muted}>nothing queued</span>
                      )}
                    </Row>
                  ) : null}
                  {m?.trading_message ? <Row label="Message">{m.trading_message}</Row> : null}
                </dl>
                {isAdmin ? <TradingControl status={(m as MarketStatus | null) ?? null} onChanged={() => void load()} /> : null}
                {isAdmin ? <MaintenanceControl /> : null}
              </div>

              {isAdmin ? (
                <div className={styles.healthCol}>
                  <h3>Schedulers</h3>
                  <dl className={styles.rows}>
                    <Row label="Ticks" tone={a && a.scheduler_status !== "running" ? "warn" : undefined}>
                      {a ? (
                        <>
                          <span className={ui.pill} data-tone={a.scheduler_status === "running" ? "blue" : "warn"}>
                            <i aria-hidden="true" />
                            {schedulerLabel(a)}
                          </span>
                          <small>every {Math.round(a.scheduler_interval_ms / 1000)}s{a.scheduler_lock_held ? " · lock held" : ""}</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </Row>
                    <Row label="Ticks 24h">
                      {a ? (
                        <>
                          {fmtCount(a.applied_24h_count)} applied <small>{fmtCount(a.skipped_24h_count)} skipped</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </Row>
                    <Row label="Stuck" tone={a && (a.stuck_scheduled_count || a.overdue_scheduled_count) ? "warn" : undefined}>
                      {a ? (
                        <>
                          {fmtCount(a.stuck_scheduled_count)} <small>{fmtCount(a.overdue_scheduled_count)} overdue</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </Row>
                    <Row label="Live orders" tone={l && l.scheduler_status !== "running" ? "warn" : undefined}>
                      {l ? (
                        <>
                          <span className={ui.pill} data-tone={l.scheduler_status === "running" ? "blue" : "warn"}>
                            <i aria-hidden="true" />
                            {schedulerLabel(l)}
                          </span>
                          <small>
                            {fmtCount(l.health.pending_count)} queued{l.health.overdue_pending_count ? ` · ${l.health.overdue_pending_count} overdue` : ""}
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </Row>
                    <Row label="Orders 24h">
                      {l ? (
                        <>
                          {fmtCount(l.health.filled_24h_count)} filled <small>{fmtCount(l.health.rejected_24h_count)} rejected</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </Row>
                  </dl>
                </div>
              ) : null}

              {canPredictions ? (
                <div className={styles.healthCol}>
                  <h3>Predictions queue</h3>
                  <ul className={styles.queue}>
                    {[
                      { label: "Disputed", value: disputed, anchor: "proposals", tone: disputed ? "warn" : undefined },
                      { label: "Calls in window", value: p ? p.proposals.length - disputed : null, anchor: "proposals" },
                      { label: "Needs a call", value: p?.needs_call.length ?? null, anchor: "needs-call", tone: p?.needs_call.length ? "blue" : undefined },
                      { label: "Approvals", value: p?.queue.length ?? null, anchor: "queue", tone: p?.queue.length ? "blue" : undefined },
                    ].map((row) => (
                      <li key={row.label}>
                        <Link href={`/predictions/manage#${row.anchor}`} data-tone={row.tone}>
                          <span>{row.label}</span>
                          <b>{row.value === null ? "—" : row.value}</b>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {p ? (
                    <p className={styles.queueFoot}>
                      <b>{p.house.open_markets}</b> open · house worst case <b>{fmtCash(p.house.worst_case_loss)}</b>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Section>

          {isAdmin ? (
            <Section id="activity" title="Activity" hint="Last 24 hours unless it says otherwise">
              <div className={ui.stripWrap}>
                <div className={ui.strip} style={{ ["--cols" as string]: 4 }}>
                  <Link href="/admin/people" className={ui.stat}>
                    <small>Players</small>
                    <b>{fmtCount(s?.users.total)}</b>
                    <em>{s ? `${fmtCount(s.users.verified)} verified` : "\u00a0"}</em>
                  </Link>
                  <div className={ui.stat} data-tone={s?.users.signups_24h ? "blue" : undefined}>
                    <small>Sign-ups</small>
                    <b>{fmtCount(s?.users.signups_24h)}</b>
                    <em>{s ? `${fmtCount(s.users.signups_7d)} this week` : "\u00a0"}</em>
                  </div>
                  <div className={ui.stat}>
                    <small>Active traders</small>
                    <b>{fmtCount(s?.market.active_traders_24h)}</b>
                    <em>{s ? `of ${fmtCount(s.users.total)} players` : "\u00a0"}</em>
                  </div>
                  <div className={ui.stat}>
                    <small>Stock trades</small>
                    <b>{fmtCount(s?.market.trades_24h)}</b>
                    <em>{s ? `${fmtCash(s.market.volume_cash_24h)} traded` : "\u00a0"}</em>
                  </div>
                  <div className={ui.stat}>
                    <small>Game rounds</small>
                    <b>{fmtCount(s?.games.rounds_24h)}</b>
                    <em>{s?.games.rounds_by_game[0] ? `mostly ${s.games.rounds_by_game[0].name}` : "\u00a0"}</em>
                  </div>
                  <div className={ui.stat}>
                    <small>Capsule pulls</small>
                    <b>{fmtCount(s?.games.capsule_pulls_24h)}</b>
                    <em>{s ? `${fmtCash(s.games.capsule_spend_24h)} spent` : "\u00a0"}</em>
                  </div>
                  <div className={ui.stat}>
                    <small>Card pulls</small>
                    <b>{fmtCount(s?.games.card_pulls_24h)}</b>
                    <em>{s ? `${fmtCash(s.games.card_spend_24h)} spent` : "\u00a0"}</em>
                  </div>
                  <Link href="/predictions" className={ui.stat}>
                    <small>Prediction volume</small>
                    <b>{fmtCash(s?.predictions.volume_cash_24h)}</b>
                    <em>{s ? `${fmtCount(s.predictions.trades_24h)} trades · ${fmtCount(s.predictions.traders_24h)} traders` : "\u00a0"}</em>
                  </Link>
                </div>
              </div>
            </Section>
          ) : null}
        </div>

        <aside className={styles.side}>
          <Section title="Tools">
            <ul className={styles.tools}>
              {tools.map((tool) => (
                <li key={tool.label}>
                  <Link href={tool.href}>
                    <b>{tool.label}</b>
                    <span>{tool.line}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          {isAdmin && s ? (
            <Section title="Games, 24h" count={s.games.rounds_24h}>
              {s.games.rounds_by_game.length ? (
                <ul className={styles.bars}>
                  {s.games.rounds_by_game.map((game) => (
                    <li key={game.key}>
                      <span>{game.name}</span>
                      <b>{fmtCount(game.rounds)}</b>
                      <i style={{ ["--w" as string]: `${Math.max(4, (game.rounds / Math.max(1, s.games.rounds_by_game[0].rounds)) * 100)}%` }} aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={ui.empty}>No rounds today.</p>
              )}
            </Section>
          ) : null}

          {isAdmin && s ? (
            <Section title="Staff" count={s.users.roles.staff} actions={<Link href="/admin/people" className={styles.sideLink}>Manage →</Link>}>
              <dl className={styles.rows}>
                <Row label="Admins">{fmtCount(s.users.roles.is_admin)}</Row>
                <Row label="Asset managers">{fmtCount(s.users.roles.can_manage_assets)}</Row>
                <Row label="Creators">{fmtCount(s.users.roles.can_create_prediction_markets)}</Row>
                <Row label="Approvers">{fmtCount(s.users.roles.can_approve_prediction_markets)}</Row>
                <Row label="Resolvers">{fmtCount(s.users.roles.can_resolve_prediction_markets)}</Row>
                <Row label="Voiders">{fmtCount(s.users.roles.can_void_prediction_markets)}</Row>
              </dl>
            </Section>
          ) : null}
        </aside>
      </div>
    </AdminFrame>
  );
}
