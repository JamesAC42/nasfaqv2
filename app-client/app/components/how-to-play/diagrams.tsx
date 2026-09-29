"use client";

import { useId } from "react";
import styles from "@/app/components/how-to-play/diagrams.module.scss";

// How-to explainers as diagrams: each one draws the actual mechanism (what feeds fair value and
// how ticks pull the price, how orders queue into a batch, where stakes go, what a prediction share
// pays). SVG on a 700×500 grid (the slot's 7:5), coloured from theme tokens so they work in light
// and dark. A `_shared/howto-*` image in the manifest still replaces them.

const VB = "0 0 700 500";

function Arrowhead({ id }: { id: string }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 Z" className={styles.arrowHead} />
    </marker>
  );
}

function useArrow() {
  return `arrow-${useId().replace(/:/g, "")}`;
}

/** 01 Market: YouTube numbers make fair value; the price wanders on hype; four ticks pull it back. */
export function MarketDiagram() {
  const arrow = useArrow();
  const inputs = ["Views", "Subscribers", "Uploads", "Big streams"];
  const ticks = [
    { x: 300, label: "09:00" },
    { x: 380, label: "15:00" },
    { x: 460, label: "21:00" },
    { x: 540, label: "03:00" },
  ];
  // Fair value drifts up; the price wanders on hype between ticks, and each tick (blue) pulls it
  // most of the way back.
  const fair = (x: number) => 330 - (x - 228) * 0.08;
  const wander = [
    "M 228 292 C 250 270, 276 226, 300 228",
    "M 300 314 C 322 334, 356 372, 380 366",
    "M 380 330 C 404 322, 438 272, 460 276",
    "M 460 306 C 484 312, 516 336, 540 330",
    "M 540 305 L 600 294",
  ];
  const pulls = [
    [300, 234, 308],
    [380, 360, 336],
    [460, 282, 300],
    [540, 324, 310],
  ];
  return (
    <svg className={styles.diagram} viewBox={VB} role="img" aria-label="Views, subscribers, uploads and big streams set a talent's fair value. The price wanders above and below it on hype, and four ticks a day pull it back toward fair value.">
      <defs>
        <Arrowhead id={arrow} />
      </defs>
      <text className={styles.kicker} x={20} y={52}>
        YOUTUBE
      </text>
      {inputs.map((label, index) => (
        <g key={label}>
          <rect className={styles.box} x={20} y={72 + index * 76} width={150} height={56} rx={8} />
          <text className={styles.boxLabel} x={95} y={100 + index * 76}>
            {label}
          </text>
        </g>
      ))}
      <path className={styles.bracket} d="M 182 100 H 196 V 404 H 182" />
      <path className={styles.arrow} d={`M 196 252 C 214 252, 206 ${fair(228)}, 224 ${fair(228)}`} markerEnd={`url(#${arrow})`} />

      {ticks.map((tick) => (
        <g key={tick.label}>
          <line className={styles.tickLine} x1={tick.x} y1={190} x2={tick.x} y2={410} />
          <text className={styles.axis} x={tick.x} y={436}>
            {tick.label}
          </text>
        </g>
      ))}
      <path className={styles.fair} d={`M 228 ${fair(228)} L 600 ${fair(600)}`} />
      {wander.map((d) => (
        <path key={d} className={styles.price} d={d} />
      ))}
      {pulls.map(([x, from, to]) => (
        <path key={x} className={styles.pull} d={`M ${x} ${from} V ${to}`} markerEnd={`url(#${arrow})`} />
      ))}
      <path className={styles.hype} d={`M 294 228 H 288 V ${fair(300)} H 294`} />
      <text className={styles.note} x={282} y={308} textAnchor="end">
        hype
      </text>
      <text className={styles.lineLabel} x={606} y={282} textAnchor="start">
        price
      </text>
      <text className={`${styles.lineLabel} ${styles.dim}`} x={606} y={322} textAnchor="start">
        fair value
      </text>
      <text className={styles.caption} x={414} y={476}>
        Four ticks a day pull the price toward fair value
      </text>
    </svg>
  );
}

