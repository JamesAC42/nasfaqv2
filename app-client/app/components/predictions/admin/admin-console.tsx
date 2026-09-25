"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import {
  ApprovalActions,
  CallCard,
  LiveActions,
  MarketLink,
  ProposalActions,
  ProposeToggle,
  SubmitAction,
  VoidAction,
  callFromAdmin,
  useNow,
  useStaffFlags,
  type StaffFlags,
} from "@/app/components/predictions/admin/staff-parts";
import { TemplatePanel } from "@/app/components/predictions/admin/template-panel";
import { PredictionsFrame } from "@/app/components/predictions/shell/predictions-frame";
import { fetchAdminOverview } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { STATUS_LABEL, TEMPLATE_LABEL, compactMoney, leader, money, outcomeColor, percent, timeAgo, timeLeft } from "@/app/lib/predictions/format";
import { usePredictionFeed } from "@/app/lib/predictions/use-prediction-feed";
import type { AdminMarket, AdminOverview } from "@/app/lib/predictions/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/admin/admin-console.module.scss";

// /predictions/manage: the staff console (spec §7). Disputed calls first, then calls whose window
// ends soonest; then markets waiting for a call, the approval queue, live markets and drafts.
// Auto templates sit in the side column. Refreshes on every market status change.

type Flash = { dir: "up" | "down"; n: number };

function Meta({ market, now, children }: { market: AdminMarket; now: number; children?: ReactNode }) {
  return (
    <p className={styles.meta}>
      <span>{market.kind === "auto" ? (TEMPLATE_LABEL[market.auto_template ?? ""] ?? "Auto") : "Event"}</span>
      <span>{market.market_type === "multi" ? `${market.outcomes.length} outcomes` : "Binary"}</span>
      {market.category ? <span>{market.category.display_name}</span> : null}
      {market.creator ? <span>by {market.creator}</span> : null}
      {["open", "pending_approval", "draft", "rejected"].includes(market.status) ? (
        <span>closes in {timeLeft(market.closes_at, now)}</span>
      ) : new Date(market.closes_at).getTime() > now ? (
        <span>closed early</span>
      ) : (
        <span>closed {timeAgo(market.closes_at, now)} ago</span>
      )}
      {children}
    </p>
  );
}

function Prices({ market }: { market: AdminMarket }) {
  const sorted = [...market.outcomes].sort((a, b) => b.price - a.price).slice(0, market.market_type === "multi" ? 4 : 2);
  return (
    <div className={styles.prices}>
      {sorted.map((outcome) => (
        <span key={outcome.id} style={{ ["--oc" as string]: outcomeColor(market, outcome) }}>
          {outcome.asset ? <Oshimark icon={outcome.asset.icon} symbol={outcome.asset.symbol} size={14} /> : <i aria-hidden="true" />}
          {outcome.label}
          <b>{percent(outcome.price)}</b>
        </span>
      ))}
      {market.market_type === "multi" && market.outcomes.length > 4 ? <span className={styles.more}>+{market.outcomes.length - 4}</span> : null}
    </div>
  );
}

function HouseInline({ market }: { market: AdminMarket }) {
  const net = market.house_net_cash;
  return (
    <span className={styles.houseInline}>
      house <b data-tone={net > 0 ? "up" : net < 0 ? "down" : undefined}>{`${net > 0 ? "+" : ""}${money(net, 0)}`}</b> · worst {money(market.max_house_loss, 0)}
    </span>
  );
}

function Section({ id, title, count, hint, tone, children }: { id: string; title: string; count: number; hint?: string; tone?: "warn"; children: ReactNode }) {
  return (
    <section className={styles.section} id={id} aria-labelledby={`${id}-h`}>
      <header className={styles.sectionHead}>
        <h2 id={`${id}-h`}>
          {title} <b data-tone={count && tone ? tone : undefined}>{count}</b>
        </h2>
        {hint ? <span>{hint}</span> : null}
      </header>
      {children}
    </section>
  );
}

function ProposalItem({ market, now, flags, onChanged }: { market: AdminMarket; now: number; flags: StaffFlags; onChanged: () => void }) {
  const call = callFromAdmin(market);
  const common = { market, flags, onChanged };
  return (
    <article className={styles.item} data-disputed={market.status === "disputed" || undefined}>
      <div className={styles.itemHead}>
        <h3>
          <MarketLink market={market}>{market.title}</MarketLink>
        </h3>
        <Meta market={market} now={now}>
          <HouseInline market={market} />
        </Meta>
      </div>
      <div className={styles.itemSplit}>
        {call ? <CallCard market={market} call={call} now={now} /> : <p className={styles.empty}>The call is missing. Open the market to check its timeline.</p>}
        <div className={styles.itemActions}>
          {call ? <ProposalActions {...common} call={call} disputeHours={market.dispute_hours} /> : null}
          <VoidAction {...common} compact />
        </div>
      </div>
    </article>
  );
}

