import type { Metadata } from "next";
import { WirePage } from "@/app/components/wire/wire-page";

export const metadata: Metadata = { title: "The Wire", description: "Streams, records, market moves and what /vt/ is talking about, as it happens." };

export default function Page() {
  return <WirePage />;
}
