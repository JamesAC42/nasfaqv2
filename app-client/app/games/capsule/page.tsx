import type { Metadata } from "next";
import { CapsuleGachaPage } from "@/app/components/games/gacha/capsule-gacha-page";

export const metadata: Metadata = { title: "Capsule machine" };

export default function Page() {
  return <CapsuleGachaPage />;
}
