// Share cards for game moments (1200×630 PNG): a talent reacting, the player's name, the result and
// holo.nasfaq.biz. Server only. Built from art that already ships (reaction set, card art) on the
// same drawing kit as the page share images (lib/og.tsx).
//
// Which talent: the player's oshi when they have one; otherwise the talent the player saw react
// (`?t=`), otherwise one picked from the moment id, so a card always draws the same way.

import { ImageResponse } from "next/og";
import { OG, OG_SIZE, Backdrop, Wordmark, alpha, artDataUri, cardText, fetchApi, loadAssets, loadFonts, loadManifest } from "@/app/lib/og";
import { lookupArt, type ArtManifest, type ChibiPose } from "@/app/lib/art-manifest";
import { talentAccent } from "@/app/lib/talent-color";
import { DEALER_FALLBACK_POSE, dealerStateForOutcome } from "@/app/lib/games/dealer-states";
import { blackjackHeadline, cardsHeadline, cleanSymbol, seededPick, signedMoney, type BlackjackMoment, type CardsMoment, type Moment, type MomentKind, type Tone } from "@/app/lib/games/moments";

const GOLD = "#f5c542";
const RAINBOW = "linear-gradient(90deg, #ff7ad9, #ffd36e, #7dffcf, #6ecbff, #b28cff)";
const FRAME: Record<string, string> = {
  UR: "linear-gradient(135deg, #ff7ad9, #ffd36e, #7dffcf, #6ecbff, #b28cff)",
  SSR: "linear-gradient(135deg, #6b4e08, #f5c542, #fff6cf, #d9a520, #6b4e08)",
  SR: "linear-gradient(135deg, #5d6b85, #dfe7f5, #8c9ab5, #f4f7ff, #5d6b85)",
  R: "linear-gradient(135deg, #1b4f8a, #3fb8f5, #9fdcff, #1b4f8a)",
  C: "linear-gradient(135deg, #2a3140, #586276, #2a3140)",
};
const RARITY_COLOR: Record<string, string> = { UR: "#ff7ad9", SSR: GOLD, SR: "#dfe7f5", R: OG.blue, C: OG.dim };

export async function fetchMoment(kind: MomentKind, id: string) {
  const body = await fetchApi<{ moment: Moment }>(`/api/games/moments/${kind}/${encodeURIComponent(id)}`, 300);
  return body?.moment && body.moment.kind === kind ? body.moment : null;
}

/** Talents with this reaction pose in the manifest, sorted. */
function withPose(manifest: ArtManifest | null, pose: ChibiPose) {
  const out: string[] = [];
  for (const id of Object.keys(manifest?.images ?? {})) {
    const match = /^([A-Z0-9_]+)\/reaction\/([a-z]+)$/.exec(id);
    if (match && match[2] === pose) out.push(match[1]);
  }
  return out.sort();
}

function pickTalent(manifest: ArtManifest | null, pose: ChibiPose, wanted: Array<string | null | undefined>, seed: string) {
  for (const symbol of wanted.map(cleanSymbol)) if (symbol && lookupArt(manifest, `${symbol}/reaction/${pose}`)) return symbol;
  return seededPick(withPose(manifest, pose), seed);
}

const toneColor = (tone: Tone) => (tone === "gold" ? GOLD : tone === "up" ? OG.up : tone === "down" ? OG.down : tone === "rainbow" ? "#ffd36e" : OG.ink);

function Headline({ text, tone, size }: { text: string; tone: Tone; size: number }) {
  const style: React.CSSProperties =
    tone === "rainbow"
      ? { backgroundImage: RAINBOW, backgroundClip: "text", color: "transparent" }
      : tone === "gold"
        ? { color: toneColor(tone), textShadow: "0 0 28px rgba(245,197,66,0.45)" }
        : { color: toneColor(tone) };
  return <div style={{ display: "flex", fontFamily: "Chicago", fontSize: size, lineHeight: 1, whiteSpace: "nowrap", ...style }}>{text}</div>;
}

