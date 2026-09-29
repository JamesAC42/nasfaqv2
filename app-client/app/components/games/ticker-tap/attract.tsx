"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { talentAccent } from "@/app/lib/talent-color";
import { isCalm } from "@/app/providers/motion-provider";
import styles from "@/app/components/games/ticker-tap/attract.module.scss";

// Attract mode: the five lanes playing themselves in the lobby, like an arcade cabinet between
// credits. Pure decoration (aria-hidden, no money, no API); it pauses when off-screen or the tab
// is hidden, and calm mode shows a still frame.

export type DemoTalent = { symbol: string; icon: string | null; color: string | null };

type Kind = "up" | "down" | "gold";
type Tile = { id: number; lane: number; y: number; kind: Kind; talent: DemoTalent | null; born: number; life: number; fateAt: number; fate: "hit" | "escape" | "avoid" | "blunder" };
type Pop = { id: number; lane: number; y: number; text: string; tone: Kind | "miss" | "big"; born: number };
type Demo = { tiles: Tile[]; pops: Pop[]; score: number; combo: number; flash: { lane: number; tone: Kind; id: number } | null };

const LANES = 5;
const GLYPH: Record<Kind, string> = { up: "▲", down: "▼", gold: "★" };
const multFor = (combo: number) => Math.min(3, 1 + Math.floor(combo / 5) * 0.5);

function stillFrame(talents: DemoTalent[]): Demo {
  const pick = (index: number) => talents[index % Math.max(1, talents.length)] ?? null;
  return {
    tiles: [
      { id: 1, lane: 0, y: 30, kind: "up", talent: pick(3), born: 0, life: 1, fateAt: 0, fate: "hit" },
      { id: 2, lane: 2, y: 62, kind: "down", talent: pick(11), born: 0, life: 1, fateAt: 0, fate: "avoid" },
      { id: 3, lane: 3, y: 24, kind: "gold", talent: pick(20), born: 0, life: 1, fateAt: 0, fate: "hit" },
      { id: 4, lane: 4, y: 70, kind: "up", talent: pick(33), born: 0, life: 1, fateAt: 0, fate: "hit" },
    ],
    pops: [{ id: 5, lane: 1, y: 45, text: "+150 ×1.5", tone: "up", born: 0 }],
    score: 4725,
    combo: 7,
    flash: null,
  };
}

