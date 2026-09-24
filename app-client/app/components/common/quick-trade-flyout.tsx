"use client";

import { createPortal } from "react-dom";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FaXmark } from "react-icons/fa6";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtNumber, fmtPct } from "@/app/lib/format";
import { buildTradeConfirmation, getTradeFailureNotice, type TradeConfirmation, type TradeExecutionResult, type TradeFailureNotice, type TradeSide } from "@/app/lib/trade";
import type { MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import drawerStyles from "@/app/components/pages/stocks-page.module.scss";
import detailStyles from "@/app/components/pages/stock-detail-page.module.scss";

const QUICK_TRADE_CLOSE_ANIMATION_MS = 170;
const TRADE_CONFIRMATION_ANIMATION_MS = 280;
const TRADE_QUANTITY_PRESETS = ["1", "10", "25", "50", "100"] as const;

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${fmtNumber(value)}`;
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value), "$")}`;
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
  const [lastQuantityPreset, setLastQuantityPreset] = useState<string | null>(null);
  const [failureNotice, setFailureNotice] = useState<TradeFailureNotice | null>(null);
  const [tradeConfirmation, setTradeConfirmation] = useState<TradeConfirmation | null>(null);
  const [isTradeConfirmationClosing, setIsTradeConfirmationClosing] = useState(false);
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

  function closeTradeConfirmation() {
    if (!tradeConfirmation || isTradeConfirmationClosing) return;
    setIsTradeConfirmationClosing(true);
    globalThis.setTimeout(() => {
      setTradeConfirmation(null);
      setIsTradeConfirmationClosing(false);
      closeWithAnimation();
    }, TRADE_CONFIRMATION_ANIMATION_MS);
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
    setTradeConfirmation(null);
    setIsTradeConfirmationClosing(false);
    try {
      const previousHolding = holding;
      const result = await apiFetch<TradeExecutionResult>(`/api/market/orders/${tradeSide}`, {
        method: "POST",
        body: JSON.stringify({ symbol: asset.symbol, quantity: Number(quantity) }),
      });
      setTradeConfirmation(buildTradeConfirmation({
        result: {
          ...result,
          side: result.side || tradeSide,
          symbol: result.symbol || asset.symbol,
        },
        currentMidPrice: asset.current_mid_price,
        previousHolding,
      }));
      await Promise.all([fetchPortfolio(), fetchPortfolioOrders(), onTradeComplete?.()]);
    } catch (error) {
      const errorCode = String((error as Error).message || error);
      setFailureNotice(getTradeFailureNotice(errorCode, tradeSide, asset.symbol));
    } finally {
      setIsSubmitting(false);
    }
  }

  function applyQuantityPreset(preset: string) {
    if (lastQuantityPreset === preset) {
      setQuantity((current) => String((Number(current) || 0) + Number(preset)));
    } else {
      setQuantity(preset);
    }
    setLastQuantityPreset(preset);
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
                        onChange={(event) => {
                          setQuantity(event.target.value);
                          setLastQuantityPreset(null);
                        }}
                      />
                    </label>

                    <div className={detailStyles.tradePresets}>
                      {TRADE_QUANTITY_PRESETS.map((preset) => (
                        <button key={preset} type="button" className={detailStyles.presetButton} onClick={() => applyQuantityPreset(preset)}>
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

      {tradeConfirmation ? (() => {
        const isQueued = tradeConfirmation.mode === "queued";
        const isPositiveTradeTheme = tradeConfirmation.side === "buy" || (tradeConfirmation.themePnl ?? tradeConfirmation.realizedPnl ?? 0) >= 0;
        return (
          <div
            className={[
              detailStyles.tradeConfirmationOverlay,
              isTradeConfirmationClosing ? detailStyles.tradeConfirmationOverlayClosing : "",
            ].filter(Boolean).join(" ")}
            onClick={closeTradeConfirmation}
          >
            <div
              className={[
                detailStyles.tradeConfirmationFrame,
                isPositiveTradeTheme ? detailStyles.tradeConfirmationFrameBuy : detailStyles.tradeConfirmationFrameSell,
              ].join(" ")}
            >
              <div
                className={[
                  detailStyles.tradeConfirmationModal,
                  isPositiveTradeTheme ? detailStyles.tradeConfirmationModalBuy : detailStyles.tradeConfirmationModalSell,
                  isTradeConfirmationClosing ? detailStyles.tradeConfirmationModalClosing : "",
                ].filter(Boolean).join(" ")}
                role="dialog"
                aria-modal="true"
                aria-labelledby="trade-confirmation-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div
                  className={[
                    detailStyles.tradeConfirmationHero,
                    isPositiveTradeTheme ? detailStyles.tradeConfirmationHeroBuy : detailStyles.tradeConfirmationHeroSell,
                  ].join(" ")}
                >
                  <div>
                    <span className={detailStyles.tradeConfirmationEyebrow}>
                      {isQueued ? "Live Order Queued" : tradeConfirmation.side === "buy" ? "Buy Filled" : "Sell Filled"}
                    </span>
                    <h2 id="trade-confirmation-title" className={detailStyles.tradeConfirmationTitle}>
                      {isQueued
                        ? "Order queued for next tick"
                        : tradeConfirmation.side === "buy"
                          ? "Position updated"
                          : (tradeConfirmation.realizedPnl ?? 0) >= 0
                            ? `Nice! Capital gains = ${fmtNumber(tradeConfirmation.realizedPnl, "$")}`
                            : `Tough break. Capital loss = ${fmtNumber(Math.abs(tradeConfirmation.realizedPnl ?? 0), "$")}`}
                    </h2>
                    <div className={detailStyles.tradeConfirmationSubheader}>
                      <AssetCoin
                        symbol={tradeConfirmation.symbol}
                        icon={asset.icon ?? null}
                        color={asset.color ?? null}
                        className={detailStyles.tradeConfirmationTickerIcon}
                      />
                      <p className={detailStyles.tradeConfirmationCopy}>
                        <strong className={detailStyles.tradeConfirmationTicker}>${tradeConfirmation.symbol}</strong>
                        <span>
                          {isQueued
                            ? `${fmtNumber(tradeConfirmation.requestedQuantity)} shares will execute on the next 10-minute tick.`
                            : `${fmtNumber(tradeConfirmation.filledQuantity)} shares executed at ${fmtNumber(tradeConfirmation.executedPrice, "$")} per share.`}
                        </span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={detailStyles.tradeConfirmationClose}
                    onClick={closeTradeConfirmation}
                    aria-label="Close trade confirmation"
                  >
                    ×
                  </button>
                </div>

                <div className={detailStyles.tradeConfirmationBody}>
                  <div className={detailStyles.tradeConfirmationLayout}>
                    <div className={detailStyles.tradeConfirmationImageSlot}>
                      <Image
                        src={tradeConfirmation.imageSrc}
                        alt="Trade confirmation illustration"
                        width={320}
                        height={320}
                        className={detailStyles.tradeConfirmationImage}
                      />
                    </div>

                    <div className={detailStyles.tradeConfirmationContent}>
                      <div className={detailStyles.tradeConfirmationGrid}>
                        <div className={detailStyles.tradeConfirmationCard}>
                          <span>{isQueued ? "Requested Shares" : tradeConfirmation.side === "buy" ? "Total Cost" : "Gross Value"}</span>
                          <strong>{isQueued ? fmtNumber(tradeConfirmation.requestedQuantity) : fmtNumber(tradeConfirmation.side === "buy" ? tradeConfirmation.totalCost : tradeConfirmation.grossValue, "$")}</strong>
                        </div>
                        <div className={detailStyles.tradeConfirmationCard}>
                          <span>{isQueued ? "Order ID" : "Fee"}</span>
                          <strong>{isQueued ? `#${tradeConfirmation.orderId || "new"}` : fmtNumber(tradeConfirmation.fee, "$")}</strong>
                        </div>
                        <div className={detailStyles.tradeConfirmationCard}>
                          <span>{isQueued ? "Executes Around" : tradeConfirmation.side === "buy" ? "Cash Change" : "Net Proceeds"}</span>
                          <strong className={isQueued || tradeConfirmation.netCashImpact >= 0 ? detailStyles.valueUp : detailStyles.valueDown}>
                            {isQueued ? fmtDate(tradeConfirmation.executeAfter) : formatSignedCurrency(tradeConfirmation.netCashImpact)}
                          </strong>
                        </div>
                        <div className={detailStyles.tradeConfirmationCard}>
                          <span>{isQueued ? "Shares Left" : "New Cash Balance"}</span>
                          <strong>{isQueued ? `${fmtNumber(tradeConfirmation.remainingIntervalShares ?? tradeConfirmation.intervalLimit)} shares` : fmtNumber(tradeConfirmation.nextCashBalance, "$")}</strong>
                        </div>
                      </div>

                      <div className={detailStyles.tradeConfirmationColumns}>
                        <section className={detailStyles.tradeConfirmationSection}>
                          <h3>Position</h3>
                          <div className={detailStyles.tradeConfirmationMetricList}>
                            <div className={detailStyles.tradeConfirmationMetric}>
                              <span>Shares owned</span>
                              <strong>{fmtNumber(tradeConfirmation.previousQuantity)} → {fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                            </div>
                            <div className={detailStyles.tradeConfirmationMetric}>
                              <span>Average cost</span>
                              <strong>{fmtNumber(tradeConfirmation.previousAvgCost, "$")} → {fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                            </div>
                            <div className={detailStyles.tradeConfirmationMetric}>
                              <span>Marked at</span>
                              <strong>{fmtNumber(tradeConfirmation.currentMidPrice, "$")}</strong>
                            </div>
                            <div className={detailStyles.tradeConfirmationMetric}>
                              <span>{tradeConfirmation.side === "buy" ? "Estimated unrealized P/L" : "Actual realized P/L"}</span>
                              <strong className={((tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl) ?? 0) >= 0 ? detailStyles.valueUp : detailStyles.valueDown}>
                                {formatSignedCurrency(tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl)}
                              </strong>
                            </div>
                          </div>
                        </section>

                        <section className={detailStyles.tradeConfirmationSection}>
                          <h3>{tradeConfirmation.side === "buy" ? "What changed" : "Remaining position"}</h3>
                          <div className={detailStyles.tradeConfirmationMetricList}>
                            {isQueued ? (
                              <>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Side</span>
                                  <strong className={tradeConfirmation.side === "buy" ? detailStyles.valueUp : detailStyles.valueDown}>{tradeConfirmation.side.toUpperCase()}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Execution rule</span>
                                  <strong>Next 10-minute tick</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Fill check</span>
                                  <strong>Cash, holdings, and quote rechecked at execution</strong>
                                </div>
                              </>
                            ) : tradeConfirmation.side === "buy" ? (
                              <>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Shares added</span>
                                  <strong className={detailStyles.valueUp}>+{fmtNumber(tradeConfirmation.filledQuantity)}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>New weighted average</span>
                                  <strong>{fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Fill time</span>
                                  <strong>{fmtDate(tradeConfirmation.filledAt)}</strong>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Cost basis sold</span>
                                  <strong>{fmtNumber(tradeConfirmation.costBasisSold, "$")}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Shares remaining</span>
                                  <strong>{fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Remaining unrealized P/L</span>
                                  <strong className={(tradeConfirmation.unrealizedPnl ?? 0) >= 0 ? detailStyles.valueUp : detailStyles.valueDown}>
                                    {formatSignedCurrency(tradeConfirmation.unrealizedPnl)}
                                  </strong>
                                </div>
                              </>
                            )}
                          </div>
                        </section>
                      </div>

                      <div className={detailStyles.tradeConfirmationActions}>
                        <button type="button" className={detailStyles.tradeConfirmationPrimary} onClick={closeTradeConfirmation}>
                          Done
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })() : null}
    </>
  );

  return typeof document === "undefined" ? null : createPortal(flyout, document.body);
}