function NeedsCallItem({ market, now, flags, onChanged }: { market: AdminMarket; now: number; flags: StaffFlags; onChanged: () => void }) {
  const common = { market, flags, onChanged };
  return (
    <article className={styles.item}>
      <div className={styles.itemHead}>
        <h3>
          <MarketLink market={market}>{market.title}</MarketLink>
        </h3>
        <Meta market={market} now={now}>
          <span className={styles.statusTag}>{STATUS_LABEL[market.status]}</span>
        </Meta>
      </div>
      <Prices market={market} />
      <div className={styles.itemRow}>
        <ProposeToggle {...common} disputeHours={market.dispute_hours} />
        <VoidAction {...common} compact />
      </div>
    </article>
  );
}

function QueueItem({ market, now, flags, onChanged }: { market: AdminMarket; now: number; flags: StaffFlags; onChanged: () => void }) {
  const common = { market, flags, onChanged };
  return (
    <article className={styles.item}>
      <div className={styles.itemHead}>
        <h3>
          <MarketLink market={market}>{market.title}</MarketLink>
        </h3>
        <Meta market={market} now={now}>
          <span>b {Math.round(market.liquidity_b)}</span>
          <span>worst {money(market.max_house_loss, 0)}</span>
          <span>submitted {timeAgo(market.created_at, now)} ago</span>
        </Meta>
        {market.subtitle ? <p className={styles.sub}>{market.subtitle}</p> : null}
      </div>
      <Prices market={market} />
      <div className={styles.itemRow}>
        <ApprovalActions {...common} creator={market.creator} />
        <VoidAction {...common} compact />
        <Link className={styles.readRules} href={`/predictions/${market.slug}`}>
          Read the rules →
        </Link>
      </div>
    </article>
  );
}

function LiveRow({ market, now, flags, flash, onChanged }: { market: AdminMarket; now: number; flags: StaffFlags; flash?: Flash; onChanged: () => void }) {
  const common = { market, flags, onChanged };
  const top = market.market_type === "binary" ? market.outcomes.find((outcome) => outcome.outcome_code === "yes") : leader(market.outcomes);
  const closesMs = new Date(market.closes_at).getTime() - now;
  const halted = market.trading_status === "halted";
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.liveRow} role="row" data-halted={halted || undefined}>
      <div className={styles.liveName} role="cell">
        <MarketLink market={market}>{market.title}</MarketLink>
        <small>
          {market.kind === "auto" ? (TEMPLATE_LABEL[market.auto_template ?? ""] ?? "Auto") : (market.category?.display_name ?? "Event")}
          {halted ? <em>Halted</em> : null}
          {market.trading_status === "pending_open" ? <em>Opens {timeLeft(market.opens_at, now)}</em> : null}
        </small>
      </div>
      <div className={styles.livePrice} role="cell" data-label="Price">
        {top ? (
          <span key={flash?.n ?? 0} className={flash ? (flash.dir === "up" ? styles.flashUp : styles.flashDown) : undefined} style={{ ["--oc" as string]: outcomeColor(market, top) }}>
            {top.asset ? <Oshimark icon={top.asset.icon} symbol={top.asset.symbol} size={14} /> : <i aria-hidden="true" />}
            <em>{top.label}</em>
            <b>{percent(top.price)}</b>
          </span>
        ) : (
          "—"
        )}
      </div>
      <div className={styles.liveNum} role="cell" data-label="Vol 24h">
        {compactMoney(market.volume_24h)}
        <small>{compactMoney(market.total_volume_cash)} all</small>
      </div>
      <div className={styles.liveNum} role="cell" data-label="House net" data-tone={market.house_net_cash > 0 ? "up" : market.house_net_cash < 0 ? "down" : undefined}>
        {`${market.house_net_cash > 0 ? "+" : ""}${money(market.house_net_cash, 0)}`}
      </div>
      <div className={styles.liveNum} role="cell" data-label="Max loss">
        {money(market.max_house_loss, 0)}
      </div>
      <div className={styles.liveNum} role="cell" data-label="Closes" data-soon={closesMs < 3_600_000 || undefined}>
        {timeLeft(market.closes_at, now)}
      </div>
      <div role="cell" className={styles.manageCell}>
        <button type="button" className={styles.manageBtn} aria-expanded={open} aria-controls={`live-${market.id}`} onClick={() => setOpen((value) => !value)}>
          {open ? "Done" : "Manage"}
        </button>
      </div>
      {open ? (
        <div className={styles.liveActions} id={`live-${market.id}`}>
          <LiveActions {...common} />
          <ProposeToggle {...common} disputeHours={market.dispute_hours} label="Call it" />
          <VoidAction {...common} compact />
        </div>
      ) : null}
    </div>
  );
}

