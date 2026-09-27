import { collageCard, OG_SIZE } from "@/app/lib/og";

export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "The NASFAQ arcade";

/** The arcade share card: a fan of UR cards. */
export default function Image() {
  return collageCard({
    plateSlot: "games-og-arcade",
    kicker: "NASFAQ ARCADE",
    title: "The Arcade",
    line: "Card gacha, oshi duels, blackjack, high-low and Ticker Tap.",
    art: "card-ur",
    count: 3,
  });
}
