import type { Metadata } from "next";
import { TableLobby } from "@/app/components/games/tables/table-lobby";

export const metadata: Metadata = { title: "Oshi Card Duel" };

export default function Page() {
  return <TableLobby game="oshi-duel" />;
}
