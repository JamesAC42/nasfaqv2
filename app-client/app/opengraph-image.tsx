import { collageCard, OG_SIZE } from "@/app/lib/og";

export const runtime = "nodejs";
export const revalidate = 3600;
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "NASFAQ: the hololive stock market";

/** The default share card: the busiest talents' key art beside the pitch. */
export default function Image() {
  return collageCard({
    plateSlot: "site-og-default",
    kicker: "HOLOLIVE STOCK MARKET",
    title: "Every talent is a stock",
    line: "$10,000 of play money. Buy your oshi, ride the ticks, climb the board.",
    art: "keyart",
    count: 3,
  });
}
