"use client";

import { useEffect, useState } from "react";
import { serverNow } from "@/app/lib/games/use-games-socket";

/** Milliseconds left until a server deadline (epoch ms), ticking every `stepMs`. Null without one. */
export function useRemaining(deadline: number | null | undefined, stepMs = 200): number | null {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(serverNow()), stepMs);
    return () => window.clearInterval(timer);
  }, [deadline, stepMs]);
  if (!deadline) return null;
  return Math.max(0, deadline - now);
}
