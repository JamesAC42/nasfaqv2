"use client";

import Link from "next/link";
import { useState } from "react";
import { Notice, Section, adminErrorText, adminUi as ui } from "@/app/components/admin/admin-ui";
import { apiFetch } from "@/app/lib/api";
import { money, signedPct } from "@/app/lib/time";
import type { EvaluationRow, WeeklyEvaluation } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/admin/evaluation-now.module.scss";

type RunResult = { ok: boolean; skipped?: string; dry_run?: boolean; eval_date?: string; report?: WeeklyEvaluation };

/**
 * The weekly evaluation on demand, for playtests: preview what it would do right now, then run it.
 * It runs under today's New York date, so a date still runs once (a second run today is refused and
 * Saturday's is a different date). Nothing pays until "Run it" is confirmed by typing "evaluate".
 */
export function EvaluationNow() {
  const refreshMarketOverview = useMarketStore((state) => state.refreshOverview);
  const [preview, setPreview] = useState<WeeklyEvaluation | null>(null);
  const [done, setDone] = useState<WeeklyEvaluation | null>(null);
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setBusy(dryRun ? "preview" : "run");
    setError(null);
    setNote(null);
    try {
      const result = await apiFetch<RunResult>("/internal/market/weekly-evaluation/run-now", {
        method: "POST",
        body: JSON.stringify(dryRun ? { dry_run: true } : { confirmation: "evaluate" }),
      });
      if (result?.skipped === "already_completed") {
        setNote(`An evaluation already ran for ${result.eval_date}. Each date runs once, so the next one on demand is tomorrow (or Saturday's on schedule).`);
      } else if (result?.skipped === "locked") {
        setNote("Another evaluation is running right now. Try again in a moment.");
      } else if (result?.report) {
        if (dryRun) {
          setPreview(result.report);
          setDone(null);
        } else {
          setDone(result.report);
          setPreview(null);
          setArmed(false);
          setTyped("");
          void refreshMarketOverview();
        }
      }
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(null);
    }
  }

  const shown = done ?? preview;

  return (
    <Section title="Weekly evaluation now" hint="For playtests: dividends, fees, max shares and buybacks without waiting for Saturday.">
      <div className={styles.wrap}>
        <p className={styles.blurb}>
          Runs the same evaluation Saturday&apos;s does, dated today (ET). Each date runs once, so pressing it twice can&apos;t pay twice. Saturday still runs on top of it, and if nothing has
          ticked in between it pays about the same again, so this is for playtests, not the live game. Players get their dividend and fee notifications and it shows on{" "}
          <Link href="/market/dividends">the Dividends tab</Link> like any other week.
        </p>
        <div className={styles.row}>
          <button type="button" className={ui.btn} onClick={() => void call(true)} disabled={busy !== null}>
            {busy === "preview" ? "Working it out…" : preview ? "Preview again" : "Preview"}
          </button>
          {armed ? (
            <>
              <input className={ui.input} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="evaluate" aria-label="Type evaluate to confirm" autoFocus />
              <button type="button" className={ui.btnDangerSolid} onClick={() => void call(false)} disabled={busy !== null || typed.trim() !== "evaluate"}>
                {busy === "run" ? "Running…" : "Run it"}
              </button>
              <button type="button" className={ui.btnGhost} onClick={() => (setArmed(false), setTyped(""))} disabled={busy !== null}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={ui.btnDanger} onClick={() => setArmed(true)} disabled={busy !== null || !preview}>
              Run it for real…
            </button>
          )}
        </div>
        {!preview && !done && !armed ? <p className={styles.small}>Preview first; running unlocks once you&apos;ve seen what it would do.</p> : null}

        <div aria-live="polite">
          {error ? <Notice>{error}</Notice> : null}
          {note ? <Notice tone="info">{note}</Notice> : null}
          {done ? <Notice tone="ok">Evaluation {done.eval_date} ran. Cash, max shares and buybacks are live.</Notice> : null}
        </div>

        {shown ? <Summary report={shown} final={Boolean(done)} /> : null}
      </div>
    </Section>
  );
}

function Summary({ report, final }: { report: WeeklyEvaluation; final: boolean }) {
  return (
    <div className={styles.summary} data-final={final || undefined}>
      <span className={styles.kicker}>{final ? `Ran · ${report.eval_date}` : `Preview · would run as ${report.eval_date}`}</span>
      <dl className={styles.stats}>
        <div>
          <dt>Dividends</dt>
          <dd data-tone="up">{money(report.dividends_total ?? 0)}</dd>
          <small>{report.holders_paid} holders · {report.paying_count} stocks</small>
        </div>
        <div>
          <dt>Share fees</dt>
          <dd data-tone="down">{money(report.fees_total ?? 0)}</dd>
          <small>{report.holders_charged} holders · {report.charging_count} stocks</small>
        </div>
        <div>
          <dt>Flat</dt>
          <dd>{report.flat_count}</dd>
          <small>of {report.asset_count} stocks</small>
        </div>
        <div>
          <dt>Buybacks</dt>
          <dd>{report.buybacks_started.length}</dd>
          <small>{report.buybacks_closed.length} closing</small>
        </div>
      </dl>
      <div className={styles.lists}>
        <Rows title="Top dividends" rows={report.top_dividends} />
        <Rows title="Top fees" rows={report.top_fees} />
        {report.buybacks_started.length ? (
          <div>
            <h4>Buybacks starting</h4>
            <ul>
              {report.buybacks_started.map((entry) => (
                <li key={entry.symbol}>
                  <b>{entry.symbol}</b> {Math.round(entry.over).toLocaleString()} over max · frozen {money(entry.frozen_price)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {report.first_evaluation ? <p className={styles.small}>This is the first evaluation, so it never sets a max below what players already hold.</p> : null}
    </div>
  );
}

function Rows({ title, rows }: { title: string; rows: EvaluationRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {rows.map((row) => (
          <li key={row.symbol}>
            <b>{row.symbol}</b> {signedPct(row.rate, 2)} · {money(row.paid)}
          </li>
        ))}
      </ul>
    </div>
  );
}
