import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DrawnBoard } from "@/app/components/dev/drawn-board";

export const metadata: Metadata = { title: "Drawn pieces", robots: { index: false } };

// Local development only: every drawn (SVG/CSS) piece side by side, to check them without playing.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DrawnBoard />;
}
