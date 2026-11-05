"use client";

import { create } from "zustand";
import { GLOBAL_ROOM } from "@/app/lib/chat-rooms";

// The floating chat window: whether it's showing and which room. Kept per device, like the
// miniplayer's spot. Phones never reopen it by themselves: there it's a sheet you asked for.

const KEY = "nasfaq.chat.window";

type Store = { open: boolean; room: string };

export const useChatWindowStore = create<Store>(() => ({ open: false, room: GLOBAL_ROOM }));

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(useChatWindowStore.getState()));
  } catch {
    /* storage blocked: it just won't be remembered */
  }
}

/** Once, on the client, after the first render (the server can't know). */
export function restoreChatWindow() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Store> | null;
    if (!saved) return;
    const phone = window.matchMedia("(max-width: 720px)").matches;
    useChatWindowStore.setState({ open: Boolean(saved.open) && !phone, room: typeof saved.room === "string" && saved.room ? saved.room : GLOBAL_ROOM });
  } catch {
    /* nothing saved we can read */
  }
}

export function openChatWindow(room?: string) {
  useChatWindowStore.setState((state) => ({ open: true, room: room ?? state.room }));
  save();
}

export function closeChatWindow() {
  useChatWindowStore.setState({ open: false });
  save();
}

export function toggleChatWindow() {
  useChatWindowStore.setState((state) => ({ open: !state.open }));
  save();
}

export function setChatWindowRoom(room: string) {
  useChatWindowStore.setState({ room });
  save();
}
