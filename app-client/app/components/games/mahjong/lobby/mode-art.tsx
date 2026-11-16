"use client";

import { FaRobot } from "react-icons/fa6";
import { FiLink, FiUser } from "react-icons/fi";
import { Tile, TileBack } from "@/app/components/games/mahjong/tile";
import styles from "@/app/components/games/mahjong/lobby/mode-art.module.scss";

// The drawn versions of the lobby's art slots (mahjong-lobby-* in lib/art/slots/mahjong.json). Each one
// fills its slot, centers on its own, and is the design until the slot's image ships in the manifest.

/** Quick match: a stopwatch on the bot-fill seconds beside four seats, three taken and one being filled. */
export function QuickArt({ seconds }: { seconds: number }) {
  return (
    <div className={styles.art}>
      <div className={styles.quick}>
        <span className={styles.watch}>
          <svg viewBox="0 0 64 72" aria-hidden="true">
            <rect className={styles.watchCrown} x="27" y="0" width="10" height="6" rx="1.5" />
            <rect className={styles.watchCrown} x="30" y="5" width="4" height="4" />
            <circle className={styles.watchTrack} cx="32" cy="40" r="27" />
            <circle className={styles.watchArc} cx="32" cy="40" r="27" pathLength="100" />
            {Array.from({ length: 12 }, (_, index) => (
              <line key={index} className={styles.watchTick} x1="32" y1="17" x2="32" y2={index % 3 === 0 ? 21 : 19} transform={`rotate(${index * 30} 32 40)`} />
            ))}
            <g className={styles.watchHand}>
              <line x1="32" y1="40" x2="32" y2="20" />
              <circle cx="32" cy="40" r="2.2" />
            </g>
          </svg>
          <b>{seconds}s</b>
        </span>
        <div className={styles.queue}>
          <div className={styles.queueSeats}>
            {[27, 28, 29].map((kind) => (
              <span key={kind} className={styles.queueSeat}>
                <Tile kind={kind} size={28} labels={false} title="" />
              </span>
            ))}
            <span className={styles.queueSeat} data-open="">
              <i />
              <i />
              <i />
            </span>
          </div>
          <span className={styles.meter}>
            <i />
          </span>
        </div>
      </div>
    </div>
  );
}

const HAND = [10, 11, 12, 22, 23];

/** Practice: a table from above, your tiles at the bottom with one glowing as the hint, three bot seats. */
export function PracticeArt() {
  return (
    <div className={styles.art}>
      <div className={styles.table}>
        <div className={styles.felt}>
          <span className={styles.rowTop}>
            {Array.from({ length: 6 }, (_, index) => (
              <TileBack key={index} size={11} />
            ))}
          </span>
          <span className={styles.rowLeft}>
            {Array.from({ length: 4 }, (_, index) => (
              <TileBack key={index} size={11} rotated />
            ))}
          </span>
          <span className={styles.rowRight}>
            {Array.from({ length: 4 }, (_, index) => (
              <TileBack key={index} size={11} rotated />
            ))}
          </span>
          <span className={styles.console}>
            <i data-you="" />
            <i />
            <i />
            <i />
          </span>
          <span className={styles.rowYou}>
            {HAND.map((kind) => (
              <Tile key={kind} kind={kind} size={18} labels={false} title="" />
            ))}
            <span className={styles.hint}>
              <Tile kind={30} size={18} labels={false} title="" />
            </span>
          </span>
        </div>
        <span className={styles.bot} data-at="top">
          <FaRobot />
        </span>
        <span className={styles.bot} data-at="left">
          <FaRobot />
        </span>
        <span className={styles.bot} data-at="right">
          <FaRobot />
        </span>
        <span className={styles.you}>You</span>
      </div>
    </div>
  );
}

/** Friend room: an open door, the invite link, and the four seats it fills (three friends, one bot). */
export function FriendArt() {
  return (
    <div className={styles.art}>
      <div className={styles.friend}>
        <svg className={styles.door} viewBox="0 0 72 100" aria-hidden="true">
          <defs>
            <linearGradient id="mj-lobby-door-light" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="mj-lobby-door-floor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.45" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className={styles.doorSpill} d="M14 82 L52 82 L70 100 L0 100 Z" fill="url(#mj-lobby-door-floor)" />
          <rect x="14" y="8" width="38" height="74" fill="url(#mj-lobby-door-light)" />
          <rect className={styles.doorFrame} x="11" y="5" width="44" height="78" rx="1.5" />
          <path className={styles.doorLeaf} d="M14 8 L30 14 L30 88 L14 82 Z" />
          <circle className={styles.doorKnob} cx="26.5" cy="49" r="1.6" />
        </svg>
        <div className={styles.invite}>
          <span className={styles.pill}>
            <FiLink />
            <i />
            <i />
          </span>
          <span className={styles.party}>
            <i data-tone="1">
              <FiUser />
            </i>
            <i data-tone="2">
              <FiUser />
            </i>
            <i data-tone="3">
              <FiUser />
            </i>
            <i data-bot="">
              <FaRobot />
            </i>
          </span>
        </div>
      </div>
    </div>
  );
}

const STACKS = [3, 5, 7];

/** Chip tables: three chip stacks of rising height beside a pair of tiles. */
export function ChipsArt() {
  return (
    <div className={styles.art}>
      <div className={styles.chips}>
        <svg className={styles.stacks} viewBox="0 0 108 76" aria-hidden="true">
          {STACKS.map((count, stack) => (
            <g key={stack} transform={`translate(${6 + stack * 34} 0)`} data-stack={stack}>
              {Array.from({ length: count }, (_, index) => {
                const y = 66 - index * 7;
                return (
                  <g key={index}>
                    <path className={styles.chipSide} d={`M0 ${y} v5 a14 5 0 0 0 28 0 v-5`} />
                    <ellipse className={styles.chipTop} cx="14" cy={y} rx="14" ry="5" />
                    <ellipse className={styles.chipRing} cx="14" cy={y} rx="8.5" ry="2.8" />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
        <span className={styles.chipTiles}>
          <Tile kind={4} size={22} labels={false} title="" />
          <Tile kind={33} size={22} labels={false} title="" rotated />
        </span>
      </div>
    </div>
  );
}
