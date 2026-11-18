"use client";

import { Tile, TileBack, TileRow, rowFromExample } from "@/app/components/games/mahjong/tile";
import { YAKU_LIST } from "@/app/lib/games/mahjong/yaku";
import { RED_FIVE_IDS, tilesFrom } from "@/app/lib/games/mahjong/tiles";
import { useTileLabels } from "@/app/lib/games/mahjong/tile-settings";
import styles from "@/app/components/games/mahjong/dev-tile-board.module.scss";

const SIZES = [22, 32, 48, 80];
const KINDS = Array.from({ length: 34 }, (_, kind) => kind);
const TINTS = ["#1f6f5c", "#e0457b", "#3fb8f5", "#f5b83f", "#8a94a6", "#7a4fd1"];

function Panel({ theme }: { theme: "dark" | "light" }) {
  return (
    <section className={styles.panel} data-theme={theme}>
      <h2>{theme === "dark" ? "Dark theme" : "Light theme"}</h2>
      {SIZES.map((size) => (
        <div key={size} className={styles.block}>
          <h3>{size}px wide</h3>
          {[false, true].map((labels) => (
            <div key={String(labels)} className={styles.run}>
              <small>{labels ? "labels" : "no labels"}</small>
              <div className={styles.tiles}>
                {KINDS.map((kind) => (
                  <Tile key={kind} kind={kind} size={size} labels={labels} />
                ))}
                {RED_FIVE_IDS.map((id) => (
                  <Tile key={id} id={id} size={size} labels={labels} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className={styles.block}>
        <h3>Backs, rotated, states</h3>
        <div className={styles.tiles}>
          {TINTS.map((tint) => (
            <TileBack key={tint} tint={tint} size={48} />
          ))}
          <TileBack size={22} />
          <Tile kind={4} size={48} rotated />
          <Tile kind={13} size={48} dim />
          <Tile kind={31} size={48} highlight />
          <Tile kind={33} size={48} onClick={() => undefined} selected />
        </div>
      </div>

      <div className={styles.block}>
        <h3>Sample hand</h3>
        <TileRow notation="123m406p789s1122z" size={36} gapAfter={[2, 5, 8]} win={tilesFrom("2z")[0]} />
        <TileRow tiles={tilesFrom("2z")} size={36} melds={[{ tiles: tilesFrom("777z"), type: "pon", called: 1 }, { tiles: tilesFrom("1111m"), type: "ankan" }, { tiles: tilesFrom("7777p"), type: "kakan", called: 2 }]} />
      </div>

      <div className={styles.block}>
        <h3>Yaku examples</h3>
        <div className={styles.examples}>
          {YAKU_LIST.slice(0, 6).map((info) => (
            <div key={info.key}>
              <small>{info.name}</small>
              <TileRow {...rowFromExample(info.example)} size={26} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DevTileBoard() {
  const [labels, setLabels] = useTileLabels();
  return (
    <div className={styles.board}>
      <header>
        <h1>Mahjong tiles</h1>
        <label>
          <input type="checkbox" checked={labels} onChange={(event) => setLabels(event.target.checked)} /> default labels (the player’s setting)
        </label>
      </header>
      <Panel theme="dark" />
      <Panel theme="light" />
    </div>
  );
}
