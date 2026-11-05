"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { FaRegBellSlash } from "react-icons/fa6";
import { isActivePath } from "@/app/components/layout/nav-config";
import { onChatSocketEvent, reconnectChatSocket } from "@/app/lib/chat-socket";
import { useAuth } from "@/app/providers/auth-provider";
import { chatNotifyOnVisible, dismissChatToast, handleChatEventForPopups, letOutWaitingPopups, setChatNotifyViewer, setChatRoomNotify, useChatNotifyStore, type ChatToast } from "@/app/stores/chat-notify-store";
import { openChatWindow, restoreChatWindow, useChatWindowStore } from "@/app/stores/chat-window-store";
import styles from "@/app/components/chat/chat-everywhere.module.scss";

// Only downloaded by players who open the window, so every other page load stays as light as it was.
const FloatingChat = dynamic(() => import("@/app/components/chat/floating-chat").then((module) => module.FloatingChat), { ssr: false });

/** Mounted once at the app root: the popups, and the floating window when it's showing. */
export function ChatEverywhere() {
  const { user, isLoading } = useAuth();
  const viewerId = user ? Number(user.id) : null;
  const pathname = usePathname();
  const windowOpen = useChatWindowStore((state) => state.open);

  useEffect(() => {
    restoreChatWindow();
    return onChatSocketEvent(handleChatEventForPopups);
  }, []);

  // The socket and the settings belong to whoever is signed in. A socket opened while the first
  // load of the session was still out knew who it was from the cookie, so only a real change of
  // player starts it over.
  const lastViewer = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (isLoading) return;
    setChatNotifyViewer(viewerId);
    if (lastViewer.current !== undefined && lastViewer.current !== viewerId) reconnectChatSocket();
    lastViewer.current = viewerId;
  }, [isLoading, viewerId]);

  useEffect(() => {
    if (viewerId === null) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") chatNotifyOnVisible();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [viewerId]);

  // Leaving a game table lets out whatever popups waited for it.
  useEffect(() => {
    if (viewerId !== null) letOutWaitingPopups();
  }, [pathname, viewerId]);

  if (viewerId === null) return null;
  const onChatPage = isActivePath(pathname, "/chat");
  return (
    <>
      <ChatToasts onChatPage={onChatPage} />
      {/* /chat is the same thing, full size. */}
      {windowOpen && !onChatPage ? <FloatingChat /> : null}
    </>
  );
}

function ChatToasts({ onChatPage }: { onChatPage: boolean }) {
  const toasts = useChatNotifyStore((state) => state.toasts);
  if (!toasts.length) return null;
  return (
    <div className={styles.stack} aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.key} toast={toast} onChatPage={onChatPage} />
      ))}
    </div>
  );
}

function who(toast: ChatToast) {
  const [first, ...others] = toast.authors;
  if (!first) return "";
  if (toast.count === 1 || !others.length) return first;
  return others.length === 1 ? `${first} and ${others[0]}` : `${first} and ${others.length} others`;
}

function Toast({ toast, onChatPage }: { toast: ChatToast; onChatPage: boolean }) {
  const open = (event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    dismissChatToast(toast.key);
    // On /chat the link just moves to that room.
    if (onChatPage) return;
    event.preventDefault();
    openChatWindow(toast.key);
  };
  const line = toast.latest ? (toast.count === 1 ? `${who(toast)}: ${toast.latest}` : `${who(toast)} · ${toast.latest}`) : who(toast);
  return (
    <div className={styles.toast} role="status">
      <Link className={styles.toastMain} href={`/chat?channel=${encodeURIComponent(toast.key)}`} prefetch={false} onClick={open}>
        <span className={styles.toastHead}>
          <b>{toast.tag}</b>
          {toast.count > 1 ? <small>{toast.count} new</small> : null}
        </span>
        <span className={styles.toastLine}>{line}</span>
      </Link>
      <button
        type="button"
        className={styles.toastAct}
        aria-label={`Stop popups from ${toast.tag}`}
        title={`Stop popups from ${toast.tag}`}
        onClick={() => {
          dismissChatToast(toast.key);
          void setChatRoomNotify(toast.key, false).catch(() => undefined);
        }}
      >
        <FaRegBellSlash aria-hidden="true" />
      </button>
      <button type="button" className={styles.toastAct} aria-label="Dismiss" onClick={() => dismissChatToast(toast.key)}>
        ✕
      </button>
    </div>
  );
}
