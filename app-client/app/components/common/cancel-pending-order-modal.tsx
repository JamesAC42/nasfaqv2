"use client";

import { FaBan } from "react-icons/fa6";
import { fmtInteger } from "@/app/lib/format";
import type { PortfolioOrder } from "@/app/lib/types";
import styles from "@/app/components/common/cancel-pending-order-modal.module.scss";

export function CancelPendingOrderModal({
  order,
  onClose,
  onConfirm,
  isCancelling,
  cancelError,
}: {
  order: PortfolioOrder | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isCancelling: boolean;
  cancelError: string | null;
}) {
  if (!order) return null;

  return (
    <div className={styles.cancelOverlay} onClick={onClose}>
      <div
        className={styles.cancelModal}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cancel-pending-order-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.cancelModalHeader}>
          <h2 id="cancel-pending-order-title" className={styles.cancelModalTitle}>
            Cancel Order
          </h2>
          <button type="button" className={styles.cancelModalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.cancelModalBody}>
          <p className={styles.cancelModalCopy}>
            Are you sure you want to cancel your <strong>{order.side.toUpperCase()}</strong> order for{" "}
            <strong>{fmtInteger(order.requested_quantity)} shares</strong> of <strong>{order.symbol}</strong>?
          </p>
          <p className={styles.cancelModalHint}>
            This order will not be executed in the next 10-minute batch tick. Cancellation cannot be undone.
          </p>
          {cancelError ? <div className={styles.cancelModalError}>Cancel failed: {cancelError}</div> : null}
          <div className={styles.cancelModalActions}>
            <button
              type="button"
              className={styles.cancelModalConfirmBtn}
              disabled={isCancelling}
              onClick={() => void onConfirm()}
            >
              {isCancelling ? "Cancelling..." : (
                <>
                  <FaBan /> Cancel Order
                </>
              )}
            </button>
            <button type="button" className={styles.cancelModalDismissBtn} onClick={onClose}>
              Keep Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
