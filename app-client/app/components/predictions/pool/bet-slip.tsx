"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { money, outcomeColor } from "@/app/lib/predictions/format";
import { multiplierText, placeBet, previewBet, splitBet, type MarginStatus, type PoolDetail, type PoolOption } from "@/app/lib/predictions/pools";
import type { PredictionApiError } from "@/app/lib/predictions/api";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/pool/pool.module.scss";

const QUICK = [1000, 5000, 10000, 25000];

const MARGIN_WHY: Record<string, string> = {
  margin_account_too_new: "Margin opens once your account is 7 days old.",
  email_verification_required: "Verify your email to use margin.",
  account_suspended: "Margin is off while your account is suspended.",
  no_shares: "Margin is backed by your shares: hold some to get a line.",
  in_the_red: "You're already borrowing. Pay it back to borrow again.",
};

/** The red banner: what's owed, and what it does and doesn't stop. */
export function InTheRed({ margin, compact = false }: { margin: MarginStatus; compact?: boolean }) {
  if (!margin.in_red) return null;
  return (
    <div className={styles.red} role="status" data-compact={compact || undefined}>
      <div className={styles.redText}>
        <strong>In the red: you owe {money(margin.owed)}</strong>
        <p>Until it’s paid back you can’t bet or spend Credit. Winnings, dividends and any other Credit pay it back. Your cash isn’t touched, and you can keep trading stocks. No interest.</p>
      </div>
      {/* The owner's call on where this goes: delete this line, or move it, to change that. */}
      <Image className={styles.redArt} src="/predictions/in-the-red.webp" alt="" width={360} height={315} unoptimized />
    </div>
  );
}