/** Suit shapes as one path each (the display font has no suit glyphs; satori wants one plain child). */
const SUIT_PATH: Record<"S" | "H" | "D" | "C", string> = {
  H: "M5 9.2 L1.1 5.2 A2.25 2.25 0 0 1 5 2.3 A2.25 2.25 0 0 1 8.9 5.2 Z",
  D: "M5 0.6 L8.6 5 L5 9.4 L1.4 5 Z",
  S: "M5 0.6 L8.9 4.6 A2.2 2.2 0 0 1 5.6 7.2 L6.6 9.6 H3.4 L4.4 7.2 A2.2 2.2 0 0 1 1.1 4.6 Z",
  C: "M7 3 A2 2 0 1 1 3 3 A2 2 0 1 1 7 3 Z M4.7 5.8 A2 2 0 1 1 0.7 5.8 A2 2 0 1 1 4.7 5.8 Z M9.3 5.8 A2 2 0 1 1 5.3 5.8 A2 2 0 1 1 9.3 5.8 Z M4.5 5.5 H5.5 L6.5 9.6 H3.5 Z",
};

function Suit({ suit, size, color }: { suit: "S" | "H" | "D" | "C"; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10">
      <path d={SUIT_PATH[suit] ?? SUIT_PATH.S} fill={color} />
    </svg>
  );
}

function MiniCard({ card, width }: { card: { rank: string | number; suit: "S" | "H" | "D" | "C" }; width: number }) {
  const labels: Record<string, string> = { "1": "A", "11": "J", "12": "Q", "13": "K", "14": "A" };
  const rank = labels[String(card.rank)] ?? String(card.rank);
  const red = card.suit === "H" || card.suit === "D";
  const ink = red ? "#d8283f" : "#151a24";
  const height = Math.round(width * 1.4);
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width, height, padding: width * 0.09, borderRadius: width * 0.1, background: "#f8f9fc", boxShadow: "0 8px 18px rgba(0,0,0,0.45)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: width * 0.34 }}>
        <div style={{ display: "flex", fontFamily: "Chicago", fontSize: width * 0.3, lineHeight: 1, color: ink }}>{rank}</div>
        <Suit suit={card.suit} size={width * 0.24} color={ink} />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Suit suit={card.suit} size={width * 0.42} color={ink} />
      </div>
    </div>
  );
}

function PlayerLine({ moment, size = 34 }: { moment: Moment; size?: number }) {
  const name = cardText(moment.player.username, 22) || "player";
  const color = moment.player.profile_color || OG.ink;
  const oshi = moment.player.oshi ? cardText(moment.player.oshi.display_name, 28) : "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", width: 16, height: 16, borderRadius: 8, background: color }} />
      <div style={{ display: "flex", fontFamily: "Chicago", fontSize: size, color }}>{name}</div>
      {oshi ? <div style={{ display: "flex", fontSize: 22, color: OG.dim, marginLeft: 6 }}>{`oshi: ${oshi}`}</div> : null}
    </div>
  );
}

function Footer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
      <div style={{ display: "flex", fontSize: 17, letterSpacing: 1, color: "rgba(233,237,245,0.75)" }}>the hololive fan stock market</div>
      <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 30, lineHeight: 1.1, color: "#8ad6ff" }}>holo.nasfaq.biz</div>
    </div>
  );
}

/** The table edge along the bottom, drawn in front of the talent so she stands behind it. */
function FeltEdge({ height = 104 }: { height?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        display: "flex",
        background: "linear-gradient(180deg, #1b4c8f 0%, #133a72 35%, #0a2149 100%)",
        borderTop: "7px solid #0b1730",
        boxShadow: "0 -10px 30px rgba(0,0,0,0.45)",
      }}
    />
  );
}

/** A faint dot screen behind the talent, in the talent's color. */
function Halftone({ color, left, top, size }: { color: string; left: number; top: number; size: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        display: "flex",
        borderRadius: size / 2,
        backgroundImage: `radial-gradient(circle, ${alpha(color, 0.28)} 2px, rgba(0,0,0,0) 2.6px)`,
        backgroundSize: "16px 16px",
        opacity: 0.8,
      }}
    />
  );
}

function FanMade() {
  return (
    <div style={{ position: "absolute", right: 16, bottom: 12, display: "flex", padding: "3px 9px", borderRadius: 6, background: "rgba(10,12,17,0.62)", fontSize: 14, color: "rgba(233,237,245,0.7)" }}>
      Play money. Fan-made, not affiliated with COVER Corp.
    </div>
  );
}