/** 02 Trading: orders queue between batches, then fill together, first in first filled. */
export function TradingDiagram() {
  const arrow = useArrow();
  const orders = [
    { side: "BUY", qty: 20, x: 140 },
    { side: "SELL", qty: 5, x: 180 },
    { side: "BUY", qty: 50, x: 215 },
    { side: "BUY", qty: 10, x: 250 },
  ];
  // Price steps after each fill: buys nudge it up, the sell down.
  const steps = [372, 352, 362, 318, 306];
  return (
    <svg className={styles.diagram} viewBox={VB} role="img" aria-label="Orders placed between :00 and :10 wait in a queue. At :10 the whole queue fills in the order it arrived, and each fill nudges the price.">
      <defs>
        <Arrowhead id={arrow} />
      </defs>
      {/* Timeline. */}
      <line className={styles.axisLine} x1={40} y1={430} x2={670} y2={430} />
      {[
        { x: 110, label: ":00" },
        { x: 380, label: ":10" },
        { x: 640, label: ":20" },
      ].map((mark) => (
        <g key={mark.label}>
          <line className={styles.batchMark} x1={mark.x} y1={418} x2={mark.x} y2={442} />
          <text className={styles.axis} x={mark.x} y={470}>
            {mark.label}
          </text>
        </g>
      ))}
      <text className={styles.kicker} x={40} y={46}>
        QUEUE
      </text>
      {/* The queue, first in on top, each order tied to when it arrived. */}
      <rect className={styles.box} x={40} y={62} width={230} height={228} rx={10} />
      {orders.map((order, index) => (
        <g key={index}>
          <path className={styles.tether} d={`M ${order.x} 424 V 292`} />
          <circle className={styles.dot} cx={order.x} cy={430} r={6} />
          <rect className={order.side === "BUY" ? styles.buyRow : styles.sellRow} x={56} y={84 + index * 50} width={198} height={40} rx={6} />
          <text className={styles.rowIndex} x={74} y={109 + index * 50}>
            {index + 1}
          </text>
          <text className={styles.rowLabel} x={100} y={109 + index * 50}>
            {order.side} {order.qty}
          </text>
        </g>
      ))}
      <path className={styles.arrow} d="M 278 176 C 330 176, 360 190, 380 230 V 404" markerEnd={`url(#${arrow})`} />
      <text className={styles.note} x={394} y={206} textAnchor="start">
        all fill at :10
      </text>
      <text className={styles.note} x={394} y={230} textAnchor="start">
        in arrival order
      </text>
      {/* Price after each fill. */}
      <text className={styles.kicker} x={440} y={286}>
        PRICE
      </text>
      <path
        className={styles.price}
        d={`M 430 ${steps[0]} ${steps
          .slice(1)
          .map((y, index) => `H ${470 + index * 45} V ${y}`)
          .join(" ")} H 660`}
      />
      {steps.slice(1).map((y, index) => (
        <circle key={index} className={styles.fillDot} cx={470 + index * 45} cy={y} r={4.5} />
      ))}
      <text className={styles.caption} x={350} y={496}>
        Every 10 minutes the whole queue fills at once
      </text>
    </svg>
  );
}

/** 04 Games: one cash balance; solo games roll on the server at posted odds, versus stakes sit in escrow. */
export function GamesDiagram() {
  const arrow = useArrow();
  return (
    <svg className={styles.diagram} viewBox={VB} role="img" aria-label="Games spend the same cash you trade with. Solo games are rolled by the server at posted rates. In versus games both stakes sit in escrow until the hand ends, then the winner takes the pot.">
      <defs>
        <Arrowhead id={arrow} />
      </defs>
      <rect className={styles.boxStrong} x={20} y={206} width={150} height={88} rx={10} />
      <text className={styles.boxLabel} x={95} y={244}>
        Your cash
      </text>
      <text className={styles.boxSub} x={95} y={270}>
        same as trading
      </text>

      {/* Solo lane. */}
      <text className={styles.kicker} x={250} y={46}>
        SOLO
      </text>
      <path className={styles.arrow} d="M 170 232 C 210 232, 210 104, 244 104" markerEnd={`url(#${arrow})`} />
      <rect className={styles.box} x={250} y={64} width={180} height={80} rx={10} />
      <text className={styles.boxLabel} x={340} y={98}>
        Server rolls
      </text>
      <text className={styles.boxSub} x={340} y={124}>
        at posted rates
      </text>
      <path className={styles.arrow} d="M 430 104 H 484" markerEnd={`url(#${arrow})`} />
      <rect className={styles.box} x={490} y={64} width={190} height={80} rx={10} />
      <text className={styles.boxLabel} x={585} y={98}>
        Result
      </text>
      <text className={styles.boxSub} x={585} y={124}>
        prize or payout
      </text>
      <text className={styles.games} x={250} y={172}>
        Card gacha · Capsule · Blackjack · Ticker Tap
      </text>

      {/* Versus lane. */}
      <text className={styles.kicker} x={250} y={262}>
        VERSUS
      </text>
      <path className={styles.arrow} d="M 170 270 C 210 270, 210 330, 244 330" markerEnd={`url(#${arrow})`} />
      <rect className={styles.box} x={20} y={400} width={150} height={64} rx={10} />
      <text className={styles.boxLabel} x={95} y={438}>
        Their stake
      </text>
      <path className={styles.arrow} d="M 170 432 C 210 432, 210 356, 244 356" markerEnd={`url(#${arrow})`} />
      <rect className={styles.boxStrong} x={250} y={286} width={180} height={116} rx={10} />
      <path className={styles.lock} d="M 328 314 v -6 a 12 12 0 0 1 24 0 v 6" />
      <rect className={styles.lockBody} x={322} y={314} width={36} height={22} rx={4} />
      <text className={styles.boxLabel} x={340} y={360}>
        Escrow
      </text>
      <text className={styles.boxSub} x={340} y={386}>
        until the hand ends
      </text>
      <path className={styles.arrow} d="M 430 344 H 484" markerEnd={`url(#${arrow})`} />
      <rect className={styles.box} x={490} y={304} width={190} height={80} rx={10} />
      <text className={styles.boxLabel} x={585} y={338}>
        Winner
      </text>
      <text className={styles.boxSub} x={585} y={364}>
        takes the pot
      </text>
      <text className={styles.games} x={250} y={428}>
        Oshi Card Duel · High-Low Duel
      </text>
    </svg>
  );
}

