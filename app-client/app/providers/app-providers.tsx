"use client";

import { AuthProvider } from "@/app/providers/auth-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
