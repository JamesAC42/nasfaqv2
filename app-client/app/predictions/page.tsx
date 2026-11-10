import type { Metadata } from "next";
import { Suspense } from "react";
import { PredictionsFloor } from "@/app/components/predictions/floor/predictions-floor";

export const metadata: Metadata = { title: "Predictions" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PredictionsFloor />
    </Suspense>
  );
}
