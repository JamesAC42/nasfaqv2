import type { Metadata } from "next";
import { TableLobby } from "@/app/components/games/tables/table-lobby";

export const metadata: Metadata = { title: "High-low" };

export default function Page() {
  return <TableLobby game="high-low" />;
}
