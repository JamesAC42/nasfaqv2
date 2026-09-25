import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArtBoard } from "@/app/components/dev/art-board";

export const metadata: Metadata = { title: "Art slots", robots: { index: false } };

// Local development only: every image the site is waiting on, with its spec and a live placeholder.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ArtBoard />;
}
