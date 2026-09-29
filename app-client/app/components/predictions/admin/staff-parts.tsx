"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useStaff } from "@/app/components/predictions/shell/predictions-frame";
import {
  approveMarket,
  closeMarket,
  confirmResolution,
  haltMarket,
  overturnResolution,
  proposeResolution,
  rejectMarket,
  resumeMarket,
  submitMarket,
  voidMarket,
  withdrawResolution,
} from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { money, outcomeColor, percent, timeAgo, timeLeft } from "@/app/lib/predictions/format";
import type { AdminMarket, PredictionMarket, PredictionMarketDetail } from "@/app/lib/predictions/types";
import styles from "@/app/components/predictions/admin/staff.module.scss";

// Building blocks shared by the market page's StaffActions panel and the /predictions/manage
// console: permission flags, the call card, the propose/overturn form and the action groups.
// Every action disables while in flight, shows errors inline and then calls onChanged().

// ── Flags and helpers ──────────────────────────────────────────────────────
export type StaffFlags = { isAdmin: boolean; canApprove: boolean; canResolve: boolean; canVoid: boolean; canCreate: boolean; username: string | null };

export function useStaffFlags(): StaffFlags & { isStaff: boolean } {
  const { user, isStaff, isAdmin, canCreate } = useStaff();
  const u = (user ?? null) as (Record<string, unknown> & { username?: string }) | null;
  return {
    isStaff,
    isAdmin,
    canCreate,
    canApprove: Boolean(isAdmin || u?.can_approve_prediction_markets),
    canResolve: Boolean(isAdmin || u?.can_resolve_prediction_markets),
    canVoid: Boolean(isAdmin || u?.can_void_prediction_markets),
    username: u?.username ? String(u.username) : null,
  };
}

/** Re-renders every `ms` so countdowns tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** One in-flight action at a time per group, with its error. */
export function useRun(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(key);
    setError(null);
    try {
      await action();
      setBusy(null);
      onChanged();
      return true;
    } catch (caught) {
      setError(predictionErrorText(caught));
      setBusy(null);
      return false;
    }
  };
  return { busy, error, setError, run };
}

export const UNRESOLVED = ["draft", "pending_approval", "rejected", "open", "closed", "resolving", "proposed", "disputed"];

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

