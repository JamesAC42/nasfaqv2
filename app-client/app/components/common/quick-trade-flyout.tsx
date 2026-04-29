"use client";

import { createPortal } from "react-dom";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FaXmark } from "react-icons/fa6";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/app/lib/format";
import type { MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import drawerStyles from "@/app/components/pages/stocks-page.module.scss";
import detailStyles from "@/app/components/pages/stock-detail-page.module.scss";

type TradeSide = "buy" | "sell";

type TradeFailureNotice = {
  title: string;
  message: string;
};

const QUICK_TRADE_CLOSE_ANIMATION_MS = 170;

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${fmtNumber(value)}`;
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value), "$")}`;
}

function getTradeFailureNotice(errorCode: string, side: TradeSide, symbol: string): TradeFailureNotice {
  switch (errorCode) {
    case "insufficient_cash":
      return {
        title: "Not enough cash",
        message: `You do not have enough cash available to buy ${symbol}. Reduce the share count or add funds to your account balance.`,
      };
    case "insufficient_holdings":
      return {
        title: "Not enough shares",
        message: `You tried to sell more ${symbol} shares than you currently own. Lower the order size and try again.`,
      };
    case "market_closed":
      return {
        title: "Market is closed",
        message: "Trading is unavailable right now. Wait for the market to reopen, then submit the order again.",
      };
    case "invalid_quantity":
      return {
        title: "Invalid order size",
        message: `Enter a valid number of ${symbol} shares before submitting this ${side} order.`,
      };
    case "live_order_limit_exceeded":
      return {
        title: "Live order limit reached",
        message: "You have already submitted the maximum number of live orders for this market interval.",
      };
    default:
      return {
        title: "Trade failed",
        message: `This ${side} order for ${symbol} could not be completed. Please try again.`,
      };
  }
}

