import type { Metadata } from "next";
import { DeskPage } from "@/app/components/games/exchange/desk-page";

export const metadata: Metadata = { title: "My desk · Card Exchange" };

export default function Page() {
  return <DeskPage />;
}
