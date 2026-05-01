const TRADE_CONFIRMATION_BUY_IMAGES = [
  "/trade-confirmations/buy-1.webp",
  "/trade-confirmations/buy-2.webp",
  "/trade-confirmations/buy-3.webp",
  "/trade-confirmations/buy-4.webp",
] as const;

const TRADE_CONFIRMATION_SELL_LOSS_IMAGES = [
  "/trade-confirmations/sell-loss-1.webp",
  "/trade-confirmations/sell-loss-2.webp",
  "/trade-confirmations/sell-loss-3.webp",
  "/trade-confirmations/sell-loss-4.webp",
  "/trade-confirmations/sell-loss-5.webp",
  "/trade-confirmations/sell-loss-6.webp",
] as const;

const TRADE_CONFIRMATION_SELL_GAIN_IMAGES = [
  "/trade-confirmations/sell-gain-1.webp",
  "/trade-confirmations/sell-gain-2.webp",
  "/trade-confirmations/sell-gain-3.webp",
  "/trade-confirmations/sell-gain-4.webp",
  "/trade-confirmations/sell-gain-5.webp",
] as const;

function pickRandomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

export function pickTradeConfirmationImage(side: "buy" | "sell", themePnl: number | null | undefined) {
  if (side === "buy") {
    return pickRandomItem(TRADE_CONFIRMATION_BUY_IMAGES);
  }
  return (themePnl ?? 0) >= 0
    ? pickRandomItem(TRADE_CONFIRMATION_SELL_GAIN_IMAGES)
    : pickRandomItem(TRADE_CONFIRMATION_SELL_LOSS_IMAGES);
}
