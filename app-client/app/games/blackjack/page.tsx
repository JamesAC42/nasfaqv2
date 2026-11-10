import type { Metadata } from "next";
import { BlackjackLobbyPage } from "@/app/components/games/blackjack/blackjack-lobby";

export const metadata: Metadata = { title: "Blackjack" };

export default function Page() {
  return <BlackjackLobbyPage />;
}