export function QuickTradeFlyout({
  asset,
  onClose,
  onTradeComplete,
}: {
  asset: MarketAsset;
  onClose: () => void;
  onTradeComplete?: () => Promise<void> | void;
}) {
  const { user } = useAuth();
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const fetchPortfolioOrders = useProfileStore((state) => state.fetchPortfolioOrders);
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [quantity, setQuantity] = useState("10");
  const [failureNotice, setFailureNotice] = useState<TradeFailureNotice | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) void fetchPortfolio();
  }, [fetchPortfolio, user]);

  const holding = useMemo(
    () => portfolio?.holdings.find((item) => item.symbol === asset.symbol) || null,
    [asset.symbol, portfolio?.holdings]
  );
  const estimatedNotional = (asset.current_mid_price ?? 0) * Math.max(Number(quantity) || 0, 0);
  const tradingOpen = marketStatus?.is_trading_open ?? true;
  const needsVerification = userNeedsEmailVerification(user);

  function closeWithAnimation() {
    if (isClosing) return;
    setIsClosing(true);
    globalThis.setTimeout(onClose, QUICK_TRADE_CLOSE_ANIMATION_MS);
  }

  async function handleTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      setFailureNotice({
        title: "Sign in required",
        message: "Sign in to trade and manage your portfolio.",
      });
      return;
    }
    if (needsVerification) {
      setFailureNotice({
        title: "Email verification required",
        message: "Verify your email before you can trade.",
      });
      return;
    }
    if (!tradingOpen) {
      setFailureNotice({
        title: "Market is closed",
        message: marketStatus?.trading_message || "Trading is unavailable right now. Wait for the market to reopen, then submit the order again.",
      });
      return;
    }

    setIsSubmitting(true);
    setFailureNotice(null);
    try {
      await apiFetch(`/api/market/orders/${tradeSide}`, {
        method: "POST",
        body: JSON.stringify({ symbol: asset.symbol, quantity: Number(quantity) }),
      });
      await Promise.all([fetchPortfolio(), fetchPortfolioOrders(), onTradeComplete?.()]);
      closeWithAnimation();
    } catch (error) {
      const errorCode = String((error as Error).message || error);
      setFailureNotice(getTradeFailureNotice(errorCode, tradeSide, asset.symbol));
    } finally {
      setIsSubmitting(false);
    }
  }

  const flyout = (
    <>
      <div className={`${drawerStyles.quickTradeBackdrop} ${isClosing ? drawerStyles.quickTradeBackdropClosing : ""}`.trim()} onClick={closeWithAnimation}>
        <div
          className={`${drawerStyles.quickTradeMascot} ${isClosing ? drawerStyles.quickTradeMascotClosing : ""}`.trim()}
          aria-hidden="true"
        >
          <Image src="/suisus.png" alt="" fill sizes="11rem" priority={false} />
        </div>
        <aside className={`${drawerStyles.quickTradeDrawer} ${isClosing ? drawerStyles.quickTradeDrawerClosing : ""}`.trim()} aria-label={`Quick trade ${asset.symbol}`} onClick={(event) => event.stopPropagation()}>
          <div className={drawerStyles.quickTradeCloseRow}>
            <button type="button" className={drawerStyles.drawerClose} onClick={closeWithAnimation} aria-label="Close quick trade">
              <FaXmark aria-hidden="true" />
            </button>
          </div>
          <section className={drawerStyles.quickTradePanel}>
            <div className={detailStyles.tradePanelContent}>
              <div className={detailStyles.sectionHeader}>
                <div className={drawerStyles.quickTradeTitleGroup}>
                  <AssetCoin
                    symbol={asset.symbol}
                    icon={asset.icon ?? null}
                    color={asset.color ?? null}
                    className={drawerStyles.quickTradeHeaderCoin}
                    shape="circle"
                  />
                  <div>
                    <h2 className={detailStyles.sectionTitle}>Trade {asset.symbol}</h2>
                  </div>
                </div>
              </div>

              {!user ? (
                <div className={detailStyles.emptyState}>Sign in to trade and load your portfolio context.</div>
              ) : (
                <>
                  <div className={`${detailStyles.statGrid} ${detailStyles.portfolioGrid}`}>
                    <div className={detailStyles.infoCard}><span>Cash</span><strong>{fmtNumber(portfolio?.cash_balance ?? null, "$")}</strong></div>
                    <div className={detailStyles.infoCard}><span>Shares owned</span><strong>{fmtNumber(holding?.quantity ?? 0)}</strong></div>
                    <div className={detailStyles.infoCard}><span>Position value</span><strong>{fmtNumber(holding?.market_value ?? 0, "$")}</strong></div>
                    <div className={detailStyles.infoCard}><span>Avg cost</span><strong>{fmtNumber(holding?.avg_cost_basis ?? 0, "$")}</strong></div>
                    <div className={detailStyles.infoCard}><span>Unrealized PNL</span><strong>{formatSignedCurrency(holding?.unrealized_pnl ?? 0)}</strong></div>
                    <div className={detailStyles.infoCard}><span>Order value</span><strong>{fmtNumber(estimatedNotional, "$")}</strong></div>
                  </div>

                  {needsVerification ? <VerificationRequiredNotice action="trade" /> : null}

                  <form className={detailStyles.tradeForm} onSubmit={(event) => void handleTrade(event)}>
                    <div className={detailStyles.sideToggle}>
                      <button type="button" className={tradeSide === "buy" ? detailStyles.sideToggleActiveBuy : detailStyles.sideToggleButton} onClick={() => setTradeSide("buy")}>
                        Buy
                      </button>
                      <button type="button" className={tradeSide === "sell" ? detailStyles.sideToggleActiveSell : detailStyles.sideToggleButton} onClick={() => setTradeSide("sell")}>
                        Sell
                      </button>
                    </div>

                    <label className={detailStyles.tradeField}>
                      <span>Quantity</span>
                      <input
                        className={detailStyles.tradeInput}
                        value={quantity}
                        inputMode="decimal"
                        disabled={!tradingOpen || isSubmitting}
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </label>

                    <div className={detailStyles.tradePresets}>
                      {["10", "25", "50", "100"].map((preset) => (
                        <button key={preset} type="button" className={detailStyles.presetButton} onClick={() => setQuantity(preset)}>
                          {preset}
                        </button>
                      ))}
                    </div>

                    <div className={detailStyles.tradeSummary}>
                      <div><span>Mid</span><strong>{formatPrice(asset.current_mid_price)}</strong></div>
                      <div><span>Bid / Ask</span><strong>{formatPrice(asset.current_bid_price)} / {formatPrice(asset.current_ask_price)}</strong></div>
                      <div><span>Premium</span><strong>{fmtPct(asset.current_premium_pct)}</strong></div>
                    </div>

                    <div className={detailStyles.liveOrderQueue}>
                      <div>
                        <span>Next Tick Queue</span>
                        <strong>{fmtNumber(asset.pending_live_order_count ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Buy Orders</span>
                        <strong className={detailStyles.valueUp}>{fmtNumber(asset.pending_live_buy_count ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Sell Orders</span>
                        <strong className={detailStyles.valueDown}>{fmtNumber(asset.pending_live_sell_count ?? 0)}</strong>
                      </div>
                      <p>
                        {asset.next_live_order_execute_after
                          ? `Queued live orders execute around ${fmtDate(asset.next_live_order_execute_after)}.`
                          : "No live orders are queued for this asset right now."}
                      </p>
                    </div>

                    <button
                      type="submit"
                      className={tradeSide === "buy" ? detailStyles.tradeSubmitBuy : detailStyles.tradeSubmitSell}
                      disabled={!user || needsVerification || !tradingOpen || isSubmitting}
                    >
                      {isSubmitting ? "Submitting..." : tradingOpen ? `${tradeSide === "buy" ? "Submit Buy" : "Submit Sell"} Order` : "Market Closed"}
                    </button>
                  </form>

                  {!tradingOpen ? (
                    <div className="statusMessage statusMessageWarn">
                      <strong>Trading paused.</strong> {marketStatus?.trading_message || "Trading is temporarily unavailable while the market settles."}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </aside>
      </div>

      {failureNotice ? (
        <div className={detailStyles.tradeFailureOverlay} onClick={() => setFailureNotice(null)}>
          <div
            className={detailStyles.tradeFailureModal}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="quick-trade-failure-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={detailStyles.tradeFailureHeader}>
              <h2 id="quick-trade-failure-title" className={detailStyles.tradeFailureTitle}>{failureNotice.title}</h2>
              <button
                type="button"
                className={detailStyles.tradeConfirmationClose}
                onClick={() => setFailureNotice(null)}
                aria-label="Close trade failure notice"
              >
                ×
              </button>
            </div>
            <div className={detailStyles.tradeFailureBody}>
              <p className={detailStyles.tradeFailureCopy}>{failureNotice.message}</p>
              <div className={detailStyles.tradeConfirmationActions}>
                <button type="button" className={detailStyles.tradeFailurePrimary} onClick={() => setFailureNotice(null)}>
                  Back to order ticket
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return typeof document === "undefined" ? null : createPortal(flyout, document.body);
}