function hostOf(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.length > 1 ? parsed.pathname : ""}`;
  } catch {
    return url;
  }
}

// ── The current call ───────────────────────────────────────────────────────
export type CallView = {
  status: string;
  is_void: boolean;
  outcome_code: string | null;
  outcome_label: string | null;
  source_url: string | null;
  note: string | null;
  window_ends_at: string;
  created_at: string | null;
  proposer: string | null;
  disputes: { username: string; reason: string; created_at: string }[];
};

export function callFromDetail(market: PredictionMarketDetail): CallView | null {
  const proposal = market.proposals?.find((entry) => entry.status === "proposed" || entry.status === "disputed");
  if (!proposal) return null;
  return {
    status: proposal.status,
    is_void: proposal.is_void,
    outcome_code: proposal.outcome_code,
    outcome_label: proposal.outcome_label,
    source_url: proposal.source_url,
    note: proposal.note,
    window_ends_at: proposal.window_ends_at,
    created_at: proposal.created_at,
    proposer: proposal.proposer?.username ?? null,
    disputes: proposal.disputes.map((dispute) => ({ username: dispute.username, reason: dispute.reason, created_at: dispute.created_at })),
  };
}

export function callFromAdmin(market: AdminMarket): CallView | null {
  const proposal = market.proposal;
  if (!proposal) return null;
  return { ...proposal, created_at: proposal.created_at ?? null, disputes: proposal.disputes ?? [] };
}

export function Countdown({ to, now, prefix }: { to: string; now: number; prefix?: string }) {
  const ms = new Date(to).getTime() - now;
  const tone = ms <= 0 ? "done" : ms < 3_600_000 ? "soon" : "live";
  return (
    <span className={styles.countdown} data-tone={tone}>
      {prefix ? <small>{prefix}</small> : null}
      {ms <= 0 ? "ended" : timeLeft(to, now)}
    </span>
  );
}

/** A coloured outcome tag ("● Yes"), or a dashed VOID tag. */
export function OutcomeTag({ market, code, label }: { market: Pick<PredictionMarket, "market_type" | "outcomes">; code: string | null; label?: string | null }) {
  if (!code || code === "void") return <span className={`${styles.tag} ${styles.tagVoid}`}>Void</span>;
  const outcome = market.outcomes.find((entry) => entry.outcome_code === code);
  const color = outcome ? outcomeColor(market, outcome) : "var(--mid)";
  return (
    <span className={styles.tag} style={{ ["--oc" as string]: color }}>
      <i aria-hidden="true" />
      {label ?? outcome?.label ?? code}
    </span>
  );
}

export function CallCard({ market, call, now, compact = false }: { market: PredictionMarket; call: CallView; now: number; compact?: boolean }) {
  const disputed = call.status === "disputed" || call.disputes.length > 0;
  const windowOpen = new Date(call.window_ends_at).getTime() > now;
  return (
    <div className={styles.call} data-disputed={disputed || undefined}>
      <div className={styles.callHead}>
        <span className={styles.callKicker}>{disputed ? "Disputed call" : "Call"}</span>
        <OutcomeTag market={market} code={call.is_void ? "void" : call.outcome_code} label={call.outcome_label} />
        <span className={styles.callBy}>
          by <b>{call.proposer ?? "the system"}</b>
          {call.created_at ? <> · {timeAgo(call.created_at, now)} ago</> : null}
        </span>
      </div>
      <div className={styles.callWindow}>
        {windowOpen ? (
          <>
            <Countdown to={call.window_ends_at} now={now} prefix="Window" />
            <span className={styles.dimNote}>{disputed ? "needs a resolver to confirm or overturn" : "settles on its own when it ends"}</span>
          </>
        ) : (
          <span className={styles.dimNote}>{disputed ? "Window closed. Waiting on a resolver." : "Window closed. Settles on the next sweep."}</span>
        )}
      </div>
      {call.source_url ? (
        <a className={styles.source} href={call.source_url} target="_blank" rel="noreferrer noopener">
          <span>Source</span>
          {hostOf(call.source_url)} ↗
        </a>
      ) : null}
      {call.note ? <p className={styles.note}>“{call.note}”</p> : null}
      {call.disputes.length ? (
        <ul className={styles.disputes} aria-label={`${call.disputes.length} dispute${call.disputes.length === 1 ? "" : "s"}`}>
          {call.disputes.slice(0, compact ? 2 : 20).map((dispute, index) => (
            <li key={`${dispute.username}-${index}`}>
              <span>
                <b>{dispute.username}</b> · {timeAgo(dispute.created_at, now)} ago
              </span>
              <p>{dispute.reason}</p>
            </li>
          ))}
          {compact && call.disputes.length > 2 ? <li className={styles.dimNote}>+{call.disputes.length - 2} more on the market page</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

// ── Inline two-step confirm (with an optional reason) ──────────────────────
export function TwoStep({
  label,
  prompt,
  confirmLabel,
  reason,
  tone = "neutral",
  disabled,
  busy,
  onConfirm,
}: {
  label: ReactNode;
  prompt: ReactNode;
  confirmLabel: string;
  reason?: { placeholder: string; min?: number };
  tone?: "neutral" | "danger" | "primary";
  disabled?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => Promise<boolean> | void;
}) {
  const [armed, setArmed] = useState(false);
  const [text, setText] = useState("");
  const id = useId();
  const min = reason?.min ?? 3;
  const ready = !reason || text.trim().length >= min;

  if (!armed) {
    return (
      <button type="button" className={styles.btn} data-tone={tone === "danger" ? "danger" : undefined} disabled={disabled || busy} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const ok = await onConfirm(text.trim());
    if (ok !== false) {
      setArmed(false);
      setText("");
    }
  };

  return (
    <form className={styles.confirm} data-tone={tone} onSubmit={submit}>
      <p id={`${id}-p`}>{prompt}</p>
      {reason ? (
        <input
          className={styles.input}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={reason.placeholder}
          aria-labelledby={`${id}-p`}
          maxLength={2000}
          autoFocus
        />
      ) : null}
      <div className={styles.row}>
        <button type="submit" className={styles.btn} data-tone={tone === "danger" ? "dangerSolid" : "primary"} disabled={!ready || busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
        <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => setArmed(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return (
    <p className={styles.error} role="alert" aria-live="polite" hidden={!error}>
      {error}
    </p>
  );
}

// ── Propose / overturn form ────────────────────────────────────────────────
export function CallForm({
  market,
  mode,
  disputeHours,
  exclude,
  onDone,
  onCancel,
}: {
  market: PredictionMarket;
  mode: "propose" | "overturn";
  disputeHours?: number;
  /** The standing call, when overturning (pre-selects nothing, marks it "current"). */
  exclude?: string | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useRun(onDone);
  const id = useId();
  const sourceOk = isHttpUrl(source);
  const choices = [...market.outcomes.map((entry) => ({ code: entry.outcome_code, label: entry.label, color: outcomeColor(market, entry), price: entry.price })), { code: "void", label: "Void", color: null, price: null }];
  const picked = choices.find((choice) => choice.code === outcome);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!outcome || !sourceOk) return;
    const body = { outcome, source_url: source.trim(), note: note.trim() || undefined };
    void run(mode, () => (mode === "propose" ? proposeResolution(market.id, body) : overturnResolution(market.id, body)));
  };

  return (
    <form className={styles.callForm} onSubmit={submit} noValidate>
      <fieldset className={styles.picker}>
        <legend>{mode === "overturn" ? "New call" : "Winning outcome"}</legend>
        <div className={styles.choices}>
          {choices.map((choice) => (
            <label key={choice.code} className={styles.choice} data-void={choice.code === "void" || undefined} style={choice.color ? { ["--oc" as string]: choice.color } : undefined}>
              <input type="radio" name={`${id}-outcome`} value={choice.code} checked={outcome === choice.code} onChange={() => setOutcome(choice.code)} />
              <i aria-hidden="true" />
              <span>{choice.label}</span>
              {choice.price !== null ? <small>{percent(choice.price)}</small> : null}
              {exclude && choice.code === exclude ? <em>current</em> : null}
            </label>
          ))}
        </div>
        {touched && !outcome ? <p className={styles.fieldError}>Pick the outcome that happened, or Void.</p> : null}
      </fieldset>
      <label className={styles.field}>
        <span>Source link</span>
        <input
          className={styles.input}
          type="url"
          inputMode="url"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="https://…"
          aria-invalid={touched && !sourceOk ? true : undefined}
          required
        />
        {touched && !sourceOk ? <em className={styles.fieldError}>{source.trim() ? "Use a full http(s) link." : "A source link is required."}</em> : null}
      </label>
      <label className={styles.field}>
        <span>Note (optional)</span>
        <input className={styles.input} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Peaked at 104k at 21:40 JST." maxLength={2000} />
      </label>
      <p className={styles.dimNote}>
        {market.status === "open" ? "Trading closes the moment you propose. " : ""}
        {mode === "overturn" ? "The current call is thrown out and a fresh " : "Opens a "}
        {disputeHours ? `${disputeHours}h` : ""} dispute window; if nobody disputes, it settles on its own.
      </p>
      <ErrorLine error={error} />
      <div className={styles.row}>
        <button type="submit" className={styles.btn} data-tone="primary" disabled={Boolean(busy)}>
          {busy ? "Posting…" : `${mode === "overturn" ? "Overturn to" : "Propose"} ${picked ? picked.label : "call"}`}
        </button>
        {onCancel ? (
          <button type="button" className={styles.btnGhost} onClick={onCancel} disabled={Boolean(busy)}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ── Action groups ──────────────────────────────────────────────────────────
type GroupProps = { market: PredictionMarket; onChanged: () => void; flags: StaffFlags };

/** pending_approval: approve / reject with a reason. */
export function ApprovalActions({ market, creator, onChanged, flags }: GroupProps & { creator: string | null }) {
  const { busy, error, run } = useRun(onChanged);
  if (!flags.canApprove) return null;
  const own = Boolean(creator && flags.username && creator === flags.username);
  const blocked = own && !flags.isAdmin;
  return (
    <div className={styles.group}>
      <div className={styles.row}>
        <button type="button" className={styles.btn} data-tone="primary" disabled={Boolean(busy) || blocked} onClick={() => void run("approve", () => approveMarket(market.id))}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
        <TwoStep
          label="Reject"
          prompt="Why? The creator sees this."
          confirmLabel="Reject market"
          reason={{ placeholder: "Rules are ambiguous about collabs", min: 3 }}
          tone="danger"
          busy={busy === "reject"}
          disabled={Boolean(busy)}
          onConfirm={(reason) => run("reject", () => rejectMarket(market.id, reason))}
        />
      </div>
      {own ? <p className={styles.dimNote}>{blocked ? "You made this one; someone else has to approve it." : "You made this one. Site admins can approve their own."}</p> : null}
      <ErrorLine error={error} />
    </div>
  );
}

/** open: close early, halt / resume. */
export function LiveActions({ market, onChanged, flags }: GroupProps) {
  const { busy, error, run } = useRun(onChanged);
  if (!flags.canResolve) return null;
  const halted = market.trading_status === "halted";
  return (
    <div className={styles.group}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.btn}
          data-tone={halted ? "primary" : undefined}
          disabled={Boolean(busy)}
          onClick={() => void run("halt", () => (halted ? resumeMarket(market.id) : haltMarket(market.id)))}
        >
          {busy === "halt" ? "…" : halted ? "Resume trading" : "Halt"}
        </button>
        <TwoStep
          label="Close early"
          prompt="Stop trading now? Resting orders are released. It waits for a call after."
          confirmLabel="Close trading"
          busy={busy === "close"}
          disabled={Boolean(busy)}
          onConfirm={() => run("close", () => closeMarket(market.id))}
        />
      </div>
      {halted ? <p className={styles.warnNote}>Trading is halted. Nobody can trade until you resume.</p> : null}
      <ErrorLine error={error} />
    </div>
  );
}

/** proposed / disputed: confirm, overturn, withdraw. */
export function ProposalActions({ market, call, onChanged, flags, disputeHours }: GroupProps & { call: CallView; disputeHours?: number }) {
  const { busy, error, run } = useRun(onChanged);
  const [overturning, setOverturning] = useState(false);
  if (!flags.canResolve) return null;
  const disputed = call.status === "disputed" || call.disputes.length > 0;
  const mine = Boolean(call.proposer && flags.username && call.proposer === flags.username);
  const blocked = disputed && mine && !flags.isAdmin;
  const callName = call.is_void ? "Void" : (call.outcome_label ?? call.outcome_code ?? "the call");

  return (
    <div className={styles.group}>
      {overturning ? (
        <CallForm
          market={market}
          mode="overturn"
          disputeHours={disputeHours}
          exclude={call.is_void ? "void" : call.outcome_code}
          onDone={() => {
            setOverturning(false);
            onChanged();
          }}
          onCancel={() => setOverturning(false)}
        />
      ) : (
        <>
          <div className={styles.row}>
            <TwoStep
              label={`Confirm ${callName}`}
              prompt={
                <>
                  {call.is_void ? "Void it and refund everyone's net cost now?" : `Settle as ${callName} now? Winning shares pay $1.`}
                  {disputed && mine ? " You made this call; as a site admin you can confirm it, and the timeline flags it as self-confirmed." : ""}
                  {!disputed ? " Skips the rest of the window." : ""}
                </>
              }
              confirmLabel={call.is_void ? "Void and refund" : `Settle ${callName}`}
              tone="primary"
              busy={busy === "confirm"}
              disabled={Boolean(busy) || blocked}
              onConfirm={() => run("confirm", () => confirmResolution(market.id))}
            />
            <button type="button" className={styles.btn} disabled={Boolean(busy)} onClick={() => setOverturning(true)}>
              Overturn
            </button>
            <TwoStep
              label="Withdraw"
              prompt="Pull this call? The market goes back to awaiting a call."
              confirmLabel="Withdraw call"
              busy={busy === "withdraw"}
              disabled={Boolean(busy)}
              onConfirm={() => run("withdraw", () => withdrawResolution(market.id))}
            />
          </div>
          {blocked ? <p className={styles.dimNote}>You proposed this disputed call, so a different resolver has to confirm it.</p> : null}
          {disputed && mine && flags.isAdmin ? <p className={styles.warnNote}>Your own disputed call: confirming is allowed for site admins and gets flagged on the timeline.</p> : null}
        </>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/** A "Propose a call" button that unfolds the form. */
export function ProposeToggle({ market, onChanged, flags, disputeHours, label = "Propose a call" }: GroupProps & { disputeHours?: number; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!flags.canResolve) return null;
  if (!open) {
    return (
      <button type="button" className={styles.btn} data-tone={market.status === "open" ? undefined : "primary"} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className={styles.unfold}>
      <CallForm
        market={market}
        mode="propose"
        disputeHours={disputeHours}
        onDone={() => {
          setOpen(false);
          onChanged();
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

/** Any unresolved market: void with a reason. */
export function VoidAction({ market, onChanged, flags, compact = false }: GroupProps & { compact?: boolean }) {
  const { busy, error, run } = useRun(onChanged);
  if (!flags.canVoid || !UNRESOLVED.includes(market.status)) return null;
  return (
    <div className={styles.group} data-compact={compact || undefined}>
      <TwoStep
        label="Void"
        prompt="Void the market? Everyone gets their net cost back and it can't be undone."
        confirmLabel="Void and refund"
        reason={{ placeholder: "Reason (shown on the timeline)", min: 3 }}
        tone="danger"
        busy={Boolean(busy)}
        onConfirm={(reason) => run("void", () => voidMarket(market.id, reason))}
      />
      <ErrorLine error={error} />
    </div>
  );
}

/** draft / rejected: send it to the approval queue. */
export function SubmitAction({ market, creator, onChanged, flags }: GroupProps & { creator: string | null }) {
  const { busy, error, run } = useRun(onChanged);
  if (!flags.isAdmin && !(creator && creator === flags.username)) return null;
  return (
    <div className={styles.group}>
      <button type="button" className={styles.btn} disabled={Boolean(busy)} onClick={() => void run("submit", () => submitMarket(market.id))}>
        {busy ? "Submitting…" : "Submit for approval"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

/** House numbers: net cash (cash in minus cash out) and the LMSR worst case. */
export function HouseNumbers({ net, maxLoss, market }: { net: number | null | undefined; maxLoss: number; market: Pick<PredictionMarket, "liquidity_b" | "fee_bps" | "total_volume_cash"> }) {
  return (
    <dl className={styles.house}>
      <div>
        <dt>House net</dt>
        <dd data-tone={net === null || net === undefined ? undefined : net > 0 ? "up" : net < 0 ? "down" : undefined}>
          {net === null || net === undefined ? "—" : `${net > 0 ? "+" : ""}${money(net)}`}
        </dd>
      </div>
      <div>
        <dt>Worst case</dt>
        <dd>{money(maxLoss, 0)}</dd>
      </div>
      <div>
        <dt>Volume</dt>
        <dd>{money(market.total_volume_cash, 0)}</dd>
      </div>
      <div>
        <dt>b · fee</dt>
        <dd>
          {Math.round(market.liquidity_b)} · {(market.fee_bps / 100).toFixed(market.fee_bps % 100 ? 2 : 0)}%
        </dd>
      </div>
    </dl>
  );
}

export function MarketLink({ market, children }: { market: Pick<PredictionMarket, "slug">; children: ReactNode }) {
  return (
    <Link href={`/predictions/${market.slug}`} className={styles.marketLink}>
      {children}
    </Link>
  );
}
