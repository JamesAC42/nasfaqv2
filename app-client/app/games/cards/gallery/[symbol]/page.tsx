import type { Metadata } from "next";
import { GalleryTalent } from "@/app/components/games/gallery/gallery-talent";

type Params = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${decodeURIComponent(symbol).toUpperCase()} · Card gallery` };
}

export default async function Page({ params }: Params) {
  const { symbol } = await params;
  return <GalleryTalent symbol={decodeURIComponent(symbol).toUpperCase()} />;
}