function DraftItem({ market, now, flags, onChanged }: { market: AdminMarket; now: number; flags: StaffFlags; onChanged: () => void }) {
  const common = { market, flags, onChanged };
  return (
    <article className={styles.item}>
      <div className={styles.itemHead}>
        <h3>
          <MarketLink market={market}>{market.title}</MarketLink>
        </h3>
        <Meta market={market} now={now}>
          <span className={styles.statusTag}>{STATUS_LABEL[market.status]}</span>
        </Meta>
      </div>
      <div className={styles.itemRow}>
        <SubmitAction {...common} creator={market.creator} />
        <VoidAction {...common} compact />
      </div>
    </article>
  );
}

type LiveFilter = "all" | "event" | "auto";

export function AdminConsole() {
  const { initialized, user } = useAuth();
  const flags = useStaffFlags();
  const now = useNow();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [liveFilter, setLiveFilter] = useState<LiveFilter>("all");
  const [flashes, setFlashes] = useState<Record<number, Flash>>({});
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<AdminOverview | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchAdminOverview();
      dataRef.current = next;
      setData(next);
      setError(null);
      setLoadedAt(Date.now());
    } catch (caught) {
      setError(predictionErrorText(caught));
    }
  }, []);

  const reloadSoon = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 500);
  }, [load]);

  useEffect(() => {
    if (!initialized || !flags.isStaff) return;
    // Initial load plus a slow poll in case the socket misses something.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 45_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [initialized, flags.isStaff, load]);

  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);

  usePredictionFeed((message) => {
    if (message.type === "prediction.market.updated") {
      reloadSoon();
      return;
    }
    if (message.type !== "prediction.trade") return;
    const { trade, market_id: marketId } = message;
    const current = dataRef.current;
    const market = current?.live.find((entry) => entry.id === marketId);
    if (!current || !market) return;
    const headline = (outcomes: AdminMarket["outcomes"]) => (market.market_type === "binary" ? outcomes.find((o) => o.outcome_code === "yes")?.price : leader(outcomes)?.price);
    const outcomes = market.outcomes.map((outcome) => {
      const next = trade.prices.find((price) => price.outcome_id === outcome.id || price.outcome_code === outcome.outcome_code);
      return next ? { ...outcome, price: next.price } : outcome;
    });
    const before = headline(market.outcomes);
    const after = headline(outcomes);
    const next = { ...current, live: current.live.map((entry) => (entry.id === marketId ? { ...entry, outcomes } : entry)) };
    dataRef.current = next;
    setData(next);
    if (before !== undefined && after !== undefined && after !== before) {
      const dir: Flash["dir"] = after > before ? "up" : "down";
      setFlashes((currentFlashes) => ({ ...currentFlashes, [marketId]: { dir, n: (currentFlashes[marketId]?.n ?? 0) + 1 } }));
    }
  });

  const proposals = useMemo(
    () =>
      [...(data?.proposals ?? [])].sort((a, b) => {
        const disputedA = a.status === "disputed" ? 0 : 1;
        const disputedB = b.status === "disputed" ? 0 : 1;
        if (disputedA !== disputedB) return disputedA - disputedB;
        const endA = a.proposal ? new Date(a.proposal.window_ends_at).getTime() : Infinity;
        const endB = b.proposal ? new Date(b.proposal.window_ends_at).getTime() : Infinity;
        return endA - endB;
      }),
    [data?.proposals],
  );

  const liveByTemplate = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const market of data?.live ?? []) if (market.auto_template) counts[market.auto_template] = (counts[market.auto_template] ?? 0) + 1;
    return counts;
  }, [data?.live]);

  const live = useMemo(() => (data?.live ?? []).filter((market) => liveFilter === "all" || market.kind === liveFilter), [data?.live, liveFilter]);

  if (!initialized) {
    return (
      <PredictionsFrame kicker="Staff" title="Control room">
        <p className={styles.loading}>Loading…</p>
      </PredictionsFrame>
    );
  }

  if (!user || !flags.isStaff) {
    return (
      <PredictionsFrame kicker="Staff" title="Control room">
        <div className={styles.gate}>
          <b>Staff only.</b>
          <p>This is where the mods approve markets and make the calls. {user ? "Your account doesn't have a staff role." : "Sign in with a staff account to get in."}</p>
          <Link href="/predictions">Back to the floor →</Link>
        </div>
      </PredictionsFrame>
    );
  }

  const disputedCount = proposals.filter((market) => market.status === "disputed").length;
  const liveEvents = (data?.live ?? []).filter((market) => market.kind === "event").length;
  const strip = data
    ? [
        { id: "proposals", label: "Disputed", value: String(disputedCount), tone: disputedCount ? "warn" : undefined },
        { id: "proposals", label: "Calls in window", value: String(proposals.length - disputedCount) },
        { id: "needs-call", label: "Needs a call", value: String(data.needs_call.length), tone: data.needs_call.length ? "blue" : undefined },
        { id: "queue", label: "Approval", value: String(data.queue.length), tone: data.queue.length ? "blue" : undefined },
        { id: "live", label: "Open markets", value: String(data.house.open_markets) },
        { id: "live", label: "House worst case", value: money(data.house.worst_case_loss, 0) },
        { id: "drafts", label: "Drafts", value: String(data.drafts.length) },
      ]
    : [];

  const common = { now, flags, onChanged: load };

  return (
    <PredictionsFrame
      kicker="Staff"
      title="Control room"
      live
      blurb={
        data ? (
          <>
            <b>{proposals.length}</b> call{proposals.length === 1 ? "" : "s"} on the clock{disputedCount ? <>, <b>{disputedCount}</b> disputed</> : null}. <b>{liveEvents}</b> event market{liveEvents === 1 ? "" : "s"} live.
          </>
        ) : undefined
      }
      aside={
        <>
          {loadedAt ? <span className={styles.synced}>synced {timeAgo(loadedAt, now)} ago</span> : null}
          {flags.canCreate ? (
            <Link href="/predictions/create" className={styles.newBtn}>
              + New market
            </Link>
          ) : null}
        </>
      }
    >
      {error ? (
        <p className={styles.loadError} role="alert">
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : null}
      {!data ? (
        error ? null : <p className={styles.loading}>Loading the console…</p>
      ) : (
        <>
          <nav className={styles.strip} aria-label="Queues">
            {strip.map((cell) => (
              <a key={cell.label} href={`#${cell.id}`} className={styles.stripCell} data-tone={cell.tone}>
                <small>{cell.label}</small>
                <b>{cell.value}</b>
              </a>
            ))}
          </nav>

          <div className={styles.layout}>
            <div className={styles.main}>
              <Section id="proposals" title="Proposals" count={proposals.length} hint="Disputed first, then the windows ending soonest" tone="warn">
                {proposals.length ? proposals.map((market) => <ProposalItem key={market.id} market={market} {...common} />) : <p className={styles.empty}>No calls on the clock.</p>}
              </Section>

              <Section id="needs-call" title="Needs a call" count={data.needs_call.length} hint="Closed event markets, oldest first">
                {data.needs_call.length ? data.needs_call.map((market) => <NeedsCallItem key={market.id} market={market} {...common} />) : <p className={styles.empty}>Nothing waiting on a call.</p>}
              </Section>

              <Section id="queue" title="Approval queue" count={data.queue.length}>
                {data.queue.length ? data.queue.map((market) => <QueueItem key={market.id} market={market} {...common} />) : <p className={styles.empty}>Queue&apos;s empty.</p>}
              </Section>

              <Section id="live" title="Live" count={data.live.length}>
                <div className={styles.liveTools} role="tablist" aria-label="Filter live markets">
                  {(["all", "event", "auto"] as const).map((key) => (
                    <button key={key} type="button" role="tab" aria-selected={liveFilter === key} onClick={() => setLiveFilter(key)}>
                      {key === "all" ? "All" : key === "event" ? "Events" : "Auto"}
                      <small>{key === "all" ? data.live.length : data.live.filter((market) => market.kind === key).length}</small>
                    </button>
                  ))}
                </div>
                {live.length ? (
                  <div className={styles.liveTable} role="table" aria-label="Live markets">
                    <div className={styles.liveHead} role="row">
                      <span role="columnheader">Market</span>
                      <span role="columnheader">Price</span>
                      <span role="columnheader">Vol 24h</span>
                      <span role="columnheader">House net</span>
                      <span role="columnheader">Max loss</span>
                      <span role="columnheader">Closes</span>
                      <span role="columnheader">
                        <span className={styles.srOnly}>Actions</span>
                      </span>
                    </div>
                    {live.map((market) => (
                      <LiveRow key={market.id} market={market} flash={flashes[market.id]} {...common} />
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>Nothing live here.</p>
                )}
              </Section>

              <Section id="drafts" title="Drafts" count={data.drafts.length} hint="Drafts and rejected markets">
                {data.drafts.length ? data.drafts.map((market) => <DraftItem key={market.id} market={market} {...common} />) : <p className={styles.empty}>No drafts.</p>}
              </Section>
            </div>

            <aside className={styles.side} aria-labelledby="templates-h">
              <header className={styles.sectionHead}>
                <h2 id="templates-h">Auto templates</h2>
                <span>Opened and called by the scheduler</span>
              </header>
              <TemplatePanel templates={data.templates} liveByTemplate={liveByTemplate} now={now} onChanged={load} />
            </aside>
          </div>
        </>
      )}
    </PredictionsFrame>
  );
}

