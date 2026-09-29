import { collageCard, OG, OG_SIZE } from "@/app/lib/og";

export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "NASFAQ predictions";

/** The predictions share card: talents plus a YES/NO price bar (the price is the chance). */
export default function Image() {
  return collageCard({
    plateSlot: "predictions-og",
    kicker: "PREDICTIONS",
    title: "Prices are chances",
    line: "Bet on hololive and the market. The price is the chance.",
    art: "keyart",
    count: 3,
    extra: (
      <div style={{ display: "flex", width: 480, height: 56, borderRadius: 8, overflow: "hidden", fontSize: 26 }}>
        <div style={{ display: "flex", alignItems: "center", paddingLeft: 18, width: "62%", background: OG.blue, color: "#04121c" }}>YES 62¢</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 18, width: "38%", background: OG.down, color: "#1c0409" }}>NO 38¢</div>
      </div>
    ),
  });
}