/** 05 Predictions: the YES price is the chance; a share pays $1 or $0; then how it resolves. */
export function PredictionsDiagram() {
  const arrow = useArrow();
  const yes = 0.62;
  const x0 = 40;
  const x1 = 660;
  const split = x0 + (x1 - x0) * yes;
  const stages = ["Trading", "Closes", "Proposed", "Dispute 12h", "Paid"];
  return (
    <svg className={styles.diagram} viewBox={VB} role="img" aria-label="A YES share at 62 cents means the market thinks it's 62% likely. If it happens, YES pays $1 and NO pays nothing; if not, the other way round. Markets close, a result is proposed, a 12 hour dispute window runs, then winners are paid.">
      <defs>
        <Arrowhead id={arrow} />
      </defs>
      <text className={styles.kicker} x={x0} y={46}>
        THE PRICE IS THE CHANCE
      </text>
      <rect className={styles.yesBar} x={x0} y={62} width={split - x0 - 2} height={56} rx={6} />
      <rect className={styles.noBar} x={split + 2} y={62} width={x1 - split - 2} height={56} rx={6} />
      <text className={styles.barLabel} x={x0 + 18} y={98} textAnchor="start">
        YES 62¢
      </text>
      <text className={styles.barLabel} x={x1 - 18} y={98} textAnchor="end">
        NO 38¢
      </text>
      <text className={styles.axis} x={x0} y={144} textAnchor="start">
        0%
      </text>
      <text className={styles.axis} x={split} y={144}>
        62% likely
      </text>
      <text className={styles.axis} x={x1} y={144} textAnchor="end">
        100%
      </text>

      {/* Payouts. */}
      {[
        { x: x0, title: "It happens", yes: "$1.00", no: "$0" },
        { x: 360, title: "It doesn't", yes: "$0", no: "$1.00" },
      ].map((col) => (
        <g key={col.title}>
          <rect className={styles.box} x={col.x} y={176} width={300} height={150} rx={10} />
          <text className={styles.boxTitle} x={col.x + 20} y={212}>
            {col.title}
          </text>
          <text className={styles.rowLabel} x={col.x + 20} y={256}>
            YES share
          </text>
          <text className={col.yes === "$0" ? styles.payZero : styles.payWin} x={col.x + 280} y={256} textAnchor="end">
            {col.yes}
          </text>
          <text className={styles.rowLabel} x={col.x + 20} y={298}>
            NO share
          </text>
          <text className={col.no === "$0" ? styles.payZero : styles.payWin} x={col.x + 280} y={298} textAnchor="end">
            {col.no}
          </text>
        </g>
      ))}

      {/* Lifecycle. */}
      {stages.map((stage, index) => {
        const cx = x0 + 56 + index * 132;
        return (
          <g key={stage}>
            {index ? <path className={styles.arrow} d={`M ${cx - 132 + 58} 410 H ${cx - 60}`} markerEnd={`url(#${arrow})`} /> : null}
            <rect className={index === stages.length - 1 ? styles.boxStrong : styles.box} x={cx - 56} y={386} width={112} height={48} rx={24} />
            <text className={styles.stage} x={cx} y={416}>
              {stage}
            </text>
          </g>
        );
      })}
      <text className={styles.caption} x={350} y={480}>
        Sell any time before it closes; voided markets refund everyone
      </text>
    </svg>
  );
}
