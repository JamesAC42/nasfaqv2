"use client";

import { useState } from "react";
import { FaRegBell, FaRegBellSlash } from "react-icons/fa6";
import { isRoomOn, setChatRoomNotify, useChatNotifyStore } from "@/app/stores/chat-notify-store";

/** One room's popups, on or off. In the /chat header and the floating window's bar. */
export function RoomNotifyButton({ roomKey, roomName, className }: { roomKey: string; roomName: string; className?: string }) {
  const on = useChatNotifyStore((state) => isRoomOn(state.rooms[roomKey]));
  const everywhereOff = useChatNotifyStore((state) => state.loaded && !state.enabled);
  const [busy, setBusy] = useState(false);
  const label = everywhereOff ? `Popups are off everywhere. Press to get them for ${roomName} when they're back on` : on ? `Stop popups from ${roomName}` : `Get popups from ${roomName}`;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void setChatRoomNotify(roomKey, !on)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      {on ? <FaRegBell aria-hidden="true" /> : <FaRegBellSlash aria-hidden="true" />}
    </button>
  );
}
