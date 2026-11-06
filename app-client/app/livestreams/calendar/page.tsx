import type { Metadata } from "next";
import { StreamCalendarPage } from "@/app/components/livestreams/stream-calendar";
import { requireFeature } from "@/app/lib/features-server";

// Behind the stream-calendar flag (api/src/features): a 404 for anyone it isn't on for.

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("stream-calendar");
  return { title: "Stream calendar", description: "Every listed talent's streams for the week ahead, in your time zone." };
}

export default async function Page() {
  await requireFeature("stream-calendar");
  return <StreamCalendarPage />;
}
