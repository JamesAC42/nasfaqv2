"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchBanners,
  fetchBlackjackLobby,
  fetchBlackjackTable,
  fetchCatalog,
  fetchMyTables,
  fetchPullFeed,
  fetchTables,
  fetchTickerTapBoard,
} from "@/app/lib/games/api";
import type {
  BannersResponse,
  BlackjackLobbyRow,
  FeedPull,
  GameEntry,
  GameTable,
  LobbyMessage,
  RecentMatch,
  TableGame,
  TickerTapBoard,
} from "@/app/lib/games/types";
import { useGamesChannel, useSeedChannel } from "@/app/lib/games/use-games-socket";

// Data for the arcade hub. Lobbies are live (games socket, seeded over HTTP); the pull feed and
// the Ticker Tap board poll, and only while the tab is visible.

function usePolled<T>(load: () => Promise<T>, everyMs: number | null): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load()
        .then((result) => {
          if (alive) setValue(result);
        })
        .catch(() => {});
    };
    run();
    const timer = everyMs ? window.setInterval(run, everyMs) : null;
    const onVisible = () => {
      if (document.visibilityState === "visible" && everyMs) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `load` is a module-level fetcher; polling restarts only when the interval changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs]);
  return value;
}

export const useBanners = () => usePolled<BannersResponse>(fetchBanners, null);
export const useCatalog = () => usePolled<{ games: GameEntry[] }>(fetchCatalog, null);
export const usePullFeed = () => usePolled<{ pulls: FeedPull[] }>(() => fetchPullFeed(12), 30_000);
export const useTapBoard = () => usePolled<TickerTapBoard>(fetchTickerTapBoard, 60_000);

/** Open and in-play tables for a two-player game, live, plus the last few finished matches. */
export function useLobby(game: TableGame) {
  const channel = `lobby:${game}`;
  const [seed, setSeed] = useState<LobbyMessage | null>(null);
  const live = useGamesChannel<LobbyMessage>(channel);
  useSeedChannel(channel, seed);

  const tables = live?.tables ?? seed?.tables ?? null;
  // The socket's lobby pushes don't carry finished matches; refetch them when a table leaves.
  const signature = (tables ?? []).map((table) => `${table.id}:${table.status}`).join(",");

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(
      () => {
        fetchTables(game)
          .then((result) => {
            if (alive) setSeed(result);
          })
          .catch(() => {});
      },
      seed ? 1500 : 0,
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // Re-run on table changes only; `seed` just picks the delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, signature]);

  return { tables, recent: seed?.recent ?? ([] as RecentMatch[]) };
}

type BlackjackLobbyMessage = { type: "lobby"; game: "blackjack"; tables: BlackjackLobbyRow[] };

export function useBlackjackLobby() {
  const channel = "lobby:blackjack";
  const [seed, setSeed] = useState<BlackjackLobbyMessage | null>(null);
  const live = useGamesChannel<BlackjackLobbyMessage>(channel);
  useSeedChannel(channel, seed);

  useEffect(() => {
    let alive = true;
    fetchBlackjackLobby()
      .then((result) => {
        if (alive) setSeed({ type: "lobby", game: "blackjack", tables: result.tables });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return live?.tables ?? seed?.tables ?? null;
}

export type MySeat =
  | { kind: "table"; table: GameTable }
  | { kind: "blackjack"; key: string; name: string; bet: number; phase: string };

/**
 * Tables the signed-in player is sitting at right now. Duel and high-low come from the live
 * lobbies (seeded by /tables/mine); blackjack seats are read off the tables that have anyone
 * seated, over HTTP so the hub doesn't count as a spectator.
 */
export function useMySeats(userId: string | number | null | undefined, lobbies: (GameTable[] | null)[], blackjack: BlackjackLobbyRow[] | null) {
  const me = userId === null || userId === undefined ? null : String(userId);
  const [mine, setMine] = useState<GameTable[] | null>(null);
  const [bjSeats, setBjSeats] = useState<MySeat[]>([]);

  useEffect(() => {
    if (!me) {
      setMine(null);
      return;
    }
    let alive = true;
    fetchMyTables()
      .then((result) => {
        if (alive) setMine(result.tables);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me]);

  const bjSignature = (blackjack ?? []).map((row) => `${row.key}:${row.seated}`).join(",");
  useEffect(() => {
    if (!me || !blackjack) {
      setBjSeats([]);
      return;
    }
    const occupied = blackjack.filter((row) => row.seated > 0);
    if (!occupied.length) {
      setBjSeats([]);
      return;
    }
    let alive = true;
    Promise.all(occupied.map((row) => fetchBlackjackTable(row.key).catch(() => null))).then((results) => {
      if (!alive) return;
      const seats: MySeat[] = [];
      for (const result of results) {
        const table = result?.table;
        const seat = table?.seats.find((entry) => entry && String(entry.user_id) === me);
        if (table && seat) seats.push({ kind: "blackjack", key: table.key, name: table.name, bet: seat.bet, phase: table.phase });
      }
      setBjSeats(seats);
    });
    return () => {
      alive = false;
    };
    // Re-check when seat counts move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, bjSignature]);

  return useMemo(() => {
    if (!me) return [] as MySeat[];
    const loaded = lobbies.every(Boolean);
    const source = loaded ? lobbies.flatMap((list) => list ?? []) : (mine ?? []);
    const tables = source
      .filter((table) => (table.status === "open" || table.status === "playing") && table.players.some((player) => String(player.user_id) === me))
      .map((table): MySeat => ({ kind: "table", table }));
    return [...tables, ...bjSeats];
  }, [me, lobbies, mine, bjSeats]);
}
