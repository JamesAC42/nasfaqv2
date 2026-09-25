import type { Metadata } from "next";
import { HowToPlayPage } from "@/app/components/how-to-play/how-to-play-page";

export const metadata: Metadata = {
  title: "How to play",
  description: "New to NASFAQ? Talents are stocks, prices tick four times a day, and there's an arcade and a predictions floor. Everything you need in one page.",
};

export default function Page() {
  return <HowToPlayPage />;
}