export function BetSlip({ pool, choice, onPick, onPlaced }: { pool: PoolDetail; choice: PoolOption | null; onPick: (code: string) => void; onPlaced: () => void }) {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [useMargin, setUseMargin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mine = pool.mine;
  const value = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100) / 100;
  const valid = Number.isFinite(value) && value > 0;
  const myStake = choice ? (mine?.stakes.find((stake) => stake.outcome_id === choice.id)?.stake ?? 0) : 0;
  const preview = choice && valid ? previewBet({ total: pool.pool_total, optionTotal: choice.pool_stake, mine: myStake, amount: value }) : null;
  const usesCash = mine ? mine.wallet.spendable - Math.max(0, mine.wallet.credit) > 0.004 || mine.wallet.cash <= 0 : true;
  const split = valid ? splitBet(value, mine, usesCash) : { fromCredit: 0, fromCash: 0, borrowed: 0 };
  const margin = mine?.margin;
  const canBorrow = Boolean(margin && margin.available > 0 && split.borrowed > 0 && split.borrowed <= margin.available + 1e-9);
  const tooBig = split.borrowed > 0 && !canBorrow;
  const belowMin = valid && value < pool.min_bet;

  const place = async () => {
    if (!choice || !valid) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await placeBet(pool.slug, { outcome: choice.outcome_code, amount: value, use_margin: split.borrowed > 0 && useMargin });
      const borrowed = result.bet.borrowed > 0 ? ` ${money(result.bet.borrowed)} of it on margin.` : "";
      setDone(`${result.bet.stake_after > value ? "Raised to" : "Bet"} ${money(result.bet.stake_after, 0)} on ${result.bet.outcome_label}.${borrowed}`);
      setAmount("");
      setUseMargin(false);
      onPlaced();
    } catch (reason) {
      const body = (reason as PredictionApiError).body as Record<string, unknown> | undefined;
      const code = String((reason as Error).message);
      if (code === "invalid_amount" && body?.min_bet) setError(`The smallest bet here is ${money(Number(body.min_bet), 0)}.`);
      else if (code === "margin_line_exceeded") setError(`That borrows more than your margin line (${money(Number(body?.line ?? 0), 0)}).`);
      else if (code === "new_account_pool_cap") setError(`New accounts can have ${money(Number(body?.cap ?? 10000), 0)} in open pools for their first 7 days; you have ${money(Number(body?.staked ?? 0), 0)} in.`);
      else setError(predictionErrorText(reason));
    } finally {
      setBusy(false);
    }
  };

  let blocked: string | null = null;
  if (!user) blocked = "signin";
  else if (pool.can?.own_pool) blocked = "You run this pool, so you can't bet in it.";
  else if (!pool.betting_open) blocked = pool.status === "open" ? "Betting is shut on this pool." : "Betting has closed.";

  return (
    <div className={styles.slip}>
      <div className={styles.slipHead}>
        <h2>Bet slip</h2>
        {mine ? (
          <span className={styles.hint}>
            {money(mine.wallet.spendable, 0)} to bet{margin && margin.available > 0 ? ` + ${money(margin.available, 0)} margin` : ""}
          </span>
        ) : null}
      </div>

      {mine && margin ? <InTheRed margin={margin} compact /> : null}

      {blocked === "signin" ? (
        <p className={styles.small}>
          <Link href="/login">Sign in</Link> to bet.
        </p>
      ) : blocked ? (
        <p className={styles.small}>{blocked}</p>
      ) : margin?.in_red ? null : (
        <>
          <div className={styles.picker} role="radiogroup" aria-label="Option">
            {pool.options.length <= 8 ? (
              pool.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={choice?.id === option.id}
                  className={styles.pick}
                  style={{ "--oc": outcomeColor(pool, option) } as CSSProperties}
                  onClick={() => onPick(option.outcome_code)}
                >
                  <span>{option.label}</span>
                  <b>{multiplierText(option.multiplier)}</b>
                </button>
              ))
            ) : (
              <select className={styles.select} value={choice?.outcome_code ?? ""} onChange={(event) => onPick(event.target.value)} aria-label="Option">
                <option value="" disabled>
                  Pick an option
                </option>
                {pool.options.map((option) => (
                  <option key={option.id} value={option.outcome_code}>
                    {option.label} · {multiplierText(option.multiplier)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <label className={styles.amount}>
            <span>{myStake > 0 ? `Add to your ${money(myStake, 0)}` : "Amount"}</span>
            <input inputMode="decimal" placeholder={`${pool.min_bet.toLocaleString("en-US")} or more`} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <div className={styles.quick}>
            {QUICK.map((step) => (
              <button key={step} type="button" onClick={() => setAmount(String((valid ? value : 0) + step))}>
                +{step >= 1000 ? `${step / 1000}k` : step}
              </button>
            ))}
          </div>

          {choice && preview ? (
            <div className={styles.preview}>
              <div>
                <span>If {choice.label} wins</span>
                <b>{money(preview.payout)}</b>
              </div>
              <div>
                <span>Profit</span>
                <b data-tone={preview.profit > 0 ? "up" : "flat"}>{money(preview.profit)}</b>
              </div>
              <div>
                <span>Pays</span>
                <b>{multiplierText(preview.multiplier)}</b>
              </div>
              <p className={styles.small}>If the pool closed right after your bet. Odds keep moving until it closes.</p>
            </div>
          ) : null}

          {valid ? (
            <p className={styles.small}>
              From Credit {money(split.fromCredit)}
              {split.fromCash > 0 ? ` · from Cash ${money(split.fromCash)}` : ""}
              {split.borrowed > 0 ? ` · borrowed ${money(split.borrowed)}` : ""}
            </p>
          ) : null}

          {split.borrowed > 0 ? (
            canBorrow ? (
              <label className={styles.marginOpt}>
                <input type="checkbox" checked={useMargin} onChange={(event) => setUseMargin(event.target.checked)} />
                <span>
                  Borrow {money(split.borrowed)} on margin. Your line is {money(margin?.line ?? 0, 0)} ({Math.round((margin?.line_share ?? 0.25) * 100)}% of your shares). It takes your Credit below zero, and
                  until it’s paid back you can’t bet or spend Credit. Winnings and any other Credit pay it back. Your cash isn’t touched, and you can keep trading stocks. No interest.
                </span>
              </label>
            ) : (
              <p className={styles.warn}>
                That’s {money(split.borrowed)} more than you have.{" "}
                {margin && margin.available > 0 ? `Your margin line is ${money(margin.available, 0)}.` : (MARGIN_WHY[margin?.reason ?? ""] ?? "")}
              </p>
            )
          ) : null}

          {mine?.new_account ? (
            <p className={styles.small}>
              New accounts: {money(mine.new_account.staked, 0)} of {money(mine.new_account.cap, 0)} in open pools for your first 7 days.
            </p>
          ) : null}

          <button
            type="button"
            className={styles.primary}
            disabled={busy || !choice || !valid || belowMin || tooBig || (split.borrowed > 0 && !useMargin)}
            onClick={() => void place()}
          >
            {busy ? "Placing…" : !choice ? "Pick an option" : belowMin ? `Minimum ${money(pool.min_bet, 0)}` : valid ? `Bet ${money(value, 0)} on ${choice.label}` : "Enter an amount"}
          </button>
          <p className={styles.small}>Bets can be raised but not withdrawn.</p>
        </>
      )}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className={styles.done} role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}
