"use client";

import { AuthProvider } from "@/app/providers/auth-provider";
import { ThemeProvider } from "@/app/providers/theme-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
