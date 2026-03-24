"use client";

import { create } from "zustand";
import type { AuthUser } from "@/app/lib/types";

type AuthState = {
  user: AuthUser | null;
  initialized: boolean;
  isLoading: boolean;
  error: string | null;
  setUser: (user: AuthUser | null) => void;
  setInitialized: (initialized: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  isLoading: false,
  error: null,
  setUser: (user) => set({ user }),
  setInitialized: (initialized) => set({ initialized }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      user: null,
      initialized: false,
      isLoading: false,
      error: null,
    }),
}));
