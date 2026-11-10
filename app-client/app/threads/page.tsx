import type { Metadata } from "next";
import { ThreadWatch } from "@/app/components/threads/thread-watch";

export const metadata: Metadata = { title: "Threads" };

export default function Page() {
  return <ThreadWatch />;
}
