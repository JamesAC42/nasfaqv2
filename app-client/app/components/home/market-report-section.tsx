import { fmtNumber, fmtPct } from "@/app/lib/format";
import type { DailyReport, ReportRow } from "@/app/lib/types";
import styles from "@/app/components/home/market-report-section.module.scss";

function ReportList({
  title,
  rows,
  mode,
}: {
  title: string;
  rows: ReportRow[];
  mode: "premium" | "move" | "volume";
}) {
  return (
    <div className={styles.listCard}>
      <h3>{title}</h3>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={`${title}-${row.symbol}`}>
            <strong>{row.symbol}</strong> {row.display_name}{" "}
            {mode === "premium" ? fmtPct(row.premium_pct) : mode === "move" ? fmtPct(row.move_pct) : fmtNumber(row.volume_cash)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketReportSection({ report }: { report: DailyReport | null }) {
  if (!report) {
    return <section className={styles.section}><div className={styles.empty}>No daily report found yet.</div></section>;
  }

  return (
    <section className={styles.section}>
      <div>
        <h2 className={styles.title}>Latest Market Report</h2>
        <p className={styles.copy}>Market date {report.market_date} · assets settled {report.asset_count}</p>
      </div>
      <div className={styles.grid}>
        <ReportList title="Largest Premiums" rows={report.largest_premiums || []} mode="premium" />
        <ReportList title="Largest Discounts" rows={report.largest_discounts || []} mode="premium" />
        <ReportList title="Top Movers" rows={report.top_price_movers || []} mode="move" />
        <ReportList title="Top Volume" rows={report.top_volume || []} mode="volume" />
      </div>
    </section>
  );
}
