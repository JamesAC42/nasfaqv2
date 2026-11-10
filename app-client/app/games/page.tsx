import type { Metadata } from "next";
import { ArcadePage } from "@/app/components/games/arcade/arcade-page";

export const metadata: Metadata = {
  title: "Arcade",
  description: "Card gacha, oshi duels, blackjack, high-low and the capsule machine. Every game spends Credit, never your cash.",
};

export default function Page() {
  return <ArcadePage />;
}
