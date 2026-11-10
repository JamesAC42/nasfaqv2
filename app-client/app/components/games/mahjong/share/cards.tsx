// Share cards for mahjong (1200x630 PNG): a winning hand, a game's result, a tournament's podium.
// Server only. Drawn on the same kit as the other share images (lib/og.tsx), with the tiles from
// tile-art.ts as inline SVG pictures (satori reads data URIs; it has no CSS variables, so the tile
// outline is passed as a literal).

import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Backdrop, Wordmark, alpha, cardText, loadAssets, loadFonts } from "@/app/lib/og";
import { tileIdSvg } from "@/app/components/games/mahjong/tile-art";
import { talentAccent } from "@/app/lib/talent-color";
import { yakuName, scoreText } from "@/app/lib/games/mahjong/yaku";
import { windName } from "@/app/lib/games/mahjong/tiles";
import type { GamePlayer, GameRecord, Meld, RecordedHand, TileId, TournamentResponse, WinEntry } from "@/app/lib/games/mahjong/types";

const GOLD = "#f5c542";
const EDGE = "#2a3040";

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

function TileImg({ id, width, rotated = false }: { id: TileId; width: number; rotated?: boolean }) {
  const height = Math.round((width * 4) / 3);
  const w = rotated ? height : width;
  const h = rotated ? width : height;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={svgUri(tileIdSvg(id, { edge: EDGE, rotated }))} width={w} height={h} alt="" />;
}

/** Concealed tiles, the winning tile, then the called sets, scaled to fit `room` px. */
function HandRow({ hand, melds, tile, room }: { hand: TileId[]; melds: Meld[]; tile: TileId; room: number }) {
  // Widths in tile units: a sideways tile is 4/3, the gaps between groups about half a tile.
  const meldUnits = melds.reduce((sum, meld) => sum + (meld.tiles.length - (meld.called !== null ? 1 : 0)) + (meld.called !== null ? 4 / 3 : 0), 0);
  const units = hand.length + 1 + meldUnits + 0.5 * (1 + melds.length);
  const width = Math.max(30, Math.min(78, Math.floor(room / units)));
  const gap = Math.round(width * 0.5);
  return (
    <div style={{ display: "flex", alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 2 }}>
        {hand.map((id, index) => (
          <TileImg key={index} id={id} width={width} />
        ))}
      </div>
      <div style={{ display: "flex", marginLeft: gap }}>
        <TileImg id={tile} width={width} />
      </div>
      {melds.map((meld, index) => {
        const sideways = meld.called !== null && meld.type !== "ankan" ? meld.tiles.indexOf(meld.called) : -1;
        return (
          <div key={index} style={{ display: "flex", alignItems: "flex-end", gap: 2, marginLeft: gap }}>
            {meld.tiles.map((id, at) => (
              <TileImg key={at} id={id} width={width} rotated={at === sideways} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

const names = (players: GamePlayer[], seat: number) => cardText(players.find((player) => player.seat === seat)?.username, 22) || `Seat ${seat + 1}`;

async function talentColorFor(player: GamePlayer | undefined) {
  const assets = await loadAssets();
  const color = assets.find((asset) => asset.symbol.toUpperCase() === (player?.talent ?? "").toUpperCase())?.color ?? player?.profile_color;
  return talentAccent(color, "dark");
}

/** "Haneman", "YAKUMAN", "DOUBLE YAKUMAN" or "3 han 30 fu". */
const bigScore = (win: WinEntry) => (win.yakuman > 0 ? scoreText(win).toUpperCase() : scoreText(win));

export async function handCard(record: GameRecord, hand: RecordedHand, winIndex = 0) {
  const result = hand.result;
  const win = result.type === "win" ? (result.wins[winIndex] ?? result.wins[0]) : null;
  if (!win) return null;
  const player = record.players.find((entry) => entry.seat === win.seat);
  const [fonts, accent] = await Promise.all([loadFonts(), talentColorFor(player)]);
  const yakuman = win.yakuman > 0;
  const color = yakuman ? GOLD : accent;
  const yaku = win.yaku.map((line) => `${yakuName(line.key)}${line.han < 13 ? ` ${line.han}` : ""}`);
  const bonus = win.dora.dora + win.dora.ura + win.dora.red;
  if (bonus > 0) yaku.push(`Dora ${bonus}`);
  const winnerName = names(record.players, win.seat);
  const source = win.tsumo ? "self-draw" : `on ${names(record.players, win.from ?? 0)}'s discard`;

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "44px 60px 40px" }}>
        <Backdrop glow={color} glowAt={yakuman ? "50% 0%" : "85% 20%"} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark size={34} />
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: yakuman ? GOLD : OG.blue }}>{`MAHJONG  ${windName(27 + hand.wind).toUpperCase()} ${hand.number + 1}`}</div>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "baseline", gap: 18, marginTop: 34 }}>
          <div style={{ display: "flex", width: 18, height: 18, borderRadius: 9, background: accent }} />
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 44, color: accent }}>{winnerName}</div>
          <div style={{ display: "flex", fontSize: 24, color: OG.dim }}>{`wins ${source}`}</div>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "baseline", gap: 30, marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Chicago",
              fontSize: yakuman ? 124 : 92,
              lineHeight: 1,
              whiteSpace: "nowrap",
              color: yakuman ? GOLD : OG.ink,
              textShadow: yakuman ? "0 0 36px rgba(245,197,66,0.55)" : "none",
            }}
          >
            {bigScore(win)}
          </div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 44, color: OG.up }}>{`+${win.gain.toLocaleString("en-US")}`}</div>
        </div>
        <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: "6px 26px", marginTop: 16, fontSize: 28, color: OG.ink }}>
          {yaku.slice(0, 6).map((line, index) => (
            <div key={index} style={{ display: "flex" }}>
              {line}
            </div>
          ))}
          {!yakuman ? <div style={{ display: "flex", color: OG.dim }}>{`${win.han} han ${win.fu} fu`}</div> : null}
        </div>
        <div style={{ position: "relative", display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between" }}>
          <HandRow hand={win.hand} melds={win.melds} tile={win.tile} room={1080} />
        </div>
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", marginTop: 18, fontSize: 17, color: "rgba(233,237,245,0.7)" }}>
          <div style={{ display: "flex" }}>Play money. Fan-made, not affiliated with COVER Corp.</div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 26, color: "#8ad6ff" }}>holo.nasfaq.biz</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}

