"use client";

import { usePathname } from "next/navigation";
import { FaRegComments } from "react-icons/fa6";
import { isActivePath } from "@/app/components/layout/nav-config";
import { useChatNotifyStore } from "@/app/stores/chat-notify-store";
import { toggleChatWindow, useChatWindowStore } from "@/app/stores/chat-window-store";

type ShellClasses = { button: string; hot: string; badge: string; icon: string };

/**
 * The speech bubbles in the top bar, beside the bell: shows or hides the floating chat window, and
 * counts what's new in the rooms on your list. Nothing floats until someone presses this.
 */
export function ChatButton({ classes }: { classes: ShellClasses }) {
  const pathname = usePathname();
  const unread = useChatNotifyStore((state) => state.unreadTotal);
  const open = useChatWindowStore((state) => state.open);
  const onChatPage = isActivePath(pathname, "/chat");
  const label = onChatPage ? "You're in chat" : open ? "Hide the chat window" : "Show the chat window";
  return (
    <button
      type="button"
      className={[classes.button, unread ? classes.hot : ""].filter(Boolean).join(" ")}
      aria-label={unread ? `${label}: ${unread} new` : label}
      aria-pressed={open && !onChatPage}
      title={label}
      disabled={onChatPage}
      onClick={toggleChatWindow}
    >
      <FaRegComments className={classes.icon} aria-hidden />
      {unread ? <span className={classes.badge}>{unread > 99 ? "99+" : unread}</span> : null}
    </button>
  );
}
