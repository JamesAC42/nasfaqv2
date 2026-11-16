"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Countdown } from "@/app/components/predictions/floor/market-card";
import { PredictionsFrame } from "@/app/components/predictions/shell/predictions-frame";
import { fetchCategories } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { money, STATUS_LABEL } from "@/app/lib/predictions/format";
import { createPool, fetchBookiePools, poolHref, type BookiePool } from "@/app/lib/predictions/pools";
import type { Category } from "@/app/lib/predictions/types";
import { usePoolAccess } from "@/app/lib/predictions/use-pool-access";
import { useNowEvery } from "@/app/lib/use-now";
import styles from "@/app/components/predictions/pool/pool.module.scss";

const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** /predictions/bookie: open a pool, and the pools you run (admins can see everyone's). */
export function BookieDesk() {
  const access = usePoolAccess();
  const router = useRouter();
  const now = useNowEvery(60_000);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [pools, setPools] = useState<BookiePool[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [closesAt, setClosesAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3_600_000)));
  const [rules, setRules] = useState("");
  const [category, setCategory] = useState("");
  const [minBet, setMinBet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchBookiePools(scope)
      .then((result) => setPools(result.pools))
      .catch((reason) => setError(predictionErrorText(reason)));
  }, [scope]);

  useEffect(() => {
    if (!access.bookie && !access.staff) return;
    load();
    fetchCategories()
      .then((result) => setCategories(result.categories))
      .catch(() => {});
  }, [access.bookie, access.staff, load]);

  if (access.loaded && !access.bookie && !access.staff) {
    return (
      <PredictionsFrame kicker="Pools" title="Bookie desk">
        <p className={styles.empty}>Bookies open and call pools. Ask staff if you’d like to be one.</p>
      </PredictionsFrame>
    );
  }

  const filled = options.map((option) => option.trim()).filter(Boolean);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { pool } = await createPool({
        title: title.trim(),
        options: filled,
        closes_at: new Date(closesAt).toISOString(),
        rules_text: rules.trim() || undefined,
        category: category || undefined,
        min_bet: minBet ? Number(minBet) : undefined,
      });
      router.push(poolHref(pool.slug));
    } catch (reason) {
      const field = (reason as { body?: { field?: string } }).body?.field;
      setError(`${predictionErrorText(reason)}${field ? ` (${field.replace(/_/g, " ")})` : ""}`);
      setBusy(false);
    }
  };

  return (
    <PredictionsFrame kicker="Pools" title="Bookie desk" blurb="Open a pool, then call the winner with a source when it's known. Your pools open straight away; you can't bet in them.">
      <div className={styles.page}>
        {access.bookie ? (
          <form className={styles.form} onSubmit={(event) => void create(event)}>
            <label>
              <span>Question</span>
              <input className={styles.input} maxLength={200} placeholder="Who wins the Holo Sports Festival relay?" value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <div className={styles.optionInputs}>
              <span className={styles.fieldLabel}>Options (2 to 100)</span>
              {options.map((option, index) => (
                <div key={index}>
                  <input
                    className={styles.input}
                    maxLength={80}
                    placeholder={`Option ${index + 1}`}
                    value={option}
                    onChange={(event) => setOptions(options.map((entry, at) => (at === index ? event.target.value : entry)))}
                    aria-label={`Option ${index + 1}`}
                  />
                  {options.length > 2 ? (
                    <button type="button" onClick={() => setOptions(options.filter((_, at) => at !== index))} aria-label={`Remove option ${index + 1}`}>
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
              {options.length < 100 ? (
                <div>
                  <button type="button" onClick={() => setOptions([...options, ""])}>
                    + Add an option
                  </button>
                </div>
              ) : null}
            </div>
            <div className={styles.split}>
              <label>
                <span>Betting closes</span>
                <input className={styles.input} type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} required />
              </label>
              <label>
                <span>Minimum bet (optional, $1,000 or more)</span>
                <input className={styles.input} inputMode="decimal" placeholder="1,000" value={minBet} onChange={(event) => setMinBet(event.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
            </div>
            <label>
              <span>Category</span>
              <select className={styles.select} value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">None</option>
                {categories.map((entry) => (
                  <option key={entry.slug} value={entry.slug}>
                    {entry.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>How it’s decided (optional)</span>
              <textarea rows={3} maxLength={10000} placeholder="Resolves to the team that crosses the line first in the official stream." value={rules} onChange={(event) => setRules(event.target.value)} />
            </label>
            {error ? <p className={styles.error}>{error}</p> : null}
            <button type="submit" className={styles.primary} disabled={busy || title.trim().length < 4 || filled.length < 2}>
              {busy ? "Opening…" : "Open the pool"}
            </button>
          </form>
        ) : null}

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>{scope === "all" ? "Every pool" : "Your pools"}</h2>
            {access.staff ? (
              <div className={styles.tabs} role="group" aria-label="Whose pools">
                <button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
                  Mine
                </button>
                <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                  Everyone’s
                </button>
              </div>
            ) : null}
          </div>
          {pools && !pools.length ? <p className={styles.empty}>No pools yet.</p> : null}
          <ul className={styles.list}>
            {pools?.map((pool) => {
              const needsCall = pool.status === "closed" || pool.status === "resolving";
              return (
                <li key={pool.id} className={styles.row}>
                  <Link href={poolHref(pool.slug)}>{pool.title}</Link>
                  <span className={styles.rowRight}>{money(pool.pool_total, 0)}</span>
                  <div className={styles.rowMeta}>
                    <span>
                      <b>{needsCall ? "Needs your call" : (STATUS_LABEL[pool.status] ?? pool.status)}</b>
                    </span>
                    {pool.status === "open" ? (
                      <span>
                        closes in <Countdown to={pool.closes_at} />
                      </span>
                    ) : null}
                    {needsCall && new Date(pool.closes_at).getTime() > now ? <span>Closed early</span> : null}
                    <span>
                      {pool.bettors} {pool.bettors === 1 ? "bettor" : "bettors"}
                    </span>
                    <span>{pool.outcomes.length} options</span>
                    {scope === "all" && pool.bookie ? <span>Bookie {pool.bookie}</span> : null}
                    {pool.can_correct ? <span>Correctable</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </PredictionsFrame>
  );
}
