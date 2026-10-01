import type { PortfolioSummary } from "@/app/lib/types";

// Cash and Credit (api/src/services/economy.js). Cash buys shares. Credit is what games, the capsule
// machine, the card exchange and predictions spend, and where dividends and winnings land; part of
// it turns into Cash every Saturday. Some rules are still open, so the server says which are in force
// (portfolio.economy).

/** Whether games, the exchange and predictions dip into Cash once Credit runs out (BBB: they do). */
export function sideModesUseCash(portfolio: PortfolioSummary | null | undefined): boolean {
  return portfolio?.economy?.side_mode_funds === "credit_then_cash";
}

/** What games, the exchange and predictions can spend: Credit, plus Cash if they fall back to it. */
export function sideModeFunds(portfolio: PortfolioSummary | null | undefined): number | null {
  if (!portfolio) return null;
  const fallsBack = portfolio.economy?.side_mode_funds === "credit_then_cash";
  return Math.max(0, portfolio.credit_balance) + (fallsBack ? Math.max(0, portfolio.cash_balance) : 0);
}

/** The money side of net worth: Cash (spendable and held for queued buys), and Credit if it counts. */
export function netWorthCash(portfolio: PortfolioSummary): number {
  return portfolio.cash_balance + portfolio.held_cash + (portfolio.economy?.net_worth === "cash_and_credit" ? portfolio.credit_balance : 0);
}
