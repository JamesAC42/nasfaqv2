import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";

export type NotificationKind =
  | "friend_request"
  | "friend_accepted"
  | "mention"
  | "reply"
  | "achievement"
  | "prediction_won"
  | "prediction_lost"
  | "prediction_void"
  | "proposal_approved"
  | "exchange"
  | "wishlist"
  | "dividend"
  | "buyback";

export type NotificationItem = {
  id: number;
  kind: NotificationKind | string;
  title: string;
  body: string;
  href: string | null;
  actor: { id: number; username: string | null } | null;
  data: Record<string, unknown>;
  created_at: string;
  read: boolean;
};

type ListResponse = { notifications: NotificationItem[]; unread: number; has_more: boolean };

function normalize(raw: Record<string, unknown>): NotificationItem {
  const actor = raw.actor && typeof raw.actor === "object" ? (raw.actor as Record<string, unknown>) : null;
  return {
    id: Number(raw.id || 0),
    kind: String(raw.kind || ""),
    title: String(raw.title || ""),
    body: String(raw.body || ""),
    href: raw.href ? String(raw.href) : null,
    actor: actor ? { id: Number(actor.id || 0), username: actor.username ? String(actor.username) : null } : null,
    data: raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : {},
    created_at: String(raw.created_at || ""),
    read: Boolean(raw.read),
  };
}

type NotificationStore = {
  items: NotificationItem[];
  unread: number;
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  /** Marks everything read on the server; the dots stay until `settle()` so you can see what was new. */
  markAllRead: () => Promise<void>;
  markRead: (ids: number[]) => Promise<void>;
  settle: () => void;
  receive: (raw: Record<string, unknown>) => void;
  reset: () => void;
};

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  items: [],
  unread: 0,
  loaded: false,
  loading: false,
  hasMore: false,
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const data = await apiFetch<ListResponse>("/api/notifications?limit=20");
      set({ items: (data.notifications || []).map((row) => normalize(row as unknown as Record<string, unknown>)), unread: Number(data.unread || 0), hasMore: Boolean(data.has_more), loaded: true });
    } catch {
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },
  loadMore: async () => {
    const { items, loading, hasMore } = get();
    if (loading || !hasMore || !items.length) return;
    set({ loading: true });
    try {
      const data = await apiFetch<ListResponse>(`/api/notifications?limit=30&before=${items[items.length - 1].id}`);
      const more = (data.notifications || []).map((row) => normalize(row as unknown as Record<string, unknown>));
      set((state) => ({ items: [...state.items, ...more.filter((row) => !state.items.some((item) => item.id === row.id))], hasMore: Boolean(data.has_more) }));
    } finally {
      set({ loading: false });
    }
  },
  refreshUnread: async () => {
    try {
      const data = await apiFetch<{ unread: number }>("/api/notifications/unread");
      const unread = Number(data.unread || 0);
      // Something arrived that the socket didn't bring (another server, a dropped connection).
      if (unread > get().unread && get().loaded) void get().load();
      else set({ unread });
    } catch {
      /* signed out or offline */
    }
  },
  markAllRead: async () => {
    if (!get().unread) return;
    set({ unread: 0 });
    try {
      await apiFetch("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) });
    } catch {
      /* the next refresh sets it right */
    }
  },
  markRead: async (ids) => {
    const fresh = ids.filter((id) => get().items.some((item) => item.id === id && !item.read));
    if (!fresh.length) return;
    set((state) => ({ items: state.items.map((item) => (fresh.includes(item.id) ? { ...item, read: true } : item)), unread: Math.max(0, state.unread - fresh.length) }));
    try {
      const data = await apiFetch<{ unread: number }>("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids: fresh }) });
      set({ unread: Number(data.unread || 0) });
    } catch {
      /* ignore */
    }
  },
  settle: () => set((state) => ({ items: state.items.map((item) => (item.read ? item : { ...item, read: true })) })),
  receive: (raw) => {
    const item = normalize(raw);
    if (!item.id || get().items.some((row) => row.id === item.id)) return;
    set((state) => ({ items: [item, ...state.items].slice(0, 100), unread: state.unread + 1 }));
  },
  reset: () => set({ items: [], unread: 0, loaded: false, hasMore: false }),
}));
