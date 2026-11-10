"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatWords } from "@/app/components/games/mahjong/tournaments/tournament-parts";
import { gameErrorText } from "@/app/lib/games/errors";
import { createTournament } from "@/app/lib/games/mahjong/api";
import type { CreateTournamentBody, GameLength } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/tournaments/tournaments.module.scss";

const pad = (value: number) => String(value).padStart(2, "0");
/** A datetime-local value (local time) an hour from now, on the hour. */
function defaultStart() {
  const date = new Date(Date.now() + 3_600_000);
  date.setMinutes(0, 0, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

/** Staff only: makes a tournament. */
export function TournamentForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [seats, setSeats] = useState<4 | 8 | 16>(8);
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [length, setLength] = useState<GameLength>("east");
  const [finalLength, setFinalLength] = useState<GameLength>("south");
  const [speed, setSpeed] = useState<"standard" | "relaxed">("standard");
  const [fee, setFee] = useState("0");
  const [weekly, setWeekly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const when = new Date(startsAt);
    if (Number.isNaN(when.getTime())) {
      setError("Pick a start time.");
      return;
    }
    const body: CreateTournamentBody = { name: name.trim(), seats, length, final_length: finalLength, speed, entry_fee: Math.max(0, Number(fee) || 0), starts_at: when.toISOString(), repeat_weekly: weekly };
    setBusy(true);
    setError(null);
    try {
      const { tournament } = await createTournament(body);
      router.push(`/games/mahjong/tournaments/${tournament.id}`);
    } catch (failure) {
      setError(gameErrorText(failure));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.primary} onClick={() => setOpen(true)}>
        New tournament
      </button>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <h3>New tournament</h3>
      <label className={styles.formField}>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required placeholder="Friday night knockout" />
      </label>
      <div className={styles.formRow}>
        <fieldset className={styles.formField}>
          <legend>Seats</legend>
          <div className={styles.seg} role="radiogroup" aria-label="Seats">
            {([4, 8, 16] as const).map((count) => (
              <button key={count} type="button" role="radio" aria-checked={seats === count} data-on={seats === count || undefined} onClick={() => setSeats(count)}>
                {count}
              </button>
            ))}
          </div>
        </fieldset>
        <label className={styles.formField}>
          <span>Starts (your time)</span>
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label className={styles.formField}>
          <span>Entry fee ($, 0 for free)</span>
          <input type="number" min={0} step={1} value={fee} onChange={(event) => setFee(event.target.value)} />
        </label>
      </div>
      <div className={styles.formRow}>
        <label className={styles.formField}>
          <span>Game length</span>
          <select value={length} onChange={(event) => setLength(event.target.value as GameLength)}>
            <option value="east">East-only</option>
            <option value="south">East-South</option>
          </select>
        </label>
        <label className={styles.formField}>
          <span>Final length</span>
          <select value={finalLength} onChange={(event) => setFinalLength(event.target.value as GameLength)}>
            <option value="east">East-only</option>
            <option value="south">East-South</option>
          </select>
        </label>
        <label className={styles.formField}>
          <span>Speed</span>
          <select value={speed} onChange={(event) => setSpeed(event.target.value as "standard" | "relaxed")}>
            <option value="standard">Standard</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} />
          <span>Repeat weekly</span>
        </label>
      </div>
      <p className={styles.note}>{formatWords({ seats, length, final_length: finalLength, speed })}</p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.formActions}>
        <button type="submit" className={styles.primary} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create"}
        </button>
        <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
