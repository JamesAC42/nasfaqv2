"use client";

import { useEffect, useRef, useState } from "react";
import { FaVolumeHigh, FaVolumeXmark } from "react-icons/fa6";
import { installSoundUnlock, playCue, useSoundSettings } from "@/app/lib/games/mahjong/sound";
import styles from "@/app/components/games/mahjong/table/table-page.module.scss";

/** The speaker in the table's header: one press mutes or unmutes; the small arrow opens the volume. */
export function SoundControl() {
  const { muted, volume, setMuted, setVolume } = useSoundSettings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    installSoundUnlock();
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const off = muted || volume <= 0;
  return (
    <span ref={box} className={styles.sound}>
      <button
        type="button"
        className={styles.round}
        aria-label={muted ? "Turn sound on" : "Mute sound"}
        aria-pressed={muted}
        title={muted ? "Sound is off" : "Sound is on"}
        onClick={() => {
          setMuted(!muted);
          if (muted) window.setTimeout(() => playCue("ui_click"), 30);
        }}
      >
        {off ? <FaVolumeXmark aria-hidden="true" /> : <FaVolumeHigh aria-hidden="true" />}
      </button>
      <button type="button" className={styles.soundMore} aria-label="Volume" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <i aria-hidden="true" />
      </button>
      {open ? (
        <span className={styles.soundPanel} role="group" aria-label="Sound">
          <label>
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(volume * 100)}
              onChange={(event) => setVolume(Number(event.target.value) / 100)}
              onPointerUp={() => playCue("discard")}
              aria-label="Volume"
            />
            <b>{Math.round(volume * 100)}</b>
          </label>
          <button type="button" className={styles.leave} onClick={() => setMuted(!muted)}>
            {muted ? "Sound on" : "Mute"}
          </button>
        </span>
      ) : null}
    </span>
  );
}
