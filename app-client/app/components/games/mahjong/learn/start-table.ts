"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiErrorCode, type ApiError } from "@/app/lib/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { createGuestTable, createMahjongTable } from "@/app/lib/games/mahjong/api";
import type { SeatedResponse } from "@/app/lib/games/mahjong/types";
import { primeChannel } from "@/app/lib/games/use-games-socket";
import { useAuth } from "@/app/providers/auth-provider";

/**
 * Starts the guided hands and a practice game against bots, then goes to the table. Signed out, the
 * same buttons make a guest table (the seat token is saved by createGuestTable).
 */
export function useStartTable() {
  const { user, initialized } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, make: () => Promise<SeatedResponse>) => {
    setBusy(key);
    setError(null);
    try {
      const response = await make();
      primeChannel(response.seat.channel, { type: "mahjong", table: response.table, server_time: response.table.server_time });
      router.push(`/games/mahjong/table/${response.table.id}`);
    } catch (caught) {
      // Already at a table: just go there.
      const tableId = (caught as Partial<ApiError>)?.body?.table_id;
      if (apiErrorCode(caught) === "already_seated" && typeof tableId === "number") {
        router.push(`/games/mahjong/table/${tableId}`);
        return;
      }
      setError(gameErrorText(caught));
      setBusy(null);
    }
  };

  return {
    user,
    initialized,
    busy,
    error,
    disabled: !initialized || busy !== null,
    lesson: (key: "riichi" | "calls") => run(key, () => (user ? createMahjongTable({ kind: "tutorial", lesson: key }) : createGuestTable({ lesson: key }))),
    practice: () => run("practice", () => (user ? createMahjongTable({ kind: "practice", length: "east", level: "easy", speed: "untimed" }) : createGuestTable({ level: "easy" }))),
  };
}
