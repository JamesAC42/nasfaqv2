"use client";

import Link from "next/link";
import { FaEye } from "react-icons/fa6";
import { fmtInteger, fmtNumber } from "@/app/lib/format";
import { talentAccent } from "@/app/lib/talent-color";
import type { LobbyEntry, MahjongLimits, StakeTier, TournamentSummary } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/lobby/mahjong-lobby.module.scss";

/** A segmented picker: [ East-only | East-South ]. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.seg} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={option.value === value} data-on={option.value === value || undefined} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const money = (value: number) => fmtNumber(value, "$");

/** "This week: -$3,200 of ±$10,000 · 2 of 6 paid games today". */
export function limitsLine(limits: MahjongLimits): string {
  const net = limits.week_net;
  const signed = net > 0 ? `+${money(net)}` : net < 0 ? `−${money(-net)}` : "$0";
  return `This week: ${signed} of ±${money(limits.weekly_limit)} · ${limits.games_today} of ${limits.games_per_day} paid games today`;
}

/** Why a stakes table can't be sat at right now, in a sentence, or null when it can. */
export function stakesBlock(limits: MahjongLimits | null, tier: StakeTier, signedIn: boolean, verified: boolean): string | null {
  if (!signedIn) return "Sign in to sit at a paid table.";
  if (!verified) return "Verify your email to sit with other players.";
  if (!limits) return null;
  if (limits.blocked === "net_worth") return `Paid tables are closed while your net worth is under ${money(limits.min_net_worth)}. You’re at ${money(limits.net_worth)}. Build it back on the market and they reopen.`;
  if (limits.blocked === "in_the_red") return "You’re in the red on margin. Winnings and other Credit pay it back; until then you can’t spend Credit.";
  if (limits.blocked === "weekly_limit") return "You’ve hit this week’s mahjong limit. Paid tables reopen Saturday at midnight ET.";
  if (limits.blocked === "daily_limit") return `That’s your ${limits.games_per_day} paid games for today. More at midnight ET.`;
  if (tier.fee > limits.loss_room) return `The ${money(tier.fee)} fee is more than the ${money(Math.max(0, limits.loss_room))} you have left to lose this week.`;
  if (tier.top_net > limits.win_room) return `First place could take you past this week’s limit: you have ${money(Math.max(0, limits.win_room))} of winning room left.`;
  return null;
}

const KIND_LABEL: Record<string, string> = { ranked: "Quick match", stakes: "Stakes table", friend: "Friend room", tournament: "Tournament", practice: "Practice", tutorial: "Tutorial" };

function startsIn(startsAt: number | null, now: number | null) {
  if (!startsAt || !now) return null;
  const seconds = Math.max(0, Math.round((startsAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function tableTitle(table: LobbyEntry) {
  if (table.tournament) return `${table.tournament.name} · ${table.tournament.round_name}`;
  if (table.kind === "stakes") return `${money(table.fee)} table`;
  return KIND_LABEL[table.kind] ?? table.kind;
}

/** One live table: who is at it, the round and scores, and how to get in. */
export function LiveTableRow({ table, now, canSit, busy, onSit }: { table: LobbyEntry; now: number | null; canSit: boolean; busy: boolean; onSit: (id: number) => void }) {
  const seated = table.seats.filter(Boolean).length;
  const playing = table.status === "playing";
  const open = !playing && seated < 4 && (table.kind === "ranked" || table.kind === "stakes");
  const countdown = !playing ? startsIn(table.starts_at, now) : null;
  return (
    <li className={styles.live} data-playing={playing || undefined}>
      <div className={styles.liveHead}>
        <Link href={`/games/mahjong/table/${table.id}`} className={styles.liveTitle}>
          {tableTitle(table)}
        </Link>
        <span className={styles.liveMeta}>
          {table.length === "south" ? "East-South" : "East-only"}
          {playing && table.label ? <> · <b>{table.label}</b></> : null}
          {!playing ? <> · waiting <b>{seated}/4</b>{countdown ? <> · deals in <b>{countdown}</b></> : null}</> : null}
        </span>
      </div>
      <ol className={styles.liveSeats}>
        {table.seats.map((seat, index) =>
          seat ? (
            <li key={index} style={{ "--tal": talentAccent(seat.profile_color) } as React.CSSProperties} data-bot={seat.bot ? "" : undefined}>
              <i aria-hidden="true" />
              <span className={styles.seatName}>{seat.username}</span>
              {table.scores ? <b className={styles.seatScore}>{fmtInteger(table.scores[index])}</b> : null}
            </li>
          ) : (
            <li key={index} data-empty="">
              <i aria-hidden="true" />
              <span className={styles.seatName}>open seat</span>
            </li>
          )
        )}
      </ol>
      <div className={styles.liveFoot}>
        <span className={styles.spectators} title="Watching">
          <FaEye aria-hidden="true" /> {fmtInteger(table.spectators)}
        </span>
        {open && canSit ? (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => onSit(table.id)}>
            {busy ? "Sitting…" : "Sit down"}
          </button>
        ) : null}
        <Link href={`/games/mahjong/table/${table.id}`} className={styles.watch}>
          Watch
        </Link>
      </div>
    </li>
  );
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** An upcoming or running tournament. */
export function TournamentRow({ tournament }: { tournament: TournamentSummary }) {
  const running = tournament.status === "running";
  return (
    <li className={styles.tournament}>
      <Link href={`/games/mahjong/tournaments/${tournament.id}`} className={styles.tournamentLink}>
        <span className={styles.tournamentName}>{tournament.name}</span>
        <span className={styles.tournamentMeta}>
          {running ? (
            <span className={styles.runningTag}>
              <i aria-hidden="true" /> Running
            </span>
          ) : (
            <>Starts {when(tournament.starts_at)}</>
          )}
          {" · "}
          <b>{tournament.entrants ?? 0}</b>/{tournament.seats} in
          {" · "}
          {tournament.entry_fee > 0 && tournament.paid ? <>{money(tournament.entry_fee)} entry</> : "free"}
          {tournament.repeat_weekly ? " · weekly" : null}
        </span>
      </Link>
    </li>
  );
}
