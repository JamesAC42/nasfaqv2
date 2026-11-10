"use client";

import { useEffect, useLayoutEffect } from "react";
import { ChatEverywhere } from "@/app/components/chat/chat-everywhere";
import { AnnouncementPopup } from "@/app/components/common/announcement-popup";
import { VisitCounter } from "@/app/components/layout/visit-counter";
import { SnowLayer } from "@/app/components/snow/snow-layer";
import { StreamDock } from "@/app/components/livestreams/stream-dock";
import { AuthProvider } from "@/app/providers/auth-provider";
import { MotionProvider } from "@/app/providers/motion-provider";
import { ThemeProvider } from "@/app/providers/theme-provider";
import { restoreRootPreferences } from "@/app/lib/root-preferences";
import { useMarketStore } from "@/app/stores/market-store";

function MarketRealtimeConnector() {
  const connectRealtime = useMarketStore((state) => state.connectRealtime);

  useEffect(() => {
    return connectRealtime();
  }, [connectRealtime]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  // A no-op after a clean load. After a failed hydration React has reset <html>, and this puts the
  // player's theme, season and calm mode back before the rebuilt page paints.
  useLayoutEffect(() => {
    restoreRootPreferences();
  }, []);

  return (
    <ThemeProvider>
      <MotionProvider>
        <AuthProvider>
          <MarketRealtimeConnector />
          <VisitCounter />
          {children}
          {/* Outside each page's shell so a playing stream survives moving between pages. */}
          <StreamDock />
          <ChatEverywhere />
          <AnnouncementPopup />
          {/* Beside the shell, not in it: a transformed ancestor would break position: fixed. */}
          <SnowLayer />
        </AuthProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}
