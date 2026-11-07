import type { Metadata } from "next";
import { LivestreamsPage } from "@/app/components/livestreams/livestreams-page";
import { serverFeatures } from "@/app/lib/features-server";

export const metadata: Metadata = { title: "Livestreams" };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  // A link straight to the calendar mode (behind the stream-calendar flag): asking the API here lets a
  // viewer who has the flag open on it. Everyone else gets the page as usual.
  const calendarConfirmed = view === "calendar" && (await serverFeatures())["stream-calendar"] === true;
  return <LivestreamsPage calendarConfirmed={calendarConfirmed} />;
}
