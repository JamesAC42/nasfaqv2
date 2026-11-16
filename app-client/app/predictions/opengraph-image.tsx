import { collageCard, OG, OG_SIZE } from "@/app/lib/og";

export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "NASFAQ predictions";

/** The predictions share card: talents plus a pool's options, sized by what's on them. */
export default function Image() {
  return collageCard({
    plateSlot: "predictions-og",
    kicker: "PREDICTIONS",
    title: "Winners split the pot",
    line: "Bet on hololive and the market. No rake, no house: players pay players.",
    art: "keyart",
    count: 3,
    extra: (
      <div style={{ display: "flex", width: 480, height: 56, borderRadius: 8, overflow: "hidden", fontSize: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "50%", background: OG.blue, color: "#04121c" }}>2.00×</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30%", background: OG.down, color: "#1c0409" }}>3.33×</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "20%", background: OG.up, color: "#04140c" }}>5×</div>
      </div>
    ),
  });
}
