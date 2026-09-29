"use client";

import type { ReactNode } from "react";
import {
  ApprovalActions,
  CallCard,
  HouseNumbers,
  LiveActions,
  ProposalActions,
  ProposeToggle,
  SubmitAction,
  VoidAction,
  callFromDetail,
  useNow,
  useStaffFlags,
} from "@/app/components/predictions/admin/staff-parts";
import { STATUS_LABEL } from "@/app/lib/predictions/format";
import type { PredictionMarketDetail } from "@/app/lib/predictions/types";
import styles from "@/app/components/predictions/admin/staff.module.scss";

/**
 * Staff controls for one market (close early, halt/resume, propose / confirm / overturn /
 * withdraw a call, void). Rendered on the market page for users with a staff flag; shows only
 * what the market's status and the user's flags allow.
 */
export function StaffActions({ market, onChanged }: { market: PredictionMarketDetail; onChanged: () => void }) {
  const flags = useStaffFlags();
  const now = useNow();
  if (!flags.isStaff) return null;

  const status = market.status;
  const call = status === "proposed" || status === "disputed" ? callFromDetail(market) : null;
  const creator = market.creator?.username ?? null;
  const common = { market, onChanged, flags };
  const halted = market.trading_status === "halted";

  let body: ReactNode = null;
  if (status === "pending_approval") {
    body = <ApprovalActions {...common} creator={creator} />;
  } else if (status === "draft" || status === "rejected") {
    body = <SubmitAction {...common} creator={creator} />;
  } else if (status === "open") {
    body = (
      <>
        <LiveActions {...common} />
        <ProposeToggle {...common} disputeHours={market.dispute_hours} label="Propose a call (closes it)" />
      </>
    );
  } else if (status === "closed" || status === "resolving") {
    body = <ProposeToggle {...common} disputeHours={market.dispute_hours} />;
  } else if (call) {
    body = (
      <>
        <CallCard market={market} call={call} now={now} />
        <ProposalActions {...common} call={call} disputeHours={market.dispute_hours} />
      </>
    );
  }

  const settled = status === "resolved" || status === "voided";

  return (
    <section className={styles.panel} aria-label="Staff controls">
      <header className={styles.panelHead}>
        <h2>Staff</h2>
        <span className={styles.status} data-status={halted ? "halted" : status}>
          {STATUS_LABEL[status] ?? status}
          {halted ? " · halted" : ""}
        </span>
        {market.kind === "auto" ? <span className={styles.autoTag}>auto</span> : null}
      </header>
      <HouseNumbers net={market.admin?.house_net_cash} maxLoss={market.max_house_loss} market={market} />
      {body ? <div className={styles.panelBody}>{body}</div> : null}
      {settled ? <p className={styles.dimNote}>{status === "resolved" ? "Settled. Nothing left to do here." : "Voided and refunded. Nothing left to do here."}</p> : null}
      {!settled ? (
        <div className={styles.panelFoot}>
          <VoidAction {...common} compact />
        </div>
      ) : null}
    </section>
  );
}
