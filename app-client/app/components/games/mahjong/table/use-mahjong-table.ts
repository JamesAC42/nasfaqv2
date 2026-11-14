"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiErrorCode } from "@/app/lib/api";
import { gameErrorText } from "@/app/lib/games/errors";
import { backToSeat, fetchMahjongGame, fetchMahjongTable, mahjongChannels } from "@/app/lib/games/mahjong/api";
import type { MahjongPush, MahjongTable, SeatedTable, SeatGrant } from "@/app/lib/games/mahjong/types";
import { isSeatedTable } from "@/app/lib/games/mahjong/types";
import { primeChannel, useGamesChannel, useSeedChannel } from "@/app/lib/games/use-games-socket";

export type TableLoad = { kind: "loading" } | { kind: "ready" } | { kind: "gone"; replay: number | null } | { kind: "error"; message: string };

/**
 * One table's state: the HTTP seed, then the socket. A seated player listens on their seat's channel
 * (the public table plus their own hand), everyone else on the public one. Reloading is reconnecting:
 * the seed already says whether this browser holds a seat.
 */
export function useMahjongTable(id: number, viewer: string | null) {
  const [seed, setSeed] = useState<MahjongPush | null>(null);
  const [grant, setGrant] = useState<SeatGrant | null>(null);
  const [myPick, setMyPick] = useState<number | null>(null);
  const [load, setLoad] = useState<TableLoad>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    // Who is looking is part of the answer (their seat), so wait until the sign-in check is done.
    if (viewer === null) return;
    let cancelled = false;
    fetchMahjongTable(id)
      .then((response) => {
        if (cancelled) return;
        setGrant(response.seat ?? null);
        setMyPick(response.my_pick?.seat ?? null);
        setSeed({ type: "mahjong", table: response.table });
        setLoad({ kind: "ready" });
        // Back from being away: take the seat off autopilot before anything else.
        if (response.seat && isSeatedTable(response.table) && response.table.me.away) {
          backToSeat(id)
            .then((back) => {
              if (!cancelled && response.seat) primeChannel(response.seat.channel, { type: "mahjong", table: back.table, server_time: back.table.server_time });
            })
            .catch(() => {
              /* the next push says where things stand */
            });
        }
      })
      .catch(async (error) => {
        if (cancelled) return;
        if (apiErrorCode(error) === "table_not_found" || apiErrorCode(error) === "404") {
          // A table that is over leaves memory; its record may still be there.
          const replay = await fetchMahjongGame(id)
            .then((record) => (record.game.status === "completed" ? id : null))
            .catch(() => null);
          if (!cancelled) setLoad({ kind: "gone", replay });
          return;
        }
        setLoad({ kind: "error", message: gameErrorText(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, viewer, reloads]);

  const channel = grant?.channel ?? mahjongChannels.table(id);
  useSeedChannel(channel, seed);
  const live = useGamesChannel<MahjongPush>(channel);
  const table: MahjongTable | SeatedTable | null = live?.table ?? seed?.table ?? null;

  // A seat grant that has just been issued (sitting down) switches the channel at once.
  const take = useCallback((next: SeatGrant, from: SeatedTable) => {
    setGrant(next);
    primeChannel(next.channel, { type: "mahjong", table: from, server_time: from.server_time });
  }, []);

  // The newest table we have been handed, so a slow HTTP answer never rewinds a push.
  const latest = useRef(table);
  useEffect(() => {
    latest.current = table;
  }, [table]);
  const apply = useCallback(
    (next: SeatedTable) => {
      if (latest.current && latest.current.server_time > next.server_time) return;
      primeChannel(channel, { type: "mahjong", table: next, server_time: next.server_time });
    },
    [channel],
  );

  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return useMemo(() => ({ table, load, grant, myPick, setMyPick, apply, take, reload }), [table, load, grant, myPick, apply, take, reload]);
}
