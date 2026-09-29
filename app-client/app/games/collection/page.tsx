import type { Metadata } from "next";
import { CollectionPage } from "@/app/components/games/collection/collection-page";

export const metadata: Metadata = { title: "Card collection" };

export default function Page() {
  return <CollectionPage />;
}
