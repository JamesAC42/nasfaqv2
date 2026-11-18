"use client";

import { useEffect, useState } from "react";
import { fetchMahjongRules } from "@/app/lib/games/mahjong/api";
import type { RulesResponse } from "@/app/lib/games/mahjong/types";

// The numbers the guide quotes (clocks, limits, ranks) come from the API, so the page never says
// something the server doesn't do. One request per visit, shared by every component that asks.

let cached: RulesResponse | null = null;
let inflight: Promise<RulesResponse> | null = null;

export function useMahjongRules(): { data: RulesResponse | null; failed: boolean } {
  const [data, setData] = useState<RulesResponse | null>(cached);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (cached) return;
    let live = true;
    inflight ??= fetchMahjongRules();
    inflight
      .then((response) => {
        cached = response;
        if (live) setData(response);
      })
      .catch(() => {
        inflight = null;
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return { data, failed };
}
