"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { FiArrowRight } from "react-icons/fi";
import { Oshimark } from "@/app/components/common/oshimark";
import { TalentCard, type CardFace } from "@/app/components/games/cards/talent-card";
import { PlayingCard } from "@/app/components/games/shared/playing-card";
import styles from "@/app/components/games/arcade/tiles.module.scss";

export type TileStat = { text: ReactNode; live?: boolean } | null;

export type ArcadeTile = {
  key: string;
  href: string;
  name: string;
  hook: string;
  price: string;
  stat: TileStat;
};

export function GameTiles({ tiles, faces, phone }: { tiles: ArcadeTile[]; faces: CardFace[]; phone: boolean }) {
  return (
    <section className={styles.section} aria-labelledby="arcade-games">
      <h2 id="arcade-games" className={styles.head}>
        Games <small>{tiles.length}</small>
      </h2>
      <ul className={styles.grid}>
        {tiles.map((tile) => (
          <li key={tile.key} className={styles.cell}>
            <Link href={tile.href} className={styles.tile} data-game={tile.key}>
              <span className={styles.stage} aria-hidden="true">
                <TileArt game={tile.key} faces={faces} phone={phone} />
              </span>
              <span className={styles.body}>
                <span className={styles.titleRow}>
                  <span className={styles.name}>{tile.name}</span>
                  {tile.stat ? (
                    <span className={styles.stat} data-live={tile.stat.live || undefined}>
                      {tile.stat.live ? <i aria-hidden="true" /> : null}
                      {tile.stat.text}
                    </span>
                  ) : null}
                </span>
                <span className={styles.hook}>{tile.hook}</span>
                <span className={styles.foot}>
                  <span className={styles.price}>{tile.price}</span>
                  <span className={styles.go}>
                    Play <FiArrowRight aria-hidden="true" />
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TileArt({ game, faces, phone }: { game: string; faces: CardFace[]; phone: boolean }) {
  const pick = (index: number) => faces[index % Math.max(1, faces.length)];
  const w = phone ? 54 : 84;

  if (game === "cards" && faces.length) {
    const [center, left, right] = [pick(0), pick(1), pick(2)];
    return (
      <span className={styles.cardFan}>
        <TalentCard card={{ ...left, rarity: "SR" }} width={w} compact tilt={false} className={styles.fanL} />
        <TalentCard card={{ ...right, rarity: "SSR" }} width={w} compact tilt={false} className={styles.fanR} />
        <TalentCard card={{ ...center, rarity: "UR" }} width={Math.round(w * 1.12)} compact tilt={false} className={styles.fanC} />
      </span>
    );
  }

  if (game === "duel" && faces.length) {
    const dw = phone ? 44 : w;
    const a = pick(3);
    const b = pick(4);
    return (
      <span className={styles.duel}>
        <TalentCard card={{ ...a, rarity: "SSR", power: 27 }} width={dw} compact tilt={false} className={styles.duelA} />
        <span className={styles.vs}>VS</span>
        <TalentCard card={{ ...b, rarity: "SR", power: 24 }} width={dw} compact tilt={false} className={styles.duelB} />
      </span>
    );
  }

  if (game === "blackjack") {
    const cw = phone ? 40 : 58;
    return (
      <span className={styles.felt}>
        <span className={styles.hand}>
          <PlayingCard card={{ rank: "A", suit: "S" }} width={cw} />
          <PlayingCard card={{ rank: "K", suit: "H" }} width={cw} />
        </span>
        <span className={styles.twentyOne}>21</span>
        <span className={styles.chips}>
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  }

  if (game === "high-low") {
    const cw = phone ? 42 : 60;
    return (
      <span className={styles.hilo}>
        <PlayingCard card={{ rank: 7, suit: "D" }} width={cw} />
        <span className={styles.calls}>
          <b data-dir="up">▲</b>
          <b data-dir="down">▼</b>
        </span>
        <PlayingCard card={null} width={cw} />
      </span>
    );
  }

  if (game === "ticker-tap") {
    const marks = faces.slice(0, 6);
    const pops: { lane: number; top: number; kind: "up" | "down" | "gold"; delay: number }[] = [
      { lane: 0, top: 18, kind: "up", delay: 0 },
      { lane: 1, top: 56, kind: "down", delay: 0.6 },
      { lane: 2, top: 28, kind: "gold", delay: 1.1 },
      { lane: 3, top: 64, kind: "up", delay: 0.3 },
      { lane: 4, top: 22, kind: "up", delay: 1.5 },
      { lane: 1, top: 12, kind: "up", delay: 1.9 },
    ];
    return (
      <span className={styles.lanes}>
        {Array.from({ length: 5 }, (_, lane) => (
          <span key={lane} className={styles.lane} />
        ))}
        {pops.map((pop, index) => {
          const face = marks[index % Math.max(1, marks.length)];
          return (
            <span
              key={index}
              className={styles.pop}
              data-kind={pop.kind}
              style={{ "--lane": pop.lane, "--top": `${pop.top}%`, "--delay": `${pop.delay}s` } as CSSProperties}
            >
              {face ? <Oshimark icon={face.icon} symbol={face.symbol} size={phone ? 12 : 14} /> : null}
              <b>{face?.symbol ?? "HOLO"}</b>
              <em>{pop.kind === "down" ? "▼" : pop.kind === "gold" ? "★" : "▲"}</em>
            </span>
          );
        })}
        <span className={styles.combo}>×12</span>
      </span>
    );
  }

  if (game === "capsule") {
    return (
      <span className={styles.machine}>
        <span className={styles.globe}>
          {["c", "r", "e", "c", "l", "r", "c", "e", "r"].map((tier, index) => (
            <i key={index} data-tier={tier} />
          ))}
        </span>
        <span className={styles.base}>
          <span className={styles.slot} />
        </span>
      </span>
    );
  }

  return null;
}