export function AttractLanes({ talents }: { talents: DemoTalent[] }) {
  const root = useRef<HTMLDivElement | null>(null);
  const [demo, setDemo] = useState<Demo>(() => stillFrame(talents));
  const sim = useRef<Demo>(demo);
  const [running, setRunning] = useState(false);
  const talentsRef = useRef(talents);

  useEffect(() => {
    talentsRef.current = talents;
  }, [talents]);

  // Run only while visible and not in calm mode.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let onScreen = false;
    const update = () => setRunning(onScreen && document.visibilityState === "visible" && !isCalm());
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      update();
    });
    observer.observe(el);
    document.addEventListener("visibilitychange", update);
    const calmWatch = new MutationObserver(update);
    calmWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-calm"] });
    return () => {
      observer.disconnect();
      calmWatch.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    let nextId = 100;
    let nextSpawn = performance.now() + 300;
    const timer = window.setInterval(() => {
      const now = performance.now();
      {
        let { tiles, pops, score, combo, flash } = sim.current;
        tiles = tiles.filter((tile) => tile.born > 0); // drop the still frame's tiles
        pops = pops.filter((pop) => pop.born > 0 && now - pop.born < 750);

        // Resolve tiles whose moment has come.
        const keep: Tile[] = [];
        for (const tile of tiles) {
          if (now < tile.fateAt) {
            keep.push(tile);
            continue;
          }
          if (tile.fate === "hit") {
            const mult = multFor(combo);
            const base = tile.kind === "gold" ? 500 : 100;
            combo += 1;
            score += Math.round(base * mult);
            pops = [...pops, { id: nextId++, lane: tile.lane, y: tile.y, text: `+${Math.round(base * mult)}${mult > 1 ? ` ×${mult}` : ""}`, tone: tile.kind === "gold" ? "big" : "up", born: now }];
            flash = { lane: tile.lane, tone: tile.kind, id: nextId++ };
          } else if (tile.fate === "blunder") {
            combo = 0;
            score = Math.max(0, score - 150);
            pops = [...pops, { id: nextId++, lane: tile.lane, y: tile.y, text: "−150", tone: "down", born: now }];
            flash = { lane: tile.lane, tone: "down", id: nextId++ };
          } else if (tile.fate === "escape") {
            combo = 0;
            pops = [...pops, { id: nextId++, lane: tile.lane, y: tile.y, text: "got away", tone: "miss", born: now }];
          }
          // "avoid": a red left alone just expires.
        }
        tiles = keep;

        // Spawn.
        if (now >= nextSpawn) {
          const pool = talentsRef.current;
          const free = Array.from({ length: LANES }, (_, lane) => lane).filter((lane) => !tiles.some((tile) => tile.lane === lane));
          if (free.length) {
            const lane = free[Math.floor(Math.random() * free.length)];
            const roll = Math.random();
            const kind: Kind = roll < 0.05 ? "gold" : roll < 0.32 ? "down" : "up";
            const life = 1150 + Math.random() * 450;
            let fate: Tile["fate"];
            let fateAt: number;
            if (kind === "down") {
              fate = Math.random() < 0.08 ? "blunder" : "avoid";
              fateAt = now + (fate === "blunder" ? life * 0.5 : life);
            } else {
              fate = Math.random() < 0.9 ? "hit" : "escape";
              fateAt = now + (fate === "hit" ? life * (0.3 + Math.random() * 0.4) : life);
            }
            tiles = [
              ...tiles,
              {
                id: nextId++,
                lane,
                y: 18 + Math.random() * 58,
                kind,
                talent: pool.length ? pool[Math.floor(Math.random() * pool.length)] : null,
                born: now,
                life,
                fateAt,
                fate,
              },
            ];
          }
          nextSpawn = now + 330 + Math.random() * 300;
        }

        // Start over now and then, so the score doesn't run away.
        if (score > 60_000) {
          score = 0;
          combo = 0;
        }
        sim.current = { tiles, pops, score, combo, flash };
        setDemo(sim.current);
      }
    }, 90);
    return () => window.clearInterval(timer);
  }, [running]);

  const mult = multFor(demo.combo);

  return (
    <div ref={root} className={styles.cabinet} aria-hidden="true">
      <div className={styles.hud}>
        <span className={styles.demo}>Demo</span>
        <span className={styles.score}>{demo.score.toLocaleString("en-US")}</span>
        <span className={styles.mult} data-hot={mult > 1 || undefined}>
          ×{mult}
        </span>
      </div>
      <div className={styles.lanes}>
        {Array.from({ length: LANES }, (_, lane) => (
          <div key={lane} className={styles.lane}>
            {demo.flash && demo.flash.lane === lane ? <span key={demo.flash.id} className={styles.flash} data-tone={demo.flash.tone} /> : null}
            {demo.tiles
              .filter((tile) => tile.lane === lane)
              .map((tile) => (
                <span
                  key={tile.id}
                  className={styles.tile}
                  data-kind={tile.kind}
                  style={{ top: `${tile.y}%`, "--life": `${Math.round(tile.life)}ms`, "--tal": talentAccent(tile.talent?.color) } as CSSProperties}
                >
                  <span className={styles.glyph}>{GLYPH[tile.kind]}</span>
                  <Oshimark icon={tile.talent?.icon} symbol={tile.talent?.symbol} size={18} />
                  <span className={styles.sym}>{tile.talent?.symbol ?? "???"}</span>
                  <i className={styles.life} />
                </span>
              ))}
            {demo.pops
              .filter((pop) => pop.lane === lane)
              .map((pop) => (
                <span key={pop.id} className={styles.pop} data-tone={pop.tone} style={{ top: `${pop.y}%` }}>
                  {pop.text}
                </span>
              ))}
          </div>
        ))}
      </div>
      <div className={styles.combo}>
        {demo.combo >= 3 ? (
          <>
            <b>{demo.combo}</b> combo
          </>
        ) : (
          "insert $100"
        )}
      </div>
    </div>
  );
}