async function blackjackCard(moment: BlackjackMoment, talentHint: string | null) {
  const [manifest, assets, fonts] = await Promise.all([loadManifest(), loadAssets(), loadFonts()]);
  const { head, tone, pose } = blackjackHeadline(moment);
  // The table's dealer that day reacts to the hand: their dealer art, or their reaction set until it
  // exists. Without a dealer (older hands, API trouble): the oshi, the talent the player saw, or a pick.
  const host = moment.dealer.talent?.symbol ? moment.dealer.talent : null;
  const state = dealerStateForOutcome(moment.outcome, moment.dealer.value);
  let symbol: string | null = null;
  let reaction: string | null = null;
  if (host) {
    reaction = (await artDataUri(manifest, `${host.symbol}/dealer/${state}`, 768)) ?? (await artDataUri(manifest, `${host.symbol}/reaction/${DEALER_FALLBACK_POSE[state]}`, 768));
    if (reaction) symbol = host.symbol;
  }
  if (!reaction) {
    symbol = pickTalent(manifest, pose, [moment.player.oshi?.symbol, talentHint], `blackjack:${moment.id}`);
    reaction = symbol ? await artDataUri(manifest, `${symbol}/reaction/${pose}`, 768) : null;
  }
  const color =
    symbol === host?.symbol ? host?.color : symbol === moment.player.oshi?.symbol ? moment.player.oshi?.color : assets.find((asset) => asset.symbol.toUpperCase() === symbol)?.color;
  const accent = symbol ? talentAccent(color, "dark") : OG.blue;
  const money = moment.net === 0 ? "Bet back" : signedMoney(moment.net);
  const dealerName = host && symbol === host.symbol ? cardText(host.name ?? host.symbol, 22) : "Dealer";
  const dealer = moment.dealer.value === null ? null : moment.dealer.value > 21 ? `${dealerName} busts (${moment.dealer.value})` : `vs ${dealerName}: ${moment.dealer.value}`;
  const tableName = cardText(moment.table.name, 20).toUpperCase();

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop glow={accent} glowAt="80% 52%" />
        <Halftone color={accent} left={690} top={30} size={520} />
        {reaction ? (
          // The waist cut sits on the bottom edge, behind the table.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reaction} width={590} height={590} alt="" style={{ position: "absolute", right: 0, bottom: 0, objectFit: "contain" }} />
        ) : null}
        <div style={{ position: "absolute", left: 590, top: 0, width: 170, height: 630, display: "flex", background: `linear-gradient(90deg, ${OG.bg} 10%, rgba(10,12,17,0))` }} />
        <FeltEdge />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "46px 60px 22px", width: 720, height: "100%" }}>
          <Wordmark size={34} />
          <div style={{ display: "flex", marginTop: 34, fontSize: 24, letterSpacing: 4, color: OG.blue }}>{`BLACKJACK · ${tableName}`}</div>
          <div style={{ display: "flex", marginTop: 12 }}>
            <Headline text={head} tone={tone} size={head.length > 12 ? 64 : head.length > 8 ? 92 : 104} />
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 14 }}>
            <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 56, color: moment.net > 0 ? OG.up : moment.net < 0 ? OG.down : OG.ink }}>{money}</div>
            <div style={{ display: "flex", fontSize: 24, color: OG.dim }}>{`on a $${moment.wager.toLocaleString("en-US")} ${moment.doubled ? "doubled bet" : "bet"}`}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22 }}>
            {moment.hand.slice(0, 6).map((card, index) => (
              <MiniCard key={index} card={card} width={moment.hand.length > 4 ? 52 : 64} />
            ))}
            {dealer ? <div style={{ display: "flex", marginLeft: 16, padding: "8px 16px", borderRadius: 999, border: `2px solid ${OG.rule}`, fontSize: 22, color: OG.dim }}>{dealer}</div> : null}
          </div>
          <div style={{ display: "flex", marginTop: 26 }}>
            <PlayerLine moment={moment} />
          </div>
          <Footer />
        </div>
        <FanMade />
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}

