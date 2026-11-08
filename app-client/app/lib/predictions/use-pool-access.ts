"use client";

import { useFeature, useFeatures } from "@/app/lib/features";
import { useAuth } from "@/app/providers/auth-provider";

// Pools and margin are behind the prediction-pools flag (api/src/features/prediction-pools.json). The
// API withholds pools from anyone the flag doesn't cover; this only decides which links and tools to
// show: whether pools show at all, and whether this player gets the bookie and staff tools.

export function usePoolAccess() {
  const visible = useFeature("prediction-pools");
  const flags = useFeatures();
  const { user } = useAuth();
  return {
    visible,
    bookie: visible && Boolean(user?.is_admin || user?.is_bookie),
    staff: visible && Boolean(user?.is_admin || user?.can_void_prediction_markets || user?.can_resolve_prediction_markets),
    /** The API has answered for this viewer (every flag is listed then). */
    loaded: "prediction-pools" in flags,
  };
}
