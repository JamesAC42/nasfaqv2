"use client";

import { useEffect } from "react";
import { AuthProvider } from "@/app/providers/auth-provider";
import { ThemeProvider } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";

function MarketRealtimeConnector() {
  const connectRealtime = useMarketStore((state) => state.connectRealtime);

  useEffect(() => {
    return connectRealtime();
  }, [connectRealtime]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MarketRealtimeConnector />
        {children}
      </AuthProvider>
    </ThemeProvider>
  );
}
