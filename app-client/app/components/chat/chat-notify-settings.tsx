"use client";

import Link from "next/link";
import { useState } from "react";
import { isRoomOn, setChatPopupsEnabled, setChatRoomNotify, unmuteChatPlayer, useChatNotifyStore } from "@/app/stores/chat-notify-store";
import styles from "@/app/components/chat/chat-everywhere.module.scss";

/** The chat section on /notifications: the overall switch, the rooms on your list, who you've muted. */
export function ChatNotifySettings() {
  const loaded = useChatNotifyStore((state) => state.loaded);
  const enabled = useChatNotifyStore((state) => state.enabled);
  const rooms = useChatNotifyStore((state) => state.rooms);
  const muted = useChatNotifyStore((state) => state.muted);
  const [error, setError] = useState<string | null>(null);

  const run = (work: Promise<unknown>) => {
    setError(null);
    void work.catch((reason) => setError(String((reason as Error).message || reason)));
  };

  if (!loaded) return null;
  const list = Object.values(rooms).sort((a, b) => a.tag.localeCompare(b.tag));
  return (
    <section className={styles.settings} id="chat" aria-label="Chat popups">
      <h2>Chat popups</h2>
      <p>
        A small popup when someone talks in a room you chose or one you&apos;ve posted in during the last 30 days. Busy rooms get bunched into one popup a minute. Calm mode keeps them still and shows them less often. Add a room with the bell in its header on <Link href="/chat">chat</Link>.
      </p>
      <label className={styles.settingLabel}>
        <input type="checkbox" checked={enabled} onChange={(event) => run(setChatPopupsEnabled(event.target.checked))} />
        Show chat popups
      </label>
      {error ? <p className={styles.settingErr}>Couldn&apos;t save that ({error}).</p> : null}
      {list.length ? (
        <div className={styles.settingList} aria-label="Your rooms">
          <span className={styles.settingHead}>Your rooms</span>
          {list.map((room) => (
            <label key={room.key} className={styles.settingLabel}>
              <input type="checkbox" checked={isRoomOn(room)} disabled={!enabled} onChange={(event) => run(setChatRoomNotify(room.key, event.target.checked))} />
              {room.tag}
              <small>{room.notify === true ? "you chose this" : room.notify === false ? "turned off" : "you posted here"}</small>
            </label>
          ))}
        </div>
      ) : (
        <p>No rooms yet. Post in one, or press the bell in its header.</p>
      )}
      {muted.length ? (
        <div className={styles.settingList} aria-label="Players you muted">
          <span className={styles.settingHead}>Players you muted</span>
          {muted.map((player) => (
            <div key={player.id} className={styles.settingRow}>
              <Link href={`/profile/${encodeURIComponent(player.username)}`}>{player.username}</Link>
              <button type="button" className={styles.settingBtn} onClick={() => run(unmuteChatPlayer(player.id))}>
                Unmute
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
