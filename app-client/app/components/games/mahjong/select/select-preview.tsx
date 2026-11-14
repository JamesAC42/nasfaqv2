"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { columnsFor, TalentSelect } from "@/app/components/games/mahjong/select/talent-select";
import { mahjongChannels } from "@/app/lib/games/mahjong/api";
import type { CursorSample, PublicSeat, SeatedTable, SeatIndex, SelectAction, SelectPick } from "@/app/lib/games/mahjong/types";
import { primeChannel } from "@/app/lib/games/use-games-socket";
import { useMarketStore } from "@/app/stores/market-store";

// Local development only (/dev/mahjong-select): the talent select with a pretend table, so it can be
// looked at without a running game. You sit in seat 0; seat 1 is a pretend player whose pointer is
// streamed the way the server would send it (a sample every 40 ms, some late, some lost) to show the
// smoothing; seats 2 and 3 are bots. Nothing here talks to the API.

const TABLE_ID = 900_000_000_001;
const FALLBACK = ["AKI", "AME", "AQU", "AYA", "AZK", "BIJ", "BLD", "BOT", "CLI", "FBK", "FLR", "GUR", "INA", "IRO", "KRA", "LAM", "MAR", "MIO", "PEK", "SUI"];

const seat = (index: SeatIndex, username: string, bot: boolean): PublicSeat => ({
  seat: index,
  user_id: bot ? null : index + 1,
  username,
  profile_color: null,
  profile_picture_url: null,
  talent: null,
  bot: bot ? "normal" : null,
  guest: false,
  rating: null,
  rank: null,
  away: false,
  connected: true,
  ready: bot,
});

export function SelectPreview() {
  const assets = useMarketStore((state) => state.assets);
  const roster = useMemo(() => (assets.length >= 4 ? assets.map((asset) => asset.symbol) : FALLBACK), [assets]);
  const [picks, setPicks] = useState<SelectPick[]>(() => [0, 1, 2, 3].map((index) => ({ seat: index as SeatIndex, talent: null, ready: false })));
  const [deadline, setDeadline] = useState(() => Date.now() + 30_000);
  const [startsAt, setStartsAt] = useState<number | null>(null);
  const picksRef = useRef(picks);
  useEffect(() => {
    picksRef.current = picks;
  }, [picks]);

  const table = useMemo(() => {
    const seats = [seat(0, "You", false), seat(1, "Player two", false), seat(2, "Limit Order", true), seat(3, "Dip Buyer", true)].map((entry, index) => ({ ...entry, talent: picks[index].talent }));
    return {
      id: TABLE_ID,
      kind: "ranked",
      status: "waiting",
      length: "east",
      speed: "standard",
      level: "normal",
      coach: false,
      fee: 0,
      prizes: null,
      rated: true,
      recorded: true,
      room_code: null,
      host_user_id: null,
      seats,
      game: null,
      clock: null,
      starts_at: null,
      expires_at: null,
      created_at: deadline - 30_000,
      tournament: null,
      lesson: null,
      picks: [0, 0, 0, 0],
      picks_open: false,
      cheers: [0, 0, 0, 0],
      spectators: 0,
      result: null,
      select: { deadline: startsAt ? null : deadline, starts_at: startsAt, roster, picks, cursors: true },
      server_time: deadline - 30_000,
      me: { seat: 0, away: false, bank: 0, deadline: null, turn_ms: 7000, ready: false, auto: false, badges_earned: [], review: null },
    } as unknown as SeatedTable;
  }, [deadline, picks, roster, startsAt]);

  const allReady = (list: SelectPick[]) => list[0].ready && list[1].ready;
  const finish = useCallback(
    (list: SelectPick[]) => {
      if (!allReady(list)) return list;
      const taken = new Set(list.map((entry) => entry.talent));
      const free = roster.filter((symbol) => !taken.has(symbol));
      setStartsAt(Date.now() + 1500);
      return list.map((entry, index) => (index >= 2 ? { ...entry, talent: free[index - 2] ?? null, ready: true } : entry));
    },
    [roster],
  );

  const onAction = useCallback(
    async (action: SelectAction) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const list = picksRef.current;
      if (action.action === "mj-pick-talent") {
        if (list.some((entry, index) => index !== 0 && entry.talent === action.talent)) throw Object.assign(new Error("talent_taken"), { code: "talent_taken", body: { seat: 1 } });
        setPicks(list.map((entry, index) => (index === 0 ? { ...entry, talent: action.talent } : entry)));
      } else {
        const next = list.map((entry, index) => (index === 0 ? { ...entry, ready: action.ready } : entry));
        setPicks(finish(next));
      }
      return { table };
    },
    [finish, table],
  );

  // The pretend player: picks after a few seconds, readies a little later.
  useEffect(() => {
    const pickTimer = window.setTimeout(() => {
      setPicks((list) => (list[1].talent ? list : list.map((entry, index) => (index === 1 ? { ...entry, talent: roster.find((symbol) => symbol !== list[0].talent && symbol.startsWith("P")) ?? roster[5] } : entry))));
    }, 5000);
    const readyTimer = window.setTimeout(() => setPicks((list) => finish(list.map((entry, index) => (index === 1 && entry.talent ? { ...entry, ready: true } : entry)))), 14_000);
    return () => {
      window.clearTimeout(pickTimer);
      window.clearTimeout(readyTimer);
    };
  }, [finish, roster]);

  // Start over once it would have dealt.
  useEffect(() => {
    if (!startsAt) return;
    const timer = window.setTimeout(() => {
      setStartsAt(null);
      setDeadline(Date.now() + 30_000);
      setPicks([0, 1, 2, 3].map((index) => ({ seat: index as SeatIndex, talent: null, ready: false })));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [startsAt]);

  // The pretend player's pointer: a wandering path, sampled every 40 ms, 15% lost, 0-80 ms late.
  useEffect(() => {
    const channel = mahjongChannels.cursors(TABLE_ID);
    const columns = columnsFor(roster.length);
    const rows = Math.ceil(roster.length / columns);
    const begin = performance.now();
    const at = (ms: number) => {
      const s = ms / 1000;
      return { x: 0.5 + 0.42 * Math.sin(s * 0.9) * Math.cos(s * 0.23), y: 0.5 + 0.4 * Math.sin(s * 1.37 + 1) };
    };
    const timer = window.setInterval(() => {
      const now = performance.now() - begin;
      const phase = (now / 1000) % 12;
      const resting = phase > 9; // stops for a few seconds now and then
      const p = at(resting ? Math.floor(now / 12_000) * 12_000 + 9000 : now);
      const q = at(now - 40);
      const vx = resting ? 0 : (p.x - q.x) / 0.04;
      const vy = resting ? 0 : (p.y - q.y) / 0.04;
      if (Math.random() < 0.15) return;
      const col = Math.min(columns - 1, Math.floor(p.x * columns));
      const row = Math.min(rows - 1, Math.floor(p.y * rows));
      const sample: CursorSample = { seat: 1, x: p.x, y: p.y, vx, vy, t: Math.round(now), hover: roster[row * columns + col] ?? null, gone: false, at: Date.now() };
      window.setTimeout(() => primeChannel(channel, { type: "mj-cursors", table_id: TABLE_ID, server_time: Date.now(), cursors: [sample] }), Math.random() * 80);
    }, 40);
    return () => window.clearInterval(timer);
  }, [roster]);

  return (
    <SiteShell>
      <div style={{ padding: "1rem" }}>
        <TalentSelect table={table} select={table.select!} mySeat={0} apply={() => {}} onLeave={() => {}} leaving={false} onAction={onAction} />
      </div>
    </SiteShell>
  );
}
