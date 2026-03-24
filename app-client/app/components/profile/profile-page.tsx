"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtNumber } from "@/app/lib/format";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/profile/profile-page.module.scss";

export function ProfilePage() {
  const { user, refreshSession } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const isLoadingPortfolio = useProfileStore((state) => state.isLoadingPortfolio);
  const portfolioError = useProfileStore((state) => state.portfolioError);
  const adminBusy = useProfileStore((state) => state.adminBusy);
  const adminStatus = useProfileStore((state) => state.adminStatus);
  const adminError = useProfileStore((state) => state.adminError);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const clearPortfolio = useProfileStore((state) => state.clearPortfolio);
  const resetMarket = useProfileStore((state) => state.resetMarket);
  const rebuildMarket = useProfileStore((state) => state.rebuildMarket);
  const refreshMarketOverview = useMarketStore((state) => state.refreshOverview);

  useEffect(() => {
    void (async () => {
      const nextUser = await refreshSession();
      if (nextUser) {
        await fetchPortfolio();
      } else {
        clearPortfolio();
      }
    })();
  }, [clearPortfolio, fetchPortfolio, refreshSession]);

  async function handleReset() {
    await resetMarket();
    await Promise.allSettled([fetchPortfolio(), refreshMarketOverview()]);
  }

  async function handleRebuild() {
    await rebuildMarket();
    await Promise.allSettled([fetchPortfolio(), refreshMarketOverview()]);
  }

  return (
    <SiteShell>
      {!user ? (
        <section className={styles.panel}>
          <h2 className={styles.title}>Profile</h2>
          <div className={styles.empty}>
            You need an authenticated session to load profile data. <Link href="/login">Login</Link> or <Link href="/register">register</Link>.
          </div>
        </section>
      ) : (
        <div className={styles.grid}>
          <section className={styles.panel}>
            <div>
              <h2 className={styles.title}>Profile</h2>
              <p className={styles.copy}>Auth and profile are now separated. This page owns user-centric data and market administration.</p>
            </div>
            <div className={styles.stats}>
              <div className={styles.statCard}><span className={styles.label}>Username</span><strong>{user.username}</strong></div>
              <div className={styles.statCard}><span className={styles.label}>User ID</span><strong>{user.id}</strong></div>
              <div className={styles.statCard}><span className={styles.label}>Created</span><strong>{user.created_at}</strong></div>
              <div className={styles.statCard}><span className={styles.label}>Session State</span><strong>Authenticated</strong></div>
            </div>
            <div>
              <h3 className={styles.title}>Market Admin</h3>
              <p className={styles.copy}>
                Reset wipes derived market, trade, and portfolio state while preserving users and raw `yt.*` history. Rebuild bootstraps assets, recalculates fundamentals, and settles history.
              </p>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void handleReset()} disabled={adminBusy !== false}>
                {adminBusy === "reset" ? "Resetting…" : "Reset Market"}
              </button>
              <button type="button" className={styles.primary} onClick={() => void handleRebuild()} disabled={adminBusy !== false}>
                {adminBusy === "rebuild" ? "Rebuilding…" : "Rebuild Full Market"}
              </button>
            </div>
            {adminError ? <div className="statusMessage statusMessageError">Admin error: {adminError}</div> : null}
            {adminStatus ? <div className="statusMessage statusMessageSuccess">{adminStatus}</div> : null}
          </section>

          <section className={styles.panel}>
            <div>
              <h2 className={styles.title}>Portfolio</h2>
              <p className={styles.copy}>Portfolio state lives in the profile store and can now be restyled without touching the home route.</p>
            </div>
            {isLoadingPortfolio ? <div className={styles.empty}>Loading portfolio…</div> : null}
            {portfolioError ? <div className="statusMessage statusMessageError">Portfolio error: {portfolioError}</div> : null}
            {portfolio ? (
              <>
                <div className={styles.stats}>
                  <div className={styles.statCard}><span className={styles.label}>Cash</span><strong>{fmtNumber(portfolio.cash_balance)}</strong></div>
                  <div className={styles.statCard}><span className={styles.label}>Market Value</span><strong>{fmtNumber(portfolio.total_market_value)}</strong></div>
                  <div className={styles.statCard}><span className={styles.label}>Unrealized PnL</span><strong>{fmtNumber(portfolio.total_unrealized_pnl)}</strong></div>
                  <div className={styles.statCard}><span className={styles.label}>Total Equity</span><strong>{fmtNumber(portfolio.total_equity)}</strong></div>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Qty</th>
                        <th>Avg Cost</th>
                        <th>Mid</th>
                        <th>Value</th>
                        <th>PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.holdings.map((holding) => (
                        <tr key={holding.asset_id}>
                          <td>{holding.symbol}</td>
                          <td>{fmtNumber(holding.quantity)}</td>
                          <td>{fmtNumber(holding.avg_cost_basis)}</td>
                          <td>{fmtNumber(holding.current_mid_price)}</td>
                          <td>{fmtNumber(holding.market_value)}</td>
                          <td>{fmtNumber(holding.unrealized_pnl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : !isLoadingPortfolio ? (
              <div className={styles.empty}>No portfolio data available for the current session.</div>
            ) : null}
          </section>
        </div>
      )}
    </SiteShell>
  );
}
