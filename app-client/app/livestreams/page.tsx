import type { Metadata } from "next";
import { LivestreamsPage } from "@/app/components/livestreams/livestreams-page";

export const metadata: Metadata = { title: "Livestreams" };

export default function Page() {
  return <LivestreamsPage />;
}
