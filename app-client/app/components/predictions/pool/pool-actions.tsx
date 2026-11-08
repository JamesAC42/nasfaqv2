"use client";

import { useState } from "react";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { closePool, correctPool, extendPool, resolvePool, voidPool, type PoolDetail } from "@/app/lib/predictions/pools";
import styles from "@/app/components/predictions/pool/pool.module.scss";

type Mode = "resolve" | "correct" | "void" | "extend" | null;

const toLocalInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

/**
 * The bookie's tools on their pool (close early, extend, call the winner, void), and staff's
 * correction and void for 7 days after it resolves. Every call needs a source link or a note: it
 * goes on the pool's public record.
 */
export function PoolActions({ pool, onChanged }: { pool: PoolDetail; onChanged: () => void }) {
  const can = pool.can;
  const [mode, setMode] = useState<Mode>(null);
  const [outcome, setOutcome] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [closesAt, setClosesAt] = useState(() => toLocalInput(new Date(new Date(pool.closes_at).getTime() + 24 * 3_600_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!can || !(can.manage || can.void || can.correct)) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode(null);
      setOutcome("");
      setSource("");
      setNote("");
      onChanged();
    } catch (reason) {
      setError(predictionErrorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const body = () => ({ outcome, source_url: source.trim() || undefined, note: note.trim() || undefined });
  const options = pool.options.filter((option) => mode !== "correct" || !option.is_winner);

  return (
    <section className={styles.section} aria-label={pool.status === "resolved" ? "Staff tools" : "Bookie tools"}>
      <div className={styles.sectionHead}>
        <h2>{pool.status === "resolved" ? "Staff tools" : "Bookie tools"}</h2>
        <span className={styles.hint}>Everything here goes on the pool’s public record.</span>
      </div>
      <div className={styles.toolRow}>
        {can.resolve ? (
          <button type="button" className={mode === "resolve" ? styles.primary : styles.secondary} onClick={() => setMode(mode === "resolve" ? null : "resolve")}>
            Call the winner
          </button>
        ) : null}
        {can.manage && !can.resolve ? <span className={styles.small}>You have money in this pool, so someone else has to call it.</span> : null}
        {can.manage && pool.status === "open" ? (
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void run(() => closePool(pool.id))}>
            Close betting now
          </button>
        ) : null}
        {can.extend ? (
          <button type="button" className={mode === "extend" ? styles.primary : styles.secondary} onClick={() => setMode(mode === "extend" ? null : "extend")}>
            Extend
          </button>
        ) : null}
        {can.correct ? (
          <button type="button" className={mode === "correct" ? styles.primary : styles.secondary} onClick={() => setMode(mode === "correct" ? null : "correct")}>
            Correct the result
          </button>
        ) : null}
        {can.void ? (
          <button type="button" className={styles.danger} onClick={() => setMode(mode === "void" ? null : "void")}>
            Void
          </button>
        ) : null}
      </div>

      {mode === "resolve" || mode === "correct" ? (
        <form
          className={styles.toolForm}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => (mode === "resolve" ? resolvePool(pool.id, body()) : correctPool(pool.id, body())));
          }}
        >
          <label>
            <span>{mode === "resolve" ? "Winning option" : "The right option"}</span>
            <select className={styles.select} value={outcome} onChange={(event) => setOutcome(event.target.value)} required>
              <option value="" disabled>
                Pick one
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.outcome_code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Source link</span>
            <input className={styles.input} type="url" placeholder="https://…" value={source} onChange={(event) => setSource(event.target.value)} />
          </label>
          <label>
            <span>Note (a source link or a note is required)</span>
            <input className={styles.input} maxLength={2000} placeholder="How you know" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <p className={styles.small}>
            {mode === "resolve"
              ? "Winners are paid the moment you call it. Staff can correct a wrong call for 7 days."
              : "Every payout from the current result is taken back from Credit first (it can go below zero), then the pool pays out on the right option."}
          </p>
          <button type="submit" className={styles.primary} disabled={busy || !outcome || (!source.trim() && !note.trim())}>
            {busy ? "Working…" : mode === "resolve" ? "Pay out" : "Correct and pay out"}
          </button>
        </form>
      ) : null}

      {mode === "extend" ? (
        <form
          className={styles.toolForm}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => extendPool(pool.id, new Date(closesAt).toISOString()));
          }}
        >
          <label>
            <span>New closing time (at most 28 days after it opened)</span>
            <input className={styles.input} type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
          </label>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Working…" : "Extend"}
          </button>
        </form>
      ) : null}

      {mode === "void" ? (
        <form
          className={styles.toolForm}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => voidPool(pool.id, { reason: note.trim() || undefined, source_url: source.trim() || undefined }));
          }}
        >
          <label>
            <span>Why</span>
            <input className={styles.input} maxLength={2000} placeholder="Event canceled" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <p className={styles.small}>
            Every bet goes back where it came from.{pool.status === "resolved" ? " The payouts are taken back first, from Credit, which can go below zero." : ""}
          </p>
          <button type="submit" className={styles.danger} disabled={busy}>
            {busy ? "Working…" : "Void the pool"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
