import type { Metadata } from "next";
import { Suspense } from "react";
import { PoolHistory } from "@/app/components/predictions/pool/pool-history";
import { requireFeature } from "@/app/lib/features-server";

// Behind the prediction-pools flag (api/src/features): a 404 for anyone it isn't on for.

export async function generateMetadata(): Promise<Metadata> {
  await requireFeature("prediction-pools");
  return { title: "Pool history" };
}

export default async function Page() {
  await requireFeature("prediction-pools");
  return (
    <Suspense fallback={null}>
      <PoolHistory />
    </Suspense>
  );
}