export async function gameCard(record: GameRecord) {
  const fonts = await loadFonts();
  const lines = record.result?.standings ?? [];
  const rows = [...lines].sort((a, b) => a.place - b.place);
  const top = record.players.find((player) => player.seat === rows[0]?.seat);
  const accent = await talentColorFor(top);
  const gameName = record.game.tournament_name ? cardText(record.game.tournament_name, 34) : record.game.kind === "stakes" ? "Stakes table" : record.game.kind === "ranked" ? "Quick match" : record.game.kind === "friend" ? "Friend room" : "Mahjong game";
  const hands = record.hands.length;
  const ordinal = ["", "1st", "2nd", "3rd", "4th"];
  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "44px 60px 36px" }}>
        <Backdrop glow={accent} glowAt="85% 20%" />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark size={34} />
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: OG.blue }}>{`MAHJONG  ${record.game.length === "south" ? "EAST-SOUTH" : "EAST-ONLY"}`}</div>
        </div>
        <div style={{ position: "relative", display: "flex", fontFamily: "Chicago", fontSize: 54, marginTop: 30 }}>{gameName}</div>
        <div style={{ position: "relative", display: "flex", fontSize: 22, color: OG.dim, marginTop: 6 }}>{`${hands} hands played`}</div>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", marginTop: 26, borderTop: `1px solid ${OG.rule}` }}>
          {rows.map((row) => {
            const player = record.players.find((entry) => entry.seat === row.seat);
            const color = talentAccent(player?.profile_color, "dark");
            return (
              <div key={row.seat} style={{ display: "flex", alignItems: "center", height: 62, borderBottom: `1px solid ${OG.rule}`, gap: 24 }}>
                <div style={{ display: "flex", width: 70, fontFamily: "Chicago", fontSize: 34, color: row.place === 1 ? GOLD : OG.dim }}>{ordinal[row.place] ?? row.place}</div>
                <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: color }} />
                <div style={{ display: "flex", flex: 1, fontFamily: "Chicago", fontSize: 34, color }}>{names(record.players, row.seat)}</div>
                <div style={{ display: "flex", fontSize: 32, width: 190, justifyContent: "flex-end" }}>{row.points.toLocaleString("en-US")}</div>
                <div style={{ display: "flex", fontSize: 28, width: 140, justifyContent: "flex-end", color: row.score >= 0 ? OG.up : OG.down }}>{`${row.score >= 0 ? "+" : "-"}${Math.abs(row.score).toFixed(1)}`}</div>
              </div>
            );
          })}
        </div>
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 17, color: "rgba(233,237,245,0.7)" }}>
          <div style={{ display: "flex" }}>Play money. Fan-made, not affiliated with COVER Corp.</div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 26, color: "#8ad6ff" }}>holo.nasfaq.biz</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}

