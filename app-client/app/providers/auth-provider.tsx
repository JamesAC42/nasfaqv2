"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { apiFetch } from "@/app/lib/api";
import type { AuthUser } from "@/app/lib/types";
import { useAuthStore } from "@/app/stores/auth-store";
import { useProfileStore } from "@/app/stores/profile-store";

type AuthContextValue = {
  user: AuthUser | null;
  initialized: boolean;
  isLoading: boolean;
  error: string | null;
  refreshSession: () => Promise<AuthUser | null>;
  login: (username: string, password: string, turnstileToken?: string) => Promise<AuthUser>;
  register: (username: string, email: string, password: string, ogey: string, turnstileToken?: string) => Promise<AuthUser>;
  loginWithGoogle: (credential: string, turnstileToken?: string) => Promise<AuthUser>;
  resendVerification: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const initialized = useAuthStore((state) => state.initialized);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);
  const setUser = useAuthStore((state) => state.setUser);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const setLoading = useAuthStore((state) => state.setLoading);
  const setError = useAuthStore((state) => state.setError);
  const clearPortfolio = useProfileStore((state) => state.clearPortfolio);
  const hasBootstrappedRef = useRef(false);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ user: AuthUser }>("/api/auth/me");
      setUser(result.user);
      setInitialized(true);
      return result.user;
    } catch {
      setUser(null);
      setInitialized(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setError, setInitialized, setLoading, setUser]);

  const login = useCallback(
    async (username: string, password: string, turnstileToken?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password, turnstile_token: turnstileToken }),
        });
        setUser(result.user);
        setInitialized(true);
        return result.user;
      } catch (error) {
        const message = String((error as Error).message || error);
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [setError, setInitialized, setLoading, setUser]
  );

  const register = useCallback(
    async (username: string, email: string, password: string, ogey: string, turnstileToken?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ username, email, password, ogey, turnstile_token: turnstileToken }),
        });
        setUser(result.user);
        setInitialized(true);
        return result.user;
      } catch (error) {
        const message = String((error as Error).message || error);
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [setError, setInitialized, setLoading, setUser]
  );

  const loginWithGoogle = useCallback(
    async (credential: string, turnstileToken?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/google", {
          method: "POST",
          body: JSON.stringify({ credential, turnstile_token: turnstileToken }),
        });
        setUser(result.user);
        setInitialized(true);
        return result.user;
      } catch (error) {
        const message = String((error as Error).message || error);
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [setError, setInitialized, setLoading, setUser]
  );

  const resendVerification = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>("/api/auth/resend-verification", {
        method: "POST",
        body: "{}",
      });
    } catch (error) {
      const message = String((error as Error).message || error);
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [setError, setLoading]);

  const logout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<{ ok: boolean }>("/api/auth/logout", {
        method: "POST",
        body: "{}",
      });
      setUser(null);
      clearPortfolio();
    } catch (error) {
      const message = String((error as Error).message || error);
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [clearPortfolio, setError, setLoading, setUser]);

  useEffect(() => {
    if (initialized || isLoading || hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;
    void refreshSession();
  }, [initialized, isLoading, refreshSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initialized,
      isLoading,
      error,
      refreshSession,
      login,
      register,
      loginWithGoogle,
      resendVerification,
      logout,
    }),
    [error, initialized, isLoading, login, loginWithGoogle, logout, refreshSession, register, resendVerification, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
