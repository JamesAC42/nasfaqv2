import type { Metadata } from "next";
import { GalleryIndex } from "@/app/components/games/gallery/gallery-index";

export const metadata: Metadata = { title: "Card gallery" };

export default function Page() {
  return <GalleryIndex />;
}
