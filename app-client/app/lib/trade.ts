import { pickTradeConfirmationImage } from "@/app/lib/trade-confirmation-images";

// Order submission helpers shared by the trade drawer and older trade panels.

export type TradeSide = "buy" | "sell";

export type TradeFailureNotice = {
  title: string;
  message: string;
};

export type TradeExecutionResult = {
  order_id?: number | string;
  status?: "pending" | "filled" | "cancelled" | "rejected";
  order_type?: "market" | "live_market";
  requested_quantity?: number;
  execute_after?: string | null;
  interval_limit?: number;
  remaining_interval_shares?: number | null;
  remaining_tick_shares?: number | null;
  indicative_price?: number;
  filled_quantity?: number;
  executed_price?: number;
  fee?: number;
  total_cost?: number | null;
  total_proceeds?: number | null;
  cost_basis_sold?: number | null;
  realized_pnl?: number | null;
  side?: TradeSide;
  symbol?: string;
  updated_holdings?: {
    quantity: number;
    avg_cost_basis: number;
  } | null;
  updated_cash_balance?: number | null;
  filled_at?: string | null;
};

export type TradeConfirmation = {
  mode: "filled" | "queued";
  orderId: number | string | null;
  side: TradeSide;
  symbol: string;
  requestedQuantity: number;
  executeAfter: string | null;
  intervalLimit: number | null;
  remainingIntervalShares: number | null;
  filledQuantity: number;
  executedPrice: number;
  fee: number;
  grossValue: number;
  netCashImpact: number;
  totalCost: number | null;
  totalProceeds: number | null;
  costBasisSold: number | null;
  previousQuantity: number;
  previousAvgCost: number;
  nextQuantity: number;
  nextAvgCost: number;
  nextCashBalance: number | null;
  currentMidPrice: number | null;
  filledAt: string | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  themePnl: number | null;
  imageSrc: string;
};


export function getTradeFailureNotice(errorCode: string, side: TradeSide, symbol: string): TradeFailureNotice {
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
        title: "Live limit reached",
        message: "This order would exceed your live share limit for the next execution tick.",
      };
    default:
      return {
        title: "Trade failed",
        message: `This ${side} order for ${symbol} could not be completed. Please try again.`,
      };
  }
}

export function buildTradeConfirmation(args: {
  result: TradeExecutionResult & { side: TradeSide; symbol: string };
  currentMidPrice: number | null | undefined;
  previousHolding: { quantity: number; avg_cost_basis: number } | null;
}): TradeConfirmation {
  const { result, currentMidPrice, previousHolding } = args;
  const previousQuantity = previousHolding?.quantity ?? 0;
  const previousAvgCost = previousHolding?.avg_cost_basis ?? 0;
  const isQueued = result.order_type === "live_market" && result.status === "pending";
  const filledQuantity = result.filled_quantity ?? 0;
  const executedPrice = result.executed_price ?? (result.indicative_price ?? 0);
  const fee = result.fee ?? 0;
  const grossValue = filledQuantity * executedPrice;
  const requestedQuantity = result.requested_quantity ?? filledQuantity;
  const nextQuantity = result.updated_holdings?.quantity ?? (result.side === "buy" ? previousQuantity + filledQuantity : previousQuantity - filledQuantity);
  const nextAvgCost = result.updated_holdings?.avg_cost_basis ?? (nextQuantity > 0 ? previousAvgCost : 0);
  const totalCost = result.total_cost ?? (result.side === "buy" ? grossValue + fee : null);
  const totalProceeds = result.total_proceeds ?? (result.side === "sell" ? grossValue - fee : null);
  const costBasisSold = result.cost_basis_sold ?? (result.side === "sell" ? previousAvgCost * filledQuantity : null);
  const netCashImpact = result.side === "buy" ? -(totalCost ?? (grossValue + fee)) : (totalProceeds ?? (grossValue - fee));
  const realizedPnl =
    result.side === "sell"
      ? (result.realized_pnl ?? ((totalProceeds ?? (grossValue - fee)) - (costBasisSold ?? 0)))
      : null;
  const unrealizedPnl =
    currentMidPrice !== null && currentMidPrice !== undefined && nextQuantity > 0
      ? nextQuantity * (currentMidPrice - nextAvgCost)
      : null;
  const expectedSellPnl =
    result.side === "sell" && isQueued
      ? (requestedQuantity * executedPrice) - fee - (previousAvgCost * requestedQuantity)
      : null;
  const themePnl = result.side === "sell" ? (expectedSellPnl ?? realizedPnl) : null;
  const imageSrc = pickTradeConfirmationImage(result.side, themePnl);

  return {
    mode: isQueued ? "queued" : "filled",
    orderId: result.order_id ?? null,
    side: result.side,
    symbol: result.symbol,
    requestedQuantity,
    executeAfter: result.execute_after ?? null,
    intervalLimit: result.interval_limit ?? null,
    remainingIntervalShares: result.remaining_interval_shares ?? result.remaining_tick_shares ?? null,
    filledQuantity,
    executedPrice,
    fee,
    grossValue,
    netCashImpact,
    totalCost,
    totalProceeds,
    costBasisSold,
    previousQuantity,
    previousAvgCost,
    nextQuantity,
    nextAvgCost,
    nextCashBalance: result.updated_cash_balance ?? null,
    currentMidPrice: currentMidPrice ?? null,
    filledAt: result.filled_at ?? null,
    realizedPnl,
    unrealizedPnl,
    themePnl,
    imageSrc,
  };
}
