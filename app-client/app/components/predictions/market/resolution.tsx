"use client";

import { useState, type CSSProperties } from "react";
import { evidenceText, useNow } from "@/app/components/predictions/market/shared";
import { disputeMarket } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { outcomeColor, timeAgo, timeLeft } from "@/app/lib/predictions/format";
import type { PredictionMarketDetail, Proposal } from "@/app/lib/predictions/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/market/market.module.scss";

const PROPOSAL_LABEL: Record<Proposal["status"], string> = {
  proposed: "Proposed",
  disputed: "Disputed",
  finalized: "Final",
  withdrawn: "Withdrawn",
  overturned: "Overturned",
};

const fmtDate = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Rules, the source, and every call made on this market, with disputes. */
export function RulesAndResolution({ market, onChanged }: { market: PredictionMarketDetail; onChanged: () => void }) {
  const now = useNow(1000);
  const auto = market.kind === "auto";
  const current = market.proposals.find((entry) => entry.status === "proposed" || entry.status === "disputed") ?? null;

  return (
    <section className={styles.section} aria-labelledby="rules-h">
      <div className={styles.sectionHead}>
        <h2 id="rules-h">Rules &amp; resolution</h2>
      </div>
      <div className={styles.rulesGrid}>
        <div className={styles.rules}>
          {market.description ? <p className={styles.description}>{market.description}</p> : null}
          <p>{market.rules_text}</p>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Source</dt>
            <dd>{market.resolution_source_text}</dd>
          </div>
          <div>
            <dt>Closes</dt>
            <dd>{fmtDate(market.closes_at)}</dd>
          </div>
          {!auto ? (
            <div>
              <dt>Dispute window</dt>
              <dd>{market.dispute_hours}h after a call</dd>
            </div>
          ) : null}
          <div>
            <dt>Made by</dt>
            <dd>{auto ? "The system, from NASFAQ data" : market.creator?.username ?? "staff"}{market.approver && market.approver.username !== market.creator?.username ? ` · approved by ${market.approver.username}` : ""}</dd>
          </div>
          <div>
            <dt>Fee · depth</dt>
            <dd>
              {market.fee_bps / 100}% · b {market.liquidity_b}
            </dd>
          </div>
        </dl>
      </div>

      <div className={styles.calls}>
        <h3>Calls</h3>
        {market.proposals.length ? (
          <ol className={styles.callList}>
            {market.proposals.map((proposal) => (
              <ProposalItem key={proposal.id} market={market} proposal={proposal} now={now} />
            ))}
          </ol>
        ) : (
          <p className={styles.fine}>
            {auto
              ? "No call yet. This one resolves itself from the data when it's in."
              : market.status === "open"
                ? `No call yet. After it closes, a resolver posts the result with a source and there's a ${market.dispute_hours}h window to dispute it.`
                : "No call yet. A resolver will post one with a source."}
          </p>
        )}
        {current ? <DisputeBox market={market} proposal={current} now={now} onChanged={onChanged} /> : null}
      </div>
    </section>
  );
}

function ProposalItem({ market, proposal, now }: { market: PredictionMarketDetail; proposal: Proposal; now: number }) {
  const outcome = market.outcomes.find((entry) => entry.outcome_code === proposal.outcome_code) ?? null;
  const color = proposal.is_void || !outcome ? "var(--dim)" : outcomeColor(market, outcome);
  const windowOpen = (proposal.status === "proposed" || proposal.status === "disputed") && new Date(proposal.window_ends_at).getTime() > now;
  const evidence = evidenceText(proposal.evidence);
  const system = !proposal.proposer;
  return (
    <li className={styles.proposal} data-status={proposal.status} style={{ "--oc": color } as CSSProperties}>
      <div className={styles.proposalTop}>
        <span className={styles.proposalStatus} data-status={proposal.status}>
          {PROPOSAL_LABEL[proposal.status]}
        </span>
        <strong>{proposal.is_void ? "VOID" : proposal.outcome_label ?? "?"}</strong>
        <span className={styles.proposalBy}>
          {system ? "by the system" : `by ${proposal.proposer?.username}`} · {timeAgo(proposal.created_at, now)} ago
        </span>
      </div>
      {evidence ? <p className={styles.evidence}>{evidence}</p> : null}
      {proposal.note && !(system && evidence) ? <p className={styles.proposalNote}>{proposal.note}</p> : null}
      {proposal.source_url ? (
        <a className={styles.source} href={proposal.source_url} target="_blank" rel="noopener noreferrer nofollow">
          {proposal.source_url.replace(/^https?:\/\//, "").slice(0, 60)}
        </a>
      ) : null}
      {windowOpen ? (
        <p className={styles.window}>
          Dispute window <b>{timeLeft(proposal.window_ends_at, now)}</b> left
          {proposal.status === "proposed" ? " · settles on its own if nobody disputes" : " · a resolver has to confirm or overturn"}
        </p>
      ) : null}
      {proposal.disputes.length ? (
        <ul className={styles.disputes}>
          {proposal.disputes.map((dispute) => (
            <li key={dispute.id}>
              <span>
                <b>{dispute.username}</b> disputed · {timeAgo(dispute.created_at, now)} ago
              </span>
              <q>{dispute.reason}</q>
            </li>
          ))}
        </ul>
      ) : null}
      {proposal.status === "finalized" ? (
        <p className={styles.final}>
          {proposal.confirmer ? <>Confirmed by {proposal.confirmer.username}</> : system ? <>Settled from the data</> : <>Nobody disputed; finalized automatically</>}
          {proposal.finalized_at ? <> · {fmtDate(proposal.finalized_at)}</> : null}
          {proposal.self_confirmed ? <span className={styles.flag}>self-confirmed</span> : null}
        </p>
      ) : null}
    </li>
  );
}

function DisputeBox({ market, proposal, now, onChanged }: { market: PredictionMarketDetail; proposal: Proposal; now: number; onChanged: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const windowOpen = new Date(proposal.window_ends_at).getTime() > now;
  const hasPosition = Boolean(market.mine?.positions.length);
  const already = Boolean(user && proposal.disputes.some((dispute) => dispute.username === user.username));
  if (!windowOpen || !user || !hasPosition || market.kind === "auto") return null;
  if (already || sent) return <p className={styles.fine}>You disputed this call. Staff will review it before it settles.</p>;

  const length = reason.trim().length;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await disputeMarket(market.id, reason.trim());
      setSent(true);
      onChanged();
    } catch (reason) {
      setError(predictionErrorText(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={styles.disputeBtn} onClick={() => setOpen(true)}>
        Dispute this call
      </button>
    );
  }
  return (
    <div className={styles.disputeForm}>
      <label htmlFor={`dispute-${market.id}`}>Why is this call wrong?</label>
      <textarea id={`dispute-${market.id}`} rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Point at the rules and the source. Disputes are public." />
      <div className={styles.disputeRow}>
        <span data-ok={length >= 20 || undefined}>{length}/20+</span>
        <button type="button" className={styles.miniBtn} onClick={() => setOpen(false)}>
          Never mind
        </button>
        <button type="button" className={styles.disputeGo} disabled={length < 20 || busy} onClick={submit}>
          {busy ? "Filing…" : "File dispute"}
        </button>
      </div>
      {error ? (
        <p className={styles.errorLine} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
