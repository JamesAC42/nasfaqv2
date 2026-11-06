import type { Metadata } from "next";
import { StreamCalendarPage } from "@/app/components/livestreams/stream-calendar";

export const metadata: Metadata = { title: "Stream calendar", description: "Every listed talent's streams for the week ahead, in your time zone." };

export default function Page() {
  return <StreamCalendarPage />;
}