export async function tournamentCard(payload: TournamentResponse) {
  const fonts = await loadFonts();
  const { tournament, entrants } = payload;
  const places = tournament.result?.places ?? [];
  const champion = tournament.result?.champion ?? places.find((place) => place.place === 1) ?? null;
  const podium = (places.length ? places : []).filter((place) => place.place <= 3).sort((a, b) => a.place - b.place);
  const done = tournament.status === "completed" && champion;
  const colorOf = (userId: number | null) => talentAccent(entrants.find((entrant) => entrant.user_id === userId)?.profile_color, "dark");
  const accent = champion ? colorOf(champion.user_id) : OG.blue;
  const ordinal = ["", "1st", "2nd", "3rd"];
  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OG.bg, color: OG.ink, padding: "44px 60px 36px" }}>
        <Backdrop glow={done ? GOLD : accent} glowAt="85% 25%" />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark size={34} />
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: OG.blue }}>MAHJONG TOURNAMENT</div>
        </div>
        <div style={{ position: "relative", display: "flex", fontFamily: "Chicago", fontSize: cardText(tournament.name, 40).length > 24 ? 50 : 62, marginTop: 34, lineHeight: 1.05 }}>{cardText(tournament.name, 40)}</div>
        {done && champion ? (
          <>
            <div style={{ position: "relative", display: "flex", fontSize: 24, letterSpacing: 4, color: GOLD, marginTop: 24 }}>CHAMPION</div>
            <div style={{ position: "relative", display: "flex", fontFamily: "Chicago", fontSize: 88, lineHeight: 1.05, color: accent, textShadow: `0 0 34px ${alpha(accent, 0.45)}` }}>{cardText(champion.name, 22)}</div>
            <div style={{ position: "relative", display: "flex", gap: 40, marginTop: 26 }}>
              {podium
                .filter((place) => place.place > 1)
                .map((place) => (
                  <div key={place.place} style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                    <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 30, color: OG.dim }}>{ordinal[place.place]}</div>
                    <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 36, color: colorOf(place.user_id) }}>{cardText(place.name, 20)}</div>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <div style={{ position: "relative", display: "flex", fontSize: 30, color: OG.dim, marginTop: 28 }}>{`${tournament.seats} seats, knockout, ${tournament.entry_fee > 0 && tournament.paid ? "entry fee" : "free"}`}</div>
        )}
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 17, color: "rgba(233,237,245,0.7)" }}>
          <div style={{ display: "flex" }}>Play money. Fan-made, not affiliated with COVER Corp.</div>
          <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 26, color: "#8ad6ff" }}>holo.nasfaq.biz</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}

