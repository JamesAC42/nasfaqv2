import type { Metadata } from "next";
import { CardGachaPage } from "@/app/components/games/gacha/card-gacha-page";

export const metadata: Metadata = { title: "Card gacha" };

export default function Page() {
  return <CardGachaPage />;
}