async function cardsCard(moment: CardsMoment, talentHint: string | null) {
  const [manifest, fonts] = await Promise.all([loadManifest(), loadFonts()]);
  const { best } = moment;
  const { head, tone } = cardsHeadline(best);
  const top = best.rarity === "UR" || best.rarity === "SSR";
  const pose: ChibiPose = top ? "hype" : best.rarity === "SR" ? "smug" : "idle";
  // The pulled talent reacts to being pulled; the hint only matters if they have no reaction art.
  const symbol = pickTalent(manifest, pose, [best.symbol, talentHint], `cards:${moment.id}`);
  const slot = `card-${best.rarity.toLowerCase()}`;
  const [cardArt, keyart, reaction] = await Promise.all([
    artDataUri(manifest, `${best.symbol}/${slot}/default`, 600),
    artDataUri(manifest, `${best.symbol}/keyart/default`, 600),
    symbol ? artDataUri(manifest, `${symbol}/reaction/${pose}`, 512) : null,
  ]);
  const art = cardArt ?? keyart;
  const accent = talentAccent(best.color, "dark");
  const tally = ["UR", "SSR", "SR", "R", "C"].map((rarity) => ({ rarity, n: moment.cards.filter((card) => card.rarity === rarity).length })).filter((entry) => entry.n);
  const name = cardText(best.name, 26);

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: OG.bg, color: OG.ink }}>
        <Backdrop glow={accent} glowAt="74% 48%" />
        <Halftone color={accent} left={640} top={20} size={590} />
        {art ? (
          <div style={{ position: "absolute", left: 790, top: 54, display: "flex", padding: 8, borderRadius: 20, backgroundImage: FRAME[best.rarity] ?? FRAME.C, transform: "rotate(5deg)", boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 60px ${alpha(accent, 0.5)}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={art} width={300} height={420} alt="" style={{ borderRadius: 13, objectFit: "cover", objectPosition: "50% 18%" }} />
          </div>
        ) : null}
        {reaction ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reaction} width={290} height={290} alt="" style={{ position: "absolute", left: 610, bottom: 0, objectFit: "contain" }} />
        ) : null}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "46px 60px 22px", width: 640, height: "100%" }}>
          <Wordmark size={34} />
          <div style={{ display: "flex", marginTop: 30, fontSize: 24, letterSpacing: 4, color: OG.blue }}>{`CARD GACHA · ${moment.count === 1 ? "SINGLE PULL" : `${moment.count}-PULL`}`}</div>
          <div style={{ display: "flex", marginTop: 10 }}>
            <Headline text={head} tone={tone} size={head.length > 9 ? 80 : 92} />
          </div>
          <div style={{ display: "flex", marginTop: 16, fontFamily: "Chicago", fontSize: name.length > 18 ? 34 : 44, lineHeight: 1.05, color: OG.ink }}>{name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <div style={{ display: "flex", padding: "4px 12px", borderRadius: 999, border: `2px solid ${alpha(RARITY_COLOR[best.rarity] ?? "#8a93a6", 0.7)}`, color: RARITY_COLOR[best.rarity] ?? OG.dim, fontSize: 20 }}>{`${best.rarity} · ${best.rarity_name}`}</div>
            {best.was_new ? <div style={{ display: "flex", padding: "4px 12px", borderRadius: 999, background: OG.up, color: OG.bg, fontSize: 20 }}>NEW</div> : null}
            {best.was_featured ? <div style={{ display: "flex", padding: "4px 12px", borderRadius: 999, background: GOLD, color: OG.bg, fontSize: 20 }}>RATE-UP</div> : null}
            {best.stars > 1 ? <div style={{ display: "flex", padding: "4px 12px", borderRadius: 999, border: `2px solid ${OG.rule}`, color: OG.dim, fontSize: 20 }}>{`${best.stars} stars`}</div> : null}
          </div>
          {moment.count > 1 ? (
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              {tally.map((entry) => (
                <div key={entry.rarity} style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "6px 14px", borderRadius: 10, border: `2px solid ${alpha(entry.rarity === "UR" ? "#ff7ad9" : entry.rarity === "SSR" ? GOLD : entry.rarity === "SR" ? "#dfe7f5" : entry.rarity === "R" ? OG.blue : "#8a93a6", 0.6)}` }}>
                  <div style={{ display: "flex", fontFamily: "Chicago", fontSize: 24, color: RARITY_COLOR[entry.rarity] }}>{entry.rarity}</div>
                  <div style={{ display: "flex", fontSize: 22, color: OG.dim }}>{`x${entry.n}`}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", marginTop: 22 }}>
            <PlayerLine moment={moment} />
          </div>
          <Footer />
        </div>
        <FanMade />
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}

/** The share card for a moment, or null when there's no such moment. */
export async function momentImage(kind: MomentKind, id: string, talentHint: string | null) {
  const moment = await fetchMoment(kind, id);
  if (!moment) return null;
  return moment.kind === "blackjack" ? blackjackCard(moment, talentHint) : cardsCard(moment, talentHint);
}
