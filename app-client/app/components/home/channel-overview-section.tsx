import { fmtDate, fmtInteger } from "@/app/lib/format";
import type { ChannelOverviewRow } from "@/app/lib/types";
import styles from "@/app/components/home/channel-overview-section.module.scss";

export function ChannelOverviewSection({ channels }: { channels: ChannelOverviewRow[] }) {
  return (
    <section className={styles.section}>
      <div>
        <h2 className={styles.title}>Channel Snapshot Overview</h2>
        <p className={styles.copy}>Channel data now lives in its own store so this area can be redesigned independently.</p>
      </div>
      {channels.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>YT Channel ID</th>
                <th>Subscribers</th>
                <th>Views</th>
                <th>Videos</th>
                <th>Snapshot Time</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((row) => (
                <tr key={row.channel.youtube_channel_id}>
                  <td>{row.channel.name || row.channel.name_short || "—"}</td>
                  <td>{row.channel.youtube_channel_id}</td>
                  <td>{fmtInteger(row.latest?.subscriber_count)}</td>
                  <td>{fmtInteger(row.latest?.view_count)}</td>
                  <td>{fmtInteger(row.latest?.video_count)}</td>
                  <td>{fmtDate(row.latest?.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>No channel snapshots loaded.</div>
      )}
    </section>
  );
}
