"use client";

import { useMemo } from "react";
import { SECTIONS } from "@/app/components/how-to-play/content";
import { useFeatures } from "@/app/lib/features";

/** The guide's sections for this viewer: the ones behind a feature flag appear only when it is on for them. */
export function useVisibleSections() {
  const features = useFeatures();
  return useMemo(() => SECTIONS.filter((section) => !section.flag || features[section.flag] === true), [features]);
}
