"use client";

import { useEffect } from "react";
import { AuthProvider } from "@/app/providers/auth-provider";
import { MotionProvider } from "@/app/providers/motion-provider";
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
      <MotionProvider>
        <AuthProvider>
          <MarketRealtimeConnector />
          {children}
        </AuthProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}
