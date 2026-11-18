"use client";

import { useEffect, useMemo, useState } from "react";
import { useNetWorth, type Worth } from "@/app/components/common/use-net-worth";
import { PlayerCell, type PlayerLook } from "@/app/components/games/mahjong/records/record-parts";
import { apiErrorCode } from "@/app/lib/api";
import { fmtInteger } from "@/app/lib/format";
import { gameErrorText } from "@/app/lib/games/errors";
import { fetchChipLeaderboard } from "@/app/lib/games/mahjong/api";
import { fmtChips } from "@/app/lib/games/mahjong/chips";
import type { ChipLeader, ChipLeaderboardResponse, ChipRange } from "@/app/lib/games/mahjong/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/games/mahjong/records/records.module.scss";

const SIGN_CLASS = (value: number) => (value > 0 ? styles.up : value < 0 ? styles.down : undefined);

function Row({ row, rank, me, worth }: { row: ChipLeader & PlayerLook; rank: number | null; me?: boolean; worth: Record<number, Worth> }) {
  return (
    <tr data-me={me || undefined}>
      <td>{rank ?? "–"}</td>
      <td>
        <PlayerCell player={row} worth={worth} />
      </td>
      <td className={SIGN_CLASS(row.chips)}>{fmtChips(row.chips)}</td>
      <td>{fmtInteger(row.games)}</td>
    </tr>
  );
}

/** Net chips for the beta, this week (from Saturday 00:00 New York) or all time. */
export function ChipsBoard({ range }: { range: ChipRange }) {
  const { user } = useAuth();
  const [state, setState] = useState<{ range: ChipRange; data: ChipLeaderboardResponse | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchChipLeaderboard(range)
      .then((data) => !cancelled && setState({ range, data, error: null }))
      .catch((failure) => {
        if (cancelled) return;
        // An API without the chip boards answers 404: say so quietly instead of showing an error.
        setState({ range, data: null, error: apiErrorCode(failure) === "404" ? "" : gameErrorText(failure) });
      });
    return () => {
      cancelled = true;
    };
  }, [range, user?.id]);

  const current = state?.range === range ? state : null;
  const data = current?.data ?? null;
  const me = data?.me ?? null;
  const meInList = me ? data?.leaders.some((row) => row.username.toLowerCase() === me.username.toLowerCase()) : false;
  const playerIds = useMemo(() => [...(data?.leaders ?? []), ...(data?.me ? [data.me] : [])].map((row: PlayerLook) => row.user_id), [data]);
  const worth = useNetWorth(playerIds);

  return (
    <section className={styles.section} aria-label={range === "week" ? "Chips this week" : "Chips all time"}>
      <p className={styles.lede}>
        {range === "week"
          ? "Net chips from games finished since Saturday at midnight, New York time. The board starts over every week."
          : "Net chips from every chip game finished in the beta."}{" "}
        Chips are only a record, worth nothing outside the beta.
      </p>
      {current?.error ? <p className={styles.error}>{current.error}</p> : null}
      {!current ? <p className={styles.note}>Loading the board…</p> : null}
      {data && data.leaders.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.ladder}>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Chips</th>
                <th>Games</th>
              </tr>
            </thead>
            <tbody>
              {data.leaders.map((row) => (
                <Row key={row.username} row={row} rank={row.rank} me={Boolean(me && row.username.toLowerCase() === me.username.toLowerCase())} worth={worth} />
              ))}
              {me && !meInList ? (
                <>
                  <tr aria-hidden="true">
                    <td colSpan={4} className={styles.dim}>
                      …
                    </td>
                  </tr>
                  <Row row={me} rank={me.rank} me worth={worth} />
                </>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && !data.leaders.length ? (
        <p className={styles.empty}>
          {range === "week" ? "No chip games finished this week yet." : "No chip games finished yet."} Sit at a chip table in the lobby and the first result goes up here.
        </p>
      ) : null}
      {current && !data && current.error === "" ? <p className={styles.empty}>The chip boards aren’t open yet. Check back soon.</p> : null}
    </section>
  );
}
