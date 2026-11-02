"use client";

import { useEffect } from "react";
import { AnnouncementPopup } from "@/app/components/common/announcement-popup";
import { SnowLayer } from "@/app/components/snow/snow-layer";
import { StreamDock } from "@/app/components/livestreams/stream-dock";
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
          {/* Outside each page's shell so a playing stream survives moving between pages. */}
          <StreamDock />
          <AnnouncementPopup />
          {/* Beside the shell, not in it: a transformed ancestor would break position: fixed. */}
          <SnowLayer />
        </AuthProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}
