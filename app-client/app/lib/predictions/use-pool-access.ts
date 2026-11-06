"use client";

import { useEffect, useState } from "react";
import { fetchPoolAccess, type PoolAccess } from "@/app/lib/predictions/pools";
import { useAuth } from "@/app/providers/auth-provider";

// Whether this player can see prediction pools yet (the prediction-pools flag: off, staff, on) and
// whether they get the bookie tools. The API decides; this asks once per sign-in.

const NONE: PoolAccess = { visible: false, bookie: false, staff: false };
const cache = new Map<string, Promise<PoolAccess>>();

export function usePoolAccess() {
  const { user } = useAuth();
  const key = user ? String(user.id) : "anon";
  const [access, setAccess] = useState<{ key: string; value: PoolAccess } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!cache.has(key)) cache.set(key, fetchPoolAccess().catch(() => NONE));
    void cache.get(key)!.then((value) => alive && setAccess({ key, value }));
    return () => {
      alive = false;
    };
  }, [key]);
  const value = access?.key === key ? access.value : null;
  return { ...(value ?? NONE), loaded: value !== null };
}
