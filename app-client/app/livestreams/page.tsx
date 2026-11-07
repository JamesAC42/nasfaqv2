import type { Metadata } from "next";
import { LivestreamsPage } from "@/app/components/livestreams/livestreams-page";

export const metadata: Metadata = { title: "Livestreams" };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <LivestreamsPage initialView={view} />;
}
